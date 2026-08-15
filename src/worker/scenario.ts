import { workerScenario } from "../generated/workerScenario.generated.ts";
import { evaluateCondition, renderTemplate } from "../shared/condition.ts";
import type {
  PublicGeneratedAudioState,
  ScenarioContent,
  ScenarioMessageAttachment,
  ScenarioMessageSegment,
  ScenarioTalk,
  StoredTalkMessage
} from "../shared/scenario.ts";
import type { StoredPlayerState, TranscriptUpdate } from "./repository.ts";
import { compactStateValues, effectiveStateValues } from "./stateValues.ts";

export { workerScenario };

function unique<T>(items: readonly T[]) {
  return [...new Set(items)];
}

const peopleById = new Map(workerScenario.talkPeople.map((person) => [person.id, person]));
const blocksById = new Map(workerScenario.talkBlocks.map((block) => [block.id, block]));
const attachmentsById = new Map(workerScenario.attachments.map((attachment) => [attachment.id, attachment]));

export function resolveTalkAttachment(attachmentId: string): ScenarioMessageAttachment | null {
  const attachment = attachmentsById.get(attachmentId);
  if (!attachment) return null;
  if (attachment.lock === "password" && attachment.content) {
    return { kind: "locked", contentId: attachment.content, locked: true, ...(attachment.title ? { title: attachment.title } : {}) };
  }
  if (attachment.type === "image") {
    return {
      kind: "image",
      attachmentId,
      ...(attachment.content ? { contentId: attachment.content } : {}),
      imageUrl: attachment.asset
    };
  }
  const poster = attachment.poster ? attachmentsById.get(attachment.poster) : null;
  return {
    kind: "audio",
    attachmentId,
    ...(attachment.content ? { contentId: attachment.content } : {}),
    ...(poster?.type === "image" ? { imageUrl: poster.asset } : {}),
    audioUrl: attachment.asset
  };
}

export function messageTemplatesForBlock(blockId: string) {
  return (blocksById.get(blockId)?.messages ?? []).map((message) => {
    const person = peopleById.get(message.sender);
    return {
      ...message,
      senderName: person?.name ?? message.sender,
      senderRole: person?.role ?? "npc",
      ...(person?.avatar ? { avatarUrl: person.avatar } : {}),
      attachment: resolveTalkAttachment(message.attachmentId)
    };
  });
}

export function talkBlockIdForRepeatDisplay(blockId: string, previousDisplayCount: number) {
  if (previousDisplayCount <= 0) return blockId;
  const variants = workerScenario.repeatTalkBlocks[blockId] ?? [];
  return variants[Math.min(previousDisplayCount - 1, variants.length - 1)] ?? blockId;
}

function renderedSegments(
  segments: readonly ScenarioMessageSegment[] | undefined,
  env: Record<string, string>,
  messageId: string
) {
  return segments?.map((segment, segmentIndex) => segment.kind === "text"
    ? { ...segment, text: renderTemplate(segment.text, env) }
    : "contentId" in segment
      ? { ...segment, linkId: `${messageId}:link:${segmentIndex + 1}` }
      : segment);
}

export function messagesForTalkBlocks(input: {
  talk: ScenarioTalk;
  blockIds: readonly string[];
  previousCounts: Record<string, number>;
  formatEnv: Record<string, unknown>;
  baseSentAt: string;
  idPrefix: string;
  startSeq?: number;
  useRepeat?: boolean;
}) {
  const blockDisplayCounts = { ...input.previousCounts };
  const messages: StoredTalkMessage[] = [];
  const templateEnv: Record<string, string> = Object.fromEntries(
    Object.entries(input.formatEnv)
      .filter((entry): entry is [string, string | number | boolean] => ["string", "number", "boolean"].includes(typeof entry[1]))
      .map(([key, value]) => [key, String(value)])
  );
  let seq = input.startSeq ?? 0;
  for (const [blockIndex, blockId] of input.blockIds.entries()) {
    const previousCount = blockDisplayCounts[blockId] ?? 0;
    const displayBlockId = input.useRepeat === false ? blockId : talkBlockIdForRepeatDisplay(blockId, previousCount);
    if (input.useRepeat !== false) blockDisplayCounts[blockId] = previousCount + 1;
    for (const [messageIndex, template] of messageTemplatesForBlock(displayBlockId).entries()) {
      const sentAt = template.sentAt || new Date(Date.parse(input.baseSentAt) + (blockIndex + messageIndex) * 1_000).toISOString();
      const messageId = `${input.idPrefix}:${blockIndex + 1}:${messageIndex + 1}`;
      seq += 1;
      messages.push({
        seq,
        id: messageId,
        talkId: input.talk.publicId,
        sender: template.senderRole === "owner" ? "owner" : "other",
        body: renderTemplate(template.body, templateEnv),
        ...(input.talk.kind === "chat" ? { senderName: template.senderName } : {}),
        ...(template.avatarUrl ? { avatarUrl: template.avatarUrl } : {}),
        ...(template.segments ? { segments: renderedSegments(template.segments, templateEnv, messageId) } : {}),
        ...(typeof template.delayMs === "number" ? { delayMs: template.delayMs } : {}),
        ...(template.senderRole !== "owner" && typeof template.delayMs === "number" && template.delayMs > 0
          ? { delayOnFirstDisplay: true }
          : {}),
        attachment: template.attachment,
        sentAt
      });
    }
  }
  return { messages, blockDisplayCounts, lastMessageSeq: seq };
}

