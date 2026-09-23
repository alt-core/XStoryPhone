<script lang="ts">
  import { House, Play, Radio } from "@lucide/svelte";
  import type { AssistantMessage, SearchAgentSearchResult, SearchAgentTalkView, DeviceState, IncomingCallItem } from "../scenario-runtime/types";
  import { appCatalog, type AppCatalogItem } from "./appCatalog";
  import SearchAgent from "./SearchAgent.svelte";
  import IncomingCallScreen from "./IncomingCallScreen.svelte";
  import StatusBar from "./StatusBar.svelte";
  import { resourceUrl } from "./resourceUrls";

  export let deviceState: DeviceState;
  export let apps: AppCatalogItem[] = appCatalog;
  export let assistantVisible = false;
  export let assistantSurfaceKey = "home";
  export let assistantSurfaceMessage: AssistantMessage | undefined = undefined;
  export let shadeOpen = false;
  export let homeButtonVisible = false;
  export let backLinkLabel = "";
  export let radioPlaybackActive = false;
  export let searchAgentPeeking = false;
  export let searchAgentTalk: SearchAgentTalkView | null = null;
  export let searchAgentDelayMemoryKey = "";
  export let searchAgentCloseRequestId = 0;
  export let contentStates: Array<{ contentId: string; state: string; appId: string | null; updatedAt: string }> = [];
  export let incomingCall: IncomingCallItem | undefined = undefined;
  export let osName = "XStoryPhone";
  export let searchAgentName = "ナビ";
  export let searchAgentSpriteUrl = "";
  export let wallpaperUrl = "";
  export let wallpaperVisible = false;
  export let frameOnly = false;
  export let presentationEffectActive = false;
  export let onHome: () => void = () => {};
  export let onBackLink: () => void = () => {};
  export let onOpenRadioPlayback: () => void = () => {};
  export let onToggleShade: () => void = () => {};
  export let onCompleteCall: (callId: string) => void = () => {};
  export let onSearchAgentOpenChange: (open: boolean) => void = () => {};
  export let onSearchAgentSend: (body: string) => Promise<{ ok: boolean; error?: string }> = async () => ({
    ok: false,
    error: "送信できません。"
  });
  export let onOpenSearchAgentResult: (result: SearchAgentSearchResult) => boolean | Promise<boolean> = () => false;
  export let onOpenSearchAgentMessageLink: (
    talkId: string,
    messageRef: string,
    segmentIndex: number,
    linkId?: string
  ) => void | Promise<void> = () => {};

  $: wallpaperStyle = wallpaperUrl ? `--phone-wallpaper-image: url("${resourceUrl(wallpaperUrl)}");` : "";
</script>

