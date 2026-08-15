import { Howl, Howler } from "howler";

const audioUnlockEvents = ["touchstart", "touchend", "pointerdown", "click", "keydown"] as const;
const resumeTimeoutMs = 650;
const howlerHtml5PoolSize = 10;

export type AudioPlaybackSegment = {
  key?: string;
  url: string;
};

export type AudioPlaybackCue = {
  index: number;
  atMs: number;
};

export type AudioPlaybackInfo = {
  durationMs: number;
};

export type AudioPlaybackProgress = AudioPlaybackInfo & {
  currentMs: number;
};

export type AudioPlaybackRequest = {
  id: string;
  segments: AudioPlaybackSegment[];
  loop?: boolean;
  cues?: AudioPlaybackCue[];
  onStarted?: (info: AudioPlaybackInfo) => void;
  onProgress?: (progress: AudioPlaybackProgress) => void;
  onCue?: (cue: AudioPlaybackCue) => void;
  onEnded?: () => void;
  onStop?: (reason: string) => void;
  onError?: () => void;
};

type LoadedPlaybackSegment = AudioPlaybackSegment & {
  howl: Howl;
  durationMs: number;
};

type ActiveSound = {
  howl: Howl;
  soundId: number;
  cleanup: () => void;
};

type ActivePlayback = {
  id: string;
  generation: number;
  request: AudioPlaybackRequest;
  segments: LoadedPlaybackSegment[];
  soundRefs: ActiveSound[];
  frameId: number;
  segmentIndex: number;
  elapsedBeforeSegmentMs: number;
  durationMs: number;
  startedEmitted: boolean;
  reachedCueIndexes: Set<number>;
  onStop?: (reason: string) => void;
};

type WakeLockSentinelLike = EventTarget & {
  release: () => Promise<void>;
};

type NavigatorWithWakeLock = Navigator & {
  wakeLock?: {
    request: (type: "screen") => Promise<WakeLockSentinelLike>;
  };
};

let activePlayback: ActivePlayback | undefined;
let pendingPlaybackId = "";
let playbackGeneration = 0;
let audioUnlocked = false;
let howlerConfigured = false;
let wakeLockListenersInstalled = false;
let activeWakeLock: WakeLockSentinelLike | undefined;
let wakeLockRequestGeneration = 0;
let wakeLockRequestPending = false;
const howlCache = new Map<string, Promise<Howl>>();

configureHowler();

export function getSharedAudioContext() {
  configureHowler();
  const context = Howler.ctx;
  return context && context.state !== "closed" ? context : undefined;
}

export function getRunningSharedAudioContext() {
  const context = getSharedAudioContext();
  return context?.state === "running" ? context : undefined;
}

export function isAudioPlaybackActive(id?: string) {
  return Boolean(activePlayback && (!id || activePlayback.id === id));
}

export function unlockAudioEngine() {
  configureHowler();
  if (Howler.noAudio) {
    return false;
  }

  const context = getSharedAudioContext();
  if (!context) {
    audioUnlocked = true;
    return true;
  }

  if (context.state === "running") {
    audioUnlocked = true;
    return true;
  }

  void context.resume().then(markAudioUnlocked).catch(() => {});
  return audioUnlocked || isAudioContextRunning(context);
}

export async function ensureAudioEngineRunning() {
  configureHowler();
  if (Howler.noAudio) {
    return undefined;
  }

  const context = getSharedAudioContext();
  if (!context) {
    audioUnlocked = true;
    return undefined;
  }

  if (context.state !== "running") {
    await Promise.race([
      context.resume().then(markAudioUnlocked).catch(() => undefined),
      new Promise<void>((resolve) => window.setTimeout(resolve, resumeTimeoutMs))
    ]);
  }

  return context.state === "running" ? context : undefined;
}

export function installAudioUnlockListeners(target: Document = document) {
  const options: AddEventListenerOptions = { capture: true, passive: true };
  const handleAudioUnlock = () => {
    unlockAudioEngine();
  };

  for (const eventName of audioUnlockEvents) {
    target.addEventListener(eventName, handleAudioUnlock, options);
  }

  return () => {
    for (const eventName of audioUnlockEvents) {
      target.removeEventListener(eventName, handleAudioUnlock, options);
    }
  };
}

export async function preloadAudioSegments(segments: AudioPlaybackSegment[]) {
  const loadedSegments = await loadPlaybackSegments(segments);
  if (!loadedSegments.length) {
    return undefined;
  }

  return {
    durationMs: totalDurationMs(loadedSegments)
  };
}