export function initializeTalkState(talk: ScenarioTalk, formatEnv = workerScenario.stateVariables) {
  const rendered = messagesForTalkBlocks({
    talk,
    blockIds: talk.startBlocks,
    previousCounts: {},
    formatEnv,
    baseSentAt: new Date().toISOString(),
    idPrefix: `${talk.publicId}_initial`
  });
  return {
    state: {
      from: talk.initialFrom,
      turnKey: crypto.randomUUID(),
      blockDisplayCounts: rendered.blockDisplayCounts,
      transcriptKey: crypto.randomUUID(),
      lastMessageSeq: rendered.lastMessageSeq,
      lastOtherMessageSeq: Math.max(0, ...rendered.messages.filter((message) => message.sender === "other").map((message) => message.seq)),
      lastReadMessageSeq: 0
    },
    messages: rendered.messages
  };
}

export function createInitialPlayerState(): StoredPlayerState {
  return {
    repairedContentIds: [],
    repairedAppIds: [],
    openedContentIds: [],
    unlockedContentIds: [],
    clearedTodoIds: [],
    clearedNotificationIds: [],
    discoveredTargetKeys: [],
    revealedAttachmentContentIds: [],
    revealedMessageLinks: [],
    stateValues: {},
    talks: {},
    searchTranscriptKey: crypto.randomUUID(),
    searchLastMessageSeq: 0,
    incomingCallId: null,
    browserScheduledEvents: []
  };
}

export function revealTalkMessages(state: StoredPlayerState, talkId: string, messages: readonly StoredTalkMessage[]) {
  const revealedAttachmentContentIds = new Set(state.revealedAttachmentContentIds);
  const links = new Map(state.revealedMessageLinks.map((link) => [link.id, link]));
  for (const message of messages) {
    if (message.attachment?.kind === "locked" && message.attachment.contentId) {
      revealedAttachmentContentIds.add(message.attachment.contentId);
    }
    for (const segment of message.segments ?? []) {
      if (segment.kind !== "link" || !("contentId" in segment) || !segment.linkId) continue;
      links.set(segment.linkId, {
        id: segment.linkId,
        talkId,
        appId: segment.appId,
        contentId: segment.contentId,
        ...(segment.actionId ? { actionId: segment.actionId } : {})
      });
    }
  }
  return {
    ...state,
    revealedAttachmentContentIds: [...revealedAttachmentContentIds],
    revealedMessageLinks: [...links.values()]
  };
}

export function reconcileScenarioState(state: StoredPlayerState, legacyTranscripts: readonly TranscriptUpdate[] = []) {
  const stateValues = compactStateValues(workerScenario.stateVariables, state.stateValues);
  const talks = { ...state.talks };
  const transcriptAppends: TranscriptUpdate[] = [];
  let nextState = { ...state, stateValues, talks };
  for (const transcript of legacyTranscripts) {
    if (!transcript.streamId.startsWith("talk:")) continue;
    const talkId = transcript.streamId.slice("talk:".length);
    nextState = revealTalkMessages(nextState, talkId, transcript.messages.filter((message): message is StoredTalkMessage => "sender" in message));
  }
  for (const talk of workerScenario.talks) {
    if (talks[talk.id] || !talkAvailable(talk, nextState)) continue;
    const initial = initializeTalkState(talk, effectiveStateValues(workerScenario.stateVariables, stateValues));
    talks[talk.id] = initial.state;
    nextState = revealTalkMessages(nextState, talk.id, initial.messages);
    transcriptAppends.push({
      streamId: `talk:${talk.id}`,
      transcriptKey: initial.state.transcriptKey,
      messages: initial.messages
    });
  }
  return { state: nextState, transcriptAppends };
}

