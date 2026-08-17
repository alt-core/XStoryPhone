<script lang="ts">
  import { afterUpdate, beforeUpdate, onDestroy } from "svelte";
  import { FileImage, ImagePlus, KeyRound, List, MessageSquareText, Radio, Send, Video, X } from "@lucide/svelte";
  import type { AppId, ChatAppThread, ChatAuthGate, MessageAttachment, PendingShareDraft, PhotoItem } from "../scenario-runtime/types";
  import AttachmentImageFrame from "../system/AttachmentImageFrame.svelte";
  import AudioPlaybackButton from "../system/AudioPlaybackButton.svelte";
  import MessageBody from "../system/MessageBody.svelte";
  import ScrollHint from "../system/ScrollHint.svelte";
  import TypingIndicator from "../system/TypingIndicator.svelte";
  import UserAvatar from "../system/UserAvatar.svelte";
  import VideoPlayback from "../system/VideoPlayback.svelte";
  import VideoStillFrame from "../system/VideoStillFrame.svelte";
  import AppShell from "./AppShell.svelte";
  import BrokenTalkHistory from "./BrokenTalkHistory.svelte";
  import {
    consumeConversationScroll,
    isConversationNearBottom,
    rememberConversationScrollForLink,
    restoreConversationScrollAfterTick,
    scrollConversationToBottomAfterTick
  } from "./conversationScrollMemory";
  import PhotoMessagePicker from "./PhotoMessagePicker.svelte";
  import { brokenRangesAfterMessages, brokenRangesBeforeMessage } from "./talkHistoryRanges";
  import {
    loadTalkDelaySeenMessages,
    saveTalkDelaySeenMessages,
    type SeenMessageIdsByThread
  } from "./talkDelaySeenStorage";

  const DEFAULT_MESSAGE_DELAY_MS = 100;
  const MAX_MESSAGE_DELAY_MS = 8000;
  const DELAY_MEMORY_APP_ID = "chat";

  type DelayedMessage = {
    id: string;
    sender?: "owner" | "other";
    delayMs?: number;
    delayOnFirstDisplay?: boolean;
  };

  type ReplyDelayAnchor = {
    waiting: boolean;
  };

  export let threads: ChatAppThread[] = [];
  export let authGate: ChatAuthGate | undefined = undefined;
  export let photos: PhotoItem[] = [];
  export let focusContentId = "";
  export let focusContentRequestId = 0;
  export let focusHistoryRepairId = "";
  export let delayMemoryKey = "";
  export let onNoise: () => void = () => {};
  export let onSend: (talkId: string, message: string) => Promise<{ ok: boolean; error?: string }> = async () => ({
    ok: false,
    error: "送信できません。"
  });
  export let initialShareDraft: PendingShareDraft | null = null;
  export let onInitialShareDraftConsumed: (requestId: number) => void = () => {};
  export let onOpenSharedContent: (appId: AppId, contentId: string) => void = () => {};
  export let albumMediaContentId: (attachment: MessageAttachment | undefined) => string = () => "";
  export let onOpenAlbumMedia: (attachment: MessageAttachment | undefined) => void = () => {};
  export let postEnabledByThread: Record<string, boolean> = {};
  export let onAuthLinkRequest: () => Promise<{ ok: boolean; error?: string }> = async () => ({
    ok: false,
    error: "送信できません。"
  });
  export let onOpenMessageLink: (talkId: string, messageRef: string, segmentIndex: number) => void | Promise<void> = () => {};
  export let onPickerOpenChange: (open: boolean) => void = () => {};
  export let onContentOpen: (contentId: string, mediaContentIds: string[]) => void = () => {};
  export let onMediaObserved: (contentId: string, mediaContentIds: string[]) => void = () => {};
  export let onVisibleMediaObserved: (contentId: string) => void = () => {};
  export let onPhotoDraftChange: (active: boolean) => void = () => {};
  export let onRead: (talkId: string, messageId: string) => void | Promise<void> = () => {};
  export let onDisplayedThreadChange: (contentId: string) => void = () => {};
  export let onBlockedContentOpen: (contentId: string) => void = () => {};
  export let replyDelayAnchorsByThread: Record<string, ReplyDelayAnchor> = {};
  export let initialDateLabel = "今日";

  let selectedThreadId = threads[0]?.id ?? "";
  let pickerOpen = true;
  let photoPickerOpen = false;
  let selectedPhotoId = "";
  let selectedShare: { appId: AppId; contentId: string; title: string } | null = null;
  let draft = "";
  let sending = false;
  let requestingAuthLink = false;
  let sendError = "";
  let authError = "";
  let historyList: HTMLDivElement;
  let lastHistorySignature = "";
  let lastHistoryThreadId = "";
  let historyWasNearBottomBeforeUpdate = true;
  let lastReportedContentId = "";
  let lastReportedMediaOpenKey = "";
  let lastReportedVisibleMediaOpenKey = "";
  let lastAppliedFocusContentId = "";
  let lastAppliedFocusContentRequestId = focusContentRequestId;
  let pendingHistoryRepairId = "";
  let trackedThreadId = "";
  let trackedMessages: DelayedMessage[] = [];
  let visibleMessageIds = new Set<string>();
  let pendingMessageIds = new Set<string>();
  let readDividerAfterMessageId = "";
  let readDividerArmed = false;
  let messageDelayTimer: number | undefined;
  let scheduledMessageId = "";
  let pendingRead: { talkId: string; messageId: string } | null = null;
  let lastReportedReadKey = "";
  let lastReportedDisplayedContentId = "";
  let seenMessageIdsByThread: SeenMessageIdsByThread = {};
  let loadedDelayMemoryKey: string | undefined = undefined;
  let lastAppliedShareDraftRequestId = 0;
  let lastReportedPhotoDraftActive = false;

  $: syncSeenMessageMemory(delayMemoryKey);
  $: if (threads.length && !threads.some((thread) => thread.id === selectedThreadId)) {
    selectedThreadId = threads[0].id;
  }
  $: if (initialShareDraft && initialShareDraft.requestId !== lastAppliedShareDraftRequestId) {
    applyInitialShareDraft(initialShareDraft);
  }
  $: if (!focusContentId) {
    lastAppliedFocusContentId = "";
    lastAppliedFocusContentRequestId = focusContentRequestId;
    pendingHistoryRepairId = "";
  } else if (focusContentId !== lastAppliedFocusContentId || focusContentRequestId !== lastAppliedFocusContentRequestId) {
    const focused = threads.find((thread) => matchesThreadId(thread, focusContentId));
    if (focused) {
      lastAppliedFocusContentId = focusContentId;
      lastAppliedFocusContentRequestId = focusContentRequestId;
      selectedThreadId = focused.id;
      pickerOpen = focused.corrupted === true;
      pendingHistoryRepairId = focused.corrupted ? "" : focusHistoryRepairId;
      lastHistorySignature = "";
      lastHistoryThreadId = "";
      if (focused.corrupted) {
        onNoise();
        onBlockedContentOpen(focused.contentId ?? focused.id);
      }
    }
  }
  $: selectedThread = threads.find((thread) => thread.id === selectedThreadId) ?? threads[0];
  $: hasOtherUnreadThread = threads.some((thread) => thread.id !== selectedThreadId && thread.unread && !thread.corrupted);
  $: selectedThreadMediaSignature = selectedThread ? mediaAttachmentSignature(selectedThread.messages) : "";
  $: selectedThreadVisibleMediaSignature = selectedThread ? mediaAttachmentSignature(selectedThread.messages, visibleMessageIds, "other") : "";
  $: selectedThreadContentId = selectedThread && !selectedThread.corrupted ? selectedThread.contentId ?? selectedThread.id : "";
  $: selectedThreadMediaOpenKey = selectedThreadContentId && selectedThreadMediaSignature ? `${selectedThreadContentId}:${selectedThreadMediaSignature}` : "";
  $: selectedThreadVisibleMediaOpenKey =
    selectedThreadContentId && selectedThreadVisibleMediaSignature ? `${selectedThreadContentId}:${selectedThreadVisibleMediaSignature}` : "";
  $: if (selectedThreadContentId && selectedThreadContentId !== lastReportedContentId) {
    lastReportedContentId = selectedThreadContentId;
    lastReportedMediaOpenKey = selectedThreadMediaOpenKey;
    lastReportedVisibleMediaOpenKey = "";
    onContentOpen(selectedThreadContentId, mediaAttachmentContentIds(selectedThread?.messages ?? []));
  }
  $: selectedThreadCanPost = selectedThread ? postEnabledByThread[selectedThread.id] === true : false;
  $: conversationVisible = Boolean(threads.length && selectedThread && !selectedThread.corrupted && !pickerOpen && !authGate);
  $: reportDisplayedThread(conversationVisible ? selectedThreadContentId : "");
  $: sendablePhotos = photos.filter((photo) => (photo.imageUrl || photo.audioUrl || photo.videoUrl) && !photo.corrupted);
  $: if (selectedPhotoId && !sendablePhotos.some((photo) => photo.id === selectedPhotoId)) {
    selectedPhotoId = "";
  }
  $: selectedPhoto = sendablePhotos.find((photo) => photo.id === selectedPhotoId);
  $: photoDraftActive = Boolean(selectedPhoto);
  $: if (photoDraftActive !== lastReportedPhotoDraftActive) {
    lastReportedPhotoDraftActive = photoDraftActive;
    onPhotoDraftChange(photoDraftActive);
  }
  $: latestMessageId = selectedThread?.messages[selectedThread.messages.length - 1]?.id ?? "";
  $: historySignature = selectedThread ? `${selectedThread.id}:${selectedThread.messages.length}:${latestMessageId}` : "";
  $: syncDelayedMessages(
    conversationVisible ? selectedThread?.id ?? "" : "",
    conversationVisible ? selectedThread?.messages ?? [] : []
  );
  $: if (conversationVisible && selectedThreadContentId && selectedThreadMediaOpenKey && selectedThreadMediaOpenKey !== lastReportedMediaOpenKey) {
    lastReportedMediaOpenKey = selectedThreadMediaOpenKey;
    onMediaObserved(selectedThreadContentId, mediaAttachmentContentIds(selectedThread?.messages ?? []));
  }
  $: if (
    conversationVisible &&
    !photoPickerOpen &&
    !selectedPhoto &&
    selectedThreadContentId &&
    selectedThreadVisibleMediaOpenKey &&
    selectedThreadVisibleMediaOpenKey !== lastReportedVisibleMediaOpenKey
  ) {
    lastReportedVisibleMediaOpenKey = selectedThreadVisibleMediaOpenKey;
    onMediaObserved(selectedThreadContentId, mediaAttachmentContentIds(selectedThread?.messages ?? []));
    onVisibleMediaObserved(selectedThreadContentId);
  }
  $: syncVisibleRead(conversationVisible ? selectedThread : undefined);
  $: typingMessage = selectedThread?.messages.find((message) => pendingMessageIds.has(message.id));
  $: replyDelayAnchor = selectedThread ? replyDelayAnchorsByThread[selectedThread.id] : undefined;
  $: typingVisible = Boolean(typingMessage || replyDelayAnchor?.waiting);

  beforeUpdate(() => {
    historyWasNearBottomBeforeUpdate = isHistoryNearBottom();
  });

  afterUpdate(() => {
    if (!conversationVisible) {
      if (lastHistorySignature) {
        lastHistorySignature = "";
      }
      if (lastHistoryThreadId) {
        lastHistoryThreadId = "";
      }
      return;
    }

    if (!historyList || !selectedThread || !historySignature) {
      return;
    }

    if (pendingHistoryRepairId && scrollToHistoryRepair(pendingHistoryRepairId)) {
      pendingHistoryRepairId = "";
      lastHistorySignature = historySignature;
      lastHistoryThreadId = selectedThread.id;
      return;
    }

    if (historySignature === lastHistorySignature) {
      return;
    }

    const threadChanged = selectedThread.id !== lastHistoryThreadId;
    lastHistorySignature = historySignature;
    lastHistoryThreadId = selectedThread.id;
    const restoredScrollTop = consumeConversationScroll(DELAY_MEMORY_APP_ID, selectedThread.id);

    if (restoredScrollTop !== undefined) {
      restoreConversationScrollAfterTick(() => historyList, restoredScrollTop);
      return;
    }

    if (threadChanged || historyWasNearBottomBeforeUpdate) {
      scrollHistoryToBottom();
    }
  });

  onDestroy(() => {
    markVisibleMessagesSeen(trackedThreadId, trackedMessages, visibleMessageIds);
    flushPendingRead();
    onPickerOpenChange(false);
    onPhotoDraftChange(false);
    clearMessageDelayTimers();
  });

  function scrollHistoryToBottom() {
    scrollConversationToBottomAfterTick(() => historyList);
  }

  function scrollToHistoryRepair(repairId: string) {
    const target = [...historyList.querySelectorAll<HTMLElement>("[data-history-repair-id]")]
      .find((element) => element.dataset.historyRepairId === repairId);
    if (!target) return false;
    historyList.scrollTop = Math.max(0, target.offsetTop - 8);
    return true;
  }

  function isHistoryNearBottom() {
    return isConversationNearBottom(historyList);
  }

  function rememberHistoryScrollForLink() {
    if (!selectedThread) {
      return;
    }

    rememberConversationScrollForLink(DELAY_MEMORY_APP_ID, selectedThread.id, historyList);
  }

  function openMessageLink(messageId: string, segmentIndex: number) {
    if (!selectedThread) {
      return;
    }

    rememberHistoryScrollForLink();
    return onOpenMessageLink(selectedThread.id, messageId, segmentIndex);
  }

  function openSharedContent(appId: AppId, contentId: string) {
    rememberHistoryScrollForLink();
    onOpenSharedContent(appId, contentId);
  }

  function openAlbumMedia(attachment: MessageAttachment | undefined) {
    rememberHistoryScrollForLink();
    onOpenAlbumMedia(attachment);
  }

  function setPhotoPickerOpen(open: boolean) {
    photoPickerOpen = open;
    onPickerOpenChange(open);
  }

  function reportDisplayedThread(contentId: string) {
    if (contentId === lastReportedDisplayedContentId) {
      return;
    }

    lastReportedDisplayedContentId = contentId;
    onDisplayedThreadChange(contentId);
  }

  function selectThread(talkId: string) {
    flushPendingRead();
    const thread = threads.find((item) => item.id === talkId);
    if (thread?.corrupted) {
      selectedThreadId = talkId;
      pickerOpen = true;
      setPhotoPickerOpen(false);
      selectedPhotoId = "";
      selectedShare = null;
      sendError = "";
      authError = "";
      onNoise();
      onBlockedContentOpen(thread.contentId ?? thread.id);
      return;
    }

    selectedThreadId = talkId;
    pickerOpen = false;
    setPhotoPickerOpen(false);
    selectedPhotoId = "";
    selectedShare = null;
    sendError = "";
    authError = "";
  }

  function openRoomPicker() {
    flushPendingRead();
    pickerOpen = true;
  }

  async function submitMessage() {
    if (!selectedThread || selectedThread.corrupted || !selectedThreadCanPost || sending || (!draft.trim() && !selectedPhoto && !selectedShare)) {
      return;
    }

    readDividerArmed = false;
    readDividerAfterMessageId = "";
    flushPendingRead();
    sending = true;
    sendError = "";
    const outgoingMessage = selectedPhoto ? `photo:${selectedPhoto.id}` : selectedShare ? `share:${selectedShare.contentId}` : draft.trim();
    const previousDraft = draft;
    const previousPhotoId = selectedPhotoId;
    const previousShare = selectedShare;
    draft = "";
    selectedPhotoId = "";
    selectedShare = null;
    const result = await onSend(selectedThread.id, outgoingMessage);
    sending = false;

    if (!result.ok) {
      if (!draft && !selectedPhotoId && !selectedShare) {
        draft = previousDraft;
        selectedPhotoId = previousPhotoId;
        selectedShare = previousShare;
      }
      sendError = result.error ?? "送信に失敗しました。";
      return;
    }

    scrollHistoryToBottom();
  }

  function selectPhoto(photoId: string) {
    selectedPhotoId = photoId;
    selectedShare = null;
    draft = "";
    sendError = "";
  }

  function applyInitialShareDraft(shareDraft: PendingShareDraft) {
    lastAppliedShareDraftRequestId = shareDraft.requestId;
    const thread = threads.find((item) => matchesThreadId(item, shareDraft.talkId) && !item.corrupted);
    if (!thread) {
      onInitialShareDraftConsumed(shareDraft.requestId);
      return;
    }

    selectedThreadId = thread.id;
    pickerOpen = false;
    setPhotoPickerOpen(false);
    selectedPhotoId = "";
    draft = "";
    selectedShare = {
      appId: shareDraft.appId,
      contentId: shareDraft.contentId,
      title: shareDraft.title
    };
    sendError = "";
    authError = "";
    onInitialShareDraftConsumed(shareDraft.requestId);
  }

  function isVideoPhoto(photo: PhotoItem | undefined) {
    return (photo?.mediaKind === "still_video" && Boolean(photo.audioUrl))
      || (photo?.mediaKind === "video" && Boolean(photo.videoUrl));
  }

  function matchesThreadId(thread: ChatAppThread, id: string) {
    return thread.id === id || thread.contentId === id;
  }

  function mediaAttachmentSignature(messages: ChatAppThread["messages"], visibleIds?: Set<string>, sender?: "owner" | "other") {
    return messages
      .map((message) => {
        if (sender && message.sender !== sender) {
          return "";
        }

        if (visibleIds && !visibleIds.has(message.id)) {
          return "";
        }

        const attachment = message.attachment;
        if (!attachment || !isMediaAttachment(attachment)) {
          return "";
        }

        return `${message.id}:${attachment.kind}:${attachment.contentId ?? ""}:${attachment.attachmentId ?? ""}`;
      })
      .filter(Boolean)
      .join("|");
  }

  function mediaAttachmentContentIds(messages: ChatAppThread["messages"]) {
    return [...new Set(messages.flatMap((message) => {
      const attachment = message.attachment;
      return attachment && isMediaAttachment(attachment) && attachment.contentId
        ? [attachment.contentId]
        : [];
    }))];
  }

  function readKey(talkId: string, messageId: string) {
    return `${talkId}:${messageId}`;
  }

  function latestVisibleOtherMessageId(thread: ChatAppThread | undefined) {
    if (!thread) {
      return "";
    }

    return latestVisibleOtherMessageIdFromSet(thread.messages, visibleMessageIds);
  }

  function flushPendingRead() {
    const read = pendingRead;
    pendingRead = null;

    if (!read) {
      return;
    }

    const key = readKey(read.talkId, read.messageId);
    if (key === lastReportedReadKey) {
      return;
    }

    lastReportedReadKey = key;
    void onRead(read.talkId, read.messageId);
  }

  function queueRead(talkId: string, messageId: string) {
    if (!selectedThread?.unread || selectedThread.id !== talkId) {
      return;
    }

    const key = readKey(talkId, messageId);
    if (key === lastReportedReadKey) {
      return;
    }

    pendingRead = { talkId, messageId };
  }

  function syncVisibleRead(thread: ChatAppThread | undefined) {
    if (!thread || !thread.unread || !conversationVisible) {
      return;
    }

    const messageId = latestVisibleOtherMessageId(thread);
    if (!messageId) {
      return;
    }

    queueRead(thread.id, messageId);
  }

  async function requestAuthLink() {
    if (requestingAuthLink) {
      return;
    }

    requestingAuthLink = true;
    authError = "";
    const result = await onAuthLinkRequest();
    requestingAuthLink = false;

    if (!result.ok) {
      authError = result.error ?? "送信に失敗しました。";
    }
  }

  function isMediaAttachment(
    attachment: MessageAttachment
  ): attachment is Extract<MessageAttachment, { kind: "image" | "audio" | "video" }> {
    return attachment.kind === "image" || attachment.kind === "audio" || attachment.kind === "video";
  }

  function notifyAudioPlaybackComplete(attachment: MessageAttachment) {
    if (!isMediaAttachment(attachment)
      || (attachment.kind !== "audio" && attachment.kind !== "video")
      || (!attachment.contentId && !attachment.attachmentId)) {
      return;
    }

    window.dispatchEvent(
      new CustomEvent("xstoryphone:audio-playback-complete", {
        detail: {
          ...(attachment.contentId ? { contentId: attachment.contentId } : {}),
          ...(attachment.attachmentId ? { attachmentId: attachment.attachmentId } : {})
        }
      })
    );
  }

  function explicitDateLabel(sentAt: string) {
    const match = /^(\d{1,2}\/\d{1,2})/.exec(sentAt);
    return match?.[1];
  }

  function messageDateLabel(messages: ChatAppThread["messages"], index: number) {
    const sentAt = messages[index]?.sentAt ?? "";
    const explicit = explicitDateLabel(sentAt);
    if (explicit) {
      return explicit;
    }

    for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
      const previous = messages[cursor];
      if (!previous) {
        continue;
      }

      const previousDate = explicitDateLabel(previous.sentAt);
      if (previousDate) {
        return previousDate;
      }
    }

    return initialDateLabel;
  }

  function roomPreview(thread: ChatAppThread) {
    const lastMessage = [...thread.messages]
      .reverse()
      .find((message) => isMessageVisibleInPreview(thread.id, message) && (message.body.trim() || message.attachment));

    if (!lastMessage) {
      return thread.brokenHistoryRanges?.length ? "履歴データが破損しています" : "投稿なし";
    }

    const body = lastMessage.body.trim() || "添付";
    if (lastMessage.sender === "owner") {
      return body;
    }

    return `${lastMessage.senderName}: ${body}`;
  }

  function isMessageVisibleInPreview(threadId: string, message: DelayedMessage) {
    if (threadId === trackedThreadId && visibleMessageIds.has(message.id)) {
      return true;
    }

    if (seenMessageIdsByThread[threadId]?.has(message.id)) {
      return true;
    }

    return !shouldDelayNewlyTrackedMessage(message);
  }

  function roomAvatarUrl(thread: ChatAppThread) {
    return thread.avatarUrl ?? "";
  }

  function messageDelayMs(message: DelayedMessage) {
    if (typeof message.delayMs === "number" && Number.isFinite(message.delayMs)) {
      return Math.max(0, Math.min(message.delayMs, MAX_MESSAGE_DELAY_MS));
    }
    return DEFAULT_MESSAGE_DELAY_MS;
  }

  function explicitMessageDelayMs(message: DelayedMessage) {
    if (typeof message.delayMs !== "number" || !Number.isFinite(message.delayMs)) {
      return undefined;
    }

    return Math.max(0, Math.min(message.delayMs, MAX_MESSAGE_DELAY_MS));
  }

  function shouldDelayNewlyTrackedMessage(message: DelayedMessage) {
    const delayMs = explicitMessageDelayMs(message);
    return message.sender !== "owner" && message.delayOnFirstDisplay === true && delayMs !== undefined && delayMs > 0;
  }

  function lastOwnerMessageIndex(messages: DelayedMessage[]) {
    let ownerIndex = -1;
    messages.forEach((message, index) => {
      if (message.sender === "owner") {
        ownerIndex = index;
      }
    });
    return ownerIndex;
  }

  function canDelayMessageAtIndex(messageIndex: number, ownerIndex: number) {
    return ownerIndex < 0 || messageIndex > ownerIndex;
  }

  function seenMessageIds(threadId: string) {
    if (!seenMessageIdsByThread[threadId]) {
      seenMessageIdsByThread[threadId] = new Set<string>();
    }

    return seenMessageIdsByThread[threadId];
  }

  function markMessageSeen(threadId: string, messageId: string) {
    if (!threadId || !messageId) {
      return;
    }

    const messageIds = seenMessageIds(threadId);
    if (messageIds.has(messageId)) {
      return;
    }

    messageIds.add(messageId);
    saveSeenMessageMemory();
  }

  function markVisibleMessagesSeen(threadId: string, messages: DelayedMessage[], visibleIds: Set<string>) {
    if (!threadId) {
      return;
    }

    for (const message of messages) {
      if (visibleIds.has(message.id)) {
        markMessageSeen(threadId, message.id);
      }
    }
  }

  function syncSeenMessageMemory(memoryKey: string) {
    if (memoryKey === loadedDelayMemoryKey) {
      return;
    }

    loadedDelayMemoryKey = memoryKey;
    seenMessageIdsByThread = loadTalkDelaySeenMessages(DELAY_MEMORY_APP_ID, memoryKey);
  }

  function saveSeenMessageMemory() {
    saveTalkDelaySeenMessages(DELAY_MEMORY_APP_ID, loadedDelayMemoryKey ?? delayMemoryKey, seenMessageIdsByThread);
  }

  function clearMessageDelayTimers() {
    if (messageDelayTimer) {
      window.clearTimeout(messageDelayTimer);
    }
    messageDelayTimer = undefined;
    scheduledMessageId = "";
  }

  function revealDelayedMessage(messageId: string, threadId: string) {
    if (scheduledMessageId === messageId) {
      messageDelayTimer = undefined;
      scheduledMessageId = "";
    }

    if (threadId !== trackedThreadId || !pendingMessageIds.has(messageId)) {
      scheduleNextPendingMessage();
      return;
    }

    const shouldScrollToBottom = isHistoryNearBottom();
    const nextPending = new Set(pendingMessageIds);
    const nextVisible = new Set(visibleMessageIds);
    nextPending.delete(messageId);
    nextVisible.add(messageId);
    markMessageSeen(threadId, messageId);
    pendingMessageIds = nextPending;
    visibleMessageIds = nextVisible;
    if (shouldScrollToBottom) {
      scrollHistoryToBottom();
    }
    queueRead(threadId, messageId);
    scheduleNextPendingMessage();
  }

  function nextPendingMessage() {
    return trackedMessages.find((message) => pendingMessageIds.has(message.id));
  }

  function scheduleNextPendingMessage() {
    if (!trackedThreadId || scheduledMessageId) {
      return;
    }

    const message = nextPendingMessage();
    if (!message) {
      return;
    }

    const delayMs = messageDelayMs(message);
    scheduledMessageId = message.id;
    messageDelayTimer = window.setTimeout(() => revealDelayedMessage(message.id, trackedThreadId), delayMs);
  }

  function syncDelayedMessages(threadId: string, messages: DelayedMessage[]) {
    if (!threadId) {
      markVisibleMessagesSeen(trackedThreadId, trackedMessages, visibleMessageIds);
      clearMessageDelayTimers();
      trackedThreadId = "";
      trackedMessages = [];
      visibleMessageIds = new Set();
      pendingMessageIds = new Set();
      readDividerAfterMessageId = "";
      readDividerArmed = false;
      return;
    }

    const messageIds = new Set(messages.map((message) => message.id));
    const ownerIndex = lastOwnerMessageIndex(messages);

    if (threadId !== trackedThreadId) {
      markVisibleMessagesSeen(trackedThreadId, trackedMessages, visibleMessageIds);
      clearMessageDelayTimers();
      trackedThreadId = threadId;
      trackedMessages = messages;
      const seenIds = seenMessageIds(threadId);
      const nextVisible = new Set<string>();
      const nextPending = new Set<string>();

      for (const [index, message] of messages.entries()) {
        if (seenIds.has(message.id)) {
          nextVisible.add(message.id);
          continue;
        }

        if (canDelayMessageAtIndex(index, ownerIndex) && shouldDelayNewlyTrackedMessage(message)) {
          nextPending.add(message.id);
          continue;
        }

        nextVisible.add(message.id);
        markMessageSeen(threadId, message.id);
      }

      visibleMessageIds = nextVisible;
      pendingMessageIds = nextPending;
      readDividerAfterMessageId = nextPending.size ? latestVisibleMessageIdFromSet(messages, nextVisible) : "";
      readDividerArmed = nextPending.size === 0;
      queueLatestVisibleRead(threadId, messages, nextVisible);
      scheduleNextPendingMessage();
      return;
    }

    trackedMessages = messages;
    const nextVisible = new Set([...visibleMessageIds].filter((messageId) => messageIds.has(messageId)));
    const nextPending = new Set([...pendingMessageIds].filter((messageId) => messageIds.has(messageId)));
    let changed = nextVisible.size !== visibleMessageIds.size || nextPending.size !== pendingMessageIds.size;
    let addedPendingMessage = false;

    if (scheduledMessageId && !nextPending.has(scheduledMessageId)) {
      clearMessageDelayTimers();
    }

    for (const [index, message] of messages.entries()) {
      if (nextVisible.has(message.id) || nextPending.has(message.id)) {
        continue;
      }

      if (message.sender === "owner" || !canDelayMessageAtIndex(index, ownerIndex) || !shouldDelayNewlyTrackedMessage(message)) {
        nextVisible.add(message.id);
        markMessageSeen(threadId, message.id);
        changed = true;
        continue;
      }

      nextPending.add(message.id);
      addedPendingMessage = true;
      changed = true;
    }

    if (changed) {
      const shouldScrollToBottom = isHistoryNearBottom();
      visibleMessageIds = nextVisible;
      pendingMessageIds = nextPending;
      if (addedPendingMessage && readDividerArmed) {
        readDividerAfterMessageId = latestVisibleMessageIdFromSet(messages, nextVisible);
        readDividerArmed = false;
      } else if (readDividerAfterMessageId && !nextVisible.has(readDividerAfterMessageId)) {
        readDividerAfterMessageId = "";
      }
      if (shouldScrollToBottom) {
        scrollHistoryToBottom();
      }
      queueLatestVisibleRead(threadId, messages, nextVisible);
    }

    scheduleNextPendingMessage();
  }

  function latestVisibleMessageIdFromSet(messages: DelayedMessage[], visibleIds: Set<string>) {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (visibleIds.has(message.id)) {
        return message.id;
      }
    }

    return "";
  }

  function latestVisibleOtherMessageIdFromSet(messages: DelayedMessage[], visibleIds: Set<string>) {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (message.sender === "other" && visibleIds.has(message.id)) {
        return message.id;
      }
    }

    return "";
  }

  function queueLatestVisibleRead(threadId: string, messages: DelayedMessage[], visibleIds: Set<string>) {
    const messageId = latestVisibleOtherMessageIdFromSet(messages, visibleIds);
    if (messageId) {
      queueRead(threadId, messageId);
    }
  }
