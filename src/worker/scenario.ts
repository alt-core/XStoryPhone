import { workerScenario } from "../generated/workerScenario.generated.ts";
import { projectApps } from "../project/apps.ts";
import { evaluateCondition, renderTemplate } from "../shared/condition.ts";
import type {
  PublicGeneratedAudioState,
  ScenarioContent,
  ScenarioDeviceTalk,
  ScenarioMessageAttachment,
  ScenarioMessageSegment,
  ScenarioSearchAgentTalk,
  ScenarioTalk,
  TalkOutputStep,
  StoredTalkMessage
} from "../shared/scenario.ts";
import { SEARCH_AGENT_STREAM_ID, SEARCH_AGENT_TALK_ID } from "../shared/searchAgent.ts";
import type { StoredPlayerState, StoredSearchAgentEvent, StoredTalkEvent, TranscriptAppend } from "../server/store.ts";
import { compactStateValues, effectiveStateValues } from "./stateValues.ts";
import {
  formatEnvForMessageBlockFromState,
  renderedQuickReplies,
  resolveSearchAgentEvents,
  resolveSingleTalkEvent,
  resolveTalkEvents,
  searchAgentBlockEvents,
  searchAgentResultEvent
} from "./talkEvents.ts";
import { normalizeQuery, searchResponseTermsMatch } from "./product/search.ts";
import { evaluateTalkOutputSteps, type ResolvedTalkOutputStep } from "./services/talkOutput.ts";

export { workerScenario };

function unique<T>(items: readonly T[]) {
  return [...new Set(items)];
}

const peopleById = new Map(workerScenario.talkPeople.map((person) => [person.id, person]));
const blocksById = new Map(workerScenario.talkBlocks.map((block) => [block.id, block]));
const attachmentsById = new Map(workerScenario.attachments.map((attachment) => [attachment.id, attachment]));
const projectAppById = new Map<string, (typeof projectApps)[number]>(projectApps.map((app) => [app.id, app]));
const attachmentIdByPublicId = new Map(Object.entries(workerScenario.publicIds.attachment).map(([id, publicId]) => [publicId, id]));
const incomingCallIdByPublicId = new Map(Object.entries(workerScenario.publicIds.incomingCall).map(([id, publicId]) => [publicId, id]));
const talkHistoryRepairs = workerScenario.contents.flatMap((content) => {
  if (content.appId !== "messages" && content.appId !== "chat") return [];
  const talkId = typeof content.record.talk === "string" ? content.record.talk : "";
  const blockId = typeof content.record.block === "string" ? content.record.block : "";
  const talk = workerScenario.talks.find((item): item is ScenarioDeviceTalk => item.id === talkId && item.kind !== "search_agent");
  return talk && blockId
    ? [{ content, talk, blockId }]
    : [];
});

export function isSearchAgentTalk(talk: ScenarioTalk): talk is ScenarioSearchAgentTalk {
  return talk.kind === "search_agent";
}

