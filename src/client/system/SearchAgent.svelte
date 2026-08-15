<script lang="ts">
  import { tick } from "svelte";
  import { Send, X } from "@lucide/svelte";
  import type {
    AssistantMessage,
    SearchAgentAction,
    SearchAgentMessage,
    SearchAgentSearchResponse,
    SearchAgentSearchResult,
    DeviceState
  } from "../scenario-runtime/types";
  import { getAppById } from "./appCatalog";

  type SurfaceMessageMode = "search" | "dismissOnTap";

  type ContentStateSnapshot = {
    contentId: string;
    state: string;
    appId: string | null;
    updatedAt: string;
  };

  const SEARCH_HISTORY_PAGE_SIZE = 20;

  export let messages: SearchAgentMessage[] = [];
  export let name = "ナビ";
  export let deviceState: DeviceState;
  export let contentStates: ContentStateSnapshot[] = [];
  export let onSearchAgentSearch: (query: string, requestId: string) => Promise<SearchAgentSearchResponse> = async () => ({
    ok: false,
    matched: false,
    body: "検索できませんでした。",
    results: []
  });
  export let onOpenSearchAgentResult: (result: SearchAgentSearchResult) => boolean | Promise<boolean> = () => false;
  export let peeking = false;
  export let surfaceKey = "home";
  export let surfaceMessage: AssistantMessage | undefined = undefined;
  export let surfaceMessageMode: SurfaceMessageMode = "dismissOnTap";

  let expanded = false;
  let input = "";
  let transientMessages: SearchAgentMessage[] = [];
  let pending = false;
  let dismissedSurfaceMessageKey = "";
  let lastSurfaceKey = surfaceKey;
  let expandedFromVisible = false;
  let agentAction: SearchAgentAction = "idle";
  let lastServerMessageKey = "";
  let visibleExchangeCount = SEARCH_HISTORY_PAGE_SIZE;
  let messageListElement: HTMLDivElement | undefined;
  let inputElement: HTMLInputElement | undefined;
  let loadingOlderHistory = false;
  let openingResult = false;

  $: if (surfaceKey !== lastSurfaceKey) {
    lastSurfaceKey = surfaceKey;
    dismissedSurfaceMessageKey = "";
  }
  $: surfaceMessageKey = surfaceMessage ? `${surfaceKey}:${surfaceMessage.id}` : "";
  $: surfaceBubbleVisible = Boolean(
    surfaceMessage &&
      !expanded &&
      (surfaceMessageMode === "search" || surfaceMessageKey !== dismissedSurfaceMessageKey)
  );
  $: agentPeeking = peeking && !expanded && !surfaceBubbleVisible;
  $: agentAction = surfaceBubbleVisible ? surfaceMessage?.agentAction ?? "idle" : "idle";
  $: serverMessageKey = messages.map((message) => message.id).join("|");
  $: if (serverMessageKey !== lastServerMessageKey) {
    lastServerMessageKey = serverMessageKey;
    transientMessages = [];
    if (expanded) {
      void scrollMessagesToBottom();
    }
  }
  $: serverExchangeCount = countMessageExchanges(messages);
  $: visibleServerMessages = recentMessagesForExchangeCount(messages, visibleExchangeCount);
  $: displayedMessages = [...visibleServerMessages, ...transientMessages];
  $: hasOlderHistory = visibleExchangeCount < serverExchangeCount;

  function messageExchangeKey(message: SearchAgentMessage) {
    return message.requestId ?? message.id;
  }

  function messageExchangeKeys(history: readonly SearchAgentMessage[]) {
    const keys: string[] = [];
    const seen = new Set<string>();
    for (const message of history) {
      const key = messageExchangeKey(message);
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      keys.push(key);
    }
    return keys;
  }

  function countMessageExchanges(history: readonly SearchAgentMessage[]) {
    return messageExchangeKeys(history).length;
  }

  function recentMessagesForExchangeCount(history: readonly SearchAgentMessage[], count: number) {
    const keys = messageExchangeKeys(history);
    const visibleKeys = new Set(keys.slice(Math.max(0, keys.length - count)));
    return history.filter((message) => visibleKeys.has(messageExchangeKey(message)));
  }

  async function scrollMessagesToBottom() {
    await tick();
    if (!messageListElement) {
      return;
    }
    messageListElement.scrollTop = messageListElement.scrollHeight;
  }

  async function loadOlderHistory() {
    if (!messageListElement || loadingOlderHistory || !hasOlderHistory) {
      return;
    }

    loadingOlderHistory = true;
    const previousHeight = messageListElement.scrollHeight;
    const previousTop = messageListElement.scrollTop;
    visibleExchangeCount = Math.min(serverExchangeCount, visibleExchangeCount + SEARCH_HISTORY_PAGE_SIZE);
    await tick();
    messageListElement.scrollTop = messageListElement.scrollHeight - previousHeight + previousTop;
    loadingOlderHistory = false;
  }

  function handleMessageListScroll() {
    if (!messageListElement) {
      return;
    }

    if (messageListElement.scrollTop <= 28) {
      void loadOlderHistory();
    }
  }

  function shouldAutoFocusTextInput() {
    return window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  }

  async function focusInput() {
    await tick();
    if (shouldAutoFocusTextInput()) {
      inputElement?.focus({ preventScroll: true });
    }
  }

  function openExpanded() {
    expandedFromVisible = !agentPeeking;
    visibleExchangeCount = SEARCH_HISTORY_PAGE_SIZE;
    expanded = true;
    void scrollMessagesToBottom();
    void focusInput();
  }

  function toggleExpanded() {
    if (expanded) {
      closeExpanded();
      return;
    }

    openExpanded();
  }

  function closeExpanded() {
    expanded = false;
    expandedFromVisible = false;
  }

  function dismissSurfaceMessage() {
    dismissedSurfaceMessageKey = surfaceMessageKey;
  }

  function handleScreenPointerDown() {
    if (!surfaceBubbleVisible || surfaceMessageMode !== "dismissOnTap") {
      return;
    }

    dismissSurfaceMessage();
  }

  function serverHasRequest(requestId: string) {
    return messages.some((message) => message.requestId === requestId);
  }

  async function sendMessage() {
    const body = input.trim();
    if (!body || pending) {
      return;
    }

    const requestId = crypto.randomUUID();
    const sentAt = new Date().toISOString();
    const userMessage: SearchAgentMessage = {
      id: `searchAgent-pending-${requestId}:user`,
      requestId,
      role: "user",
      body,
      sentAt
    };

    transientMessages = [...transientMessages, userMessage];
    input = "";
    pending = true;
    void scrollMessagesToBottom();

    try {
      const result = await onSearchAgentSearch(body, requestId);
      if (serverHasRequest(requestId)) {
        transientMessages = [];
        return;
      }

      const assistantMessage: SearchAgentMessage = {
        id: `searchAgent-pending-${requestId}:assistant`,
        requestId,
        role: "assistant",
        body: result.body,
        results: result.results,
        sentAt: new Date().toISOString()
      };
      transientMessages = [...transientMessages, assistantMessage];
      void scrollMessagesToBottom();
    } catch {
      const assistantMessage: SearchAgentMessage = {
        id: `searchAgent-pending-${requestId}:assistant`,
        requestId,
        role: "assistant",
        body: "検索できませんでした。",
        results: [],
        sentAt: new Date().toISOString()
      };
      transientMessages = [...transientMessages, assistantMessage];
      void scrollMessagesToBottom();
    } finally {
      pending = false;
    }
  }

  async function openResult(result: SearchAgentSearchResult) {
    if (openingResult) {
      return;
    }

    openingResult = true;
    try {
      if (await onOpenSearchAgentResult(result)) {
        closeExpanded();
        return;
      }

      transientMessages = [
        ...transientMessages,
        {
          id: `searchAgent-open-failed-${crypto.randomUUID()}`,
          role: "assistant",
          body: "このデータはまだ開けないみたい。",
          sentAt: new Date().toISOString()
        }
      ];
      void scrollMessagesToBottom();
    } finally {
      openingResult = false;
    }
  }

  function isHomeAppRepairResult(result: SearchAgentSearchResult) {
    return result.targetKind === "app" || result.contentId === result.appId;
  }

  function currentAppById(appId: string) {
    return deviceState.apps.find((app) => app.id === appId);
  }

  function appLabel(result: SearchAgentSearchResult, app: { label: string } | undefined) {
    const currentApp = currentAppById(result.appId);
    if (currentApp && currentApp.corrupted !== true) {
      return currentApp.label;
    }
    return app?.label;
  }

  function resultSourceLabel(result: SearchAgentSearchResult, appLabel: string | undefined) {
    return isHomeAppRepairResult(result) ? "ホーム" : appLabel ?? result.appId;
  }

  function resultTitle(result: SearchAgentSearchResult, appLabel: string | undefined) {
    if (result.title) {
      return result.title;
    }
    return isHomeAppRepairResult(result) ? appLabel ?? result.contentId : "";
  }

  function contentStateForResult(result: SearchAgentSearchResult) {
    return contentStates.find((item) => item.contentId === result.contentId);
  }

  function isRepairedResult(result: SearchAgentSearchResult) {
    const contentState = contentStateForResult(result)?.state;
    if (contentState === "repaired" || contentState === "unlocked") {
      return true;
    }

    if (isHomeAppRepairResult(result)) {
      const app = currentAppById(result.appId);
      return Boolean(app && app.available && app.corrupted !== true);
    }

    return false;
  }

  function visibleRecordForResult(result: SearchAgentSearchResult) {
    const groups: Array<readonly unknown[]> = [
      deviceState.messages,
      deviceState.photos,
      deviceState.notes,
      deviceState.calendarEvents,
      deviceState.callLogs,
      deviceState.radioItems,
      deviceState.chatThreads
    ];

    for (const group of groups) {
      const record = group.find((item) => {
        const entry = item as { id?: unknown; contentId?: unknown };
        return entry.contentId === result.contentId || entry.id === result.contentId;
      });
      if (record) {
        return record as { initialState?: string };
      }
    }

    return undefined;
  }

  function isRepairableResult(result: SearchAgentSearchResult) {
    if (result.repairable) {
      return true;
    }

    if (isHomeAppRepairResult(result)) {
      const app = currentAppById(result.appId);
      return app?.initialState === "repairable" || app?.initialState === "hidden";
    }

    const record = visibleRecordForResult(result);
    return record?.initialState === "repairable" || record?.initialState === "hidden";
  }

  function shouldShowRepairBadge(result: SearchAgentSearchResult) {
    return isRepairableResult(result) && !isRepairedResult(result);
  }