function conditionMet(cond: string | undefined, state: StoredPlayerState) {
  return evaluateCondition(cond ?? "", effectiveStateValues(workerScenario.stateVariables, state.stateValues));
}

export function appAvailable(appId: string, state: StoredPlayerState) {
  const app = appById(appId);
  if (!app || !conditionMet(app.cond, state)) return false;
  return app.initialState === "normal" || state.repairedAppIds.includes(app.id);
}

export function contentAvailable(content: ScenarioContent, state: StoredPlayerState) {
  return conditionMet(content.cond, state)
    && appAvailable(content.appId, state)
    && (
      content.initialState === "normal"
      || state.repairedContentIds.includes(content.id)
      || state.unlockedContentIds.includes(content.id)
    );
}

export function talkAvailable(talk: ScenarioTalk, state: StoredPlayerState) {
  return conditionMet(talk.cond, state) && appAvailable(talk.appId, state);
}

export function chatAuthGateActive(state: StoredPlayerState) {
  return Boolean(
    workerScenario.chatAuthGate
    && conditionMet(workerScenario.chatAuthGate.cond, state)
    && appAvailable("chat", state)
  );
}

export function talkCanPost(talk: ScenarioTalk, state: StoredPlayerState) {
  return talkAvailable(talk, state) && !(talk.kind === "chat" && chatAuthGateActive(state));
}

function publicNotification(notificationId: string, state: StoredPlayerState) {
  const notification = workerScenario.notifications.find((item) => item.id === notificationId);
  if (!notification || !conditionMet(notification.cond, state)) return null;
  const targetContentId = notification.targetTalkId
    ? workerScenario.publicIds.talk[notification.targetTalkId]
    : workerScenario.publicIds.content[notification.targetContentId ?? ""] ?? notification.targetContentId ?? "";
  return {
    id: `notification_${notification.id}`,
    appId: notification.appId,
    targetContentId,
    title: notification.title,
    body: notification.body
  };
}

function publicTalkThread(talk: ScenarioTalk, state: StoredPlayerState) {
  const stored = state.talks[talk.id];
  const unread = Boolean(stored && stored.lastOtherMessageSeq > stored.lastReadMessageSeq);
  return talk.kind === "sms"
    ? {
        id: talk.publicId,
        contentId: talk.publicId,
        contactName: talk.label,
        messages: [],
        ...(unread ? { unread: true } : {})
      }
    : {
        id: talk.publicId,
        contentId: talk.publicId,
        roomName: talk.label,
        messages: [],
        ...(unread ? { unread: true } : {})
      };
}

function visibleApps(state: StoredPlayerState) {
  return workerScenario.apps
    .filter((app) => conditionMet(app.cond, state))
    .flatMap((app) => {
      const available = app.initialState === "normal" || state.repairedAppIds.includes(app.id);
      if (app.initialState === "hidden" && !available) return [];
      return [{
        id: app.id,
        label: available ? app.label : app.repairLabel ?? app.label,
        icon: app.icon,
        accent: app.accent,
        available,
        initialState: app.initialState,
        corrupted: !available,
        ...(app.repairLabel ? { repairLabel: app.repairLabel } : {})
      }];
    });
}

function publicContentRecord(content: ScenarioContent) {
  const { unlockCode: _unlockCode, ...sourceRecord } = content.record;
  const record: Record<string, unknown> = {
    ...sourceRecord,
    id: content.publicId,
    contentId: content.publicId,
    initialState: content.initialState,
    ...(content.repairLabel ? { repairLabel: content.repairLabel } : {})
  };
  if (typeof record.genAudioId === "string") {
    record.genAudioId = workerScenario.publicIds.generatedAudio[record.genAudioId] ?? record.genAudioId;
  }
  return record;
}