export function isDeviceTalk(talk: ScenarioTalk): talk is ScenarioDeviceTalk {
  return talk.kind !== "search_agent";
}
const talkHistoryRepairByBlockId = new Map(talkHistoryRepairs.map((repair) => [repair.blockId, repair]));
const talkHistoryRepairByContentId = new Map(talkHistoryRepairs.map((repair) => [repair.content.id, repair]));
const talkHistoryRepairByPublicContentId = new Map(talkHistoryRepairs.map((repair) => [repair.content.publicId, repair]));
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
      imageUrl: attachment.asset ?? ""
    };
  }
  const poster = attachment.poster ? attachmentsById.get(attachment.poster) : null;
  if (attachment.type === "audio") {
    return {
      kind: "audio",
      attachmentId,
      ...(attachment.content ? { contentId: attachment.content } : {}),
      ...(poster?.type === "image" ? { imageUrl: poster.asset } : {}),
      audioUrl: attachment.asset ?? ""
    };
  }
  return {
    kind: "video",
    attachmentId,
    ...(attachment.content ? { contentId: attachment.content } : {}),
    ...(poster?.type === "image" ? { imageUrl: poster.asset } : {}),
    videoUrl: attachment.asset ?? ""
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

function messagesForInitialTalkBlocks(input: {
  talk: ScenarioDeviceTalk;
  blockIds: readonly string[];
  formatEnv: Record<string, unknown>;
  idPrefix: string;
  includeScenarioBlockId?: boolean;
  startSeq?: number;
  blockIndexOffset?: number;
}) {
  const messages: StoredTalkMessage[] = [];
  const templateEnv: Record<string, string> = Object.fromEntries(
    Object.entries(input.formatEnv)
      .filter((entry): entry is [string, string | number | boolean] => ["string", "number", "boolean"].includes(typeof entry[1]))
      .map(([key, value]) => [key, String(value)])
  );
  let seq = input.startSeq ?? 0;
  for (const [blockIndex, blockId] of input.blockIds.entries()) {
    const effectiveBlockIndex = (input.blockIndexOffset ?? 0) + blockIndex;
    for (const [messageIndex, template] of messageTemplatesForBlock(blockId).entries()) {
      const sentAt = template.sentAt;
      const messageId = `${input.idPrefix}:${effectiveBlockIndex + 1}:${messageIndex + 1}`;
      const quickReplies = renderedQuickReplies(template.quickReplies, templateEnv);
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
        ...(quickReplies.length ? { quickReplies } : {}),
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
  return { messages, lastMessageSeq: seq };
}

export function messagesForTalkBlocks(input: {
  talk: ScenarioDeviceTalk;
  blockIds: readonly string[];
  previousCounts: Record<string, number>;
  formatEnv: Record<string, unknown>;
  baseSentAt: string;
  idPrefix: string;
  startSeq?: number;
  useRepeat?: boolean;
  singleBlockMessageIds?: boolean;
  includeScenarioBlockId?: boolean;
  blockIndexOffset?: number;
}) {
  const blockDisplayCounts = { ...input.previousCounts };
  const messages: StoredTalkMessage[] = [];
  const events: StoredTalkEvent[] = [];
  const blockLastMessageSeqs: number[] = [];
  let seq = input.startSeq ?? 0;
  for (const [blockIndex, blockId] of input.blockIds.entries()) {
    const effectiveBlockIndex = (input.blockIndexOffset ?? 0) + blockIndex;
    const previousCount = blockDisplayCounts[blockId] ?? 0;
    const displayBlockId = input.useRepeat === false ? blockId : talkBlockIdForRepeatDisplay(blockId, previousCount);
    if (input.useRepeat !== false) blockDisplayCounts[blockId] = previousCount + 1;
    const formatEnv = formatEnvForMessageBlockFromState(displayBlockId, input.formatEnv);
    const event: StoredTalkEvent = {
      id: input.singleBlockMessageIds ? input.idPrefix : `${input.idPrefix}_${effectiveBlockIndex + 1}`,
      kind: input.talk.kind,
      talk_id: input.talk.id,
      event_type: "message_block",
      body: null,
      block_id: blockId,
      format_env_json: formatEnv ? JSON.stringify(formatEnv) : null,
      delivered_at: new Date(Date.parse(input.baseSentAt) + effectiveBlockIndex * 1_000).toISOString()
    };
    events.push(event);
    const resolved = resolveSingleTalkEvent(event, displayBlockId);
    for (const [messageIndex, message] of resolved.entries()) {
      seq += 1;
      messages.push({
        ...message,
        seq,
        talkId: input.talk.publicId,
        ...(message.segments ? { segments: identifiedSegments(message.segments, message.id) } : {}),
        ...(input.includeScenarioBlockId ? { scenarioBlockId: blockId } : {})
      });
    }
    blockLastMessageSeqs.push(seq);
  }
  return { messages, events, blockDisplayCounts, blockLastMessageSeqs, lastMessageSeq: seq };
}

type TalkInputAction = Extract<TalkOutputStep, { kind: "input" }>["action"];
type TalkInputState = {
  inputVisible: boolean;
  inputVisibleAfterSeq: number;
  inputEnabled: boolean;
  inputEnabledAfterSeq: number;
};

export function applyTalkInputAction(state: TalkInputState, action: TalkInputAction, latestDisplaySeq: number) {
  if (action === "show") {
    if (!state.inputVisible) {
      state.inputVisible = true;
      state.inputVisibleAfterSeq = latestDisplaySeq;
    }
  } else if (action === "hide") {
    state.inputVisible = false;
  } else if (action === "enable") {
    if (!state.inputEnabled) {
      state.inputEnabled = true;
      state.inputEnabledAfterSeq = latestDisplaySeq;
    }
  } else if (action === "disable") {
    state.inputEnabled = false;
  } else {
    const unsupported: never = action;
    throw new Error(`未対応のtalk input actionです: ${String(unsupported)}`);
  }
}

export function messagesForTalkOutputSteps(input: {
  talk: ScenarioDeviceTalk;
  steps: readonly TalkOutputStep[];
  previousCounts: Record<string, number>;
  formatEnv: Record<string, unknown>;
  baseSentAt: string;
  idPrefix: string;
  startSeq: number;
  inputVisible: boolean;
  inputVisibleAfterSeq: number;
  inputEnabled: boolean;
  inputEnabledAfterSeq: number;
  useRepeat?: boolean;
}) {
  const blockIds = input.steps.flatMap((step) => step.kind === "block" ? [step.blockId] : []);
  const rendered = messagesForTalkBlocks({
    talk: input.talk,
    blockIds,
    previousCounts: input.previousCounts,
    formatEnv: input.formatEnv,
    baseSentAt: input.baseSentAt,
    idPrefix: input.idPrefix,
    startSeq: input.startSeq,
    useRepeat: input.useRepeat
  });
  const inputState: TalkInputState = {
    inputVisible: input.inputVisible,
    inputVisibleAfterSeq: input.inputVisibleAfterSeq,
    inputEnabled: input.inputEnabled,
    inputEnabledAfterSeq: input.inputEnabledAfterSeq
  };
  let latestDisplaySeq = input.startSeq;
  let blockIndex = 0;
  for (const step of input.steps) {
    if (step.kind === "block") {
      latestDisplaySeq = rendered.blockLastMessageSeqs[blockIndex] ?? latestDisplaySeq;
      blockIndex += 1;
    } else if (step.kind === "input") {
      applyTalkInputAction(inputState, step.action, latestDisplaySeq);
    }
  }
  return {
    ...rendered,
    inputVisible: inputState.inputVisible,
    inputVisibleAfterSeq: inputState.inputVisibleAfterSeq,
    inputEnabled: inputState.inputEnabled,
    inputEnabledAfterSeq: inputState.inputEnabledAfterSeq
  };
}

export async function initialTalkTurnKey(playerId: string, talkId: string, fromId: string) {
  return `turn_${(await sha256Hex(`turn:v1:${playerId}:${talkId}:${fromId}:initial`)).slice(0, 24)}`;
}

export async function nextTalkTurnKey(playerId: string, talkId: string, currentTurnKey: string, nextFromId: string) {
  return `turn_${(await sha256Hex(`turn:v1:${playerId}:${talkId}:${currentTurnKey}:${nextFromId}`)).slice(0, 24)}`;
}

export function searchAgentTimelineForOutputs(input: {
  outputs: readonly ResolvedTalkOutputStep<ReturnType<typeof searchScenario>[number]>[];
  previousCounts: Record<string, number>;
  formatEnv: Record<string, unknown>;
  startSeq: number;
  inputVisible: boolean;
  inputVisibleAfterSeq: number;
  inputEnabled: boolean;
  inputEnabledAfterSeq: number;
  baseSentAt: string;
  idPrefix: string;
}) {
  const events: StoredSearchAgentEvent[] = [];
  const blockDisplayCounts = { ...input.previousCounts };
  let seq = input.startSeq;
  const inputState: TalkInputState = {
    inputVisible: input.inputVisible,
    inputVisibleAfterSeq: input.inputVisibleAfterSeq,
    inputEnabled: input.inputEnabled,
    inputEnabledAfterSeq: input.inputEnabledAfterSeq
  };
  let latestDisplaySeq = input.startSeq;
  let displayOutputIndex = 0;
  for (const [outputIndex, output] of input.outputs.entries()) {
    if (output.kind === "input") {
      applyTalkInputAction(inputState, output.action, latestDisplaySeq);
      continue;
    }
    const deliveredAt = new Date(Date.parse(input.baseSentAt) + displayOutputIndex * 1_000).toISOString();
    displayOutputIndex += 1;
    if (output.kind === "block") {
      const previousCount = blockDisplayCounts[output.blockId] ?? 0;
      const displayBlockId = talkBlockIdForRepeatDisplay(output.blockId, previousCount);
      blockDisplayCounts[output.blockId] = previousCount + 1;
      const rendered = searchAgentBlockEvents({
        baseBlockId: output.blockId,
        displayBlockId,
        formatEnv: input.formatEnv,
        startSeq: seq,
        baseSentAt: deliveredAt,
        idPrefix: `${input.idPrefix}:${outputIndex + 1}`
      });
      events.push(...rendered.events);
      seq = rendered.lastSeq;
      if (rendered.events.length) latestDisplaySeq = rendered.lastSeq;
      continue;
    }
    if (output.kind === "search") {
      seq += 1;
      events.push(searchAgentResultEvent({
        id: `${input.idPrefix}:${outputIndex + 1}`,
        seq,
        query: output.query,
        results: output.results,
        deliveredAt
      }));
      latestDisplaySeq = seq;
      continue;
    }
  }
  return {
    events,
    messages: resolveSearchAgentEvents(events),
    blockDisplayCounts,
    lastSeq: seq,
    inputVisible: inputState.inputVisible,
    inputVisibleAfterSeq: inputState.inputVisibleAfterSeq,
    inputEnabled: inputState.inputEnabled,
    inputEnabledAfterSeq: inputState.inputEnabledAfterSeq
  };
}

export async function initializeSearchAgentTalkState(
  talk: ScenarioSearchAgentTalk,
  playerId: string,
  state: StoredPlayerState,
  at = new Date().toISOString()
) {
  const turnKey = await initialTalkTurnKey(playerId, talk.id, talk.initialFrom);
  const initialId = (await sha256Hex(`search-agent-initial:${playerId}`)).slice(0, 32);
  const env = effectiveStateValues(workerScenario.stateVariables, state.stateValues);
  const evaluated = evaluateTalkOutputSteps({
    steps: talk.startSteps,
    env,
    search: (query) => searchScenario(query, state)
  });
  const rendered = searchAgentTimelineForOutputs({
    outputs: evaluated.outputs,
    previousCounts: {},
    formatEnv: evaluated.env,
    startSeq: 0,
    inputVisible: talk.inputVisible,
    inputVisibleAfterSeq: 0,
    inputEnabled: talk.inputEnabled,
    inputEnabledAfterSeq: 0,
    baseSentAt: at,
    idPrefix: `search_agent_initial_${initialId}`
  });
  return {
    state: {
      from: talk.initialFrom,
      turnKey,
      blockDisplayCounts: rendered.blockDisplayCounts,
      transcriptKey: crypto.randomUUID(),
      lastMessageSeq: rendered.lastSeq,
      lastOtherMessageId: "",
      historySlots: [],
      initialHistoryLastSeq: 0,
      initialVisibleLastSeq: 0,
      initialFormatEnv: {},
      inputVisible: rendered.inputVisible,
      inputVisibleAfterSeq: rendered.inputVisibleAfterSeq,
      inputEnabled: rendered.inputEnabled,
      inputEnabledAfterSeq: rendered.inputEnabledAfterSeq
    },
    events: rendered.events,
    messages: rendered.messages
  };
}

export async function talkTurnHash(playerId: string, kind: "sms" | "chat", talkId: string, turnKey: string) {
  return (await sha256Hex(`${playerId}:${kind}:${talkId}:${turnKey}`)).slice(0, 32);
}

export async function scenarioMessageBlockId(playerId: string, kind: "sms" | "chat", talkId: string, blockId: string) {
  return `${kind}_block_${(await sha256Hex(`${playerId}:${kind}:${talkId}:${blockId}`)).slice(0, 32)}`;
}

function initialTalkBlockSpans(talk: ScenarioDeviceTalk) {
  let lastSeq = 0;
  return talk.startBlocks.map((blockId) => {
    const startSeq = lastSeq + 1;
    lastSeq += blocksById.get(blockId)?.messages.length ?? 0;
    return { blockId, startSeq, endSeq: lastSeq };
  });
}

function initialTalkHistorySlots(talk: ScenarioDeviceTalk) {
  return initialTalkBlockSpans(talk).flatMap((span, blockIndex) => {
    const repair = talkHistoryRepairByBlockId.get(span.blockId);
    return repair
      ? [{
          repairId: repair.content.publicId,
          startSeq: span.startSeq,
          messageCount: span.endSeq - span.startSeq + 1,
          blockIndex
        }]
      : [];
  });
}

function historySlotsForTalk(talk: ScenarioDeviceTalk, state: StoredPlayerState) {
  return (state.talks[talk.id]?.historySlots ?? []).filter((slot) => (
    talkHistoryRepairByPublicContentId.get(slot.repairId)?.talk.id === talk.id
  ));
}

function talkHistoryRevision(talk: ScenarioDeviceTalk, state: StoredPlayerState) {
  return historySlotsForTalk(talk, state).filter((slot) => (
    state.repairedContentIds.includes(talkHistoryRepairByPublicContentId.get(slot.repairId)?.content.id ?? "")
  )).length;
}

function brokenTalkHistoryRanges(talk: ScenarioDeviceTalk, state: StoredPlayerState) {
  const slots = historySlotsForTalk(talk, state).sort((left, right) => left.blockIndex - right.blockIndex);
  const ranges: Array<{ beforeSeq: number }> = [];
  let previousBrokenBlockIndex = -2;
  for (const slot of slots) {
    const repair = talkHistoryRepairByPublicContentId.get(slot.repairId);
    if (!repair || state.repairedContentIds.includes(repair.content.id)) {
      previousBrokenBlockIndex = -2;
      continue;
    }
    if (previousBrokenBlockIndex === slot.blockIndex - 1 && ranges.length) {
      ranges[ranges.length - 1].beforeSeq = slot.startSeq + slot.messageCount;
    } else {
      ranges.push({ beforeSeq: slot.startSeq + slot.messageCount });
    }
    previousBrokenBlockIndex = slot.blockIndex;
  }
  return ranges;
}

function publicTalkLastMessageSeq(talk: ScenarioDeviceTalk, state: StoredPlayerState) {
  const stored = state.talks[talk.id];
  if (!stored) return 0;
  if (!stored.historySlots.length) return stored.lastMessageSeq;
  if (stored.lastMessageSeq > stored.initialHistoryLastSeq) return stored.lastMessageSeq;
  return historySlotsForTalk(talk, state).reduce((lastSeq, slot) => {
    const repair = talkHistoryRepairByPublicContentId.get(slot.repairId);
    return repair && state.repairedContentIds.includes(repair.content.id)
      ? Math.max(lastSeq, slot.startSeq + slot.messageCount - 1)
      : lastSeq;
  }, stored.initialVisibleLastSeq);
}

export function talkInputBoundarySeq(talk: ScenarioTalk, state: StoredPlayerState) {
  return isSearchAgentTalk(talk)
    ? state.talks[talk.id]?.lastMessageSeq ?? 0
    : publicTalkLastMessageSeq(talk, state);
}

export function initializeTalkState(
  talk: ScenarioDeviceTalk,
  turnKey: string,
  formatEnv = workerScenario.stateVariables,
  repairedContentIds: readonly string[] = []
) {
  const initialFormatEnv = Object.assign({}, ...talk.startBlocks.map((blockId) => (
    formatEnvForMessageBlockFromState(blockId, formatEnv) ?? {}
  )));
  const { rendered, visibleMessages } = initialTalkMessagesForState(talk, initialFormatEnv, repairedContentIds);
  const historySlots = initialTalkHistorySlots(talk);
  return {
    state: {
      from: talk.initialFrom,
      turnKey,
      blockDisplayCounts: {},
      transcriptKey: crypto.randomUUID(),
      lastMessageSeq: rendered.lastMessageSeq,
      lastOtherMessageId: [...visibleMessages].reverse().find((message) => message.sender === "other")?.id ?? "",
      historySlots,
      initialHistoryLastSeq: rendered.lastMessageSeq,
      initialVisibleLastSeq: Math.max(0, ...visibleMessages.map((message) => message.seq)),
      initialFormatEnv,
      inputVisible: talk.inputVisible,
      inputVisibleAfterSeq: 0,
      inputEnabled: talk.inputEnabled,
      inputEnabledAfterSeq: 0
    },
    messages: visibleMessages
  };
}

function initialTalkMessagesForState(
  talk: ScenarioDeviceTalk,
  formatEnv: Record<string, unknown>,
  repairedContentIds: readonly string[]
) {
  const rendered = messagesForInitialTalkBlocks({
    talk,
    blockIds: talk.startBlocks,
    formatEnv,
    idPrefix: `${talk.publicId}_initial`,
    includeScenarioBlockId: true
  });
  const visibleMessages = rendered.messages.flatMap((message) => {
    const repair = message.scenarioBlockId ? talkHistoryRepairByBlockId.get(message.scenarioBlockId) : undefined;
    if (repair) return repairedContentIds.includes(repair.content.id) ? [message] : [];
    const { scenarioBlockId: _scenarioBlockId, ...plainMessage } = message;
    return [plainMessage];
  });
  return { rendered, visibleMessages };
}

export function restoredTalkHistoryMessages(state: StoredPlayerState, contentId: string) {
  const repair = talkHistoryRepairByContentId.get(contentId);
  const stored = repair ? state.talks[repair.talk.id] : undefined;
  if (!repair) return null;
  if (!stored) return { ok: true as const, talk: repair.talk, messages: [] };
  const slot = stored.historySlots.find((item) => item.repairId === repair.content.publicId);
  if (!slot) return { ok: false as const, error: "history_not_initialized" as const };
  const rendered = messagesForInitialTalkBlocks({
    talk: repair.talk,
    blockIds: [repair.blockId],
    formatEnv: stored.initialFormatEnv,
    idPrefix: `${repair.talk.publicId}_initial`,
    startSeq: slot.startSeq - 1,
    includeScenarioBlockId: true,
    blockIndexOffset: slot.blockIndex
  });
  if (rendered.messages.length !== slot.messageCount) {
    return { ok: false as const, error: "history_layout_changed" as const };
  }
  const messages = rendered.messages
    .map(({ delayOnFirstDisplay: _delayOnFirstDisplay, ...message }) => message);
  return { ok: true as const, talk: repair.talk, messages };
}

export function synchronizeInitialTalkLastOtherMessageId(state: StoredPlayerState, talkId: string) {
  const talk = talkByInternalId(talkId);
  const stored = state.talks[talkId];
  if (!talk || !isDeviceTalk(talk) || !stored || stored.lastMessageSeq > stored.initialHistoryLastSeq) return state;
  const latestOther = [...initialTalkMessagesForState(
    talk,
    stored.initialFormatEnv,
    state.repairedContentIds
  ).visibleMessages].reverse().find((message) => message.sender === "other");
  if (latestOther) stored.lastOtherMessageId = latestOther.id;
  return state;
}

export function talkHistoryRepairAvailable(state: StoredPlayerState, contentId: string) {
  const repair = talkHistoryRepairByContentId.get(contentId);
  if (!repair) return true;
  const stored = state.talks[repair.talk.id];
  return Boolean(stored?.historySlots.some((slot) => slot.repairId === repair.content.publicId));
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
    talkReadCursors: {},
    incomingCallId: null,
    completedIncomingCallIds: [],
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
  const transcriptAppends: TranscriptAppend[] = [];
  const incomingIds = new Set(workerScenario.incomingCalls.map((call) => call.id));
  let nextState = {
    ...state,
    stateValues,
    talks,
    incomingCallId: state.incomingCallId && incomingIds.has(state.incomingCallId) ? state.incomingCallId : null,
    completedIncomingCallIds: state.completedIncomingCallIds.filter((id) => incomingIds.has(id))
  };
  for (const talk of workerScenario.talks) {
    if (talks[talk.id] || !talkAvailable(talk, nextState)) continue;
    if (isSearchAgentTalk(talk)) {
      const initial = await initializeSearchAgentTalkState(talk, playerId, nextState);
      talks[talk.id] = initial.state;
      if (initial.events.length) {
        transcriptAppends.push({
          streamId: SEARCH_AGENT_STREAM_ID,
          transcriptKey: initial.state.transcriptKey,
          messages: initial.events
        });
      }
      continue;
    }
    const initial = initializeTalkState(
      talk,
      await initialTalkTurnKey(playerId, talk.id, talk.initialFrom),
      effectiveStateValues(workerScenario.stateVariables, stateValues),
      nextState.repairedContentIds
    );
    talks[talk.id] = initial.state;
    nextState = revealTalkMessages(nextState, talk.id, initial.messages);
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

function talkDefinitionAvailable(talk: ScenarioTalk, state: StoredPlayerState) {
  if (isSearchAgentTalk(talk)) return true;
  return conditionMet(talk.cond, state) && appAvailable(talk.appId, state);
}

function talkRepaired(talk: ScenarioTalk, state: StoredPlayerState) {
  if (isSearchAgentTalk(talk)) return true;
  return talk.initialState === "normal" || state.repairedContentIds.includes(talk.id);
}

export function talkAvailable(talk: ScenarioTalk, state: StoredPlayerState) {
  return talkDefinitionAvailable(talk, state) && talkRepaired(talk, state);
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
  if (state.talks[talk.id]?.inputEnabled === false) return false;
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
  const { id: _id, publicId, cond: _cond, ...publicCall } = call;
  return { ...publicCall, id: publicId };
}

export function visibleIncomingCallId(state: StoredPlayerState) {
  const id = state.incomingCallId;
  if (!id || state.completedIncomingCallIds.includes(id)) return null;
  const call = workerScenario.incomingCalls.find((item) => item.id === id);
  return call && conditionMet(call.cond, state) ? id : null;
}

function publicTalkThread(talk: ScenarioDeviceTalk, state: StoredPlayerState) {
  const repaired = talkRepaired(talk, state);
  const fallbackRepairLabel = talk.kind === "sms" ? "SMS" : "□□□□□□";
  const repairLabel = talk.repairLabel ?? fallbackRepairLabel;
  const initialState = talk.initialState === "normal"
    ? {}
    : {
        initialState: talk.initialState,
        ...(talk.initialState === "repairable" ? { repairLabel } : {})
      };
  if (!repaired) {
    return talk.kind === "sms"
      ? {
          id: talk.publicId,
          contentId: talk.publicId,
          contactName: repairLabel,
          messages: [],
          corrupted: true,
          ...initialState
        }
      : {
          id: talk.publicId,
          contentId: talk.publicId,
          roomName: repairLabel,
          messages: [],
          corrupted: true,
          ...initialState
        };
  }
  const stored = state.talks[talk.id];
  const unread = Boolean(stored?.lastOtherMessageId && state.talkReadCursors[talk.id] !== stored.lastOtherMessageId);
  const brokenHistoryRanges = brokenTalkHistoryRanges(talk, state);
  const messages = initialTalkMessagesForState(
    talk,
    stored?.initialFormatEnv ?? {},
    state.repairedContentIds
  ).visibleMessages.map(publicTalkMessage);
  const shared = {
    id: talk.publicId,
    contentId: talk.publicId,
    messages,
    ...(talk.avatarUrl ? { avatarUrl: talk.avatarUrl } : {}),
    ...initialState,
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
        ...(app.badgeCond.trim() && conditionMet(app.badgeCond, state) ? { badge: true } : {}),
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
  const projectApp = projectAppById.get(content.appId);
  const projectedRecord = projectApp ? projectApp.publicRecord(sourceRecord) : sourceRecord;
  const record: Record<string, unknown> = {
    ...projectedRecord,
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
  return `player:${(await sha256Hex(JSON.stringify({
    ...state,
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

export function publicSearchAgentTimelineItems(events: readonly StoredSearchAgentEvent[], talkId: string) {
  return resolveSearchAgentEvents(events).map((item) => item.type === "message"
    ? {
        kind: "message" as const,
        seq: item.seq,
        id: item.id,
        talkId,
        sender: item.role === "user" ? "owner" as const : "other" as const,
        body: item.body,
        sentAt: item.sentAt,
        ...(item.quickReplies?.length ? { quickReplies: item.quickReplies } : {}),
        ...(typeof item.delayMs === "number" ? { delayMs: item.delayMs } : {}),
        ...(item.delayOnFirstDisplay ? { delayOnFirstDisplay: true } : {})
      }
    : {
        kind: "search_results" as const,
        seq: item.seq,
        id: item.id,
        talkId,
        sender: "other" as const,
        results: item.results,
        sentAt: item.sentAt
      });
}

function identifiedSegments(segments: readonly ScenarioMessageSegment[] | undefined, messageId: string) {
  return segments?.map((segment, segmentIndex) => segment.kind === "link" && "contentId" in segment
    ? { ...segment, linkId: `${messageId}:link:${segmentIndex + 1}` }
    : segment);
}

export function materializedTalkMessagesForEvents(talk: ScenarioDeviceTalk, events: readonly StoredTalkEvent[]) {
  const ordered = [...events].sort((left, right) => (
    left.delivered_at.localeCompare(right.delivered_at) || left.id.localeCompare(right.id)
  ));
  const initialSpans = initialTalkBlockSpans(talk);
  const initialMessageCount = initialSpans[initialSpans.length - 1]?.endSeq ?? 0;
  return resolveTalkEvents(ordered).map((message, index): StoredTalkMessage => ({
    seq: initialMessageCount + index + 1,
    id: message.id,
    talkId: talk.publicId,
    sender: message.sender,
    body: message.body,
    ...(talk.kind === "chat" ? { senderName: message.senderName } : {}),
    ...(message.avatarUrl ? { avatarUrl: message.avatarUrl } : {}),
    ...(message.segments ? { segments: identifiedSegments(message.segments, message.id) } : {}),
    ...(message.quickReplies?.length ? { quickReplies: message.quickReplies } : {}),
    ...(typeof message.delayMs === "number" ? { delayMs: message.delayMs } : {}),
    ...(message.delayOnFirstDisplay ? { delayOnFirstDisplay: true } : {}),
    attachment: message.attachment,
    sentAt: message.sentAt
  }));
}

export function visibleTalkMessagesForState(
  talk: ScenarioDeviceTalk,
  state: StoredPlayerState,
  events: readonly StoredTalkEvent[] = []
) {
  const initial = initialTalkMessagesForState(
    talk,
    state.talks[talk.id]?.initialFormatEnv ?? {},
    state.repairedContentIds
  ).visibleMessages;
  return [...initial, ...materializedTalkMessagesForEvents(talk, events)];
}

export async function publicPlayerState(
  state: StoredPlayerState,
  stateVersion: number,
  generatedAudio: PublicGeneratedAudioState[] = [],
  nextScenarioWakeAt: string | null = null,
  transcriptDeltas: readonly TranscriptAppend[] = []
) {
  const now = new Date().toISOString();
  const stateValues = effectiveStateValues(workerScenario.stateVariables, state.stateValues);
  const repairedContents = new Set(state.repairedContentIds);
  const unlockedContents = new Set(state.unlockedContentIds);
  const contentStates = unique([...state.repairedContentIds, ...state.unlockedContentIds]).flatMap((internalId) => {
    const content = workerScenario.contents.find((item) => item.id === internalId);
    const talk = workerScenario.talks.find((item): item is ScenarioDeviceTalk => item.id === internalId && isDeviceTalk(item));
    const definition = content ?? talk;
    if (!definition) return [];
    return [{
      contentId: definition.publicId,
      state: content && unlockedContents.has(internalId) ? "unlocked" : "repaired",
      appId: definition.appId,
      updatedAt: now
    }];
  });
  const visibleTalks = workerScenario.talks.filter((talk) => talkAvailable(talk, state));
  const listedTalks = workerScenario.talks.filter((talk): talk is ScenarioDeviceTalk => isDeviceTalk(talk) && (
    talkDefinitionAvailable(talk, state)
    && (talk.initialState !== "hidden" || talkRepaired(talk, state))
  ));
  const talks = visibleTalks.map((talk) => {
    const stored = state.talks[talk.id];
    return isSearchAgentTalk(talk)
      ? {
          talkId: talk.publicId,
          kind: "search_agent" as const,
          label: talk.label,
          canPost: talkCanPost(talk, state),
          turnKey: stored?.turnKey ?? "",
          transcriptKey: stored?.transcriptKey ?? "",
          lastMessageSeq: stored?.lastMessageSeq ?? 0,
          historyRevision: 0 as const,
          inputVisible: stored?.inputVisible ?? talk.inputVisible,
          inputVisibleAfterSeq: stored?.inputVisibleAfterSeq ?? 0,
          inputEnabled: stored?.inputEnabled ?? talk.inputEnabled,
          inputEnabledAfterSeq: stored?.inputEnabledAfterSeq ?? 0
        }
      : {
          talkId: talk.publicId,
          kind: talk.kind,
          canPost: talkCanPost(talk, state),
          turnKey: stored?.turnKey ?? "",
          transcriptKey: stored?.transcriptKey ?? "",
          lastMessageSeq: publicTalkLastMessageSeq(talk, state),
          historyRevision: talkHistoryRevision(talk, state),
          inputVisible: stored?.inputVisible ?? talk.inputVisible,
          inputVisibleAfterSeq: stored?.inputVisibleAfterSeq ?? 0,
          inputEnabled: stored?.inputEnabled ?? talk.inputEnabled,
          inputEnabledAfterSeq: stored?.inputEnabledAfterSeq ?? 0
        };
  });
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
    | { kind: "search_agent"; talkId: string; transcriptKey: string; messages: Array<Record<string, unknown>> }
    | { kind: "sms" | "chat"; talkId: string; transcriptKey: string; messages: StoredTalkMessage[] }
  > = [];
  for (const transcript of transcriptDeltas) {
    if (transcript.streamId === SEARCH_AGENT_STREAM_ID) {
      const talk = talkByInternalId(SEARCH_AGENT_TALK_ID);
      if (!talk || !isSearchAgentTalk(talk)) continue;
      publicTranscriptDeltas.push({
        kind: "search_agent",
        talkId: talk.publicId,
        transcriptKey: transcript.transcriptKey,
        messages: publicSearchAgentTimelineItems(
          transcript.messages.filter((message): message is StoredSearchAgentEvent => message.kind === "search_agent"),
          talk.publicId
        )
      });
      continue;
    }
    if (!transcript.streamId.startsWith("talk:")) continue;
    const talk = talkByInternalId(transcript.streamId.slice("talk:".length));
    if (!talk || !talkAvailable(talk, state)) continue;
    if (!isDeviceTalk(talk)) continue;
    const resolvedMessages = transcript.resolvedMessages
      ?? materializedTalkMessagesForEvents(
        talk,
        transcript.messages.filter((message): message is StoredTalkEvent => "event_type" in message)
      );
    publicTranscriptDeltas.push({
      kind: talk.kind,
      talkId: talk.publicId,
      transcriptKey: transcript.transcriptKey,
      messages: resolvedMessages.map(publicTalkMessage)
    });
  }
  const projectAppRecords = Object.fromEntries(workerScenario.projectAppIds.flatMap((appId) => {
    if (!workerScenario.apps.some((app) => app.id === appId)) return [];
    return [[appId, visibleContentRecords(appId, state)]];
  }));

  return {
    clientRevision: workerScenario.clientRevision,
    transcriptRevision: workerScenario.transcriptRevision,
    revision: await playerStateRevision(state),
    stateVersion,
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
      messages: listedTalks.filter((talk) => talk.kind === "sms").map((talk) => publicTalkThread(talk, state)),
      chatThreads: listedTalks.filter((talk) => talk.kind === "chat").map((talk) => publicTalkThread(talk, state)),
      ...(Object.keys(projectAppRecords).length ? { projectApps: projectAppRecords } : {}),
      ...(chatAuthGate ? { chatAuthGate } : {}),
      ...(visibleIncomingCallId(state)
        ? { incomingCall: publicIncomingCall(visibleIncomingCallId(state) ?? "") }
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

function termsMatch(terms: readonly (string | readonly string[])[], query: string) {
  const groups = terms.map((termOrGroup) => typeof termOrGroup === "string" ? [termOrGroup] : termOrGroup);
  return searchResponseTermsMatch(groups, query);
}

function contentTitle(content: ScenarioContent) {
  const record = content.record;
  const projectTitle = projectAppById.get(content.appId)?.searchTitle?.(record);
  if (projectTitle?.trim()) return projectTitle;
  for (const key of ["title", "subject", "programTitle", "name"]) {
    if (typeof record[key] === "string" && record[key].trim()) return record[key];
  }
  return content.id;
}

export function searchScenario(query: string, state: StoredPlayerState) {
  const value = normalizeQuery(query);
  if (!value) return [];
  const appResults = workerScenario.apps
    .filter((app) => app.search.length > 0 && conditionMet(app.cond, state) && termsMatch(app.search, value))
    .map((app) => ({
      contentId: app.id,
      appId: app.id,
      targetKind: "app" as const,
      title: app.label,
      repairable: app.initialState !== "normal" && !state.repairedAppIds.includes(app.id)
    }));
  const contentResults = workerScenario.contents
    .filter((content) => (
      conditionMet(content.cond, state)
      && content.search.length > 0
      && termsMatch(content.search, value)
      && talkHistoryRepairAvailable(state, content.id)
    ))
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
  const talkResults = workerScenario.talks
    .filter((talk): talk is ScenarioDeviceTalk => isDeviceTalk(talk)
      && talk.search.length > 0
      && conditionMet(talk.cond, state)
      && termsMatch(talk.search, value))
    .map((talk) => ({
      contentId: talk.publicId,
      appId: talk.appId,
      targetKind: "content" as const,
      title: talk.label,
      repairable: talk.initialState !== "normal" && !state.repairedContentIds.includes(talk.id)
    }));
  return [...appResults, ...contentResults, ...talkResults];
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
  const talk = talkByPublicId(publicContentId);
  if (talk && isDeviceTalk(talk) && talk.appId === appId && talk.initialState !== "normal") {
    return { kind: "talk" as const, internalId: talk.id, appId: talk.appId };
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
      && (!historyRepair || (talkAvailable(historyRepair.talk, state) && talkHistoryRepairAvailable(state, content.id)));
  }
  const talk = talkByPublicId(publicContentId);
  return Boolean(talk && isDeviceTalk(talk) && talk.appId === appId && talkDefinitionAvailable(talk, state));
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