export async function playAudio(request: AudioPlaybackRequest) {
  const segments = request.segments.filter((segment) => segment.url);
  if (!segments.length) {
    request.onError?.();
    return false;
  }

  configureHowler();
  void ensureAudioEngineRunning();
  stopActivePlayback("replaced", true);

  const generation = ++playbackGeneration;
  pendingPlaybackId = request.id;

  try {
    const loadedSegments = await loadPlaybackSegments(segments);
    if (generation !== playbackGeneration) {
      return false;
    }

    pendingPlaybackId = "";
    activePlayback = {
      id: request.id,
      generation,
      request,
      segments: loadedSegments,
      soundRefs: [],
      frameId: 0,
      segmentIndex: 0,
      elapsedBeforeSegmentMs: 0,
      durationMs: totalDurationMs(loadedSegments),
      startedEmitted: false,
      reachedCueIndexes: new Set<number>(),
      onStop: request.onStop
    };

    return startHowlerSegment(activePlayback, 0);
  } catch {
    if (generation === playbackGeneration) {
      pendingPlaybackId = "";
      request.onError?.();
    }
    return false;
  }
}

export function stopAudioPlayback(reason = "stop", id?: string) {
  if (id && activePlayback?.id !== id && pendingPlaybackId !== id) {
    return;
  }

  playbackGeneration += 1;
  pendingPlaybackId = "";
  stopActivePlayback(reason, true);
}

function configureHowler() {
  if (howlerConfigured) {
    return;
  }

  Howler.autoUnlock = true;
  Howler.html5PoolSize = Math.max(Howler.html5PoolSize, howlerHtml5PoolSize);
  howlerConfigured = true;
  installWakeLockListeners();
}

async function loadPlaybackSegments(segments: AudioPlaybackSegment[]) {
  const loadedSegments: LoadedPlaybackSegment[] = [];

  for (const segment of segments) {
    const howl = await loadHowl(segment.url);
    loadedSegments.push({
      ...segment,
      howl,
      durationMs: howlDurationMs(howl)
    });
  }

  return loadedSegments;
}

function loadHowl(url: string) {
  const cached = howlCache.get(url);
  if (cached) {
    return cached;
  }

  const howl = new Howl({
    src: [url],
    html5: true,
    preload: "metadata",
    pool: 1
  });

  const loading = new Promise<Howl>((resolve, reject) => {
    const resolveLoaded = () => {
      cleanup();
      resolve(howl);
    };
    const rejectLoad = (_soundId: number, error: unknown) => {
      cleanup();
      howlCache.delete(url);
      howl.unload();
      reject(error);
    };
    const cleanup = () => {
      howl.off("load", resolveLoaded);
      howl.off("loaderror", rejectLoad);
    };

    howl.once("load", resolveLoaded);
    howl.once("loaderror", rejectLoad);

    if (howl.state() === "loaded") {
      resolveLoaded();
    }
  });

  howlCache.set(url, loading);
  return loading;
}