function publicCorruptedContentRecord(content: ScenarioContent) {
  const shared = {
    id: content.publicId,
    contentId: content.publicId,
    initialState: content.initialState,
    corrupted: true,
    ...(content.repairLabel ? { repairLabel: content.repairLabel } : {})
  };
  if (content.appId === "phone") {
    return { ...shared, name: content.repairLabel ?? "取得不能", kind: "missed", at: "--:--", durationLabel: "取得不能" };
  }
  if (content.appId === "notes") {
    return { ...shared, title: content.repairLabel ?? "□□□□□□", body: "<ERROR コンテンツへのリンクが破損しています>" };
  }
  if (content.appId === "photos") {
    return { ...shared, title: content.repairLabel ?? "破損したデータ" };
  }
  if (content.appId === "calendar") {
    return { ...shared, title: content.repairLabel ?? "破損した予定", date: "--/--", time: "--:--", place: "取得不能", memo: "予定データが壊れています。" };
  }
  return { ...shared, programTitle: content.repairLabel ?? "□□□□□□ □□□□□" };
}

function visibleContentRecords(appId: string, state: StoredPlayerState) {
  return workerScenario.contents
    .filter((content) => content.appId === appId && conditionMet(content.cond, state))
    .flatMap<Record<string, unknown>>((content) => {
      if (contentAvailable(content, state)) return [publicContentRecord(content)];
      if (content.initialState === "repairable" && appAvailable(content.appId, state)) {
        return [publicCorruptedContentRecord(content)];
      }
      return [];
    });
}

function visibleRadioItems(generatedAudio: readonly PublicGeneratedAudioState[], state: StoredPlayerState) {
  const stateById = new Map(generatedAudio.map((item) => [item.id, item]));
  return workerScenario.contents
    .filter((content) => content.appId === "radio" && conditionMet(content.cond, state))
    .flatMap<Record<string, unknown>>((content) => {
      if (!contentAvailable(content, state)) {
        return content.initialState === "repairable" && appAvailable(content.appId, state)
          ? [publicCorruptedContentRecord(content)]
          : [];
      }
      const publicId = content.publicId;
      const record = publicContentRecord(content);
      const internalAudioId = typeof content.record.genAudioId === "string" ? content.record.genAudioId : "";
      const publicAudioId = workerScenario.publicIds.generatedAudio[internalAudioId] ?? "";
      const audioState = stateById.get(publicAudioId);
      return [{
        ...record,
        ...(publicAudioId ? { genAudioId: publicAudioId } : {}),
        ...(audioState ? { generatedAudio: audioState } : {})
      }];
    });
}

function publicContentId(internalId: string) {
  return workerScenario.publicIds.content[internalId] ?? internalId;
}

function publicCommandBody(body: string) {
  const match = /^(photo|share):([a-zA-Z0-9_:-]+)$/u.exec(body.trim());
  return match ? `${match[1]}:${publicContentId(match[2])}` : body;
}

export function publicTalkMessage(message: StoredTalkMessage): StoredTalkMessage {
  const attachment = message.attachment && "contentId" in message.attachment && message.attachment.contentId
    ? { ...message.attachment, contentId: publicContentId(message.attachment.contentId) }
    : message.attachment;
  const segments = message.segments?.map((segment) =>
    segment.kind === "link" && "contentId" in segment
      ? (() => {
          const { actionId: _actionId, ...publicSegment } = segment;
          return { ...publicSegment, contentId: publicContentId(segment.contentId) };
        })()
      : segment
  );
  return {
    ...message,
    body: publicCommandBody(message.body),
    ...(segments ? { segments } : {}),
    attachment
  };
}

