// Chromeは途切れた取得を約33秒再試行するため、回復できる途絶は打ち切らない長さにする。
const PLAYBACK_STALL_LIMIT_MS = 45_000;

// 再生位置が一定時間進まない音声を、取得が止まったとみなす。
// 非表示の間は進行の通知が止まるため数えず、表示に戻った時点から数え直す。
export function watchPlaybackStall(onStall: () => void, target: Document = document) {
  let lastPositionMs = Number.NaN;
  let lastProgressAt = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;

  function schedule() {
    clearTimeout(timer);
    timer = target.hidden ? undefined : setTimeout(check, lastProgressAt + PLAYBACK_STALL_LIMIT_MS - Date.now());
  }

  function check() {
    if (Date.now() - lastProgressAt < PLAYBACK_STALL_LIMIT_MS) {
      schedule();
      return;
    }
    stop();
    onStall();
  }

  function restart() {
    lastProgressAt = Date.now();
    schedule();
  }

  function stop() {
    clearTimeout(timer);
    target.removeEventListener("visibilitychange", restart);
  }

  target.addEventListener("visibilitychange", restart);
  schedule();
  return {
    progress(positionMs: number) {
      if (positionMs === lastPositionMs) return;
      lastPositionMs = positionMs;
      lastProgressAt = Date.now();
    },
    stop
  };
}
