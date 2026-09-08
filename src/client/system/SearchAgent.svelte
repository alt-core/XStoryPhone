<script lang="ts">
  import { onDestroy, tick } from "svelte";
  import { Send, X } from "@lucide/svelte";
  import type {
    AssistantMessage,
    SearchAgentAction,
    SearchAgentMessage,
    SearchAgentSearchResult,
    SearchAgentTalkView,
    DeviceState
  } from "../scenario-runtime/types";
  import {
    queuedTalkMessageDelayMs,
    shouldQueueTalkMessage
  } from "./talkMessageDelay";
  import MessageBody from "./MessageBody.svelte";
  import TypingIndicator from "./TypingIndicator.svelte";
  import QuickReplies from "./QuickReplies.svelte";
  import { latestQuickReplyPlacement, resolvedTalkInputState } from "./talkInputState.ts";
  import {
    loadTalkDelaySeenMessages,
    saveTalkDelaySeenMessages,
    type SeenMessageIdsByThread
  } from "../apps/talkDelaySeenStorage";
  import { appCatalog, getAppById, type AppCatalogItem } from "./appCatalog";
  import { MAX_SEARCH_AGENT_QUERY_LENGTH } from "../../shared/searchAgent";

  type SurfaceMessageMode = "search" | "dismissOnTap";

  type ContentStateSnapshot = {
    contentId: string;
    state: string;
    appId: string | null;
    updatedAt: string;
  };

  const SEARCH_HISTORY_PAGE_SIZE = 40;
  const DELAY_MEMORY_SCOPE = "search_agent";

  export let talk: SearchAgentTalkView | null = null;
  export let apps: AppCatalogItem[] = appCatalog;
  export let name = "ナビ";
  export let deviceState: DeviceState;
  export let contentStates: ContentStateSnapshot[] = [];
  export let onSend: (body: string) => Promise<{ ok: boolean; error?: string }> = async () => ({
    ok: false,
    error: "送信できません。"
  });
  export let onOpenSearchAgentResult: (result: SearchAgentSearchResult) => boolean | Promise<boolean> = () => false;
  export let onOpenMessageLink: (
    talkId: string,
    messageRef: string,
    segmentIndex: number,
    linkId?: string
  ) => void | Promise<void> = () => {};
  export let delayMemoryKey = "";
  export let peeking = false;
  export let surfaceKey = "home";
  export let closeRequestId = 0;
  export let surfaceMessage: AssistantMessage | undefined = undefined;
  export let surfaceMessageMode: SurfaceMessageMode = "dismissOnTap";
  export let onOpenChange: (open: boolean) => void = () => {};

  let expanded = false;
  let destroyed = false;
  let input = "";
  let transientMessages: SearchAgentMessage[] = [];
  let pending = false;
  let sendError = "";
  let dismissedSurfaceMessageKey = "";
  let lastSurfaceKey = surfaceKey;
  let lastCloseRequestId = closeRequestId;
  let expandedFromVisible = false;
  let agentAction: SearchAgentAction = "idle";
  let lastServerMessageKey = "";
  let visibleMessageCount = SEARCH_HISTORY_PAGE_SIZE;
  let messageListElement: HTMLDivElement | undefined;
  let inputElement: HTMLInputElement | undefined;
  let loadingOlderHistory = false;
  let openingResult = false;
  let trackedTalkId = "";
  let trackedMessages: SearchAgentMessage[] = [];
  let visibleMessageIds = new Set<string>();
  let pendingMessageIds = new Set<string>();
  let messageDelayTimer: number | undefined;
  let scheduledMessageId = "";
  let seenMessageIdsByThread: SeenMessageIdsByThread = {};
  let loadedDelayMemoryKey: string | undefined;
  let lastQuickReplySignature = "";

  $: if (surfaceKey !== lastSurfaceKey) {
    lastSurfaceKey = surfaceKey;
    dismissedSurfaceMessageKey = "";
    closeExpanded();
  }
  $: if (closeRequestId !== lastCloseRequestId) {
    lastCloseRequestId = closeRequestId;
    closeExpanded();
  }
  $: surfaceMessageKey = surfaceMessage ? `${surfaceKey}:${surfaceMessage.id}` : "";
  $: surfaceBubbleVisible = Boolean(
    surfaceMessage &&
      !expanded &&
      (surfaceMessageMode === "search" || surfaceMessageKey !== dismissedSurfaceMessageKey)
  );
  $: agentPeeking = peeking && !expanded && !surfaceBubbleVisible;
  $: agentAction = surfaceBubbleVisible ? surfaceMessage?.agentAction ?? "idle" : "idle";
  $: messages = talk?.messages ?? [];
  $: syncSeenMessageMemory(delayMemoryKey);
  $: syncDelayedMessages(expanded ? talk?.talkId ?? "" : "", messages);
  $: serverMessageKey = messages.map((message) => message.id).join("|");
  $: if (serverMessageKey !== lastServerMessageKey) {
    lastServerMessageKey = serverMessageKey;
    transientMessages = [];
    if (expanded) {
      void scrollMessagesToBottom();
    }
  }
  $: visibleServerMessages = messages.filter((message) => visibleMessageIds.has(message.id));
  $: pagedServerMessages = visibleServerMessages.slice(-visibleMessageCount);
  $: displayedMessages = [...pagedServerMessages, ...transientMessages];
  $: hasOlderHistory = visibleMessageCount < visibleServerMessages.length;
  $: resolvedInput = resolvedTalkInputState(talk ?? undefined, messages, visibleMessageIds);
  $: composerVisible = resolvedInput.visible;
  $: composerEnabled = resolvedInput.canSubmit;
  $: quickReplyPlacement = pending || transientMessages.length
    ? undefined
    : latestQuickReplyPlacement(messages, visibleMessageIds, composerEnabled);
  $: quickReplySignature = quickReplyPlacement?.messageId ?? "";
  $: if (quickReplySignature !== lastQuickReplySignature) {
    const wasNearBottom = isMessageListNearBottom();
    lastQuickReplySignature = quickReplySignature;
    if (expanded && wasNearBottom) {
      void scrollMessagesToBottom();
    }
  }
  $: typingVisible = pending || pendingMessageIds.size > 0;

  function isMessageListNearBottom() {
    if (!messageListElement) return true;
    return messageListElement.scrollHeight - messageListElement.scrollTop - messageListElement.clientHeight <= 48;
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
    visibleMessageCount = Math.min(visibleServerMessages.length, visibleMessageCount + SEARCH_HISTORY_PAGE_SIZE);
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
    visibleMessageCount = SEARCH_HISTORY_PAGE_SIZE;
    expanded = true;
    onOpenChange(true);
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
    onOpenChange(false);
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

  function seenMessageIds(talkId: string) {
    if (!seenMessageIdsByThread[talkId]) {
      seenMessageIdsByThread[talkId] = new Set<string>();
    }
    return seenMessageIdsByThread[talkId];
  }

  function saveSeenMessageMemory() {
    saveTalkDelaySeenMessages(
      DELAY_MEMORY_SCOPE,
      loadedDelayMemoryKey ?? delayMemoryKey,
      seenMessageIdsByThread
    );
  }

  function markMessageSeen(talkId: string, messageId: string) {
    if (!talkId || !messageId) return;
    const seen = seenMessageIds(talkId);
    if (seen.has(messageId)) return;
    seen.add(messageId);
    saveSeenMessageMemory();
  }

  function markVisibleMessagesSeen() {
    if (!trackedTalkId) return;
    for (const message of trackedMessages) {
      if (visibleMessageIds.has(message.id)) markMessageSeen(trackedTalkId, message.id);
    }
  }

  function syncSeenMessageMemory(memoryKey: string) {
    if (memoryKey === loadedDelayMemoryKey) return;
    loadedDelayMemoryKey = memoryKey;
    seenMessageIdsByThread = loadTalkDelaySeenMessages(DELAY_MEMORY_SCOPE, memoryKey);
  }

  function clearMessageDelayTimer() {
    if (messageDelayTimer) window.clearTimeout(messageDelayTimer);
    messageDelayTimer = undefined;
    scheduledMessageId = "";
  }

  function lastOwnerMessageIndex(items: SearchAgentMessage[]) {
    let ownerIndex = -1;
    items.forEach((message, index) => {
      if (message.sender === "owner") ownerIndex = index;
    });
    return ownerIndex;
  }

  function nextPendingMessage() {
    return trackedMessages.find((message) => pendingMessageIds.has(message.id));
  }

  function revealDelayedMessage(messageId: string, talkId: string) {
    if (scheduledMessageId === messageId) {
      messageDelayTimer = undefined;
      scheduledMessageId = "";
    }
    if (talkId !== trackedTalkId || !pendingMessageIds.has(messageId)) {
      scheduleNextPendingMessage();
      return;
    }
    const nextPending = new Set(pendingMessageIds);
    const nextVisible = new Set(visibleMessageIds);
    nextPending.delete(messageId);
    nextVisible.add(messageId);
    markMessageSeen(talkId, messageId);
    pendingMessageIds = nextPending;
    visibleMessageIds = nextVisible;
    void scrollMessagesToBottom();
    scheduleNextPendingMessage();
  }

  function scheduleNextPendingMessage() {
    if (!trackedTalkId || scheduledMessageId) return;
    const message = nextPendingMessage();
    if (!message) return;
    scheduledMessageId = message.id;
    messageDelayTimer = window.setTimeout(
      () => revealDelayedMessage(message.id, trackedTalkId),
      queuedTalkMessageDelayMs(message)
    );
  }

  function syncDelayedMessages(talkId: string, items: SearchAgentMessage[]) {
    if (!talkId) {
      markVisibleMessagesSeen();
      clearMessageDelayTimer();
      trackedTalkId = "";
      trackedMessages = [];
      visibleMessageIds = new Set();
      pendingMessageIds = new Set();
      return;
    }

    const itemIds = new Set(items.map((message) => message.id));
    const ownerIndex = lastOwnerMessageIndex(items);
    if (talkId !== trackedTalkId) {
      markVisibleMessagesSeen();
      clearMessageDelayTimer();
      trackedTalkId = talkId;
      trackedMessages = items;
      const seen = seenMessageIds(talkId);
      const nextVisible = new Set<string>();
      const nextPending = new Set<string>();
      let earlierReplyPending = false;
      for (const [index, message] of items.entries()) {
        if (seen.has(message.id)) {
          nextVisible.add(message.id);
          continue;
        }
        if (shouldQueueTalkMessage(message, index, ownerIndex, earlierReplyPending)) {
          nextPending.add(message.id);
          earlierReplyPending = true;
          continue;
        }
        nextVisible.add(message.id);
        markMessageSeen(talkId, message.id);
      }
      visibleMessageIds = nextVisible;
      pendingMessageIds = nextPending;
      scheduleNextPendingMessage();
      return;
    }

    trackedMessages = items;
    const nextVisible = new Set([...visibleMessageIds].filter((id) => itemIds.has(id)));
    const nextPending = new Set([...pendingMessageIds].filter((id) => itemIds.has(id)));
    let earlierReplyPending = false;
    if (scheduledMessageId && !nextPending.has(scheduledMessageId)) clearMessageDelayTimer();
    for (const [index, message] of items.entries()) {
      if (nextPending.has(message.id)) {
        earlierReplyPending = true;
        continue;
      }
      if (nextVisible.has(message.id)) continue;
      if (shouldQueueTalkMessage(message, index, ownerIndex, earlierReplyPending)) {
        nextPending.add(message.id);
        earlierReplyPending = true;
      } else {
        nextVisible.add(message.id);
        markMessageSeen(talkId, message.id);
      }
    }
    visibleMessageIds = nextVisible;
    pendingMessageIds = nextPending;
    scheduleNextPendingMessage();
  }

  onDestroy(() => {
    destroyed = true;
    onOpenChange(false);
    markVisibleMessagesSeen();
    clearMessageDelayTimer();
  });

  async function sendBody(body: string, clearInput: boolean) {
    if (!body || pending || !composerEnabled) {
      return;
    }

    const requestId = crypto.randomUUID();
    const sentAt = new Date().toISOString();
    const userMessage: SearchAgentMessage = {
      kind: "message",
      seq: (messages[messages.length - 1]?.seq ?? 0) + 1,
      id: `searchAgent-pending-${requestId}:user`,
      talkId: talk?.talkId ?? "search_agent",
      sender: "owner",
      body,
      sentAt
    };

    transientMessages = [...transientMessages, userMessage];
    if (clearInput) input = "";
    pending = true;
    sendError = "";
    void scrollMessagesToBottom();

    try {
      const result = await onSend(body);
      if (!result.ok) {
        if (clearInput && !input) input = body;
        sendError = result.error ?? "送信に失敗しました。";
      }
    } catch {
      if (clearInput && !input) input = body;
      sendError = "送信に失敗しました。";
    } finally {
      transientMessages = [];
      pending = false;
      void focusInput();
    }
  }

  async function sendMessage() {
    await sendBody(input.trim(), true);
  }

  async function sendQuickReply(reply: string) {
    await sendBody(reply, false);
  }

  function openMessageLink(message: Extract<SearchAgentMessage, { kind: "message" }>, segmentIndex: number) {
    const segment = message.segments?.[segmentIndex];
    return onOpenMessageLink(
      message.talkId,
      message.id,
      segmentIndex,
      segment?.kind === "link" && "linkId" in segment ? segment.linkId : undefined
    );
  }

  async function openResult(result: SearchAgentSearchResult) {
    if (openingResult) {
      return;
    }

    openingResult = true;
    const requestId = closeRequestId;
    try {
      const opened = await onOpenSearchAgentResult(result);
      // 破棄後のpropsは更新されないため、新しいパネルへ旧応答の開閉通知を渡さない。
      if (destroyed || requestId !== closeRequestId) return;
      if (opened) {
        closeExpanded();
        return;
      }

      transientMessages = [
        ...transientMessages,
        {
          kind: "message",
          seq: (messages[messages.length - 1]?.seq ?? 0) + transientMessages.length + 1,
          id: `searchAgent-open-failed-${crypto.randomUUID()}`,
          talkId: talk?.talkId ?? "search_agent",
          sender: "other",
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
    return result.targetKind === "app";
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

  function isRepairableResult(result: SearchAgentSearchResult) {
    return result.repairable;
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
          {#if message.kind === "message" || message.results.length}
            <article class:user={message.sender === "owner"} class:has-results={message.kind === "search_results"}>
              {#if message.kind === "message"}
                <MessageBody
                  body={message.body}
                  segments={message.segments}
                  onOpenLink={(segmentIndex) => openMessageLink(message, segmentIndex)}
                />
              {:else}
                <div class="result-list" aria-label="検索結果">
                  {#each message.results as result}
                    {@const app = getAppById(result.appId, apps)}
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
            {#if quickReplyPlacement?.messageId === message.id}
              <div class="history-quick-replies">
                <QuickReplies replies={quickReplyPlacement.replies} accent="#8fd2ff" onSelect={sendQuickReply} />
              </div>
            {/if}
          {/if}
        {/each}
        {#if typingVisible}
          <TypingIndicator variant="search" ariaLabel={pending ? "返答待ち" : "入力中"} />
        {/if}
      </div>

      {#if composerVisible || sendError}
        <div class="agent-controls">
          {#if sendError}
            <p class="send-error" role="alert">{sendError}</p>
          {/if}
          {#if composerVisible}
            <div class="composer-area">
              <form class="agent-composer" on:submit|preventDefault={sendMessage}>
                <input
                  bind:this={inputElement}
                  bind:value={input}
                  type="text"
                  maxlength={MAX_SEARCH_AGENT_QUERY_LENGTH}
                  aria-label={`${name}へ送信`}
                  placeholder={composerEnabled ? "メッセージを入力" : "送信できません"}
                  disabled={pending || !composerEnabled}
                />
                <button type="submit" aria-label="送信" title="送信" disabled={pending || !composerEnabled || !input.trim()}>
                  <Send size={15} strokeWidth={2.2} />
                </button>
              </form>
            </div>
          {/if}
        </div>
      {/if}
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

  .agent-controls {
    display: grid;
    gap: 6px;
    min-width: 0;
  }

  .history-quick-replies {
    min-width: 0;
    width: 100%;
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

  .message-list article :global(.message-body) {
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

  .composer-area {
    display: grid;
    gap: 6px;
  }

  .send-error {
    margin: 0;
    color: #ffc2bd;
    font-size: 0.68rem;
    line-height: 1.4;
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