export function publicPlayerState(
  state: StoredPlayerState,
  stateVersion: number,
  generatedAudio: PublicGeneratedAudioState[] = [],
  nextScenarioWakeAt: string | null = null,
  transcriptDeltas: readonly TranscriptUpdate[] = []
) {
  const now = new Date().toISOString();
  const stateValues = effectiveStateValues(workerScenario.stateVariables, state.stateValues);
  const repairedContents = new Set(state.repairedContentIds);
  const unlockedContents = new Set(state.unlockedContentIds);
  const contentStates = unique([...state.repairedContentIds, ...state.unlockedContentIds]).map((internalId) => {
    const content = workerScenario.contents.find((item) => item.id === internalId);
    return {
      contentId: content?.publicId ?? internalId,
      state: unlockedContents.has(internalId) ? "unlocked" : "repaired",
      appId: content?.appId ?? null,
      updatedAt: now
    };
  });
  const visibleTalks = workerScenario.talks.filter((talk) => talkAvailable(talk, state));
  const talks = visibleTalks.map((talk) => ({
    talkId: talk.publicId,
    kind: talk.kind,
    canPost: talkCanPost(talk, state),
    turnKey: state.talks[talk.id]?.turnKey ?? "",
    transcriptKey: state.talks[talk.id]?.transcriptKey ?? "",
    lastMessageSeq: state.talks[talk.id]?.lastMessageSeq ?? 0
  }));
  const clearedNotificationIds = new Set(state.clearedNotificationIds);
  const notifications = workerScenario.notifications
    .filter((notification) => !clearedNotificationIds.has(notification.id))
    .map((notification) => publicNotification(notification.id, state))
    .filter((item): item is NonNullable<typeof item> => Boolean(item));
  const chatAuthGate = workerScenario.chatAuthGate && chatAuthGateActive(state)
      ? {
          status: "session_expired" as const,
          linkSent: conditionMet(workerScenario.chatAuthGate.linkSentCond, state)
        }
      : undefined;
  const publicTranscriptDeltas: Array<
    | { kind: "search"; transcriptKey: string; messages: import("../server/store.ts").StoredSearchAgentMessage[] }
    | { kind: "sms" | "chat"; talkId: string; transcriptKey: string; messages: StoredTalkMessage[] }
  > = [];
  for (const transcript of transcriptDeltas) {
    if (transcript.streamId === "search") {
      publicTranscriptDeltas.push({
        kind: "search",
        transcriptKey: transcript.transcriptKey,
        messages: transcript.messages.filter((message) => "role" in message)
      });
      continue;
    }
    if (!transcript.streamId.startsWith("talk:")) continue;
    const talk = talkByInternalId(transcript.streamId.slice("talk:".length));
    if (!talk || !talkAvailable(talk, state)) continue;
    publicTranscriptDeltas.push({
      kind: talk.kind,
      talkId: talk.publicId,
      transcriptKey: transcript.transcriptKey,
      messages: transcript.messages
        .filter((message): message is StoredTalkMessage => "sender" in message)
        .map(publicTalkMessage)
    });
  }

  return {
    clientRevision: workerScenario.revision,
    revision: workerScenario.revision,
    stateVersion,
    serialCounter: "anonymous",
    nextScenarioWakeAt,
    scenarioTime: {
      dateLabel: workerScenario.project.dateLabel,
      timeLabel: workerScenario.project.timeLabel
    },
    projectState: Object.fromEntries(
      workerScenario.publicStateVariables.map((id) => [id, stateValues[id]])
    ),
    visibleDeviceState: {
      apps: visibleApps(state),
      notifications,
      photos: visibleContentRecords("photos", state),
      notes: visibleContentRecords("notes", state),
      calendarEvents: visibleContentRecords("calendar", state),
      callLogs: visibleContentRecords("phone", state),
      radioItems: visibleRadioItems(generatedAudio, state),
      messages: visibleTalks.filter((talk) => talk.kind === "sms").map((talk) => publicTalkThread(talk, state)),
      chatThreads: visibleTalks.filter((talk) => talk.kind === "chat").map((talk) => publicTalkThread(talk, state)),
      ...(chatAuthGate ? { chatAuthGate } : {}),
      ...(state.incomingCallId
        ? { incomingCall: workerScenario.incomingCalls.find((call) => call.id === state.incomingCallId) }
        : {})
    },
    todos: workerScenario.todos.filter((todo) => !state.clearedTodoIds.includes(todo.id) && conditionMet(todo.cond, state)),
    assistantMessages: workerScenario.assistantMessages.filter((message) => conditionMet(message.cond, state)),
    contentStates,
    unlockedAttachments: workerScenario.attachments
      .filter((attachment) => {
        const content = attachment.content ? contentByInternalId(attachment.content) : null;
        return attachment.lock === "password" && content && conditionMet(content.cond, state) && state.unlockedContentIds.includes(content.id);
      })
      .map((attachment) => ({
        contentId: publicContentId(attachment.content ?? ""),
        title: attachment.title ?? "添付ファイル",
        body: attachment.body ?? "",
        ...(attachment.type === "image" ? { imageUrl: attachment.asset } : {})
      })),
    talks,
    searchTranscript: {
      transcriptKey: state.searchTranscriptKey,
      lastMessageSeq: state.searchLastMessageSeq
    },
    transcriptDeltas: publicTranscriptDeltas,
    repairedContentCount: repairedContents.size
  };
}

