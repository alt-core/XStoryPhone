<script lang="ts">
  import { onDestroy } from "svelte";
  import { Play, Square } from "@lucide/svelte";
  import { playAudio, stopAudioPlayback } from "./audioEngine";

  export let playbackId: string;
  export let src: string;
  export let label = "再生";
  export let onComplete: () => void = () => {};

  let loading = false;
  let playing = false;
  let currentMs = 0;
  let durationMs = 0;

  $: timeLabel = durationMs > 0 ? `${formatTime(currentMs)} / ${formatTime(durationMs)}` : "--:--";

  onDestroy(() => {
    stopAudioPlayback("component_destroy", playbackId);
  });

  async function togglePlayback() {
    if (!src || loading) {
      return;
    }

    if (playing) {
      stopAudioPlayback("user_stop", playbackId);
      resetPlayback();
      return;
    }

    loading = true;
    const started = await playAudio({
      id: playbackId,
      segments: [{ url: src }],
      onStarted: ({ durationMs: nextDurationMs }) => {
        durationMs = nextDurationMs;
        currentMs = 0;
        playing = true;
        loading = false;
      },
      onProgress: ({ currentMs: nextCurrentMs, durationMs: nextDurationMs }) => {
        currentMs = nextCurrentMs;
        durationMs = nextDurationMs;
      },
      onEnded: () => {
        currentMs = durationMs;
        playing = false;
        loading = false;
        onComplete();
      },
      onStop: resetPlayback,
      onError: resetPlayback
    });

    if (!started) {
      resetPlayback();
    }
  }

  function resetPlayback() {
    loading = false;
    playing = false;
    currentMs = 0;
  }

  function formatTime(valueMs: number) {
    const totalSeconds = Math.max(0, Math.floor(valueMs / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, "0")}`;
  }
</script>

<button
  class="audio-playback-button"
  class:playing
  type="button"
  disabled={!src || loading}
  aria-label={playing ? "停止" : label}
  on:click={togglePlayback}
>
  {#if playing}
    <Square size={15} strokeWidth={2.4} fill="currentColor" />
  {:else}
    <Play size={16} strokeWidth={2.25} fill="currentColor" />
  {/if}
  <span>{loading ? "読込中" : playing ? "停止" : label}</span>
  <em>{timeLabel}</em>
</button>

<style>
  .audio-playback-button {
    display: grid;
    grid-template-columns: 18px minmax(0, 1fr) auto;
    align-items: center;
    gap: 8px;
    width: 100%;
    min-width: 0;
    min-height: 36px;
    border: 1px solid rgba(255, 255, 255, 0.14);
    border-radius: 10px;
    padding: 8px 10px;
    background: rgba(0, 0, 0, 0.2);
    color: inherit;
    font: inherit;
    cursor: pointer;
  }

  .audio-playback-button.playing {
    border-color: rgba(244, 200, 106, 0.42);
    color: #ffe5a0;
  }

  .audio-playback-button:disabled {
    cursor: default;
    opacity: 0.54;
  }

  .audio-playback-button span {
    overflow: hidden;
    font-size: 0.76rem;
    font-weight: 760;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .audio-playback-button em {
    color: rgba(255, 255, 255, 0.58);
    font-size: 0.68rem;
    font-style: normal;
    font-variant-numeric: tabular-nums;
  }
</style>