</script>

<svelte:window on:pointerdown|capture={handleScreenPointerDown} />

<section
  class="search-agent"
  class:expanded
  class:expanded-from-visible={expanded && expandedFromVisible}
  class:peeking={agentPeeking}
  data-action={agentAction}
  aria-label={name}
>
  {#if expanded}
    <button class="agent-backdrop" type="button" aria-label="検索窓を閉じる" on:click={closeExpanded}></button>
    <div class="agent-panel" aria-label={name}>
      <header>
        <strong>検索AI {name}</strong>
        <button type="button" aria-label="閉じる" title="閉じる" on:click={closeExpanded}>
          <X size={16} strokeWidth={2.2} />
        </button>
      </header>

      <div class="message-list" bind:this={messageListElement} on:scroll={handleMessageListScroll}>
        {#each displayedMessages as message (message.id)}
          <article class:user={message.role === "user"} class:has-results={Boolean(message.results?.length)}>
            <p>{message.body}</p>
            {#if message.results?.length}
              <div class="result-list" aria-label="検索結果">
                {#each message.results as result}
                  {@const app = getAppById(result.appId)}
                  {@const label = appLabel(result, app)}
                  {@const title = resultTitle(result, label)}
                  <button
                    type="button"
                    class="result-card"
                    class:attention={shouldShowRepairBadge(result)}
                    disabled={openingResult}
                    on:click={() => openResult(result)}
                  >
                    <span class="result-icon" style={`--result-accent: ${app?.accent ?? "#8fd2ff"}`}>
                      {#if app}
                        <svelte:component this={app.icon} size={20} strokeWidth={2.2} />
                      {/if}
                    </span>
                    <span class="result-copy">
                      <span class="result-meta">
                        <span>{resultSourceLabel(result, label)}</span>
                        {#if shouldShowRepairBadge(result)}
                          <span class="result-badge" aria-hidden="true"></span>
                        {/if}
                      </span>
                      {#if result.thumbnailUrl}
                        <img src={result.thumbnailUrl} alt="" />
                      {:else if title}
                        <strong>{title}</strong>
                      {/if}
                    </span>
                  </button>
                {/each}
              </div>
            {/if}
          </article>
        {/each}
      </div>

      <form class="agent-composer" on:submit|preventDefault={sendMessage}>
        <input bind:this={inputElement} bind:value={input} type="text" aria-label={`${name}検索`} placeholder="端末内の語句を検索" />
        <button type="submit" aria-label="検索" title="検索" disabled={pending}>
          <Send size={15} strokeWidth={2.2} />
        </button>
      </form>
    </div>
  {/if}

  {#if surfaceBubbleVisible && surfaceMessage && surfaceMessageMode === "search"}
    <button
      class="surface-bubble"
      type="button"
      aria-label={`${name}の検索窓を開く`}
      on:click={openExpanded}
    >
      <span>{surfaceMessage.body}</span>
    </button>
  {:else if surfaceBubbleVisible && surfaceMessage}
    <div class="surface-bubble passive" aria-live="polite">
      <span>{surfaceMessage.body}</span>
    </div>
  {/if}

  <button class="agent-float" type="button" aria-expanded={expanded} aria-label={`${name}を開く`} title={name} on:click={toggleExpanded}>
    <span class="sprite-window" aria-hidden="true">
      <img src="/search-agent/search-agent-spritesheet.svg" alt="" />
    </span>
  </button>
</section>

<style>
  .search-agent {
    position: absolute;
    inset: 0;
    z-index: 9;
    pointer-events: none;
  }

  .agent-float,
  .agent-panel,
  .surface-bubble,
  .agent-backdrop {
    pointer-events: auto;
  }

  .agent-backdrop {
    position: absolute;
    inset: 0;
    z-index: 1;
    border: 0;
    background: rgba(8, 11, 15, 0.58);
    cursor: default;
    backdrop-filter: grayscale(0.42) blur(2px);
    animation: backdrop-in 120ms ease-out both;
  }

  .agent-float {
    position: absolute;
    right: 5px;
    bottom: calc(6px + var(--phone-safe-bottom, 0px));
    z-index: 4;
    display: grid;
    place-items: center;
    width: 96px;
    height: 104px;
    border: 0;
    background: transparent;
    color: #fff;
    cursor: pointer;
    filter:
      drop-shadow(0 14px 18px rgba(0, 0, 0, 0.46))
      drop-shadow(0 0 10px rgba(143, 210, 255, 0.16));
    transform: scale(0.96);
    transform-origin: right bottom;
    transition:
      bottom 190ms cubic-bezier(0.2, 0.78, 0.24, 1),
      transform 190ms cubic-bezier(0.2, 0.78, 0.24, 1);
  }

  .search-agent.peeking .agent-float {
    bottom: calc(-52px + var(--phone-safe-bottom, 0px));
  }

  .search-agent.expanded .agent-float {
    bottom: calc(6px + var(--phone-safe-bottom, 0px));
    animation: searchAgent-pop 260ms cubic-bezier(0.18, 1.2, 0.32, 1) both;
  }

  .search-agent.expanded.expanded-from-visible .agent-float {
    animation: searchAgent-hop 220ms cubic-bezier(0.18, 1.2, 0.32, 1) both;
  }

  .sprite-window {
    position: absolute;
    right: 0;
    bottom: 0;
    display: block;
    width: 96px;
    height: 104px;
    overflow: hidden;
    pointer-events: none;
  }

  .agent-float:active .sprite-window {
    transform: translateY(1px) scale(0.98);
  }

  .sprite-window img {
    display: block;
    width: 768px;
    height: 936px;
    max-width: none;
    image-rendering: pixelated;
    animation: searchAgent-idle 1.28s steps(6) infinite;
  }

  .search-agent[data-action="hi"] .sprite-window img {
    animation: searchAgent-hi 740ms steps(4) infinite;
  }

  .surface-bubble {
    position: absolute;
    right: 106px;
    bottom: calc(42px + var(--phone-safe-bottom, 0px));
    z-index: 2;
    display: block;
    width: min(214px, calc(100% - 136px));
    padding: 10px 12px;
    border: 1px solid rgba(15, 23, 31, 0.14);
    border-radius: 15px 15px 6px;
    background: rgba(255, 255, 255, 0.96);
    color: #15202a;
    cursor: pointer;
    font-size: 0.72rem;
    font-weight: 720;
    line-height: 1.42;
    text-align: left;
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.78),
      0 12px 26px rgba(0, 0, 0, 0.24);
    backdrop-filter: blur(18px) saturate(1.02);
    animation: surface-bubble-in 130ms ease-out both;
  }

  .surface-bubble::after {
    content: "";
    position: absolute;
    right: -6px;
    bottom: 22px;
    width: 12px;
    height: 12px;
    border-right: 1px solid rgba(15, 23, 31, 0.14);
    border-bottom: 1px solid rgba(15, 23, 31, 0.14);
    background: rgba(255, 255, 255, 0.96);
    transform: rotate(45deg);
  }

  .surface-bubble.passive {
    pointer-events: none;
  }

  .search-agent.peeking .surface-bubble {
    bottom: calc(42px + var(--phone-safe-bottom, 0px));
  }

  .agent-panel {
    position: absolute;
    top: 58px;
    right: 14px;
    bottom: calc(132px + var(--phone-safe-bottom, 0px));
    z-index: 3;
    display: grid;
    grid-template-rows: auto minmax(0, 1fr) auto;
    gap: 10px;
    width: 342px;
    padding: 12px;
    border: 1px solid rgba(143, 210, 255, 0.2);
    border-radius: 18px;
    background:
      radial-gradient(circle at 14% 8%, rgba(143, 210, 255, 0.2), transparent 32%),
      rgba(11, 16, 23, 0.94);
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.09),
      0 18px 42px rgba(0, 0, 0, 0.46);
    backdrop-filter: blur(26px) saturate(1.16);
    transform-origin: right bottom;
    animation: panel-in 130ms ease-out both;
  }

  header {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 34px;
    align-items: center;
    gap: 8px;
  }

  header strong {
    overflow: hidden;
    font-size: 1rem;
    line-height: 1.12;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  header button,
  .agent-composer button {
    display: grid;
    place-items: center;
    border: 1px solid var(--ap-border);
    background: var(--ap-surface-2);
    color: #fff;
    cursor: pointer;
  }

  header button {
    width: 34px;
    height: 34px;
    border-radius: 12px;
  }

  .message-list {
    display: grid;
    align-content: start;
    gap: 8px;
    min-height: 0;
    overflow: auto;
    padding-right: 2px;
  }

  .message-list article {
    display: grid;
    justify-self: start;
    gap: 4px;
    max-width: 88%;
    padding: 9px 10px;
    border-radius: 15px 15px 15px 6px;
    background: rgba(143, 210, 255, 0.14);
  }

  .message-list article.has-results {
    width: min(100%, 304px);
    max-width: 96%;
    padding: 10px;
  }

  .message-list article.user {
    justify-self: end;
    border-radius: 15px 15px 6px 15px;
    background: rgba(255, 255, 255, 0.11);
  }

  .message-list article p {
    margin: 0;
    color: rgba(255, 255, 255, 0.86);
    font-size: 0.76rem;
    line-height: 1.52;
  }

  .result-list {
    display: grid;
    gap: 8px;
    margin-top: 4px;
  }

  .result-card {
    position: relative;
    display: grid;
    grid-template-columns: 40px minmax(0, 1fr);
    align-items: center;
    gap: 10px;
    width: 100%;
    min-width: 0;
    min-height: 64px;
    padding: 10px;
    border: 1px solid rgba(255, 255, 255, 0.17);
    border-radius: 14px;
    background:
      linear-gradient(135deg, rgba(255, 255, 255, 0.15), rgba(255, 255, 255, 0.075)),
      rgba(255, 255, 255, 0.08);
    color: #fff;
    cursor: pointer;
    text-align: left;
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.12),
      0 8px 18px rgba(0, 0, 0, 0.22);
    transition:
      border-color 120ms ease,
      background 120ms ease,
      transform 120ms ease;
  }

  .result-card.attention {
    border-color: rgba(244, 200, 106, 0.58);
    background:
      linear-gradient(135deg, rgba(244, 200, 106, 0.18), rgba(255, 255, 255, 0.08) 48%),
      rgba(255, 255, 255, 0.1);
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.16),
      0 0 0 1px rgba(244, 200, 106, 0.1),
      0 12px 24px rgba(0, 0, 0, 0.24),
      0 0 20px rgba(244, 200, 106, 0.18);
  }

  .result-card:hover,
  .result-card:focus-visible {
    border-color: rgba(143, 210, 255, 0.4);
    background:
      linear-gradient(135deg, rgba(143, 210, 255, 0.2), rgba(255, 255, 255, 0.1)),
      rgba(255, 255, 255, 0.1);
  }

  .result-card:active {
    transform: translateY(1px) scale(0.99);
  }

  .result-icon {
    display: grid;
    place-items: center;
    width: 40px;
    height: 40px;
    border-radius: 13px;
    background: color-mix(in srgb, var(--result-accent) 78%, white 8%);
    color: #111821;
  }

  .result-copy {
    display: grid;
    min-width: 0;
    gap: 4px;
  }

  .result-meta {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    min-width: 0;
  }

  .result-meta span:first-child {
    overflow: hidden;
    min-width: 0;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .result-meta span:first-child,
  .result-copy > span:not(.result-meta) {
    color: var(--ap-text-soft);
    font-size: 0.62rem;
    font-weight: 760;
  }

  .result-badge {
    flex: 0 0 auto;
    width: 12px;
    height: 12px;
    border: 1px solid rgba(255, 255, 255, 0.68);
    border-radius: 999px;
    background: #f4c86a;
    box-shadow:
      0 0 0 2px rgba(244, 200, 106, 0.16),
      0 0 14px rgba(244, 200, 106, 0.42);
  }

  .result-copy strong {
    overflow: hidden;
    font-size: 0.86rem;
    line-height: 1.28;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .result-copy img {
    width: 100%;
    max-height: 82px;
    border-radius: 10px;
    object-fit: cover;
  }

  .agent-composer {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 38px;
    gap: 8px;
  }

  .agent-composer input {
    min-width: 0;
    min-height: 38px;
    padding: 0 11px;
    border: 1px solid var(--ap-border);
    border-radius: 13px;
    background: var(--ap-surface-1);
    color: #fff;
    outline: none;
  }

  .agent-composer input::placeholder {
    color: var(--ap-text-soft);
  }

  @keyframes searchAgent-idle {
    from {
      transform: translate3d(0, 0, 0);
    }

    to {
      transform: translate3d(-576px, 0, 0);
    }
  }

  @keyframes searchAgent-hi {
    from {
      transform: translate3d(0, -312px, 0);
    }

    to {
      transform: translate3d(-384px, -312px, 0);
    }
  }

  @keyframes searchAgent-pop {
    0% {
      transform: translateY(52px) scale(0.96);
    }

    58% {
      transform: translateY(-10px) scale(1);
    }

    100% {
      transform: translateY(0) scale(0.96);
    }
  }

  @keyframes searchAgent-hop {
    0% {
      transform: translateY(0) scale(0.96);
    }

    48% {
      transform: translateY(-7px) scale(0.985);
    }

    100% {
      transform: translateY(0) scale(0.96);
    }
  }

  @keyframes panel-in {
    from {
      opacity: 0;
      transform: translateY(8px) scale(0.985);
    }

    to {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
  }

  @keyframes backdrop-in {
    from {
      opacity: 0;
    }

    to {
      opacity: 1;
    }
  }

  @keyframes surface-bubble-in {
    from {
      opacity: 0;
      transform: translateY(5px) scale(0.99);
    }

    to {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
  }
</style>