function startHowlerSegment(playback: ActivePlayback, segmentIndex: number) {
  if (!isCurrentPlayback(playback) || segmentIndex >= playback.segments.length) {
    return false;
  }

  playback.segmentIndex = segmentIndex;
  const segment = playback.segments[segmentIndex];
  const loop = playback.request.loop === true && playback.segments.length === 1;
  let soundId = Number.NaN;
  let soundRef: ActiveSound | undefined;
  let cleanedUp = false;

  const isExpectedSound = (eventSoundId: number) => soundId === eventSoundId;
  function cleanup() {
    if (cleanedUp) {
      return;
    }
    cleanedUp = true;
    try {
      segment.howl.off("play", handlePlay);
      segment.howl.off("end", handleEnd);
      segment.howl.off("playerror", handlePlayError);
    } catch (error) {
      warnNonFatalAudioError("cleanup", error);
    }
  }

  function handlePlay(playedSoundId: number) {
    if (!isExpectedSound(playedSoundId)) {
      return;
    }
    if (!isCurrentSegmentSound(playback, segmentIndex, soundRef)) {
      cleanup();
      return;
    }

    if (!playback.startedEmitted) {
      playback.startedEmitted = true;
      playback.request.onStarted?.({ durationMs: playback.durationMs });
    }

    requestPlaybackWakeLock(playback);
    startProgressTicker(playback);
  }

  function handleEnd(endedSoundId: number) {
    if (!isExpectedSound(endedSoundId)) {
      return;
    }
    if (!isCurrentSegmentSound(playback, segmentIndex, soundRef)) {
      cleanup();
      return;
    }

    if (loop) {
      startProgressTicker(playback);
      return;
    }

    finishSegmentPlayback(playback, segmentIndex, soundRef);
  }

  function handlePlayError(errorSoundId: number, _error: unknown) {
    if (!isExpectedSound(errorSoundId)) {
      return;
    }
    if (!isCurrentSegmentSound(playback, segmentIndex, soundRef)) {
      cleanup();
      return;
    }

    handlePlaybackError(playback);
  }

  segment.howl.on("play", handlePlay);
  segment.howl.on("end", handleEnd);
  segment.howl.on("playerror", handlePlayError);

  try {
    soundId = segment.howl.play();
  } catch (error) {
    cleanup();
    warnNonFatalAudioError("play", error);
    handlePlaybackError(playback);
    return false;
  }

  if (!Number.isFinite(soundId)) {
    cleanup();
    handlePlaybackError(playback);
    return false;
  }

  soundRef = { howl: segment.howl, soundId, cleanup };
  playback.soundRefs = [...playback.soundRefs, soundRef];
  try {
    segment.howl.loop(loop, soundId);
  } catch (error) {
    warnNonFatalAudioError("loop", error);
  }

  try {
    if (segment.howl.playing(soundId)) {
      handlePlay(soundId);
    }
  } catch (error) {
    warnNonFatalAudioError("playing", error);
  }

  return true;
}

function startProgressTicker(playback: ActivePlayback) {
  if (playback.frameId) {
    window.cancelAnimationFrame(playback.frameId);
  }

  const tick = () => {
    if (!isCurrentPlayback(playback)) {
      return;
    }

    playback.durationMs = Math.max(playback.durationMs, totalDurationMs(playback.segments));
    const currentMs = currentPlaybackMs(playback);
    playback.request.onProgress?.({ currentMs, durationMs: playback.durationMs });
    emitReachedCues(playback.request, playback.reachedCueIndexes, currentMs);
    playback.frameId = window.requestAnimationFrame(tick);
  };

  tick();
}

function currentPlaybackMs(playback: ActivePlayback) {
  const current = playback.soundRefs[playback.soundRefs.length - 1];
  if (!current) {
    return playback.elapsedBeforeSegmentMs;
  }

  let seekSeconds: number | Howl;
  try {
    seekSeconds = current.howl.seek(current.soundId);
  } catch (error) {
    warnNonFatalAudioError("seek", error);
    return playback.elapsedBeforeSegmentMs;
  }
  const seekMs = typeof seekSeconds === "number" && Number.isFinite(seekSeconds) ? Math.max(0, seekSeconds * 1000) : 0;
  return Math.min(playback.durationMs, playback.elapsedBeforeSegmentMs + seekMs);
}

function handlePlaybackError(playback: ActivePlayback) {
  stopActivePlayback("play_failed", false);
  playback.request.onError?.();
}

function finishSegmentPlayback(playback: ActivePlayback, segmentIndex: number, soundRef: ActiveSound | undefined) {
  if (!isCurrentSegmentSound(playback, segmentIndex, soundRef)) {
    soundRef?.cleanup();
    return;
  }

  const segment = playback.segments[segmentIndex];
  playback.elapsedBeforeSegmentMs += segment.durationMs || howlDurationMs(segment.howl);
  if (soundRef) {
    // Howler の end 通知後に内部 stop が走るため、終了済み音源は参照だけ外す。
    forgetSoundRef(playback, soundRef);
  }

  const nextSegmentIndex = segmentIndex + 1;
  if (nextSegmentIndex < playback.segments.length) {
    startHowlerSegment(playback, nextSegmentIndex);
    return;
  }

  stopActivePlayback("ended", false);
  playback.request.onEnded?.();
}

function stopActivePlayback(reason: string, emitStop: boolean) {
  const playback = activePlayback;
  activePlayback = undefined;
  releasePlaybackWakeLock();

  if (!playback) {
    return;
  }

  if (playback.frameId) {
    window.cancelAnimationFrame(playback.frameId);
  }

  for (const soundRef of [...playback.soundRefs]) {
    releaseSoundRef(playback, soundRef);
  }

  if (emitStop) {
    playback.onStop?.(reason);
  }
}