<div class="phone-shell" class:frame-only={frameOnly} aria-label={osName} data-phone-shell>
  <div class="side-key side-key-top"></div>
  <div class="side-key side-key-bottom"></div>
  <div
    class="phone-screen"
    data-phone-screen
    aria-busy={presentationEffectActive ? "true" : undefined}
  >
    <div
      class="phone-base"
      class:wallpaper-visible={wallpaperVisible && Boolean(wallpaperUrl)}
      style={wallpaperStyle}
      inert={Boolean(incomingCall) || presentationEffectActive}
      aria-hidden={incomingCall ? "true" : undefined}
    >
      <StatusBar {deviceState} {shadeOpen} {backLinkLabel} {onToggleShade} {onBackLink} />
      <main class="phone-content">
        <slot />
      </main>
      {#if homeButtonVisible || radioPlaybackActive}
        <div class="system-home-control">
          {#if radioPlaybackActive}
            <button
              class="system-radio-button"
              type="button"
              aria-label="ラジオへ戻る"
              title="ラジオ再生中"
              on:click={onOpenRadioPlayback}
            >
              <span class="system-radio-icon" aria-hidden="true">
                <Radio size={16} strokeWidth={2.25} />
              </span>
              <span class="system-radio-play" aria-hidden="true">
                <Play size={10} strokeWidth={2.8} fill="currentColor" />
              </span>
            </button>
          {/if}
          {#if homeButtonVisible}
            <button class="system-home-button" type="button" aria-label="ホームへ戻る" title="ホームへ戻る" on:click={onHome}>
              <House size={20} strokeWidth={2.25} />
            </button>
          {/if}
        </div>
      {/if}
      {#if assistantVisible && searchAgentTalk}
        <SearchAgent
          name={searchAgentTalk.label || searchAgentName}
          spriteUrl={searchAgentSpriteUrl}
          {apps}
          talk={searchAgentTalk}
          {deviceState}
          {contentStates}
          delayMemoryKey={searchAgentDelayMemoryKey}
          closeRequestId={searchAgentCloseRequestId}
          peeking={searchAgentPeeking}
          surfaceKey={assistantSurfaceKey}
          surfaceMessage={assistantSurfaceMessage}
          onSend={onSearchAgentSend}
          onOpenChange={onSearchAgentOpenChange}
          onOpenMessageLink={onOpenSearchAgentMessageLink}
          {onOpenSearchAgentResult}
        />
      {/if}
    </div>
    <slot name="overlay" />
    {#if incomingCall}
      <IncomingCallScreen call={incomingCall} onComplete={onCompleteCall} />
    {/if}
  </div>
</div>

<style>
  .phone-shell {
    position: relative;
    width: 410px;
    height: 698px;
    border: 1px solid rgba(255, 255, 255, 0.22);
    border-radius: 42px;
    background:
      linear-gradient(145deg, rgba(255, 255, 255, 0.26), rgba(255, 255, 255, 0.04) 26%),
      linear-gradient(315deg, rgba(92, 200, 167, 0.14), transparent 34%),
      #151922;
    box-shadow:
      0 42px 96px rgba(0, 0, 0, 0.52),
      0 0 0 1px rgba(0, 0, 0, 0.76),
      inset 0 0 0 8px #0b0f16,
      inset 0 0 0 10px rgba(255, 255, 255, 0.08);
    padding: 12px;
  }

  .phone-shell::before {
    content: "";
    position: absolute;
    top: 19px;
    left: 50%;
    z-index: 3;
    width: 92px;
    height: 25px;
    border-radius: 999px;
    background: #0b0e14;
    transform: translateX(-50%);
    box-shadow:
      inset 0 -1px 0 rgba(255, 255, 255, 0.08),
      0 1px 4px rgba(255, 255, 255, 0.08);
  }

  .side-key {
    position: absolute;
    right: -4px;
    width: 4px;
    border-radius: 0 3px 3px 0;
    background: #2b303a;
  }

  .side-key-top {
    top: 148px;
    height: 74px;
  }

  .side-key-bottom {
    top: 246px;
    height: 116px;
  }

  .phone-screen {
    --phone-safe-bottom: 0px;

    position: relative;
    width: 100%;
    height: 100%;
    /* フォーカス移動でも端末全体をスクロールさせない。各アプリ内の領域だけが動く。 */
    overflow: clip;
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 31px;
    background:
      linear-gradient(122deg, rgba(92, 200, 167, 0.18) 0%, transparent 34%),
      linear-gradient(302deg, rgba(240, 179, 93, 0.12) 0%, transparent 32%),
      linear-gradient(24deg, transparent 52%, rgba(118, 169, 255, 0.08) 100%),
      linear-gradient(155deg, #152232 0%, #11151d 48%, #1a1815 100%);
    color: #f6f2e8;
    box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.05);
  }

  .phone-base {
    position: relative;
    display: grid;
    grid-template-rows: 40px minmax(0, 1fr);
    width: 100%;
    height: 100%;
    padding-bottom: var(--phone-safe-bottom, 0px);
  }

  .phone-base.wallpaper-visible {
    background:
      linear-gradient(180deg, rgba(4, 7, 12, 0.06), rgba(4, 7, 12, 0.42)),
      var(--phone-wallpaper-image);
    background-position: center;
    background-size: cover;
  }

  .phone-content {
    position: relative;
    min-height: 0;
    overflow: hidden;
  }

  .system-home-control {
    position: absolute;
    right: 0;
    bottom: calc(6px + var(--phone-safe-bottom, 0px));
    left: 0;
    z-index: 8;
    height: 38px;
    display: grid;
    place-items: center;
    pointer-events: none;
  }

  .system-radio-button {
    position: absolute;
    top: 0;
    left: 18px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 7px;
    width: 62px;
    height: 38px;
    padding: 0;
    border: 1px solid rgba(244, 200, 106, 0.28);
    border-radius: 999px;
    background:
      linear-gradient(180deg, rgba(244, 200, 106, 0.2), rgba(255, 255, 255, 0.055)),
      rgba(7, 11, 17, 0.62);
    color: #ffe2a2;
    cursor: pointer;
    pointer-events: auto;
    box-shadow:
      var(--ap-shadow-inset),
      0 10px 24px rgba(0, 0, 0, 0.22);
    backdrop-filter: blur(18px) saturate(1.08);
  }

  .system-radio-icon {
    display: grid;
    place-items: center;
  }

  .system-radio-play {
    display: grid;
    place-items: center;
    width: 17px;
    height: 17px;
    border-radius: 999px;
    background: #f4c86a;
    color: #18130a;
    box-shadow:
      0 0 9px rgba(244, 200, 106, 0.28),
      0 0 18px rgba(244, 200, 106, 0.1);
    animation: radio-play-glow 2.8s ease-in-out infinite;
  }

  .system-radio-button:active {
    background: rgba(244, 200, 106, 0.18);
  }

  @keyframes radio-play-glow {
    0%,
    100% {
      box-shadow:
        0 0 9px rgba(244, 200, 106, 0.24),
        0 0 18px rgba(244, 200, 106, 0.08);
      transform: translateY(0);
    }

    50% {
      box-shadow:
        0 0 13px rgba(244, 200, 106, 0.46),
        0 0 26px rgba(244, 200, 106, 0.2);
      transform: translateY(-1px);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .system-radio-play {
      animation: none;
    }
  }

  .system-home-button {
    display: grid;
    place-items: center;
    width: 132px;
    height: 38px;
    padding: 0;
    border: 1px solid rgba(255, 255, 255, 0.14);
    border-radius: 999px;
    background:
      linear-gradient(180deg, rgba(255, 255, 255, 0.18), rgba(255, 255, 255, 0.055)),
      rgba(7, 11, 17, 0.54);
    color: rgba(255, 255, 255, 0.92);
    cursor: pointer;
    pointer-events: auto;
    box-shadow:
      var(--ap-shadow-inset),
      0 10px 24px rgba(0, 0, 0, 0.22);
    backdrop-filter: blur(18px) saturate(1.08);
  }

  .system-home-button:active {
    transform: translateY(1px);
    background: rgba(92, 200, 167, 0.18);
  }

  .phone-shell.frame-only {
    width: 384px;
    height: 672px;
    border: 0;
    border-radius: 0;
    padding: 0;
    box-shadow: none;
  }

  .phone-shell.frame-only::before,
  .phone-shell.frame-only .side-key {
    display: none;
  }

  .phone-shell.frame-only .phone-screen {
    border: 0;
    border-radius: 0;
  }

  @media (display-mode: standalone), (display-mode: fullscreen) {
    .phone-shell.frame-only .phone-screen {
      --phone-safe-bottom: max(18px, env(safe-area-inset-bottom, 0px));
    }
  }
</style>
