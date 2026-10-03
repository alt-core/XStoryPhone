<script lang="ts">
  import { onDestroy, tick } from "svelte";
  import { ChevronRight, Clock3, FileText, PhoneCall, Play, Square, Voicemail } from "@lucide/svelte";
  import type { CallLogItem } from "../scenario-runtime/types";
  import { playAudio, stopAudioPlayback } from "../system/audioEngine";
  import { corruptionNoiseStyle } from "../system/corruptionNoise";
  import AppDetailBar from "./AppDetailBar.svelte";
  import AppShell from "./AppShell.svelte";

  export let callLogs: CallLogItem[] = [];
  export let focusContentId = "";
  export let focusContentRequestId = 0;
  export let onNoise: () => void = () => {};
  export let onNavigate: (contentId: string) => void = () => {};
  export let onContentOpen: (contentId: string) => void = () => {};
  export let onDisplayedContentChange: (contentId: string) => void = () => {};
  export let onBlockedContentOpen: (contentId: string) => void = () => {};

  const keypad = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "0", "#"];
  const CALL_KIND_LABELS: Record<CallLogItem["kind"], string> = {
    incoming: "着信",
    missed: "不在着信",
    outgoing: "発信",
    voicemail: "留守番電話"
  };

  let tab: "history" | "keypad" = "history";
  // 空なら履歴の一覧。Appの表示指定は要求ごとに1回だけ適用する。
  let detailCallId = "";
  let lastOpenedCallId = "";
  let lastReportedContentId = "";
  let appliedFocusRequestId: number | undefined;
  let lastReportedDisplayedContentId: string | undefined;
  let playbackCallId = "";
  let playbackLoadingCallId = "";
  let historyElement: HTMLElement | undefined;
  let historyScrollTop = 0;

  $: applyFocus(focusContentId, focusContentRequestId);
  $: detailCall = detailCallId ? callLogs.find((call) => call.id === detailCallId) : undefined;
  // condで消えた履歴を表示し続けない。
  $: if (detailCallId && (!detailCall || detailCall.corrupted)) {
    showList();
  }
  $: reportDisplayedContent(detailCall && !detailCall.corrupted ? callContentId(detailCall) : "");
  $: if (playbackCallId && !callLogs.some((call) => call.id === playbackCallId)) {
    stopCurrentPlayback("call_history_removed");
  }
  $: if (playbackLoadingCallId && !callLogs.some((call) => call.id === playbackLoadingCallId)) {
    stopCurrentPlayback("call_history_removed");
  }

  onDestroy(() => {
    stopCurrentPlayback("phone_app_destroy");
  });

  function callContentId(call: CallLogItem) {
    return call.contentId ?? call.id;
  }

  function applyFocus(contentId: string, requestId: number) {
    if (requestId === appliedFocusRequestId) {
      return;
    }
    appliedFocusRequestId = requestId;
    tab = "history";
    const focused = contentId ? callLogs.find((call) => call.contentId === contentId || call.id === contentId) : undefined;
    if (!focused || focused.corrupted) {
      showList();
      if (focused) onBlockedContentOpen(callContentId(focused));
      return;
    }
    enterCall(focused);
  }

  // 詳細に入るたびに開封を報告する。一覧を挟んだ同じ項目の再表示も1回の開封。
  function enterCall(call: CallLogItem) {
    tab = "history";
    detailCallId = call.id;
    lastOpenedCallId = call.id;
    lastReportedContentId = callContentId(call);
    onContentOpen(lastReportedContentId);
  }

  function showList() {
    if (!detailCallId) {
      return;
    }
    detailCallId = "";
    void restoreHistoryPosition();
  }

  async function restoreHistoryPosition() {
    await tick();
    if (!historyElement) {
      return;
    }
    historyElement.scrollTop = historyScrollTop;
    historyElement.querySelector(`[data-call-id="${CSS.escape(lastOpenedCallId)}"]`)?.scrollIntoView({ block: "nearest" });
  }

  function reportDisplayedContent(contentId: string) {
    if (contentId === lastReportedDisplayedContentId) {
      return;
    }
    lastReportedDisplayedContentId = contentId;
    onDisplayedContentChange(contentId);
  }

  function pressDigit() {
    onNoise();
  }

  function openCallHistoryEntry(call: CallLogItem) {
    if (call.corrupted) {
      onBlockedContentOpen(callContentId(call));
      return;
    }
    onNavigate(callContentId(call));
    enterCall(call);
  }

  function returnToList() {
    onNavigate("");
    showList();
  }

  // 一覧から録音を再生した時も、その履歴を開いたことにする。詳細では入った時に報告済み。
  function reportPlaybackOpen(call: CallLogItem) {
    const contentId = callContentId(call);
    if (call.id === detailCallId || contentId === lastReportedContentId) {
      return;
    }
    lastReportedContentId = contentId;
    onContentOpen(contentId);
  }

  async function toggleRecording(call: CallLogItem) {
    if (!call.audioUrl || playbackLoadingCallId) {
      return;
    }

    reportPlaybackOpen(call);

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
  <div class="phone-layout" class:detail-open={Boolean(detailCall)}>
    {#if detailCall && !detailCall.corrupted}
      <section class="call-detail" aria-label={`${detailCall.name}の${detailCall.kind === "voicemail" ? "留守番電話" : "通話"}詳細`}>
        <AppDetailBar listLabel="通話履歴" title={detailCall.name} onList={returnToList} />

        <header class="call-hero">
          <span class="kind-mark" class:missed={detailCall.kind === "missed"} class:outgoing={detailCall.kind === "outgoing"} class:voicemail={detailCall.kind === "voicemail"} aria-hidden="true">
            {#if detailCall.kind === "voicemail"}
              <Voicemail size={22} strokeWidth={2.1} />
            {:else}
              <PhoneCall size={21} strokeWidth={2.1} />
            {/if}
          </span>
          <div class="hero-copy">
            <strong class:missed={detailCall.kind === "missed"}>{CALL_KIND_LABELS[detailCall.kind]}</strong>
            <p><span>{detailCall.at}</span><span aria-hidden="true">・</span><span>{detailCall.durationLabel}</span></p>
          </div>
          {#if detailCall.audioUrl}
            <button
              class="detail-playback"
              class:playing={playbackCallId === detailCall.id}
              type="button"
              disabled={playbackLoadingCallId === detailCall.id}
              aria-busy={playbackLoadingCallId === detailCall.id ? "true" : undefined}
              aria-label={playbackCallId === detailCall.id ? "録音を停止" : "録音を再生"}
              title={playbackCallId === detailCall.id ? "録音を停止" : "録音を再生"}
              on:click={() => detailCall && toggleRecording(detailCall)}
            >
              {#if playbackCallId === detailCall.id}
                <Square size={16} strokeWidth={2.35} fill="currentColor" />
              {:else}
                <Play size={18} strokeWidth={2.25} fill="currentColor" />
              {/if}
            </button>
          {/if}
        </header>

        {#if detailCall.transcript?.length}
          <section class="transcript-panel" aria-label="音声書き起こし">
            <header>
              <FileText size={15} strokeWidth={2.15} />
              <strong>音声書き起こし</strong>
            </header>
            <div class="transcript-body">
              {#each detailCall.transcript as cue}
                <p>
                  <span>{cue.text}</span>
                </p>
              {/each}
            </div>
          </section>
        {/if}
      </section>
    {:else}
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
        <section class="call-history" aria-label="通話履歴" bind:this={historyElement} on:scroll={() => (historyScrollTop = historyElement?.scrollTop ?? 0)}>
          {#each callLogs as call (call.id)}
            <article
              data-call-id={call.id}
              class:recent={call.id === lastOpenedCallId && !call.corrupted}
              class:recording={Boolean(call.audioUrl) && !call.corrupted}
              class:corrupted={call.corrupted}
              style={call.corrupted ? corruptionNoiseStyle(callContentId(call)) : ""}
            >
              <button class="call-entry" type="button" on:click={() => openCallHistoryEntry(call)}>
                <span class:missed={call.kind === "missed"} class:outgoing={call.kind === "outgoing"} class:voicemail={call.kind === "voicemail"}>
                  {#if call.kind === "voicemail"}
                    <Voicemail size={16} strokeWidth={2.2} />
                  {:else}
                    <PhoneCall size={15} strokeWidth={2.2} />
                  {/if}
                </span>
                <div>
                  <strong>{call.name}</strong>
                  {#if call.kind === "voicemail"}
                    <small>留守番電話</small>
                  {/if}
                </div>
                <time>
                  <span>{call.at}</span>
                  <em>{call.durationLabel}</em>
                </time>
                {#if !call.corrupted}
                  <ChevronRight size={15} strokeWidth={2.25} aria-hidden="true" />
                {/if}
              </button>
              {#if call.audioUrl && !call.corrupted}
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
    {/if}
  </div>
</AppShell>

<style>
  .phone-layout {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    gap: var(--ap-gap-page);
    box-sizing: border-box;
    min-height: 0;
    height: 100%;
    padding: 14px 14px 118px;
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
    grid-auto-rows: max-content;
    align-content: start;
    gap: 7px;
    min-height: 0;
    height: 100%;
    overflow: auto;
    overscroll-behavior: contain;
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
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 5px;
    align-items: center;
    min-width: 0;
    padding: 4px;
    border-radius: 13px;
    background: rgba(255, 255, 255, 0.055);
  }

  .call-history article.recording {
    grid-template-columns: minmax(0, 1fr) 34px;
  }

  .call-entry {
    display: grid;
    grid-template-columns: 36px minmax(0, 1fr) auto 16px;
    gap: 9px;
    align-items: center;
    min-width: 0;
    min-height: 46px;
    padding: 6px;
    border: 0;
    border-radius: 10px;
    background: transparent;
    color: #fff;
    text-align: left;
    cursor: pointer;
  }

  .call-entry > span {
    display: grid;
    place-items: center;
    width: 34px;
    height: 34px;
    border-radius: 12px;
    background: rgba(103, 215, 142, 0.16);
    color: #a7ffc1;
  }

  .call-entry > span.missed {
    background: rgba(240, 113, 120, 0.16);
    color: #ffc0c5;
  }

  .call-entry > span.outgoing {
    transform: rotate(-35deg);
  }

  .call-entry > span.voicemail {
    background: rgba(174, 188, 255, 0.16);
    color: #dbe0ff;
  }

  .call-entry div {
    display: grid;
    align-content: center;
    min-width: 0;
  }

  .call-entry strong,
  .call-entry time span,
  .call-entry time em {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .call-entry strong {
    font-size: 0.86rem;
  }

  .call-entry small {
    overflow: hidden;
    color: rgba(219, 224, 255, 0.68);
    font-size: 0.64rem;
    font-weight: 680;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .call-entry time {
    color: var(--ap-text-soft);
    font-size: 0.66rem;
  }

  .call-entry time {
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

  .phone-layout.detail-open {
    grid-template-rows: minmax(0, 1fr);
    padding-top: 8px;
  }

  .call-history article.recent {
    outline: 1px solid rgba(103, 215, 142, 0.42);
    background: rgba(103, 215, 142, 0.12);
  }

  .call-history article.corrupted {
    position: relative;
    overflow: hidden;
    border: 1px solid rgba(255, 214, 104, 0.26);
    background:
      linear-gradient(90deg, rgba(3, 8, 13, 0.82), rgba(3, 8, 13, 0.5)),
      var(--corruption-noise, url("/system/album-corruption-noise-01.webp")) center / cover no-repeat,
      #03080d;
  }

  .call-history article.corrupted::after {
    content: "";
    position: absolute;
    inset: 0;
    background: repeating-linear-gradient(0deg, rgba(255, 255, 255, 0.08) 0 1px, transparent 1px 5px);
    mix-blend-mode: screen;
    opacity: 0.4;
    pointer-events: none;
  }

  .call-history article.corrupted .call-entry {
    cursor: default;
  }

  .call-history article.corrupted strong,
  .call-history article.corrupted time {
    color: rgba(255, 226, 122, 0.92);
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
  }

  .call-detail {
    display: grid;
    grid-template-rows: auto auto minmax(0, 1fr);
    gap: 10px;
    min-height: 0;
    height: 100%;
    overflow: hidden;
    animation: view-in 140ms cubic-bezier(0.2, 0.8, 0.2, 1) both;
  }

  .call-hero {
    display: grid;
    grid-template-columns: 50px minmax(0, 1fr) auto;
    gap: 12px;
    align-items: center;
    min-width: 0;
    padding: 14px;
    border: 1px solid rgba(103, 215, 142, 0.2);
    border-radius: var(--ap-radius-panel);
    background:
      radial-gradient(circle at 12% 0%, rgba(103, 215, 142, 0.18), transparent 58%),
      rgba(255, 255, 255, 0.045);
    box-shadow: var(--ap-shadow-inset);
  }

  .kind-mark {
    display: grid;
    place-items: center;
    width: 50px;
    height: 50px;
    border-radius: 999px;
    background: linear-gradient(145deg, rgba(103, 215, 142, 0.3), rgba(103, 215, 142, 0.12));
    color: #b8ffcc;
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.12);
  }

  .kind-mark.missed {
    background: linear-gradient(145deg, rgba(240, 113, 120, 0.3), rgba(240, 113, 120, 0.12));
    color: #ffc6cb;
  }

  .kind-mark.outgoing :global(svg) {
    transform: rotate(-35deg);
  }

  .kind-mark.voicemail {
    background: linear-gradient(145deg, rgba(174, 188, 255, 0.3), rgba(174, 188, 255, 0.12));
    color: #dfe4ff;
  }

  .hero-copy {
    display: grid;
    gap: 4px;
    min-width: 0;
  }

  .hero-copy strong {
    font-size: 0.95rem;
    font-weight: 800;
  }

  .hero-copy strong.missed {
    color: #ffb3b9;
  }

  .hero-copy p {
    display: flex;
    flex-wrap: wrap;
    gap: 0 2px;
    margin: 0;
    color: var(--ap-text-soft);
    font-size: 0.7rem;
    font-weight: 680;
    font-variant-numeric: tabular-nums;
  }

  .detail-playback {
    display: grid;
    place-items: center;
    width: 44px;
    height: 44px;
    border: 1px solid rgba(103, 215, 142, 0.38);
    border-radius: 999px;
    background: linear-gradient(145deg, rgba(103, 215, 142, 0.32), rgba(103, 215, 142, 0.14));
    color: #d6ffe1;
    cursor: pointer;
    box-shadow: 0 8px 18px rgba(0, 0, 0, 0.22);
  }

  .detail-playback.playing {
    border-color: rgba(244, 200, 106, 0.46);
    background: linear-gradient(145deg, rgba(244, 200, 106, 0.32), rgba(244, 200, 106, 0.14));
    color: #ffe9ad;
  }

  .detail-playback:disabled {
    opacity: 0.58;
  }

  @keyframes view-in {
    from {
      opacity: 0;
      transform: translateY(5px);
    }

    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  .transcript-panel {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    min-height: 0;
    overflow: hidden;
    border: 1px solid var(--ap-border);
    border-radius: var(--ap-radius-panel);
    background: rgba(255, 255, 255, 0.045);
  }

  .transcript-panel > header {
    display: flex;
    align-items: center;
    gap: 7px;
    min-height: 40px;
    padding: 10px 12px 8px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    color: rgba(255, 255, 255, 0.78);
    font-size: 0.74rem;
  }

  .transcript-body {
    display: grid;
    align-content: start;
    gap: 3px;
    min-height: 0;
    overflow: auto;
    overscroll-behavior: contain;
    padding: 8px 10px 14px;
    scrollbar-width: thin;
    scrollbar-color: rgba(255, 255, 255, 0.18) transparent;
  }

  .transcript-body p {
    margin: 0;
    padding: 7px 5px;
    color: rgba(255, 255, 255, 0.84);
    font-size: 0.79rem;
    line-height: 1.55;
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
