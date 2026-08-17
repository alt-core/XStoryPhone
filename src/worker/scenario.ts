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
import type { StoredPlayerState, TranscriptUpdate } from "../server/store.ts";
import { compactStateValues, effectiveStateValues } from "./stateValues.ts";

export { workerScenario };

function unique<T>(items: readonly T[]) {
  return [...new Set(items)];
}

const peopleById = new Map(workerScenario.talkPeople.map((person) => [person.id, person]));
const blocksById = new Map(workerScenario.talkBlocks.map((block) => [block.id, block]));
const attachmentsById = new Map(workerScenario.attachments.map((attachment) => [attachment.id, attachment]));
const attachmentIdByPublicId = new Map(Object.entries(workerScenario.publicIds.attachment).map(([id, publicId]) => [publicId, id]));
const incomingCallIdByPublicId = new Map(Object.entries(workerScenario.publicIds.incomingCall).map(([id, publicId]) => [publicId, id]));
const talkHistoryRepairs = workerScenario.contents.flatMap((content) => {
  if (content.appId !== "messages" && content.appId !== "chat") return [];
  const talkId = typeof content.record.talk === "string" ? content.record.talk : "";
  const blockId = typeof content.record.block === "string" ? content.record.block : "";
  const talk = workerScenario.talks.find((item) => item.id === talkId);
  return talk && blockId
    ? [{ content, talk, blockId }]
    : [];
});
const talkHistoryRepairByBlockId = new Map(talkHistoryRepairs.map((repair) => [repair.blockId, repair]));
const talkHistoryRepairByContentId = new Map(talkHistoryRepairs.map((repair) => [repair.content.id, repair]));
const albumPhotoIdsByAttachmentId = new Map<string, string[]>();
const albumAttachmentIdsByPhotoId = new Map<string, string[]>();
for (const link of workerScenario.albumMediaAttachmentLinks) {
  albumPhotoIdsByAttachmentId.set(link.attachmentId, unique([...(albumPhotoIdsByAttachmentId.get(link.attachmentId) ?? []), link.photoId]));
  albumAttachmentIdsByPhotoId.set(link.photoId, unique([...(albumAttachmentIdsByPhotoId.get(link.photoId) ?? []), link.attachmentId]));
}

function publicAttachmentId(internalId: string) {
  return workerScenario.publicIds.attachment[internalId] ?? internalId;
}

export function internalAttachmentId(publicId: string) {
  return attachmentIdByPublicId.get(publicId) ?? "";
}

export function internalIncomingCallId(publicId: string) {
  return incomingCallIdByPublicId.get(publicId) ?? "";
}

export function internalFormId(publicId: string) {
  return Object.entries(workerScenario.publicIds.form).find(([, candidate]) => candidate === publicId)?.[0] ?? "";
}

export function lockedContentPasswordHash(contentId: string) {
  return workerScenario.lockedContentPasswords.find((item) => item.contentId === contentId)?.passwordHash ?? "";
}

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
  if (attachment.type === "audio") {
    return {
      kind: "audio",
      attachmentId,
      ...(attachment.content ? { contentId: attachment.content } : {}),
      ...(poster?.type === "image" ? { imageUrl: poster.asset } : {}),
      audioUrl: attachment.asset
    };
  }
  return {
    kind: "video",
    attachmentId,
    ...(attachment.content ? { contentId: attachment.content } : {}),
    ...(poster?.type === "image" ? { imageUrl: poster.asset } : {}),
    videoUrl: attachment.asset
  };
}

export function albumPhotoIdsForMediaAttachment(attachment: unknown) {
  if (!attachment || typeof attachment !== "object") return [];
  const record = attachment as { kind?: unknown; attachmentId?: unknown };
  if (!["image", "audio", "video"].includes(String(record.kind)) || typeof record.attachmentId !== "string") return [];
  return albumPhotoIdsByAttachmentId.get(record.attachmentId) ?? [];
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
  singleBlockMessageIds?: boolean;
  includeScenarioBlockId?: boolean;
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
      const messageId = input.singleBlockMessageIds
        ? `${input.idPrefix}:${messageIndex + 1}`
        : `${input.idPrefix}:${blockIndex + 1}:${messageIndex + 1}`;
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
        sentAt,
        ...(input.includeScenarioBlockId ? { scenarioBlockId: blockId } : {})
      });
    }
  }
  return { messages, blockDisplayCounts, lastMessageSeq: seq };
}

