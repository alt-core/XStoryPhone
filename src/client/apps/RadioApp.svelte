<script lang="ts">
  import { onDestroy, onMount, tick } from "svelte";
  import { Play, Radio, Send, Share2, Square, TriangleAlert, X } from "@lucide/svelte";
  import type { RadioEpisodeItem, TalkShareTarget } from "../scenario-runtime/types";
  import {
    getRunningSharedAudioContext,
    preloadAudioSegments,
    type AudioPlaybackSegment
  } from "../system/audioEngine";
  import { corruptionNoiseStyle } from "../system/corruptionNoise";
  import ScrollHint from "../system/ScrollHint.svelte";
  import { captionAt } from "../system/timedTranscript";
  import AppShell from "./AppShell.svelte";
  import ShareTargetPicker from "./ShareTargetPicker.svelte";

  type AudioCue = NonNullable<RadioEpisodeItem["audioCues"]>[number];
  type PlaybackSegment = AudioPlaybackSegment;
  type RadioPlaybackStartRequest = {
    item: RadioEpisodeItem;
    audioKey: string;
    segments: PlaybackSegment[];
    cues: AudioCue[];
  };
  type RadioFormSubmitResult = { ok: true; gameOver?: boolean } | { ok: false; error?: string; message?: string };
  const broadcastWaitingTitle = "放送開始をお待ちください";
  const broadcastWaitingBody = "しばらく待ってから、ページのリロードをお試しください。";

  export let items: RadioEpisodeItem[] = [];
  export let focusContentId = "";
  export let focusContentRequestId = 0;
  export let autoplayContentId = "";
  export let autoplayRequestId = 0;
  export let onNoise: () => void = () => {};
  export let onContentOpen: (contentId: string) => void = () => {};
  export let onBlockedContentOpen: (contentId: string) => void = () => {};
  export let onModalOpenChange: (open: boolean) => void = () => {};
  export let shareTargets: TalkShareTarget[] = [];
  export let onShareContent: (target: TalkShareTarget, content: { contentId: string; title: string }) => void = () => {};
  export let playbackItemId = "";
  export let playbackAudioKey = "";
  export let playbackCurrentMs = 0;
  export let playbackDurationMs = 0;
  export let playbackLoadingItemId = "";
  export let playbackRequestId = 0;
  export let playbackFocusRequestId = 0;
  export let onStartPlayback: (request: RadioPlaybackStartRequest) => Promise<boolean> | boolean = () => false;
  export let onStopPlayback: (item?: RadioEpisodeItem) => void = () => {};
  export let onSubmitRadioForm: (formId: string, fields: Record<string, string>) => Promise<RadioFormSubmitResult> = async () => ({
    ok: false,
    error: "unavailable",
    message: "投稿を送信できません。"
  });

  let selectedItemId = "";
  let selectedAudioKey = "";
  let playlistLoading = false;
  let preloadToken = 0;
  let broadcastFrameElement: HTMLIFrameElement | null = null;
  let preparing = false;
  let broadcastModalOpen = false;
  let sharePickerOpen = false;
  let broadcastSubmissionPending = false;
  let broadcastSubmissionAccepted = false;
  let lastReportedContentId = "";
  let lastAppliedFocusContentId = "";
  let lastAppliedFocusContentRequestId = focusContentRequestId;
  let lastAutoplayRequestId = 0;
  let lastAppliedPlaybackRequestId = 0;
  let lastAppliedPlaybackFocusRequestId = 0;
  let preloadDurationMs = 0;

  $: if (items.length > 0 && (!selectedItemId || !items.some((item) => item.id === selectedItemId))) {
    selectedItemId = items[0].id;
  }
  $: if (!focusContentId) {
    lastAppliedFocusContentId = "";
    lastAppliedFocusContentRequestId = focusContentRequestId;
  } else if (focusContentId !== lastAppliedFocusContentId || focusContentRequestId !== lastAppliedFocusContentRequestId) {
    const focused = items.find((item) => item.contentId === focusContentId);
    if (focused) {
      lastAppliedFocusContentId = focusContentId;
      lastAppliedFocusContentRequestId = focusContentRequestId;
      selectedItemId = focused.id;
      if (focused.corrupted) {
        onBlockedContentOpen(focused.contentId ?? focused.id);
      }
    }
  }
  $: selectedItem = items.find((item) => item.id === selectedItemId);
  $: selectedItemContentId = selectedItem && !selectedItem.corrupted ? selectedItem.contentId ?? selectedItem.id : "";
  $: if (selectedItemContentId && selectedItemContentId !== lastReportedContentId) {
    lastReportedContentId = selectedItemContentId;
    onContentOpen(selectedItemContentId);
  }
  $: selectedPlaybackSegments = selectedItem && !selectedItem.corrupted ? playbackSegmentsForItem(selectedItem) : [];
  $: playbackDisabledLabel = selectedItem && !selectedItem.corrupted ? selectedItem.playbackDisabledLabel?.trim() ?? "" : "";
  $: broadcastWaiting = Boolean(
    selectedItem && !selectedItem.corrupted && !playbackDisabledLabel && itemHasPendingGeneratedAudio(selectedItem)
  );
  $: playbackBlockedReason = playbackDisabledLabel || (broadcastWaiting ? broadcastWaitingTitle : "");
  $: playbackBlocked = Boolean(playbackBlockedReason);
  $: hasPlaybackSegments = selectedPlaybackSegments.length > 0;
  $: selectedRadioForm = selectedItem?.form?.kind === "html" ? selectedItem.form : null;
  $: selectedFormDisabled = Boolean(selectedRadioForm?.disabled);
  $: selectedShareContent =
    selectedItem && !selectedItem.corrupted
      ? {
          contentId: selectedItem.contentId ?? selectedItem.id,
          title: selectedItem.programTitle
        }
      : null;
  $: if (
    (!selectedRadioForm || (selectedFormDisabled && !broadcastSubmissionPending && !broadcastSubmissionAccepted)) &&
    broadcastModalOpen
  ) {
    closeBroadcastModal();
  }
  $: if ((!selectedShareContent || !shareTargets.length) && sharePickerOpen) {
    closeSharePicker();
  }
  $: if (playbackRequestId !== lastAppliedPlaybackRequestId) {
    lastAppliedPlaybackRequestId = playbackRequestId;
    focusPlaybackItem();
  }
  $: if (playbackFocusRequestId !== lastAppliedPlaybackFocusRequestId) {
    lastAppliedPlaybackFocusRequestId = playbackFocusRequestId;
    focusPlaybackItem();
  }
  $: isSelectedPlaying = Boolean(selectedItem && playbackItemId === selectedItem.id);
  $: isSelectedLoading = Boolean(selectedItem && (playbackLoadingItemId === selectedItem.id || playlistLoading));
  $: currentMs = isSelectedPlaying ? playbackCurrentMs : 0;
  $: activeCaption = isSelectedPlaying ? captionAt(selectedItem?.transcript, currentMs) : "";
  $: durationMs = isSelectedPlaying ? playbackDurationMs : preloadDurationMs;
  $: progressPercent = durationMs > 0 ? Math.min(100, Math.max(0, (currentMs / durationMs) * 100)) : 0;
  $: currentTimeLabel = formatPlaybackTime(currentMs);
  $: durationTimeLabel = durationMs > 0 ? formatPlaybackTime(durationMs) : "--:--";
  $: nextAudioKey =
    selectedItem && !selectedItem.corrupted
      ? [
          selectedItem.id,
          playbackBlocked ? `blocked:${playbackBlockedReason}` : "ready",
          selectedPlaybackSegments.map((segment) => `${segment.key}=${segment.url}`).join("|")
        ].join(":")
      : selectedItem?.id ?? "";
  $: if (nextAudioKey !== selectedAudioKey) {
    const preserveActivePlayback = Boolean(selectedItem && playbackItemId === selectedItem.id && playbackAudioKey === nextAudioKey);
    selectedAudioKey = nextAudioKey;
    if (!preserveActivePlayback) {
      resetPlaybackForSelection();
    }
    if (!preserveActivePlayback && !playbackBlocked && getRunningSharedAudioContext()) {
      void preloadSelectedPlayback();
    }
  }
  $: if (autoplayRequestId !== lastAutoplayRequestId) {
    lastAutoplayRequestId = autoplayRequestId;
    if (autoplayContentId) {
      void autoplayContent(autoplayContentId);
    }
  }

  onMount(() => {
    window.addEventListener("xstoryphone:stop-audio-playback", handleGlobalAudioStop);
    window.addEventListener("message", handleRadioFormMessage);

    return () => {
      window.removeEventListener("xstoryphone:stop-audio-playback", handleGlobalAudioStop);
      window.removeEventListener("message", handleRadioFormMessage);
    };
  });

  onDestroy(() => {
    preloadToken += 1;
    onModalOpenChange(false);
  });

  function handleGlobalAudioStop() {
    stopPlayback();
  }

  async function handleRadioFormMessage(event: MessageEvent) {
    if (!broadcastFrameElement?.contentWindow || event.source !== broadcastFrameElement.contentWindow) {
      return;
    }

    const message = event.data as { type?: unknown; requestId?: unknown; fields?: unknown };
    if (!message || message.type !== "xstoryphone:submitRadioForm" || typeof message.requestId !== "string") {
      return;
    }

    const fields =
      message.fields && typeof message.fields === "object" && !Array.isArray(message.fields)
        ? Object.fromEntries(
            Object.entries(message.fields)
              .filter(([, value]) => typeof value === "string")
              .map(([key, value]) => [key, value as string])
          )
        : {};
    const result = await submitCurrentRadioForm(fields);
    event.source.postMessage(
      {
        type: "xstoryphone:submitRadioForm:result",
        requestId: message.requestId,
        result
      },
      "*"
    );
  }

  function selectItem(itemId: string) {
    const item = items.find((entry) => entry.id === itemId);

    if (!item) {
      onNoise();
      return;
    }

    if (item.id !== selectedItemId) {
      closeBroadcastModal();
      closeSharePicker();
    }

    selectedItemId = itemId;
    if (item.corrupted) {
      onBlockedContentOpen(item.contentId ?? item.id);
    }
  }

  function showStationListNoise() {
    onNoise();
  }

  function stopPlayback() {
    onStopPlayback(selectedItem);
    playlistLoading = false;
  }

  function focusPlaybackItem() {
    const playbackItem = playbackItemId ? items.find((item) => item.id === playbackItemId && !item.corrupted) : undefined;
    if (playbackItem) {
      selectedItemId = playbackItem.id;
    }
  }

  function resetPlaybackForSelection() {
    preloadToken += 1;
    playlistLoading = false;
    preloadDurationMs = 0;
  }

  function formatPlaybackTime(valueMs: number) {
    const totalSeconds = Math.max(0, Math.floor(valueMs / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, "0")}`;
  }

  function playbackSegmentsForItem(item: RadioEpisodeItem): PlaybackSegment[] {
    if (item.audioSegments?.length) {
      const segments: PlaybackSegment[] = [];
      for (const [index, segment] of item.audioSegments.entries()) {
        const url = segment.audioUrl ?? "";
        if (url) {
          segments.push({ key: `${segment.kind}:${"genAudioId" in segment ? segment.genAudioId : index}:${index}`, url });
        }
      }
      return segments;
    }

    return item.audioUrl ? [{ key: `audio:${item.audioUrl}:0`, url: item.audioUrl }] : [];
  }

  function itemHasPendingGeneratedAudio(item: RadioEpisodeItem) {
    return Boolean(item.audioSegments?.some((segment) => segment.kind === "generated" && !segment.audioUrl));
  }

  async function preloadSelectedPlayback() {
    const item = selectedItem;
    const audioKey = selectedAudioKey;
    const segments = [...selectedPlaybackSegments];
    const token = ++preloadToken;

    if (!item || playbackBlocked || !segments.length) {
      preloadDurationMs = 0;
      playlistLoading = false;
      return;
    }

    playlistLoading = true;
    try {
      const preload = await preloadAudioSegments(segments);

      if (token !== preloadToken || audioKey !== selectedAudioKey) {
        return;
      }

      preloadDurationMs = preload?.durationMs ?? 0;
    } catch {
      if (token === preloadToken) {
        preloadDurationMs = 0;
      }
    } finally {
      if (token === preloadToken) {
        playlistLoading = false;
      }
    }
  }

  async function toggleSelectedItemPlayback() {
    if (!selectedItem || playbackBlocked || !hasPlaybackSegments || isSelectedLoading) {
      return;
    }

    if (isSelectedPlaying) {
      stopPlayback();
      return;
    }

    await startSelectedItemPlayback();
  }

  async function startSelectedItemPlayback() {
    if (!selectedItem || playbackBlocked || !hasPlaybackSegments) {
      return;
    }

    const item = selectedItem;

    const audioKey = selectedAudioKey;
    playlistLoading = true;
    await onStartPlayback({
      item,
      audioKey,
      segments: selectedPlaybackSegments,
      cues: item.audioCues ?? []
    });

    if (selectedAudioKey === audioKey) {
      playlistLoading = false;
    }
  }

  async function autoplayContent(contentId: string) {
    const item = items.find((entry) => (entry.contentId ?? entry.id) === contentId);
    if (!item || item.corrupted) {
      return;
    }

    closeBroadcastModal();
    selectedItemId = item.id;
    await tick();

    if (selectedItem?.id === item.id && playbackItemId !== item.id && playbackLoadingItemId !== item.id) {
      await startSelectedItemPlayback();
    }
  }

  function openBroadcastModal() {
    if (!selectedRadioForm || selectedFormDisabled) {
      return;
    }

    broadcastSubmissionPending = false;
    broadcastSubmissionAccepted = false;
    broadcastModalOpen = true;
    syncModalOpen();
  }

  function closeBroadcastModal() {
    if (!broadcastModalOpen) {
      return;
    }

    broadcastModalOpen = false;
    broadcastSubmissionPending = false;
    broadcastSubmissionAccepted = false;
    syncModalOpen();
  }

  function openSharePicker() {
    if (!selectedShareContent || !shareTargets.length) {
      onNoise();
      return;
    }

    sharePickerOpen = true;
    syncModalOpen();
  }

  function closeSharePicker() {
    if (!sharePickerOpen) {
      return;
    }

    sharePickerOpen = false;
    syncModalOpen();
  }

  function syncModalOpen() {
    onModalOpenChange(broadcastModalOpen || sharePickerOpen);
  }

  function selectShareTarget(target: TalkShareTarget) {
    const content = selectedShareContent;
    if (!content) {
      return;
    }

    onShareContent(target, content);
    closeSharePicker();
  }

  function itemCorruptionNoiseStyle(item: RadioEpisodeItem) {
    return corruptionNoiseStyle(item.contentId ?? item.id);
  }

  function normalizeFormFields(fields: Record<string, string>) {
    return Object.fromEntries(
      Object.entries(fields)
        .filter(([key, value]) => key.trim() && typeof value === "string")
        .map(([key, value]) => [key.trim(), value.trim()])
    );
  }

  async function submitCurrentRadioForm(fields: Record<string, string>) {
    const form = selectedRadioForm;
    if (preparing || selectedFormDisabled || !form) {
      const result = { ok: false as const, error: "not_ready", message: "まだ投稿できません。" };
      return result;
    }

    preparing = true;
    broadcastSubmissionPending = true;
    const result = await onSubmitRadioForm(form.id, normalizeFormFields(fields)).catch(() => ({
      ok: false as const,
      error: "network_error",
      message: "投稿の送信に失敗しました。"
    }));
    preparing = false;

    if (!result.ok) {
      broadcastSubmissionPending = false;
      return result;
    }

    if (result.gameOver) {
      closeBroadcastModal();
      return result;
    }

    broadcastSubmissionAccepted = true;
    broadcastSubmissionPending = false;
    return result;
  }
</script>

<AppShell title="ラジオ" accent="#f4c86a">
  <div class="radio-app">
    <section
      class="playback-panel"
      class:empty={!selectedItem}
      class:corrupted={selectedItem?.corrupted}
      class:waiting={broadcastWaiting}
      style={selectedItem?.corrupted ? itemCorruptionNoiseStyle(selectedItem) : ""}
      aria-label={selectedItem?.programTitle ?? "再生"}
    >
      {#if selectedItem?.corrupted}
        <span class="repair-label">&lt;ERROR コンテンツへのリンクが破損しています&gt;</span>
      {:else if selectedItem}
        <div class="panel-head">
          <h2>{selectedItem.programTitle}</h2>
          <div class="panel-actions">
            <button
              class="share-open"
              type="button"
              disabled={!selectedShareContent || !shareTargets.length}
              aria-label="共有"
              title="共有"
              on:click={openSharePicker}
            >
              <Share2 size={15} strokeWidth={2.35} />
            </button>
            {#if selectedRadioForm}
              <button
                class="broadcast-open"
                type="button"
                disabled={selectedFormDisabled}
                on:click={openBroadcastModal}
              >
                <Send size={14} strokeWidth={2.35} />
                <span>番組への投稿</span>
              </button>
            {/if}
          </div>
        </div>
        {#if broadcastWaiting}
          <div class="broadcast-waiting" role="status">
            <div class="broadcast-waiting-head">
              <TriangleAlert size={24} strokeWidth={2.2} aria-hidden="true" />
              <strong>{broadcastWaitingTitle}</strong>
            </div>
            <p>{broadcastWaitingBody}</p>
          </div>
        {:else}
          <div class="transport-stage" class:playing={isSelectedPlaying}>
            {#if isSelectedPlaying}
              <div class="transport-ripples" aria-hidden="true">
                <span></span>
                <span></span>
                <span></span>
              </div>
            {/if}
            <button
              type="button"
              class="transport-button"
              class:playing={isSelectedPlaying}
              on:click={toggleSelectedItemPlayback}
              disabled={playbackBlocked || !hasPlaybackSegments || isSelectedLoading}
              aria-label={playbackBlocked ? playbackBlockedReason : isSelectedPlaying ? "停止" : "再生"}
            >
              {#if isSelectedPlaying}
                <Square size={27} strokeWidth={2.4} fill="currentColor" />
              {:else}
                <Play size={31} strokeWidth={2.2} fill="currentColor" />
              {/if}
            </button>
            {#if isSelectedPlaying}
              <span class="transport-home-hint">再生したままホームに戻れます</span>
            {/if}
            {#if playbackBlocked}
              <span class="transport-disabled-reason" aria-hidden="true">{playbackBlockedReason}</span>
            {/if}
            {#if activeCaption}
              <p class="radio-caption" aria-live="polite">{activeCaption}</p>
            {/if}
          </div>
          <div
            class="progress-stack"
            aria-label={playbackBlocked ? playbackBlockedReason : `再生位置 ${currentTimeLabel} / ${durationTimeLabel}`}
          >
            <div class="progress-track" aria-hidden="true">
              <span style={`width: ${progressPercent}%`}></span>
            </div>
            <div class="time-row">
              <span>{currentTimeLabel}</span>
              <span>{durationTimeLabel}</span>
            </div>
          </div>
        {/if}
      {:else}
        <div class="player-empty" aria-hidden="true">
          <Radio size={38} strokeWidth={1.9} />
          <span>----</span>
        </div>
      {/if}
    </section>

    <div class="library-head">
      <span><Radio size={15} strokeWidth={2.1} /> ブックマーク</span>
      <strong>{items.length}</strong>
    </div>

    <div class="radio-main">
      <ScrollHint enabled={items.length > 3} step={76}>
        <div class="episode-list" class:scrolling={items.length > 3} aria-label="ブックマーク済み番組">
          {#each items as item}
            <button
              type="button"
              class:active={item.id === selectedItem?.id}
              class:corrupted={item.corrupted}
              on:click={() => selectItem(item.id)}
            >
              <strong>{item.programTitle}</strong>
            </button>
          {/each}
        </div>
      </ScrollHint>
    </div>

    <nav class="radio-tabs" aria-label="ラジオ表示切替">
      <button class="active" type="button">
        <Radio size={16} strokeWidth={2.2} />
        <span>ブックマーク</span>
      </button>
      <button type="button" on:click={showStationListNoise}>
        <span>放送局一覧</span>
      </button>
    </nav>

    {#if broadcastModalOpen && selectedItem && selectedRadioForm}
      <div class="broadcast-modal-backdrop" role="presentation">
        <div
          class="broadcast-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="broadcast-modal-title"
        >
          <header class="broadcast-modal-head">
            <div>
              <span>{selectedItem.programTitle}</span>
              <strong id="broadcast-modal-title">{selectedRadioForm.label}</strong>
            </div>
            <button type="button" aria-label="閉じる" on:click={closeBroadcastModal}>
              <X size={18} strokeWidth={2.3} />
            </button>
          </header>

          <iframe
            bind:this={broadcastFrameElement}
            class="broadcast-frame"
            src={selectedRadioForm.url}
            title={selectedRadioForm.label}
            sandbox="allow-forms allow-scripts"
          ></iframe>
        </div>
      </div>
    {/if}
    <ShareTargetPicker
      open={sharePickerOpen}
      targets={shareTargets}
      contentTitle={selectedShareContent?.title ?? ""}
      accent="#f4c86a"
      onSelect={selectShareTarget}
      onClose={closeSharePicker}
    />
  </div>
</AppShell>

<style>
  h2 {
    margin: 0;
  }

  .radio-app {
    position: relative;
    display: grid;
    grid-template-rows: 238px auto minmax(0, 1fr);
    gap: 9px;
    min-height: 0;
    height: 100%;
    padding: 12px 14px 116px;
    overflow: hidden;
  }

  .playback-panel {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr) auto;
    align-content: space-between;
    gap: 10px;
    width: 100%;
    min-height: 0;
    padding: 16px;
    border: 1px solid rgba(244, 200, 106, 0.2);
    border-radius: var(--ap-radius-panel);
    background:
      linear-gradient(180deg, rgba(244, 200, 106, 0.13), rgba(255, 255, 255, 0.045) 52%, rgba(0, 0, 0, 0.08)),
      var(--ap-surface-1);
    box-shadow:
      var(--ap-shadow-inset),
      0 18px 36px rgba(0, 0, 0, 0.18);
  }

  .playback-panel.empty {
    place-items: center;
    align-content: center;
    color: rgba(255, 255, 255, 0.42);
  }

  .playback-panel.waiting {
    grid-template-rows: auto minmax(0, 1fr);
  }

  .playback-panel.corrupted {
    position: relative;
    grid-template-rows: minmax(0, 1fr);
    place-items: center;
    align-content: center;
    border-color: rgba(255, 214, 104, 0.34);
    overflow: hidden;
    background:
      linear-gradient(180deg, rgba(0, 0, 0, 0.1), rgba(0, 0, 0, 0.58)),
      var(--corruption-noise, url("/system/album-corruption-noise-01.webp")) center / cover no-repeat,
      #03080d;
  }

  .playback-panel.corrupted::before,
  .playback-panel.corrupted::after {
    content: "";
    position: absolute;
    inset: 0;
    pointer-events: none;
  }

  .playback-panel.corrupted::before {
    background:
      linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.14), transparent),
      repeating-linear-gradient(
        0deg,
        rgba(255, 255, 255, 0.1) 0 1px,
        transparent 1px 6px
      );
    mix-blend-mode: screen;
    opacity: 0.18;
  }

  .playback-panel.corrupted::after {
    inset: auto 0 0;
    height: 40%;
    background: linear-gradient(180deg, transparent, rgba(0, 0, 0, 0.48));
  }

  .repair-label {
    position: relative;
    z-index: 1;
    max-width: min(86%, 280px);
    padding: 10px 11px;
    border: 1px solid rgba(255, 214, 104, 0.36);
    border-radius: 8px;
    background: rgba(4, 4, 2, 0.86);
    color: rgba(255, 226, 122, 0.96);
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
    font-size: 0.74rem;
    line-height: 1.5;
    text-align: center;
  }

  .panel-head {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: start;
    gap: 10px;
    min-width: 0;
  }

  .panel-head h2 {
    display: -webkit-box;
    overflow: hidden;
    align-self: start;
    color: #fff1c4;
    font-size: 0.98rem;
    line-height: 1.32;
    text-align: left;
    text-overflow: ellipsis;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
  }

  .panel-actions {
    display: inline-flex;
    align-items: center;
    justify-content: end;
    gap: 7px;
    min-width: 0;
  }

  .share-open {
    display: grid;
    place-items: center;
    width: 36px;
    height: 36px;
    padding: 0;
    border: 1px solid rgba(244, 200, 106, 0.34);
    border-radius: 13px;
    background: rgba(244, 200, 106, 0.12);
    color: #ffe4a8;
    cursor: pointer;
    box-shadow: var(--ap-shadow-inset);
  }

  .share-open:active:not(:disabled) {
    transform: translateY(1px);
  }

  .share-open:disabled {
    cursor: default;
    opacity: 0.42;
  }

  .broadcast-open {
    position: relative;
    display: inline-grid;
    grid-auto-flow: column;
    align-items: center;
    gap: 7px;
    min-width: 116px;
    min-height: 36px;
    padding: 0 13px 0 12px;
    border: 1px solid rgba(255, 195, 170, 0.56);
    border-radius: 999px;
    background:
      linear-gradient(180deg, rgba(255, 180, 128, 0.92), rgba(235, 63, 93, 0.9)),
      #f05a70;
    color: #fff8ec;
    cursor: pointer;
    font-size: 0.72rem;
    font-weight: 880;
    line-height: 1;
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.32),
      inset 0 -8px 14px rgba(118, 16, 42, 0.2),
      0 12px 24px rgba(0, 0, 0, 0.24),
      0 0 20px rgba(255, 83, 111, 0.16);
    backdrop-filter: blur(14px) saturate(1.08);
  }

  .broadcast-open:active:not(:disabled) {
    transform: translateY(1px);
  }

  .broadcast-open:disabled {
    cursor: default;
    opacity: 0.52;
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.12),
      0 8px 18px rgba(0, 0, 0, 0.16);
  }

  .transport-stage {
    position: relative;
    display: grid;
    place-items: center;
    min-height: 0;
  }

  .transport-ripples {
    position: absolute;
    z-index: 0;
    display: grid;
    place-items: center;
    width: 142px;
    height: 142px;
    border-radius: 50%;
    pointer-events: none;
  }

  .transport-ripples span {
    position: absolute;
    border: 1px solid rgba(244, 200, 106, 0.28);
    border-radius: inherit;
    opacity: 0;
    box-shadow: 0 0 24px rgba(244, 200, 106, 0.1);
    transform: scale(0.72);
    animation: radio-ripple 2.6s cubic-bezier(0.19, 1, 0.22, 1) infinite;
  }

  .transport-ripples span:nth-child(1) {
    width: 78px;
    height: 78px;
  }

  .transport-ripples span:nth-child(2) {
    width: 106px;
    height: 106px;
    animation-delay: 420ms;
  }

  .transport-ripples span:nth-child(3) {
    width: 134px;
    height: 134px;
    animation-delay: 840ms;
  }

  .transport-button {
    position: relative;
    z-index: 1;
    display: grid;
    place-items: center;
    width: 66px;
    height: 66px;
    border: 1px solid rgba(255, 237, 184, 0.52);
    border-radius: 50%;
    background:
      linear-gradient(145deg, #ffe7ad 0%, #f0bd58 48%, #c98724 100%);
    color: #211302;
    cursor: pointer;
    box-shadow:
      0 18px 34px rgba(0, 0, 0, 0.34),
      inset 0 1px 0 rgba(255, 255, 255, 0.42),
      inset 0 -8px 16px rgba(88, 42, 0, 0.18);
    transition:
      transform 160ms ease,
      border-color 160ms ease,
      box-shadow 160ms ease,
      background 160ms ease;
  }

  .transport-button:hover:not(:disabled) {
    transform: translateY(-1px);
    box-shadow:
      0 20px 36px rgba(0, 0, 0, 0.38),
      inset 0 1px 0 rgba(255, 255, 255, 0.48),
      inset 0 -8px 16px rgba(88, 42, 0, 0.16);
  }

  .radio-caption {
    position: absolute;
    z-index: 2;
    right: 8px;
    bottom: 0;
    left: 8px;
    margin: 0;
    padding: 7px 10px;
    border: 1px solid rgba(255, 237, 184, 0.18);
    border-radius: 9px;
    background: rgba(3, 7, 11, 0.76);
    color: #fff6dc;
    font-size: 0.72rem;
    font-weight: 730;
    line-height: 1.45;
    text-align: center;
    box-shadow: 0 8px 22px rgba(0, 0, 0, 0.28);
    backdrop-filter: blur(8px);
    pointer-events: none;
  }

  .transport-button:active:not(:disabled) {
    transform: translateY(1px) scale(0.99);
  }

  .transport-button.playing {
    border-color: rgba(244, 200, 106, 0.32);
    background:
      linear-gradient(145deg, rgba(255, 230, 170, 0.14), rgba(244, 200, 106, 0.08)),
      rgba(11, 13, 17, 0.78);
    color: #ffe7aa;
    box-shadow:
      0 16px 30px rgba(0, 0, 0, 0.34),
      inset 0 1px 0 rgba(255, 255, 255, 0.12),
      inset 0 -8px 18px rgba(0, 0, 0, 0.2);
  }

  .transport-button:disabled {
    cursor: default;
    opacity: 0.42;
  }

  .transport-button :global(svg) {
    position: relative;
    z-index: 1;
    margin-left: 3px;
  }

  .transport-button.playing :global(svg) {
    margin-left: 0;
  }

  .transport-home-hint {
    position: absolute;
    z-index: 0;
    top: calc(50% + 42px);
    left: 50%;
    max-width: calc(100% - 24px);
    color: rgba(255, 242, 204, 0.66);
    font-size: 0.62rem;
    font-weight: 740;
    line-height: 1;
    overflow: hidden;
    pointer-events: none;
    text-align: center;
    text-overflow: ellipsis;
    transform: translateX(-50%);
    white-space: nowrap;
  }

  .transport-disabled-reason {
    position: absolute;
    z-index: 2;
    top: 50%;
    left: 50%;
    max-width: min(172px, calc(100% - 28px));
    padding: 5px 10px 6px;
    border: 1px solid rgba(255, 232, 176, 0.5);
    border-radius: 999px;
    background:
      linear-gradient(180deg, rgba(51, 38, 18, 0.78), rgba(21, 18, 14, 0.8)),
      rgba(20, 18, 14, 0.78);
    color: #fff0c2;
    font-size: 0.66rem;
    font-weight: 880;
    line-height: 1;
    overflow: hidden;
    pointer-events: none;
    text-align: center;
    text-overflow: ellipsis;
    text-shadow: 0 1px 8px rgba(255, 213, 126, 0.18);
    transform: translate(-50%, -50%);
    white-space: nowrap;
    box-shadow:
      0 10px 20px rgba(0, 0, 0, 0.28),
      inset 0 1px 0 rgba(255, 255, 255, 0.14);
    backdrop-filter: blur(12px) saturate(1.1);
  }

  @keyframes radio-ripple {
    0% {
      opacity: 0;
      transform: scale(0.72);
    }

    14% {
      opacity: 0.58;
    }

    72% {
      opacity: 0.12;
    }

    100% {
      opacity: 0;
      transform: scale(1.18);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .transport-ripples span {
      animation: none;
      opacity: 0.24;
      transform: none;
    }
  }

  .player-empty {
    display: grid;
    place-items: center;
    gap: 10px;
    font-size: 0.82rem;
    font-weight: 820;
    letter-spacing: 0.08em;
  }

  .broadcast-waiting {
    display: grid;
    align-content: center;
    gap: 9px;
    min-height: 0;
    height: 100%;
    padding: 14px;
    border: 1px solid #d3d7de;
    border-radius: 4px;
    background: #ffffff;
    color: #111111;
    box-shadow:
      0 1px 0 rgba(255, 255, 255, 0.8),
      0 10px 22px rgba(0, 0, 0, 0.24);
  }

  .broadcast-waiting strong {
    color: #111111;
    font-size: 0.94rem;
    font-weight: 760;
    line-height: 1.25;
  }

  .broadcast-waiting-head {
    display: grid;
    grid-template-columns: 28px minmax(0, 1fr);
    align-items: center;
    gap: 9px;
  }

  .broadcast-waiting-head :global(svg) {
    color: #d39b00;
    fill: #ffd54f;
    filter: drop-shadow(0 1px 0 rgba(0, 0, 0, 0.18));
  }

  .broadcast-waiting p {
    margin: 0;
    color: #222222;
    font-size: 0.76rem;
    font-weight: 520;
    line-height: 1.58;
    overflow-wrap: anywhere;
  }

  .progress-stack {
    display: grid;
    align-self: end;
    gap: 7px;
  }

  .progress-track {
    position: relative;
    overflow: hidden;
    height: 5px;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.12);
    box-shadow:
      inset 0 1px 2px rgba(0, 0, 0, 0.34),
      0 1px 0 rgba(255, 255, 255, 0.045);
  }

  .progress-track span {
    display: block;
    height: 100%;
    border-radius: inherit;
    background: linear-gradient(90deg, #f4c86a, #ffe6a8);
    box-shadow: 0 0 12px rgba(244, 200, 106, 0.22);
  }

  .time-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    color: rgba(255, 242, 204, 0.76);
    font-size: 0.72rem;
    font-variant-numeric: tabular-nums;
    font-weight: 760;
    line-height: 1;
  }

  .radio-tabs button {
    color: var(--ap-text-soft);
    font-size: 0.68rem;
    font-style: normal;
    font-weight: 730;
  }

  .library-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    color: rgba(255, 255, 255, 0.68);
    font-size: 0.72rem;
    font-weight: 760;
  }

  .library-head span {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }

  .library-head strong {
    color: #fff;
  }

  .radio-main,
  .radio-main :global(.scroll-hint-shell) {
    min-height: 0;
    height: 100%;
  }

  .episode-list {
    display: grid;
    align-content: start;
    gap: 4px;
    min-height: 0;
    height: 100%;
    padding: 4px;
    border: 1px solid var(--ap-border);
    border-radius: var(--ap-radius-panel);
    background: rgba(255, 255, 255, 0.045);
  }

  .episode-list.scrolling {
    overflow: auto;
    overscroll-behavior: contain;
    padding-bottom: 12px;
    scrollbar-width: none;
    mask-image: linear-gradient(180deg, #000 0, #000 calc(100% - 20px), rgba(0, 0, 0, 0.18));
  }

  .episode-list.scrolling::-webkit-scrollbar {
    display: none;
  }

  .episode-list button {
    display: grid;
    align-items: center;
    grid-template-columns: minmax(0, 1fr);
    min-height: 52px;
    padding: 0 10px;
    border: 1px solid transparent;
    border-radius: 10px;
    background: transparent;
    color: var(--ap-text);
    text-align: left;
    cursor: pointer;
  }

  .episode-list button.active {
    border-color: rgba(244, 200, 106, 0.34);
    background: rgba(244, 200, 106, 0.12);
  }

  .episode-list button.corrupted {
    color: rgba(255, 255, 255, 0.54);
  }

  .episode-list strong {
    overflow: hidden;
    font-size: 0.86rem;
    line-height: 1.26;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .radio-tabs {
    position: absolute;
    left: 14px;
    right: 14px;
    bottom: 58px;
    z-index: 4;
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    padding: 5px;
    gap: 5px;
    border: 1px solid rgba(244, 200, 106, 0.18);
    border-radius: var(--ap-radius-panel);
    background:
      linear-gradient(180deg, rgba(244, 200, 106, 0.12), transparent 68%),
      rgba(17, 20, 24, 0.72);
    box-shadow: var(--ap-shadow-inset);
    backdrop-filter: blur(16px);
  }

  .radio-tabs button {
    display: inline-grid;
    grid-auto-flow: column;
    place-content: center;
    align-items: center;
    gap: 6px;
    min-height: 38px;
    border: 1px solid transparent;
    border-radius: 12px;
    background: transparent;
    color: var(--ap-text-soft);
    cursor: pointer;
  }

  .radio-tabs button.active {
    border-color: rgba(244, 200, 106, 0.28);
    background: rgba(244, 200, 106, 0.12);
    color: #ffe4a8;
  }

  .broadcast-modal-backdrop {
    position: absolute;
    inset: 0;
    z-index: 30;
    display: grid;
    place-items: center;
    padding: 10px 9px 58px;
    background:
      radial-gradient(circle at 50% 28%, rgba(244, 200, 106, 0.18), transparent 36%),
      rgba(4, 7, 12, 0.66);
    backdrop-filter: blur(10px);
  }

  .broadcast-modal {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    gap: 12px;
    width: min(100%, 342px);
    height: min(100%, 708px);
    max-height: 100%;
    padding: 12px;
    border: 1px solid rgba(244, 200, 106, 0.24);
    border-radius: 18px;
    overflow: hidden;
    background:
      linear-gradient(180deg, rgba(244, 200, 106, 0.12), rgba(255, 255, 255, 0.045) 48%, rgba(0, 0, 0, 0.12)),
      rgba(13, 17, 24, 0.94);
    box-shadow:
      var(--ap-shadow-inset),
      0 26px 52px rgba(0, 0, 0, 0.48);
  }

  .broadcast-modal-head {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 34px;
    align-items: start;
    gap: 12px;
  }

  .broadcast-modal-head div {
    display: grid;
    gap: 4px;
    min-width: 0;
  }

  .broadcast-modal-head span {
    overflow: hidden;
    color: rgba(255, 242, 204, 0.56);
    font-size: 0.68rem;
    font-weight: 760;
    line-height: 1.2;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .broadcast-modal-head strong {
    color: #fff1c4;
    font-size: 1rem;
    line-height: 1.22;
  }

  .broadcast-modal-head button {
    display: grid;
    place-items: center;
    width: 34px;
    height: 34px;
    padding: 0;
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 12px;
    background: rgba(255, 255, 255, 0.06);
    color: rgba(255, 255, 255, 0.82);
    cursor: pointer;
  }

  .broadcast-frame {
    width: 100%;
    height: 100%;
    min-height: 0;
    border: 0;
    border-radius: 14px;
    background: #fff;
    box-shadow:
      0 16px 34px rgba(0, 0, 0, 0.22),
      0 0 0 1px rgba(255, 255, 255, 0.1);
  }

</style>