</script>

<AppShell title="チャット" subtitle={authGate ? "再認証" : `${threads.length}ルーム`} accent="#7ee093">
  <div class="chat-app">
    {#if authGate}
      <section class="access-panel" aria-label="チャットの再認証">
        <KeyRound size={22} strokeWidth={2.1} />
        <strong>セッションの有効期限が切れました。</strong>
        <button class="auth-link" type="button" disabled={requestingAuthLink} on:click={requestAuthLink}>
          認証リンクを送信する
        </button>
        <p class="auth-status" aria-live="polite">{authGate.linkSent ? "認証リンクをメッセージに送りました" : ""}</p>
        {#if authError}
          <p class="send-error">{authError}</p>
        {/if}
      </section>
    {:else if threads.length && selectedThread && !selectedThread.corrupted && !pickerOpen}
      <section class="conversation-screen" aria-label={`${selectedThread.roomName}の会話`}>
        <header class="conversation-bar">
          <button class="icon-button" type="button" aria-label="ルーム一覧" title="ルーム一覧" on:click={openRoomPicker}>
            <List size={18} strokeWidth={2.2} />
            {#if hasOtherUnreadThread}
              <span class="button-unread-dot" aria-hidden="true"></span>
            {/if}
          </button>
          <UserAvatar name={selectedThread.roomName} src={roomAvatarUrl(selectedThread)} size={36} tone="chat" />
          <div class="title-copy">
            <h3>{selectedThread.roomName}</h3>
          </div>
        </header>

        <div class="history-area">
            <ScrollHint enabled step={116}>
              <div class="bubble-list" bind:this={historyList} aria-label="会話履歴">
                {#each selectedThread.messages as message, index}
                  {#each brokenRangesBeforeMessage(selectedThread.messages, selectedThread.brokenHistoryRanges ?? [], index) as _range}
                    <BrokenTalkHistory />
                  {/each}
                  {#if visibleMessageIds.has(message.id)}
                    {#if index === 0 || messageDateLabel(selectedThread.messages, index - 1) !== messageDateLabel(selectedThread.messages, index)}
                      <div class="day-chip">{messageDateLabel(selectedThread.messages, index)}</div>
                    {/if}
                    <div
                      class="message-row"
                      class:owner={message.sender === "owner"}
                      data-history-repair-id={message.historyRepairId || undefined}
                    >
                      {#if message.sender !== "owner"}
                        <UserAvatar name={message.senderName} src={message.avatarUrl ?? ""} size={28} tone="chat" />
                      {/if}
                      <article>
                        {#if message.sender !== "owner"}
                          <strong>{message.senderName}</strong>
                        {/if}
                        <MessageBody body={message.body} segments={message.segments} onOpenLink={(segmentIndex) => openMessageLink(message.id, segmentIndex)} />
                        {#if message.attachment?.kind === "share"}
                          <section class="attachment-card" aria-label="添付">
                            <div>
                              <Radio size={16} strokeWidth={2.1} />
                              <b>リンク情報</b>
                            </div>
                            <button
                              class="shared-link-card"
                              type="button"
                              on:click={() => message.attachment?.kind === "share" && openSharedContent(message.attachment.appId, message.attachment.contentId)}
                            >
                              <span>{message.attachment.title}</span>
                            </button>
                          </section>
                        {:else if message.attachment && isMediaAttachment(message.attachment)}
                          <section class="attachment-card" aria-label="添付">
                            <div>
                              {#if message.attachment.kind === "image"}
                                <FileImage size={16} strokeWidth={2.1} />
                              {:else}
                                <Video size={16} strokeWidth={2.1} />
                              {/if}
                              <b>{message.attachment.kind === "image" ? "画像" : "動画"}</b>
                            </div>
                            {#if message.attachment.kind === "image" && message.attachment.imageUrl}
                              {#if albumMediaContentId(message.attachment)}
                                <button
                                  class="media-attachment-button"
                                  type="button"
                                  title="アルバムで開く"
                                  aria-label="画像をアルバムで開く"
                                  on:click={() => openAlbumMedia(message.attachment)}
                                >
                                  <AttachmentImageFrame src={message.attachment.imageUrl} alt="" />
                                </button>
                              {:else}
                                <AttachmentImageFrame src={message.attachment.imageUrl} alt="" />
                              {/if}
                            {:else if message.attachment.kind === "audio" && message.attachment.audioUrl}
                              {#if albumMediaContentId(message.attachment)}
                                <button
                                  class="media-attachment-button"
                                  type="button"
                                  title="アルバムで開く"
                                  aria-label="動画をアルバムで開く"
                                  on:click={() => openAlbumMedia(message.attachment)}
                                >
                                  <VideoStillFrame src={message.attachment.imageUrl} />
                                </button>
                              {:else}
                                <VideoStillFrame src={message.attachment.imageUrl} />
                              {/if}
                              <AudioPlaybackButton
                                playbackId={`chat-audio:${selectedThread.id}:${message.id}`}
                                src={message.attachment.audioUrl}
                                label="再生"
                                onComplete={() => message.attachment?.kind === "audio" && notifyAudioPlaybackComplete(message.attachment)}
                              />
                            {:else if message.attachment.kind === "video" && message.attachment.videoUrl}
                              <VideoPlayback
                                src={message.attachment.videoUrl}
                                poster={message.attachment.imageUrl ?? ""}
                                label="添付動画"
                                onComplete={() => message.attachment?.kind === "video" && notifyAudioPlaybackComplete(message.attachment)}
                              />
                              {#if albumMediaContentId(message.attachment)}
                                <button
                                  class="shared-link-card"
                                  type="button"
                                  on:click={() => openAlbumMedia(message.attachment)}
                                >
                                  <span>アルバムで表示</span>
                                </button>
                              {/if}
                            {/if}
                          </section>
                        {/if}
                      </article>
                    </div>
                    {#if readDividerAfterMessageId === message.id}
                      <div class="read-position-divider" role="separator" aria-label="ここまで既読"></div>
                    {/if}
                  {/if}
                {/each}
                {#each brokenRangesAfterMessages(selectedThread.messages, selectedThread.brokenHistoryRanges ?? []) as _range}
                  <BrokenTalkHistory />
                {/each}
                {#if typingVisible}
                  <TypingIndicator owner={typingMessage?.sender === "owner"} variant="chat" ariaLabel={replyDelayAnchor?.waiting ? "返答待ち" : "入力中"} />
                {/if}
              </div>
            </ScrollHint>
          </div>

          <form class="composer" aria-label="メッセージ入力欄" on:submit|preventDefault={submitMessage}>
            <button
              class="photo-button"
              type="button"
              disabled={sending || selectedThread.corrupted || !selectedThreadCanPost || !sendablePhotos.length}
              aria-label="写真・動画"
              title="写真・動画"
              on:click={() => setPhotoPickerOpen(true)}
            >
              <ImagePlus size={16} strokeWidth={2.1} />
            </button>
            {#if selectedPhoto}
              <div class="selected-photo">
                {#if isVideoPhoto(selectedPhoto)}
                  <VideoStillFrame src={selectedPhoto.imageUrl} square compact />
                {:else}
                  <img src={selectedPhoto.imageUrl ?? ""} alt="" />
                {/if}
                <span>{isVideoPhoto(selectedPhoto) ? "動画" : "写真"}</span>
                <button type="button" aria-label="写真を外す" title="写真を外す" on:click={() => (selectedPhotoId = "")}>
                  <X size={13} strokeWidth={2.4} />
                </button>
              </div>
            {:else if selectedShare}
              <div class="selected-share" title={selectedShare.title}>
                <Radio size={15} strokeWidth={2.2} />
                <span>リンク情報</span>
                <button type="button" aria-label="リンク情報を外す" title="リンク情報を外す" on:click={() => (selectedShare = null)}>
                  <X size={13} strokeWidth={2.4} />
                </button>
              </div>
            {:else}
              <input
                bind:value={draft}
                disabled={sending || selectedThread.corrupted || !selectedThreadCanPost}
                maxlength="500"
                placeholder={selectedThreadCanPost ? "メッセージを入力" : "投稿できません"}
              />
            {/if}
            <button type="submit" disabled={sending || selectedThread.corrupted || !selectedThreadCanPost || (!draft.trim() && !selectedPhoto && !selectedShare)} aria-label="送信" title="送信">
              <Send size={16} strokeWidth={2.1} />
            </button>
          </form>
          {#if sendError}
            <p class="send-error">{sendError}</p>
          {/if}
      </section>
    {:else if threads.length}
      <section class="room-picker" aria-label="ルーム一覧">
        <header class="picker-bar">
          <div class="title-copy">
            <h2>チャット</h2>
            <span>{threads.length}ルーム</span>
          </div>
        </header>

        <div class="room-scroll">
          <ScrollHint enabled={threads.length > 7} step={82}>
            <div class="room-list" class:scrolling={threads.length > 7}>
              {#each threads as thread}
                <button
                  type="button"
                  class:active={thread.id === selectedThread?.id && !thread.corrupted}
                  class:corrupted={thread.corrupted}
                  on:click={() => selectThread(thread.id)}
                >
                  <UserAvatar name={thread.roomName} src={roomAvatarUrl(thread)} size={36} tone="chat" />
                  <span class="room-copy">
                    <strong>{thread.roomName}</strong>
                    <em>{roomPreview(thread)}</em>
                  </span>
                  {#if thread.unread && !thread.corrupted}
                    <span class="unread-dot" aria-hidden="true"></span>
                  {/if}
                </button>
              {/each}
            </div>
          </ScrollHint>
        </div>
      </section>
    {:else}
      <section class="empty-chat" aria-label="チャットの空状態">
        <MessageSquareText size={22} strokeWidth={2.1} />
        <strong>受信ルームなし</strong>
      </section>
    {/if}
    <PhotoMessagePicker
      open={photoPickerOpen}
      photos={sendablePhotos}
      selectedPhotoId={selectedPhotoId}
      accent="#7ee093"
      onSelect={selectPhoto}
      onClose={() => setPhotoPickerOpen(false)}
    />
  </div>
</AppShell>

<style>
  .chat-app {
    position: relative;
    min-height: 0;
    height: 100%;
    padding: 8px 12px 42px;
  }

  .conversation-screen,
  .room-picker {
    display: grid;
    min-height: 0;
    height: 100%;
    animation: view-in 120ms ease-out both;
  }

  .conversation-screen {
    grid-template-rows: auto minmax(0, 1fr) auto auto;
    gap: 6px;
    padding-bottom: 20px;
  }

  .room-picker {
    grid-template-rows: auto minmax(0, 1fr);
    gap: 10px;
  }

  .conversation-bar,
  .picker-bar {
    display: grid;
    grid-template-columns: auto auto minmax(0, 1fr);
    align-items: center;
    gap: 9px;
    min-height: 46px;
  }

  .picker-bar {
    grid-template-columns: minmax(0, 1fr);
  }

  .icon-button {
    position: relative;
    display: grid;
    place-items: center;
    width: 36px;
    height: 36px;
    padding: 0;
    border: 1px solid var(--ap-border);
    border-radius: var(--ap-radius-control);
    background: var(--ap-surface-2);
    color: #fff;
    cursor: pointer;
  }

  .icon-button:active {
    transform: translateY(1px);
  }

  .button-unread-dot {
    position: absolute;
    top: 6px;
    right: 6px;
    width: 8px;
    height: 8px;
    border: 1px solid rgba(10, 14, 20, 0.92);
    border-radius: 999px;
    background: #ff4d5a;
    box-shadow: 0 0 0 1px rgba(255, 77, 90, 0.26);
    pointer-events: none;
  }

  .title-copy,
  .room-copy {
    display: grid;
    min-width: 0;
    gap: 3px;
  }

  h2,
  h3 {
    margin: 0;
    overflow: hidden;
    line-height: 1.12;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  h2 {
    font-size: 1.32rem;
  }

  h3 {
    font-size: 1rem;
  }

  .title-copy span {
    overflow: hidden;
    color: rgba(255, 255, 255, 0.54);
    font-size: 0.66rem;
    font-weight: 740;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .history-area {
    min-height: 0;
    border: 1px solid rgba(126, 224, 147, 0.12);
    border-radius: 18px;
    background:
      linear-gradient(180deg, rgba(126, 224, 147, 0.08), transparent 30%),
      rgba(6, 12, 15, 0.24);
    overflow: hidden;
  }

  .history-area :global(.scroll-hint-shell) {
    min-height: 0;
    height: 100%;
  }

  .access-panel {
    display: grid;
    align-content: center;
    justify-items: center;
    gap: 12px;
    min-height: 0;
    height: 100%;
    padding: 24px 18px;
    border: 1px solid rgba(126, 224, 147, 0.14);
    border-radius: 18px;
    background:
      linear-gradient(180deg, rgba(126, 224, 147, 0.1), transparent 38%),
      rgba(6, 12, 15, 0.3);
    color: rgba(255, 255, 255, 0.82);
    text-align: center;
  }

  .access-panel strong {
    font-size: 0.92rem;
  }

  .auth-link {
    border: 0;
    border-radius: 13px;
    padding: 11px 16px;
    background: #7ee093;
    color: #06170a;
    cursor: pointer;
    font: inherit;
    font-size: 0.82rem;
    font-weight: 820;
  }

  .auth-status {
    min-height: 1rem;
    margin: 0;
    color: rgba(190, 249, 204, 0.78);
    font-size: 0.68rem;
    font-weight: 720;
    line-height: 1rem;
  }

  .access-panel button:disabled {
    cursor: default;
    opacity: 0.45;
  }

  .bubble-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-height: 0;
    height: 100%;
    overflow: auto;
    padding: 10px 9px;
    overscroll-behavior: contain;
    scrollbar-width: thin;
    scrollbar-color: rgba(255, 255, 255, 0.18) transparent;
  }

  .bubble-list > :first-child {
    margin-top: auto;
  }

  .day-chip {
    align-self: center;
    margin: 2px 0;
    padding: 4px 8px;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.08);
    color: rgba(255, 255, 255, 0.58);
    font-size: 0.64rem;
    font-weight: 760;
  }

  .read-position-divider {
    align-self: stretch;
    min-height: 1px;
    margin: 1px 4px;
    border-radius: 999px;
    background: linear-gradient(
      90deg,
      transparent,
      rgba(255, 77, 90, 0.62) 18%,
      rgba(255, 77, 90, 0.92) 50%,
      rgba(255, 77, 90, 0.62) 82%,
      transparent
    );
    box-shadow: 0 0 10px rgba(255, 77, 90, 0.16);
    pointer-events: none;
  }

  .message-row {
    display: flex;
    align-self: start;
    align-items: flex-end;
    gap: 7px;
    max-width: 94%;
    animation: message-in 150ms ease-out both;
  }

  .message-row.owner {
    align-self: end;
  }

  .message-row :global(.user-avatar) {
    margin-bottom: 1px;
  }

  article {
    display: grid;
    min-width: 0;
    gap: 4px;
    max-width: 100%;
    padding: 9px 11px;
    border-radius: 16px 16px 16px 6px;
    background: rgba(255, 255, 255, 0.11);
  }

  .message-row.owner article {
    border-radius: 16px 16px 6px 16px;
    background: rgba(126, 224, 147, 0.22);
  }

  article strong {
    overflow: hidden;
    color: #bef9cc;
    font-size: 0.63rem;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .attachment-card {
    display: grid;
    gap: 8px;
    margin-top: 3px;
    padding: 9px;
    border: 1px solid rgba(255, 255, 255, 0.13);
    border-radius: 12px;
    background: rgba(0, 0, 0, 0.18);
  }

  .attachment-card > div {
    display: grid;
    grid-template-columns: 18px minmax(0, 1fr);
    align-items: center;
    gap: 7px;
    color: #bef9cc;
  }

  .attachment-card b {
    overflow: hidden;
    font-size: 0.72rem;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .attachment-card .media-attachment-button {
    display: block;
    width: 100%;
    min-width: 0;
    height: auto;
    padding: 0;
    border: 0;
    border-radius: 10px;
    background: transparent;
    color: inherit;
    text-align: inherit;
    cursor: pointer;
  }

  .attachment-card .media-attachment-button:focus-visible {
    outline: 2px solid rgba(126, 224, 147, 0.72);
    outline-offset: 2px;
  }

  .attachment-card .shared-link-card {
    display: grid;
    place-items: start;
    width: 100%;
    min-width: 0;
    min-height: 34px;
    padding: 8px 9px;
    border: 1px solid rgba(126, 224, 147, 0.22);
    border-radius: 10px;
    background: rgba(126, 224, 147, 0.1);
    color: #bef9cc;
    text-align: left;
    cursor: pointer;
  }

  .shared-link-card span {
    overflow: hidden;
    max-width: 100%;
    font-size: 0.74rem;
    font-weight: 780;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .composer {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: 8px;
    min-height: 44px;
    padding: 7px 8px;
    border: 1px solid var(--ap-border);
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.09);
    color: var(--ap-text-soft);
    font-size: 0.76rem;
    font-weight: 700;
  }

  .composer input {
    min-width: 0;
    border: 0;
    background: transparent;
    color: var(--ap-text);
    font: inherit;
    outline: none;
  }

  .composer input::placeholder {
    color: var(--ap-text-soft);
  }

  .composer button {
    display: grid;
    place-items: center;
    width: 30px;
    height: 30px;
    border: 0;
    border-radius: 999px;
    background: rgba(126, 224, 147, 0.18);
    color: #bef9cc;
    cursor: pointer;
  }

  .composer button:disabled {
    cursor: default;
    opacity: 0.42;
  }

  .selected-photo {
    display: grid;
    grid-template-columns: 30px minmax(0, 1fr) 24px;
    align-items: center;
    gap: 8px;
    min-width: 0;
    height: 32px;
    padding: 2px 4px 2px 2px;
    border: 1px solid rgba(126, 224, 147, 0.24);
    border-radius: 999px;
    background: rgba(126, 224, 147, 0.12);
    color: rgba(255, 255, 255, 0.84);
  }

  .selected-photo img {
    width: 28px;
    height: 28px;
    border-radius: 999px;
    object-fit: cover;
  }

  .selected-photo :global(.video-still-frame) {
    width: 28px;
    height: 28px;
    border-radius: 8px;
  }

  .selected-photo span {
    overflow: hidden;
    font-size: 0.72rem;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .selected-photo button {
    width: 24px;
    height: 24px;
    background: rgba(255, 255, 255, 0.08);
  }

  .selected-share {
    display: grid;
    grid-template-columns: 24px minmax(0, 1fr) 24px;
    align-items: center;
    gap: 6px;
    min-width: 0;
    height: 32px;
    padding: 2px 4px 2px 5px;
    border: 1px solid rgba(126, 224, 147, 0.24);
    border-radius: 999px;
    background: rgba(126, 224, 147, 0.12);
    color: rgba(255, 255, 255, 0.84);
  }

  .selected-share span {
    overflow: hidden;
    font-size: 0.72rem;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .selected-share button {
    width: 24px;
    height: 24px;
    background: rgba(255, 255, 255, 0.08);
  }

  .send-error {
    margin: -2px 0 0;
    color: #ffadb4;
    font-size: 0.68rem;
    font-weight: 700;
  }

  .room-scroll,
  .room-scroll :global(.scroll-hint-shell) {
    min-height: 0;
    height: 100%;
  }

  .room-list {
    display: grid;
    align-content: start;
    gap: 6px;
    min-height: 0;
    height: 100%;
    padding: 4px;
    border: 1px solid var(--ap-border);
    border-radius: var(--ap-radius-panel);
    background: rgba(255, 255, 255, 0.045);
    overflow: auto;
    overscroll-behavior: contain;
    scrollbar-width: none;
  }

  .room-list.scrolling {
    padding-bottom: 12px;
    mask-image: linear-gradient(180deg, #000 0, #000 calc(100% - 20px), rgba(0, 0, 0, 0.18));
  }

  .room-list::-webkit-scrollbar {
    display: none;
  }

  .room-list button {
    position: relative;
    display: grid;
    grid-template-columns: 36px minmax(0, 1fr);
    align-items: center;
    gap: 9px;
    min-height: 58px;
    min-width: 0;
    padding: 8px 30px 8px 8px;
    border: 1px solid transparent;
    border-radius: 13px;
    background: transparent;
    color: #fff;
    text-align: left;
    cursor: pointer;
  }

  .room-list button.active {
    border-color: rgba(126, 224, 147, 0.34);
    background: linear-gradient(145deg, rgba(126, 224, 147, 0.16), rgba(255, 255, 255, 0.055));
  }

  .room-list button.corrupted {
    cursor: default;
    opacity: 0.62;
  }

  .unread-dot {
    position: absolute;
    top: 50%;
    right: 13px;
    width: 8px;
    height: 8px;
    border-radius: 999px;
    background: #ff4d5a;
    box-shadow: 0 0 0 1px rgba(255, 77, 90, 0.28);
    transform: translateY(-50%);
    pointer-events: none;
  }

  .room-list strong,
  .room-list em {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .room-list strong {
    font-size: 0.86rem;
  }

  .room-list em {
    color: var(--ap-text-soft);
    font-size: 0.7rem;
    font-style: normal;
  }

  .empty-chat {
    display: grid;
    place-items: center;
    gap: 8px;
    height: 100%;
    border: 1px solid var(--ap-border);
    border-radius: var(--ap-radius-panel);
    background: rgba(255, 255, 255, 0.045);
    color: var(--ap-text-soft);
    font-size: 0.78rem;
  }

  .empty-chat :global(svg) {
    color: rgba(126, 224, 147, 0.78);
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

  @keyframes message-in {
    from {
      opacity: 0;
      transform: translateY(5px);
    }

    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

</style>