export async function initialTalkTurnKey(playerId: string, talkId: string, fromId: string) {
  return `turn_${(await sha256Hex(`turn:v1:${playerId}:${talkId}:${fromId}:initial`)).slice(0, 24)}`;
}

export async function nextTalkTurnKey(playerId: string, talkId: string, currentTurnKey: string, nextFromId: string) {
  return `turn_${(await sha256Hex(`turn:v1:${playerId}:${talkId}:${currentTurnKey}:${nextFromId}`)).slice(0, 24)}`;
}

export async function scenarioMessageBlockId(playerId: string, kind: "sms" | "chat", talkId: string, blockId: string) {
  return `${kind}_block_${(await sha256Hex(`${playerId}:${kind}:${talkId}:${blockId}`)).slice(0, 32)}`;
}

function initialTalkBlockSpans(talk: ScenarioTalk) {
  let lastSeq = 0;
  return talk.startBlocks.map((blockId) => {
    const startSeq = lastSeq + 1;
    lastSeq += blocksById.get(blockId)?.messages.length ?? 0;
    return { blockId, startSeq, endSeq: lastSeq };
  });
}

function talkHistoryRevision(talk: ScenarioTalk, state: StoredPlayerState) {
  return talkHistoryRepairs.filter((repair) => (
    repair.talk.id === talk.id && state.repairedContentIds.includes(repair.content.id)
  )).length;
}

function brokenTalkHistoryRanges(talk: ScenarioTalk, state: StoredPlayerState) {
  const spans = initialTalkBlockSpans(talk);
  const ranges: Array<{ beforeSeq: number }> = [];
  let broken = false;
  for (const span of spans) {
    const repair = talkHistoryRepairByBlockId.get(span.blockId);
    const currentBroken = Boolean(repair && !state.repairedContentIds.includes(repair.content.id));
    if (currentBroken) {
      broken = true;
      continue;
    }
    if (broken) {
      ranges.push({ beforeSeq: span.startSeq });
      broken = false;
    }
  }
  if (broken) ranges.push({ beforeSeq: (spans[spans.length - 1]?.endSeq ?? 0) + 1 });
  return ranges;
}

function publicTalkLastMessageSeq(talk: ScenarioTalk, state: StoredPlayerState) {
  const stored = state.talks[talk.id];
  if (!stored) return 0;
  const spans = initialTalkBlockSpans(talk);
  const initialLastSeq = spans[spans.length - 1]?.endSeq ?? 0;
  if (stored.lastMessageSeq > initialLastSeq) return stored.lastMessageSeq;
  return spans.reduce((lastSeq, span) => {
    const repair = talkHistoryRepairByBlockId.get(span.blockId);
    return !repair || state.repairedContentIds.includes(repair.content.id)
      ? Math.max(lastSeq, span.endSeq)
      : lastSeq;
  }, 0);
}

export function initializeTalkState(
  talk: ScenarioTalk,
  turnKey: string,
  formatEnv = workerScenario.stateVariables,
  repairedContentIds: readonly string[] = []
) {
  const rendered = messagesForTalkBlocks({
    talk,
    blockIds: talk.startBlocks,
    previousCounts: {},
    formatEnv,
    baseSentAt: new Date().toISOString(),
    idPrefix: `${talk.publicId}_initial`,
    includeScenarioBlockId: true
  });
  const visibleMessages = rendered.messages.flatMap((message) => {
    const repair = message.scenarioBlockId ? talkHistoryRepairByBlockId.get(message.scenarioBlockId) : undefined;
    if (repair) return repairedContentIds.includes(repair.content.id) ? [message] : [];
    const { scenarioBlockId: _scenarioBlockId, ...plainMessage } = message;
    return [plainMessage];
  });
  return {
    state: {
      from: talk.initialFrom,
      turnKey,
      blockDisplayCounts: rendered.blockDisplayCounts,
      transcriptKey: crypto.randomUUID(),
      lastMessageSeq: rendered.lastMessageSeq,
      lastOtherMessageSeq: Math.max(0, ...visibleMessages.filter((message) => message.sender === "other").map((message) => message.seq)),
      lastReadMessageSeq: 0
    },
    messages: visibleMessages
  };
}

