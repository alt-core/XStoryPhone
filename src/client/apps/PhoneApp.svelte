<script lang="ts">
  import { onDestroy } from "svelte";
  import { Clock3, PhoneCall, Play, Square } from "@lucide/svelte";
  import type { CallLogItem } from "../scenario-runtime/types";
  import { playAudio, stopAudioPlayback } from "../system/audioEngine";
  import AppShell from "./AppShell.svelte";

  export let callLogs: CallLogItem[] = [];
  export let focusContentId = "";
  export let focusContentRequestId = 0;
  export let onNoise: () => void = () => {};
  export let onContentOpen: (contentId: string) => void = () => {};

  const keypad = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "0", "#"];

  let tab: "history" | "keypad" = "history";
  let lastReportedContentId = "";
  let lastAppliedFocusContentRequestId = focusContentRequestId;
  let playbackCallId = "";
  let playbackLoadingCallId = "";

  $: focusedCall = focusContentId ? callLogs.find((call) => call.contentId === focusContentId || call.id === focusContentId) : null;
  $: if (!focusContentId) {
    lastAppliedFocusContentRequestId = focusContentRequestId;
  } else if (focusedCall && focusContentRequestId !== lastAppliedFocusContentRequestId) {
    lastAppliedFocusContentRequestId = focusContentRequestId;
    tab = "history";
  }
  $: focusedCallContentId = focusedCall && !focusedCall.corrupted ? focusedCall.contentId ?? focusedCall.id : "";
  $: if (focusedCallContentId && focusedCallContentId !== lastReportedContentId) {
    tab = "history";
    lastReportedContentId = focusedCallContentId;
    onContentOpen(focusedCallContentId);
  }
  $: if (playbackCallId && !callLogs.some((call) => call.id === playbackCallId)) {
    stopCurrentPlayback("call_history_removed");
  }
  $: if (playbackLoadingCallId && !callLogs.some((call) => call.id === playbackLoadingCallId)) {
    stopCurrentPlayback("call_history_removed");
  }

  onDestroy(() => {
    stopCurrentPlayback("phone_app_destroy");
  });

  function pressDigit() {
    onNoise();
  }

  async function toggleRecording(call: CallLogItem) {
    if (!call.audioUrl || playbackLoadingCallId) {
      return;
    }

    if (playbackCallId === call.id) {
      stopAudioPlayback("user_stop", recordingPlaybackId(call.id));
      resetPlayback(call.id);
      return;
    }

    playbackLoadingCallId = call.id;
    const started = await playAudio({
      id: recordingPlaybackId(call.id),
      segments: [{ url: call.audioUrl }],
      onStarted: () => {
        if (playbackLoadingCallId !== call.id) {
          return;
        }
        playbackCallId = call.id;
        playbackLoadingCallId = "";
      },
      onEnded: () => {
        resetPlayback(call.id);
      },
      onStop: () => {
        resetPlayback(call.id);
      },
      onError: () => {
        resetPlayback(call.id);
      }
    });

    if (!started) {
      resetPlayback(call.id);
    }
  }

  function stopCurrentPlayback(reason: string) {
    if (playbackCallId) {
      stopAudioPlayback(reason, recordingPlaybackId(playbackCallId));
    }
    if (playbackLoadingCallId) {
      stopAudioPlayback(reason, recordingPlaybackId(playbackLoadingCallId));
    }
    playbackCallId = "";
    playbackLoadingCallId = "";
  }

  function resetPlayback(callId: string) {
    if (playbackCallId === callId) {
      playbackCallId = "";
    }
    if (playbackLoadingCallId === callId) {
      playbackLoadingCallId = "";
    }
  }

  function recordingPlaybackId(callId: string) {
    return `call-recording:${callId}`;
  }
</script>

