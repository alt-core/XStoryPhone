<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import { PhoneCall, PhoneOff, RotateCcw } from "@lucide/svelte";
  import type { IncomingCallItem } from "../scenario-runtime/types";
  import { playAudio, stopAudioPlayback } from "./audioEngine";

  export let call: IncomingCallItem;
  export let onComplete: (callId: string) => void = () => {};

  const bellAudioUrl = "/system/incoming-call-bell.wav";

  let answered = false;
  let audioCompleted = false;
  let callStarting = false;
  let audioErrorVisible = false;
  let bellWanted = true;
  let bellRetryArmed = false;

  onMount(() => {
    void startBell();
  });

  onDestroy(() => {
    bellWanted = false;
    disarmBellRetry();
    stopBell();
    stopAudioPlayback("call_screen_destroy", callPlaybackId());
  });

  function stopBell() {
    stopAudioPlayback("bell_stop", bellPlaybackId());
  }

  async function startBell() {
    if (!bellWanted) {
      return;
    }

    disarmBellRetry();
    const started = await playAudio({
      id: bellPlaybackId(),
      segments: [{ url: bellAudioUrl }],
      loop: true,
      onError: armBellRetry
    });
    if (!started) {
      armBellRetry();
    }
  }

  function armBellRetry() {
    if (!bellWanted || bellRetryArmed) {
      return;
    }

    bellRetryArmed = true;
    document.addEventListener("pointerdown", retryBell, { capture: true, once: true });
  }

  function disarmBellRetry() {
    if (!bellRetryArmed) {
      return;
    }

    bellRetryArmed = false;
    document.removeEventListener("pointerdown", retryBell, true);
  }

  function retryBell() {
    bellRetryArmed = false;
    if (bellWanted) {
      void startBell();
    }
  }

  async function startCall() {
    if (callStarting) {
      return;
    }

    audioErrorVisible = false;
    bellWanted = false;
    disarmBellRetry();
    stopBell();
    answered = true;
    audioCompleted = false;

    if (!call.audioUrl) {
      completeCall();
      return;
    }

    callStarting = true;
    const started = await playAudio({
      id: callPlaybackId(),
      segments: [{ url: call.audioUrl }],
      onStarted: () => {
        callStarting = false;
      },
      onEnded: completeCall,
      onStop: () => {
        callStarting = false;
      },
      onError: showCallAudioError
    });

    if (!started) {
      showCallAudioError();
    }
  }

  function showCallAudioError() {
    answered = false;
    audioCompleted = false;
    callStarting = false;
    audioErrorVisible = true;
  }

  function reload() {
    window.location.reload();
  }

  function completeCall() {
    audioCompleted = true;
    onComplete(call.id);
  }

  function endCall() {
    if (audioCompleted) {
      onComplete(call.id);
    }
  }

  function bellPlaybackId() {
    return `incoming-bell:${call.id}`;
  }

  function callPlaybackId() {
    return `incoming-call:${call.id}`;
  }
</script>