export function restoredTalkHistoryMessages(state: StoredPlayerState, contentId: string) {
  const repair = talkHistoryRepairByContentId.get(contentId);
  const stored = repair ? state.talks[repair.talk.id] : undefined;
  if (!repair || !stored) return null;
  const rendered = messagesForTalkBlocks({
    talk: repair.talk,
    blockIds: repair.talk.startBlocks,
    previousCounts: {},
    formatEnv: effectiveStateValues(workerScenario.stateVariables, state.stateValues),
    baseSentAt: new Date().toISOString(),
    idPrefix: `${repair.talk.publicId}_initial`,
    useRepeat: false,
    includeScenarioBlockId: true
  });
  const messages = rendered.messages
    .filter((message) => message.scenarioBlockId === repair.blockId)
    .map(({ delayOnFirstDisplay: _delayOnFirstDisplay, ...message }) => message);
  return { talk: repair.talk, messages };
}

export function createInitialPlayerState(): StoredPlayerState {
  return {
    repairedContentIds: [],
    repairedAppIds: [],
    unlockedContentIds: [],
    activeTodoIds: [],
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
    if (message.attachment?.contentId) {
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

export async function reconcileScenarioState(state: StoredPlayerState, playerId: string) {
  const stateValues = compactStateValues(workerScenario.stateVariables, state.stateValues);
  const talks = { ...state.talks };
  const transcriptAppends: TranscriptUpdate[] = [];
  let nextState = { ...state, stateValues, talks };
  for (const talk of workerScenario.talks) {
    if (talks[talk.id] || !talkAvailable(talk, nextState)) continue;
    const initial = initializeTalkState(
      talk,
      await initialTalkTurnKey(playerId, talk.id, talk.initialFrom),
      effectiveStateValues(workerScenario.stateVariables, stateValues),
      nextState.repairedContentIds
    );
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
  if (!talkAvailable(talk, state) || (talk.kind === "chat" && chatAuthGateActive(state))) return false;
  const currentFrom = state.talks[talk.id]?.from;
  return Boolean(currentFrom && talk.rules.some((rule) => rule.from === currentFrom && conditionMet(rule.cond, state)));
}

function publicNotification(notificationId: string, state: StoredPlayerState) {
  const notification = workerScenario.notifications.find((item) => item.id === notificationId);
  if (!notification || !conditionMet(notification.cond, state)) return null;
  const targetContentId = notification.targetTalkId
    ? workerScenario.publicIds.talk[notification.targetTalkId]
    : workerScenario.publicIds.content[notification.targetContentId ?? ""] ?? notification.targetContentId ?? "";
  return {
    id: workerScenario.publicIds.notification[notification.id],
    appId: notification.appId,
    targetContentId,
    title: notification.title,
    body: notification.body
  };
}

function publicIncomingCall(internalId: string) {
  const call = workerScenario.incomingCalls.find((item) => item.id === internalId);
  if (!call) return undefined;
  const { id: _id, publicId, ...publicCall } = call;
  return { ...publicCall, id: publicId };
}

function publicTalkThread(talk: ScenarioTalk, state: StoredPlayerState) {
  const stored = state.talks[talk.id];
  const unread = Boolean(stored && stored.lastOtherMessageSeq > stored.lastReadMessageSeq);
  const brokenHistoryRanges = brokenTalkHistoryRanges(talk, state);
  const shared = {
    id: talk.publicId,
    contentId: talk.publicId,
    messages: [],
    ...(brokenHistoryRanges.length ? { brokenHistoryRanges } : {}),
    ...(unread ? { unread: true } : {})
  };
  return talk.kind === "sms"
    ? {
        ...shared,
        contactName: talk.label
      }
    : {
        ...shared,
        roomName: talk.label
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
  const {
    unlockCode: _unlockCode,
    playbackCond: _playbackCond,
    playbackDisabledLabel: _playbackDisabledLabel,
    formDisabledCond: _formDisabledCond,
    ...sourceRecord
  } = content.record;
  const record: Record<string, unknown> = {
    ...sourceRecord,
    id: content.publicId,
    contentId: content.publicId,
    initialState: content.initialState,
    ...(content.repairLabel ? { repairLabel: content.repairLabel } : {})
  };
  if (content.appId === "photos") {
    const attachmentIds = albumAttachmentIdsByPhotoId.get(content.id) ?? [];
    const preferredType = content.record.mediaKind === "still_video"
      ? "audio"
      : content.record.mediaKind === "video"
        ? "video"
        : "image";
    const attachmentId = attachmentIds.find((id) => attachmentsById.get(id)?.type === preferredType) ?? attachmentIds[0];
    if (attachmentId) record.attachmentId = publicAttachmentId(attachmentId);
  }
  if (typeof record.genAudioId === "string") {
    record.genAudioId = workerScenario.publicIds.generatedAudio[record.genAudioId] ?? record.genAudioId;
  }
  if (Array.isArray(record.audioSegments)) {
    record.audioSegments = record.audioSegments.map((segment) => {
      if (!segment || typeof segment !== "object" || Array.isArray(segment)) return segment;
      const item = segment as Record<string, unknown>;
      return typeof item.genAudioId === "string"
        ? { ...item, genAudioId: workerScenario.publicIds.generatedAudio[item.genAudioId] ?? item.genAudioId }
        : item;
    });
  }
  if (Array.isArray(record.audioCues)) {
    record.audioCues = record.audioCues.map((cue, index) => {
      const item = cue && typeof cue === "object" && !Array.isArray(cue) ? cue as Record<string, unknown> : {};
      return { index: index + 1, atMs: item.atMs };
    });
  }
  if (record.form && typeof record.form === "object" && !Array.isArray(record.form)) {
    const form = record.form as Record<string, unknown>;
    record.form = {
      ...form,
      ...(typeof form.id === "string" ? { id: workerScenario.publicIds.form[form.id] ?? form.id } : {})
    };
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
  if (content.appId === "mail") {
    return {
      ...shared,
      from: "取得不能",
      to: "取得不能",
      subject: content.repairLabel ?? "破損したメール",
      date: "----/--/-- --:--",
      body: "<ERROR コンテンツへのリンクが破損しています>"
    };
  }
  if (content.appId === "photos") {
    return { ...shared, title: content.repairLabel ?? "破損したデータ" };
  }
  if (content.appId === "calendar") {
    return { ...shared, title: content.repairLabel ?? "破損した予定", date: "--/--", time: "--:--", place: "取得不能", memo: "予定データが壊れています。" };
  }
  if (content.appId === "browser") {
    return { ...shared, title: content.repairLabel ?? "破損したタブ" };
  }
  return { ...shared, programTitle: content.repairLabel ?? "□□□□□□ □□□□□" };
}

function generatedAudioUrl(state: PublicGeneratedAudioState | undefined) {
  return state?.publicAudioUrl || state?.fallbackAudioUrl || "";
}

function resolveGeneratedAudioRecord(record: Record<string, unknown>, stateById: ReadonlyMap<string, PublicGeneratedAudioState>) {
  const generatedAudioId = typeof record.genAudioId === "string" ? record.genAudioId : "";
  const generatedAudio = generatedAudioId ? stateById.get(generatedAudioId) : undefined;
  const audioSegments = Array.isArray(record.audioSegments)
    ? record.audioSegments.map((segment) => {
        if (!segment || typeof segment !== "object" || Array.isArray(segment)) return segment;
        const item = segment as Record<string, unknown>;
        if (item.kind !== "generated" || typeof item.genAudioId !== "string") return item;
        const segmentAudio = stateById.get(item.genAudioId);
        const audioUrl = generatedAudioUrl(segmentAudio);
        return {
          ...item,
          ...(segmentAudio ? { generatedAudio: segmentAudio } : {}),
          ...(audioUrl ? { audioUrl } : {})
        };
      })
    : undefined;
  const firstSegmentAudioUrl = audioSegments?.find((segment) => (
    segment && typeof segment === "object" && !Array.isArray(segment) && typeof segment.audioUrl === "string" && segment.audioUrl
  ))?.audioUrl;
  const currentAudioUrl = typeof record.audioUrl === "string" ? record.audioUrl : "";
  const resolvedAudioUrl = currentAudioUrl || generatedAudioUrl(generatedAudio) || firstSegmentAudioUrl || "";
  return {
    ...record,
    ...(generatedAudio ? { generatedAudio } : {}),
    ...(audioSegments ? { audioSegments } : {}),
    ...(resolvedAudioUrl ? { audioUrl: resolvedAudioUrl } : {})
  };
}

function visibleContentRecords(appId: string, state: StoredPlayerState, generatedAudio: readonly PublicGeneratedAudioState[] = []) {
  const stateById = new Map(generatedAudio.map((item) => [item.id, item]));
  return workerScenario.contents
    .filter((content) => content.appId === appId && conditionMet(content.cond, state))
    .flatMap<Record<string, unknown>>((content) => {
      if (contentAvailable(content, state)) {
        const record = publicContentRecord(content);
        return [appId === "phone" ? resolveGeneratedAudioRecord(record, stateById) : record];
      }
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
      const record = publicContentRecord(content);
      const formDisabledCond = typeof content.record.formDisabledCond === "string" ? content.record.formDisabledCond : "";
      if (record.form && typeof record.form === "object" && !Array.isArray(record.form) && formDisabledCond) {
        record.form = {
          ...record.form as Record<string, unknown>,
          disabled: (record.form as { disabled?: unknown }).disabled === true || conditionMet(formDisabledCond, state)
        };
      }
      const playbackCond = typeof content.record.playbackCond === "string" ? content.record.playbackCond : "";
      if (playbackCond && !conditionMet(playbackCond, state)) {
        const {
          audioUrl: _audioUrl,
          audioSegments: _audioSegments,
          genAudioId: _genAudioId,
          generatedAudio: _generatedAudio,
          ...blocked
        } = record;
        const label = typeof content.record.playbackDisabledLabel === "string" && content.record.playbackDisabledLabel.trim()
          ? content.record.playbackDisabledLabel.trim()
          : "現在は再生できません";
        return [{ ...blocked, playbackDisabledLabel: label }];
      }
      return [resolveGeneratedAudioRecord(record, stateById)];
    });
}

export function radioAudioCueForEvent(contentId: string, cueIndex: number, state: StoredPlayerState) {
  const content = contentByInternalId(contentId);
  if (!content || content.appId !== "radio" || !contentAvailable(content, state) || !Number.isInteger(cueIndex) || cueIndex < 1) {
    return null;
  }
  const cues = Array.isArray(content.record.audioCues) ? content.record.audioCues : [];
  const cue = cues[cueIndex - 1];
  if (!cue || typeof cue !== "object" || Array.isArray(cue)) return null;
  const cueId = typeof cue.id === "string" ? cue.id : "";
  return cueId ? { cueId, cueTarget: `${content.id}:${cueId}`, cueIndex } : null;
}

function publicContentId(internalId: string) {
  return workerScenario.publicIds.content[internalId] ?? internalId;
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function playerStateRevision(state: StoredPlayerState) {
  const {
    searchTranscriptKey: _searchTranscriptKey,
    searchLastMessageSeq: _searchLastMessageSeq,
    ...progressState
  } = state;
  return `player:${(await sha256Hex(JSON.stringify({
    ...progressState,
    stateValues: effectiveStateValues(workerScenario.stateVariables, state.stateValues)
  }))).slice(0, 24)}`;
}

function publicCommandBody(body: string) {
  const match = /^(photo|share):([a-zA-Z0-9_:-]+)$/u.exec(body.trim());
  return match ? `${match[1]}:${publicContentId(match[2])}` : body;
}

export function publicTalkMessage(message: StoredTalkMessage): StoredTalkMessage {
  const { scenarioBlockId, historyRepairId: _historyRepairId, ...publicMessage } = message;
  const historyRepair = scenarioBlockId ? talkHistoryRepairByBlockId.get(scenarioBlockId) : undefined;
  const attachment = message.attachment
    ? {
        ...message.attachment,
        ...("contentId" in message.attachment && message.attachment.contentId
          ? { contentId: publicContentId(message.attachment.contentId) }
          : {}),
        ...("attachmentId" in message.attachment && message.attachment.attachmentId
          ? { attachmentId: publicAttachmentId(message.attachment.attachmentId) }
          : {})
      }
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
    ...publicMessage,
    body: publicCommandBody(message.body),
    ...(segments ? { segments } : {}),
    ...(historyRepair ? { historyRepairId: historyRepair.content.publicId } : {}),
    attachment
  };
}

export async function publicPlayerState(
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
    lastMessageSeq: publicTalkLastMessageSeq(talk, state),
    historyRevision: talkHistoryRevision(talk, state)
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
    revision: await playerStateRevision(state),
    stateVersion,
    serialCounter: "anonymous",
    nextScenarioWakeAt,
    scenarioTime: {
      date: String(stateValues.os_date),
      timeLabel: String(stateValues.os_time_label)
    },
    projectState: Object.fromEntries(
      workerScenario.publicStateVariables.map((id) => [id, stateValues[id]])
    ),
    visibleDeviceState: {
      apps: visibleApps(state),
      notifications,
      photos: visibleContentRecords("photos", state),
      notes: visibleContentRecords("notes", state),
      mails: visibleContentRecords("mail", state),
      calendarEvents: visibleContentRecords("calendar", state),
      callLogs: visibleContentRecords("phone", state, generatedAudio),
      browserTabs: visibleContentRecords("browser", state),
      radioItems: visibleRadioItems(generatedAudio, state),
      messages: visibleTalks.filter((talk) => talk.kind === "sms").map((talk) => publicTalkThread(talk, state)),
      chatThreads: visibleTalks.filter((talk) => talk.kind === "chat").map((talk) => publicTalkThread(talk, state)),
      ...(chatAuthGate ? { chatAuthGate } : {}),
      ...(state.incomingCallId
        ? { incomingCall: publicIncomingCall(state.incomingCallId) }
        : {})
    },
    todos: workerScenario.todos.filter((todo) => state.activeTodoIds.includes(todo.id) && conditionMet(todo.cond, state)),
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

export function observedAlbumMediaContentIds(
  talk: ScenarioTalk,
  state: StoredPlayerState,
  publicContentIds: readonly string[]
) {
  const requestedIds = new Set(publicContentIds);
  const revealedIds = new Set(state.revealedAttachmentContentIds);
  const alreadyAvailableIds = new Set([...state.repairedContentIds, ...state.unlockedContentIds]);
  const attachmentIds = new Set(
    workerScenario.talkBlocks
      .filter((block) => block.talkId === talk.id)
      .flatMap((block) => block.messages.map((message) => message.attachmentId).filter(Boolean))
  );

  return unique([...attachmentIds].flatMap((attachmentId) => (
    (albumPhotoIdsByAttachmentId.get(attachmentId) ?? []).filter((photoId) => {
      const content = contentByInternalId(photoId);
      return Boolean(
        content
        && content.appId === "photos"
        && content.initialState !== "normal"
        && !alreadyAvailableIds.has(content.id)
        && revealedIds.has(content.id)
        && requestedIds.has(content.publicId)
      );
    })
  )));
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
  return value.normalize("NFKC").trim().toLocaleLowerCase("ja");
}

function termsMatch(terms: readonly (string | readonly string[])[], query: string) {
  return terms.some((termOrGroup) => {
    const group = typeof termOrGroup === "string" ? [termOrGroup] : termOrGroup;
    return group.length > 0 && group.every((term) => query.includes(normalized(term)));
  });
}

function contentTitle(content: ScenarioContent) {
  const record = content.record;
  for (const key of ["title", "subject", "programTitle", "name"]) {
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
    .filter((content) => conditionMet(content.cond, state) && termsMatch(content.search, value))
    .map((content) => {
      const historyRepair = talkHistoryRepairByContentId.get(content.id);
      return {
        contentId: content.publicId,
        appId: content.appId,
        targetKind: historyRepair ? "talk_history" as const : "content" as const,
        ...(historyRepair ? { targetTalkId: historyRepair.talk.publicId } : {}),
        title: historyRepair ? content.repairLabel ?? "破損した履歴" : contentTitle(content),
        ...(typeof content.record.imageUrl === "string" ? { thumbnailUrl: content.record.imageUrl } : {}),
        repairable: content.initialState !== "normal" && !state.repairedContentIds.includes(content.id)
      };
    });
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
  if (content?.appId === appId) {
    const historyRepair = talkHistoryRepairByContentId.get(content.id);
    return conditionMet(content.cond, state)
      && conditionMet(appById(content.appId)?.cond, state)
      && (!historyRepair || talkAvailable(historyRepair.talk, state));
  }
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