function releaseSoundRef(playback: ActivePlayback, soundRef: ActiveSound) {
  forgetSoundRef(playback, soundRef);
  try {
    soundRef.howl.stop(soundRef.soundId);
  } catch (error) {
    warnNonFatalAudioError("stop", error);
  }
}

function forgetSoundRef(playback: ActivePlayback, soundRef: ActiveSound) {
  soundRef.cleanup();
  playback.soundRefs = playback.soundRefs.filter((entry) => entry !== soundRef);
}

function emitReachedCues(request: AudioPlaybackRequest, reachedCueIndexes: Set<number>, currentMs: number) {
  if (!request.cues?.length) {
    return;
  }

  for (const cue of request.cues) {
    if (reachedCueIndexes.has(cue.index) || currentMs < cue.atMs) {
      continue;
    }

    reachedCueIndexes.add(cue.index);
    request.onCue?.(cue);
  }
}

function totalDurationMs(segments: LoadedPlaybackSegment[]) {
  return segments.reduce((sum, segment) => sum + (segment.durationMs || howlDurationMs(segment.howl)), 0);
}

function howlDurationMs(howl: Howl) {
  const durationSeconds = howl.duration();
  return Number.isFinite(durationSeconds) ? Math.max(0, durationSeconds * 1000) : 0;
}

function isCurrentPlayback(playback: ActivePlayback) {
  return activePlayback === playback && playback.generation === playbackGeneration;
}

function isCurrentSegmentSound(playback: ActivePlayback, segmentIndex: number, soundRef: ActiveSound | undefined) {
  // iOS 復帰時に古い end/play が遅れて届いても、現在のセグメント以外は無視する。
  return (
    isCurrentPlayback(playback) &&
    playback.segmentIndex === segmentIndex &&
    Boolean(soundRef && playback.soundRefs.includes(soundRef))
  );
}

function markAudioUnlocked() {
  audioUnlocked = true;
}

function isAudioContextRunning(context: AudioContext) {
  return context.state === "running";
}

function warnNonFatalAudioError(action: string, error: unknown) {
  console.warn(`[audioEngine:${action}]`, error);
}

function installWakeLockListeners() {
  if (wakeLockListenersInstalled || typeof document === "undefined") {
    return;
  }

  wakeLockListenersInstalled = true;
  document.addEventListener("visibilitychange", handleWakeLockVisibilityChange);
}

function handleWakeLockVisibilityChange() {
  if (document.hidden) {
    releasePlaybackWakeLock();
    return;
  }

  requestPlaybackWakeLock(activePlayback);
}

function requestPlaybackWakeLock(playback: ActivePlayback | undefined) {
  if (
    !playback ||
    !isCurrentPlayback(playback) ||
    playback.request.loop === true ||
    !isPlaybackSoundPlaying(playback) ||
    activeWakeLock ||
    wakeLockRequestPending ||
    typeof navigator === "undefined" ||
    typeof document === "undefined" ||
    document.hidden
  ) {
    return;
  }

  const wakeLock = (navigator as NavigatorWithWakeLock).wakeLock;
  if (!wakeLock) {
    return;
  }

  const requestGeneration = ++wakeLockRequestGeneration;
  wakeLockRequestPending = true;
  void wakeLock
    .request("screen")
    .then((sentinel) => {
      wakeLockRequestPending = false;
      if (!isCurrentPlayback(playback) || requestGeneration !== wakeLockRequestGeneration || document.hidden) {
        void sentinel.release().catch(() => undefined);
        return;
      }

      activeWakeLock = sentinel;
      sentinel.addEventListener(
        "release",
        () => {
          if (activeWakeLock === sentinel) {
            activeWakeLock = undefined;
          }
        },
        { once: true }
      );
    })
    .catch(() => {
      wakeLockRequestPending = false;
    });
}

function releasePlaybackWakeLock() {
  wakeLockRequestGeneration += 1;
  wakeLockRequestPending = false;
  const wakeLock = activeWakeLock;
  activeWakeLock = undefined;

  if (!wakeLock) {
    return;
  }

  void wakeLock.release().catch(() => undefined);
}

function isPlaybackSoundPlaying(playback: ActivePlayback) {
  const soundRef = playback.soundRefs[playback.soundRefs.length - 1];
  if (!soundRef) {
    return false;
  }

  try {
    return soundRef.howl.playing(soundRef.soundId);
  } catch (error) {
    warnNonFatalAudioError("playing", error);
    return false;
  }
}