export function contentByPublicId(publicId: string) {
  return workerScenario.contents.find((content) => content.publicId === publicId) ?? null;
}

export function contentByInternalId(internalId: string) {
  return workerScenario.contents.find((content) => content.id === internalId) ?? null;
}

export function talkByPublicId(publicId: string) {
  return workerScenario.talks.find((talk) => talk.publicId === publicId) ?? null;
}

export function talkByInternalId(internalId: string) {
  return workerScenario.talks.find((talk) => talk.id === internalId) ?? null;
}

export function appById(appId: string) {
  return workerScenario.apps.find((app) => app.id === appId) ?? null;
}

function normalized(value: string) {
  return value.normalize("NFC").trim().toLocaleLowerCase("ja");
}

function termsMatch(terms: readonly string[], query: string) {
  return terms.some((term) => {
    const normalizedTerm = normalized(term);
    return query.includes(normalizedTerm) || normalizedTerm.includes(query);
  });
}

function contentTitle(content: ScenarioContent) {
  const record = content.record;
  for (const key of ["title", "programTitle", "name"]) {
    if (typeof record[key] === "string" && record[key].trim()) return record[key];
  }
  return content.id;
}

export function searchScenario(query: string, state: StoredPlayerState) {
  const value = normalized(query);
  if (!value) return [];
  const appResults = workerScenario.apps
    .filter((app) => conditionMet(app.cond, state) && termsMatch(app.search, value))
    .map((app) => ({
      contentId: app.id,
      appId: app.id,
      targetKind: "app" as const,
      title: app.label,
      repairable: app.initialState !== "normal" && !state.repairedAppIds.includes(app.id)
    }));
  const contentResults = workerScenario.contents
    .filter((content) => appAvailable(content.appId, state) && conditionMet(content.cond, state) && termsMatch(content.search, value))
    .map((content) => ({
      contentId: content.publicId,
      appId: content.appId,
      targetKind: "content" as const,
      title: contentTitle(content),
      ...(typeof content.record.imageUrl === "string" ? { thumbnailUrl: content.record.imageUrl } : {}),
      repairable: content.initialState !== "normal" && !state.repairedContentIds.includes(content.id)
    }));
  return [...appResults, ...contentResults];
}

export function searchResponseFor<T>(query: string, results: T[], state: StoredPlayerState) {
  const value = normalized(query);
  const found = results.length > 0;
  const response = workerScenario.searchResponses.find((item) => {
    if (item.when === "found" && !found) return false;
    if (item.when === "not_found" && found) return false;
    if (item.search.length && !termsMatch(item.search, value)) return false;
    return conditionMet(item.cond, state);
  });
  return response
    ? {
        body: response.body,
        results: response.suppressResults ? [] : results,
        responseId: response.id,
        suppressed: response.suppressResults
      }
    : {
        body: found ? `${results.length}件見つかりました。` : "該当するデータは見つかりませんでした。",
        results,
        responseId: null,
        suppressed: false
      };
}

export function repairTarget(publicContentId: string, appId: string) {
  const app = appById(publicContentId);
  if (app && app.id === appId && app.initialState !== "normal") {
    return { kind: "app" as const, internalId: app.id, appId: app.id };
  }
  const content = contentByPublicId(publicContentId);
  if (content && content.appId === appId && content.initialState !== "normal") {
    return { kind: "content" as const, internalId: content.id, appId: content.appId };
  }
  return null;
}

export function openTargetExists(publicContentId: string, appId: string, state: StoredPlayerState) {
  const app = appById(publicContentId);
  if (app?.id === appId) return conditionMet(app.cond, state);
  const content = contentByPublicId(publicContentId);
  if (content?.appId === appId) return conditionMet(content.cond, state) && conditionMet(appById(content.appId)?.cond, state);
  const talk = talkByPublicId(publicContentId);
  return Boolean(talk?.appId === appId && talkAvailable(talk, state));
}

export function notificationIdsForTarget(publicContentId: string, state: StoredPlayerState) {
  return workerScenario.notifications
    .filter((notification) => {
      const target = notification.targetTalkId
        ? workerScenario.publicIds.talk[notification.targetTalkId]
        : workerScenario.publicIds.content[notification.targetContentId ?? ""] ?? notification.targetContentId;
      return target === publicContentId && conditionMet(notification.cond, state);
    })
    .map((notification) => notification.id);
}