<AppShell title="電話" accent="#67d78e">
  <div class="phone-layout">
    <nav class="phone-tabs" aria-label="電話の表示切替">
      <button class:active={tab === "history"} type="button" aria-current={tab === "history" ? "page" : undefined} on:click={() => (tab = "history")}>
        <Clock3 size={16} strokeWidth={2.2} />
        <span>履歴</span>
      </button>
      <button class:active={tab === "keypad"} type="button" aria-current={tab === "keypad" ? "page" : undefined} on:click={() => (tab = "keypad")}>
        <PhoneCall size={16} strokeWidth={2.2} />
        <span>キーパッド</span>
      </button>
    </nav>

    {#if tab === "history"}
      <section class="call-history" aria-label="通話履歴">
        {#each callLogs as call}
          <article class:focused={(call.contentId ?? call.id) === focusedCallContentId} class:recording={Boolean(call.audioUrl)}>
            <span class:missed={call.kind === "missed"} class:outgoing={call.kind === "outgoing"}>
              <PhoneCall size={15} strokeWidth={2.2} />
            </span>
            <div>
              <strong>{call.name}</strong>
            </div>
            <time>
              <span>{call.at}</span>
              <em>{call.durationLabel}</em>
            </time>
            {#if call.audioUrl}
              <button
                class="recording-button"
                class:playing={playbackCallId === call.id}
                type="button"
                disabled={playbackLoadingCallId === call.id}
                aria-busy={playbackLoadingCallId === call.id ? "true" : undefined}
                aria-label={playbackCallId === call.id ? "録音を停止" : "録音を再生"}
                title={playbackCallId === call.id ? "録音を停止" : "録音を再生"}
                on:click={() => toggleRecording(call)}
              >
                {#if playbackCallId === call.id}
                  <Square size={14} strokeWidth={2.35} fill="currentColor" />
                {:else}
                  <Play size={15} strokeWidth={2.25} fill="currentColor" />
                {/if}
              </button>
            {/if}
          </article>
        {/each}
      </section>
    {:else}
      <section class="dialer" aria-label="ダイアルパッド">
        <div class="dial-display" aria-label="入力番号">番号を入力</div>
        <div class="keypad">
          {#each keypad as digit}
            <button type="button" on:click={pressDigit}>{digit}</button>
          {/each}
        </div>
      </section>
    {/if}
  </div>
</AppShell>

<style>
  .phone-layout {
    display: grid;
    gap: var(--ap-gap-page);
  }

  .phone-tabs {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px;
  }

  .phone-tabs button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 7px;
    min-height: 40px;
    border: 1px solid var(--ap-border);
    border-radius: var(--ap-radius-control);
    background: var(--ap-surface-1);
    color: rgba(255, 255, 255, 0.68);
    cursor: pointer;
    font-size: 0.76rem;
    font-weight: 760;
  }

  .phone-tabs button.active {
    border-color: rgba(103, 215, 142, 0.32);
    background: rgba(103, 215, 142, 0.14);
    color: #c9ffd8;
  }

  .call-history {
    display: grid;
    align-content: start;
    gap: 7px;
    min-height: 0;
    max-height: 540px;
    overflow: auto;
    padding: 5px;
    border: 1px solid var(--ap-border);
    border-radius: var(--ap-radius-panel);
    background: rgba(255, 255, 255, 0.045);
    scrollbar-width: none;
  }

  .call-history::-webkit-scrollbar {
    display: none;
  }

  .call-history article {
    display: grid;
    grid-template-columns: 36px minmax(0, 1fr) auto;
    gap: 9px;
    align-items: center;
    min-width: 0;
    padding: 10px;
    border-radius: 13px;
    background: rgba(255, 255, 255, 0.055);
  }

  .call-history article.recording {
    grid-template-columns: 36px minmax(0, 1fr) auto 34px;
  }

  .call-history article.focused {
    outline: 1px solid rgba(103, 215, 142, 0.42);
    background: rgba(103, 215, 142, 0.12);
  }

  .call-history article > span {
    display: grid;
    place-items: center;
    width: 34px;
    height: 34px;
    border-radius: 12px;
    background: rgba(103, 215, 142, 0.16);
    color: #a7ffc1;
  }

  .call-history article > span.missed {
    background: rgba(240, 113, 120, 0.16);
    color: #ffc0c5;
  }

  .call-history article > span.outgoing {
    transform: rotate(-35deg);
  }

  .call-history div {
    display: grid;
    align-content: center;
    min-width: 0;
  }

  .call-history strong,
  .call-history time span,
  .call-history time em {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .call-history strong {
    font-size: 0.86rem;
  }

  .call-history time {
    color: var(--ap-text-soft);
    font-size: 0.66rem;
  }

  .call-history time {
    display: grid;
    justify-items: end;
    gap: 3px;
    min-width: 58px;
    font-style: normal;
  }

  .call-history time em {
    font-style: normal;
  }

  .recording-button {
    display: grid;
    place-items: center;
    width: 32px;
    height: 32px;
    border: 1px solid rgba(103, 215, 142, 0.34);
    border-radius: 11px;
    background: rgba(103, 215, 142, 0.13);
    color: #c9ffd8;
    cursor: pointer;
  }

  .recording-button.playing {
    border-color: rgba(244, 200, 106, 0.42);
    background: rgba(244, 200, 106, 0.14);
    color: #ffe5a0;
  }

  .recording-button:disabled {
    cursor: default;
    opacity: 0.58;
  }

  .dialer {
    display: grid;
    gap: 12px;
    padding: 14px;
    border: 1px solid var(--ap-border);
    border-radius: var(--ap-radius-panel);
    background: rgba(255, 255, 255, 0.065);
  }

  .dial-display {
    display: grid;
    place-items: center;
    min-height: 54px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    color: rgba(255, 255, 255, 0.5);
    font-size: 1.18rem;
    font-weight: 720;
    font-variant-numeric: tabular-nums;
  }

  .keypad {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 9px;
  }

  .keypad button {
    border: 0;
    cursor: pointer;
    color: #fff;
  }

  .keypad button {
    min-height: 50px;
    border-radius: 15px;
    background: var(--ap-surface-2);
    font-size: 1.18rem;
    font-weight: 760;
  }
</style>