<section class="incoming-call" class:answered aria-label={answered ? "通話中" : "着信"}>
  <div class="call-copy">
    <span>{answered ? "通話中" : "着信中"}</span>
    <strong>{call.name}</strong>
  </div>

  <div class="call-visual" class:active={answered} aria-hidden="true">
    <span></span>
    <span></span>
    <span></span>
  </div>

  {#if answered}
    <div class="call-controls">
      <p class="microphone-error">
        <span>この端末のマイクが故障しています</span>
        <span>受話専用モードです</span>
      </p>
      <button
        class="call-action end-button"
        type="button"
        aria-label="通話を終了"
        title="通話を終了"
        disabled={!audioCompleted}
        on:click={endCall}
      >
        <PhoneOff size={29} strokeWidth={2.25} />
      </button>
    </div>
  {:else}
    <button class="call-action answer-button" type="button" aria-label="電話に出る" title="電話に出る" on:click={startCall}>
      <PhoneCall size={30} strokeWidth={2.25} />
    </button>
  {/if}

  {#if audioErrorVisible}
    <div class="audio-error-backdrop" role="presentation">
      <div class="audio-error-dialog" role="alertdialog" aria-modal="true" aria-labelledby="call-audio-error-title" tabindex="-1">
        <h2 id="call-audio-error-title">音声を開始できませんでした</h2>
        <p>通信の状況を確認の上、リロードしてください。</p>
        <div class="audio-error-actions">
          <button class="audio-error-primary" type="button" on:click={reload}>
            <RotateCcw size={16} strokeWidth={2.25} aria-hidden="true" />
            <span>リロード</span>
          </button>
        </div>
      </div>
    </div>
  {/if}
</section>

<style>
  .incoming-call {
    position: absolute;
    inset: 0;
    z-index: 10;
    display: grid;
    grid-template-rows: minmax(116px, 0.78fr) 216px minmax(118px, 0.46fr);
    row-gap: 18px;
    justify-items: center;
    overflow: hidden;
    padding: 74px 28px 42px;
    background:
      radial-gradient(circle at 50% 24%, rgba(103, 215, 142, 0.28), transparent 29%),
      radial-gradient(circle at 18% 86%, rgba(118, 169, 255, 0.16), transparent 34%),
      linear-gradient(180deg, #07130e, #070a10);
    color: #f6f2e8;
    pointer-events: auto;
  }

  .call-copy {
    position: relative;
    z-index: 1;
    display: grid;
    align-self: end;
    justify-items: center;
    gap: 7px;
    min-width: 0;
    padding-bottom: 4px;
    text-align: center;
  }

  .call-copy span {
    margin: 0;
    color: rgba(255, 255, 255, 0.62);
    font-size: 0.84rem;
    font-style: normal;
    font-weight: 760;
    letter-spacing: 0;
  }

  .call-copy strong {
    max-width: 100%;
    overflow: hidden;
    font-size: 2rem;
    line-height: 1.16;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .microphone-error {
    display: grid;
    gap: 2px;
    max-width: min(100%, 276px);
    margin: 0;
    padding: 0;
    color: rgba(255, 144, 136, 0.82);
    font-family: ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace;
    font-size: 0.62rem;
    font-weight: 760;
    letter-spacing: 0;
    line-height: 1.2;
    text-align: center;
  }

  .microphone-error span {
    min-width: 0;
  }

  .call-controls {
    position: relative;
    z-index: 1;
    display: grid;
    align-self: end;
    justify-items: center;
    gap: 16px;
    min-width: 0;
  }

  .call-visual {
    position: relative;
    z-index: 1;
    display: grid;
    place-items: center;
    width: 216px;
    height: 216px;
    isolation: isolate;
  }

  .call-visual span {
    position: absolute;
    border: 1px solid rgba(137, 234, 166, 0.42);
    border-radius: 999px;
    animation: call-ring 2s ease-out infinite;
    pointer-events: none;
  }

  .call-visual span:nth-child(1) {
    width: 64px;
    height: 64px;
  }

  .call-visual span:nth-child(2) {
    width: 104px;
    height: 104px;
    animation-delay: 260ms;
  }

  .call-visual span:nth-child(3) {
    width: 144px;
    height: 144px;
    animation-delay: 520ms;
  }

  .call-visual.active span {
    border-color: rgba(137, 234, 166, 0.34);
    animation-duration: 2.8s;
  }

  .call-visual.active span:nth-child(1) {
    width: 96px;
    height: 96px;
  }

  .call-visual.active span:nth-child(2) {
    width: 142px;
    height: 142px;
    animation-delay: 360ms;
  }

  .call-visual.active span:nth-child(3) {
    width: 190px;
    height: 190px;
    animation-delay: 720ms;
  }

  .call-action {
    position: relative;
    z-index: 1;
    display: grid;
    place-items: center;
    align-self: end;
    width: 76px;
    height: 76px;
    border: 0;
    border-radius: 999px;
    background:
      radial-gradient(circle at 34% 22%, rgba(255, 255, 255, 0.34), transparent 28%),
      linear-gradient(145deg, #9af0b0, #2ea95c);
    color: #06190d;
    cursor: pointer;
    box-shadow:
      0 18px 34px rgba(39, 169, 91, 0.34),
      inset 0 1px 0 rgba(255, 255, 255, 0.36);
  }

  .end-button {
    background:
      radial-gradient(circle at 34% 22%, rgba(255, 255, 255, 0.24), transparent 28%),
      linear-gradient(145deg, #ff8a7d, #c93636);
    color: #210606;
    box-shadow:
      0 18px 34px rgba(201, 54, 54, 0.28),
      inset 0 1px 0 rgba(255, 255, 255, 0.26);
  }

  .call-action:active {
    transform: translateY(1px) scale(0.985);
  }

  .audio-error-backdrop {
    position: absolute;
    inset: 0;
    z-index: 4;
    display: grid;
    place-items: center;
    padding: 28px;
    background: rgba(4, 9, 10, 0.46);
    backdrop-filter: blur(8px);
  }

  .audio-error-dialog {
    display: grid;
    gap: 14px;
    width: min(100%, 286px);
    padding: 20px;
    border: 1px solid rgba(246, 242, 232, 0.16);
    border-radius: 18px;
    background: rgba(17, 25, 25, 0.94);
    color: #f6f2e8;
    box-shadow: 0 18px 44px rgba(0, 0, 0, 0.32);
  }

  .audio-error-dialog h2,
  .audio-error-dialog p {
    margin: 0;
    letter-spacing: 0;
  }

  .audio-error-dialog h2 {
    font-size: 1rem;
    line-height: 1.35;
  }

  .audio-error-dialog p {
    color: rgba(246, 242, 232, 0.72);
    font-size: 0.78rem;
    line-height: 1.55;
  }

  .audio-error-actions {
    display: grid;
    margin-top: 2px;
  }

  .audio-error-actions button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    min-width: 0;
    min-height: 40px;
    border-radius: 14px;
    font-size: 0.78rem;
    font-weight: 760;
    letter-spacing: 0;
    cursor: pointer;
  }

  .audio-error-primary {
    border: 0;
    background: #8be0a4;
    color: #06190d;
  }

  @keyframes call-ring {
    0% {
      opacity: 0.82;
      transform: scale(0.84);
    }

    72% {
      opacity: 0.08;
    }

    100% {
      opacity: 0;
      transform: scale(1.26);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .call-visual span {
      animation: none;
    }
  }
</style>
