import { renderTemplate } from "../shared/condition.ts";
import { messageTemplateKeys, templateVariableNames } from "../shared/messageTemplateKeys.ts";
import type { ScenarioMessageAttachment, ScenarioMessageSegment } from "../shared/scenario.ts";
import { SEARCH_AGENT_TALK_ID } from "../shared/searchAgent.ts";
import type { StoredSearchAgentEvent, StoredSearchAgentMessageBlockEvent, StoredSearchAgentPlayerMessageEvent, StoredSearchAgentResultEvent, StoredSearchResult, StoredTalkEvent } from "../server/store.ts";
import type { ScenarioTalkBlockMessage } from "../shared/scenario.ts";
import { TALK_DISPLAY_TIME_KEY, talkDisplayTimeLabel } from "./talkDisplayClock.ts";
type TalkEventRow = StoredTalkEvent;
export type ResolvedTalkMessage = {
  kind: "sms" | "chat";
  id: string;
  talkId: string;
  sender: "owner" | "other";
  senderName: string | null;
  body: string;
  avatarUrl?: string;
  segments?: readonly ScenarioMessageSegment[];
  delayMs?: number;
  delayOnFirstDisplay?: boolean;
  attachment: ScenarioMessageAttachment | null;
  quickReplies?: readonly string[];
  sentAt: string;
  displayTime?: string;
};
export type ResolvedSearchAgentTimelineItem = {
  type: "message";
  seq: number;
  id: string;
  role: "user" | "assistant";
  body: string;
  segments?: readonly ScenarioMessageSegment[];
  delayMs?: number;
  delayOnFirstDisplay?: boolean;
  quickReplies?: readonly string[];
  sentAt: string;
} | {
  type: "search_result";
  seq: number;
  id: string;
  query: string;
  found: boolean;
  results: StoredSearchResult[];
  sentAt: string;
};
type TalkTemplates = {
  messageTemplatesForBlock(id: string): Array<ScenarioTalkBlockMessage & {
    senderName: string;
    senderRole: string;
    avatarUrl?: string;
    attachment: ScenarioMessageAttachment | null;
  }>;
  talkBlockIdForRepeatDisplay(id: string, count: number): string;
};
// 定義はこの実行単位に閉じ込め、別プレイヤーの処理と共有変更しない。
export function createTalkEventsRuntime(templates: TalkTemplates) {
  const { messageTemplatesForBlock, talkBlockIdForRepeatDisplay } = templates;
  function parseObject(value: string | null): Record<string, unknown> {
    if (!value) {
      return {};
    }
    try {
      const parsed = JSON.parse(value) as unknown;
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    }
    catch {
      return {};
    }
  }
  function parseStringRecord(value: string | null): Record<string, string> {
    return Object.fromEntries(Object.entries(parseObject(value)).filter((entry): entry is [
      string,
      string
    ] => typeof entry[1] === "string"));
  }
  function isoWithOffset(baseIso: string, offsetMs: number) {
    return new Date(Date.parse(baseIso) + offsetMs).toISOString();
  }
  function renderedQuickReplies(values: readonly string[] | undefined, env: Record<string, string>) {
    const seen = new Set<string>();
    return (values ?? []).flatMap((value) => {
      const rendered = renderTemplate(value, env).normalize("NFC").trim().slice(0, 500);
      if (!rendered || seen.has(rendered))
        return [];
      seen.add(rendered);
      return [rendered];
    });
  }
  function resolveTalkEvent(row: TalkEventRow, displayBlockId = row.block_id ?? ""): ResolvedTalkMessage[] {
    const displayTime = talkDisplayTimeLabel(parseObject(row.format_env_json)[TALK_DISPLAY_TIME_KEY]);
    if (row.event_type === "player_message") {
      return [
        {
          kind: row.kind,
          id: row.id,
          talkId: row.talk_id,
          sender: "owner",
          senderName: row.kind === "chat" ? "あなた" : null,
          body: row.body ?? "",
          attachment: null,
          sentAt: row.delivered_at,
          ...(displayTime ? { displayTime } : {})
        }
      ];
    }
    const formatEnv = parseStringRecord(row.format_env_json);
    return messageTemplatesForBlock(displayBlockId).map((template, index) => {
      const quickReplies = renderedQuickReplies(template.quickReplies, formatEnv);
      return {
        kind: row.kind,
        id: `${row.id}:${index + 1}`,
        talkId: row.talk_id,
        sender: template.senderRole === "owner" ? "owner" : "other",
        senderName: row.kind === "chat" ? template.senderName : null,
        body: renderTemplate(template.body, formatEnv),
        ...(template.avatarUrl ? { avatarUrl: template.avatarUrl } : {}),
        ...(template.segments
          ? {
            segments: template.segments.map((segment) => segment.kind === "text"
              ? { ...segment, text: renderTemplate(segment.text, formatEnv) }
              : segment)
          }
          : {}),
        ...(quickReplies.length ? { quickReplies } : {}),
        ...(typeof template.delayMs === "number" ? { delayMs: template.delayMs } : {}),
        ...(template.senderRole !== "owner" && typeof template.delayMs === "number" && template.delayMs > 0 ? { delayOnFirstDisplay: true } : {}),
        attachment: template.attachment ?? null,
        sentAt: isoWithOffset(row.delivered_at, index * 1000),
        ...(displayTime ? { displayTime } : {})
      };
    });
  }
  function resolveTalkEvents(rows: readonly TalkEventRow[]): ResolvedTalkMessage[] {
    const messageBlockDisplayCounts = new Map<string, number>();
    return rows.flatMap((row) => {
      if (row.event_type !== "message_block" || !row.block_id) {
        return resolveTalkEvent(row);
      }
      const displayCountKey = `${row.talk_id}\0${row.block_id}`;
      const previousDisplayCount = messageBlockDisplayCounts.get(displayCountKey) ?? 0;
      const displayBlockId = talkBlockIdForRepeatDisplay(row.block_id, previousDisplayCount);
      messageBlockDisplayCounts.set(displayCountKey, previousDisplayCount + 1);
      return resolveTalkEvent(row, displayBlockId);
    });
  }
  function formatEnvForMessageBlock(blockId: string, stateVars: Record<string, unknown>) {
    const keys = new Set<string>();
    for (const template of messageTemplatesForBlock(blockId)) {
      for (const key of messageTemplateKeys(template)) keys.add(key);
    }
    const formatEnv: Record<string, string> = {};
    for (const key of keys) {
      const value = stateVars[key];
      if (typeof value === "string") {
        formatEnv[key] = value;
      }
    }
    return Object.keys(formatEnv).length ? formatEnv : undefined;
  }
  function formatEnvForMessageBlockFromState(blockId: string, stateVars: Record<string, unknown>) {
    const stringStateValues = Object.fromEntries(Object.entries(stateVars)
      .filter((entry): entry is [
      string,
      string | number | boolean
    ] => (["string", "number", "boolean"].includes(typeof entry[1])))
      .map(([key, value]) => [key, String(value)]));
    return formatEnvForMessageBlock(blockId, stringStateValues);
  }
  function searchAgentMessageFormatEnv(displayBlockId: string, messageIndex: number, values: Record<string, unknown>) {
    const template = messageTemplatesForBlock(displayBlockId)[messageIndex];
    if (!template)
      return undefined;
    const keys = new Set(templateVariableNames(template.body));
    for (const quickReply of template.quickReplies ?? []) {
      for (const key of templateVariableNames(quickReply))
        keys.add(key);
    }
    const env = Object.fromEntries([...keys].flatMap((key) => {
      const value = values[key];
      return ["string", "number", "boolean"].includes(typeof value) ? [[key, String(value)]] : [];
    }));
    return Object.keys(env).length ? env : undefined;
  }
  function parsedSearchResults(value: string): StoredSearchResult[] {
    try {
      const parsed = JSON.parse(value) as unknown;
      return Array.isArray(parsed) ? parsed as StoredSearchResult[] : [];
    }
    catch {
      return [];
    }
  }
  function resolveSearchAgentEvent(event: StoredSearchAgentEvent): ResolvedSearchAgentTimelineItem | null {
    if (event.event_type === "player_message") {
      return {
        type: "message",
        seq: event.seq,
        id: event.id,
        role: "user",
        body: event.body,
        sentAt: event.delivered_at
      };
    }
    if (event.event_type === "search_result") {
      return {
        type: "search_result",
        seq: event.seq,
        id: event.id,
        query: event.query,
        found: event.found,
        results: parsedSearchResults(event.results_json),
        sentAt: event.delivered_at
      };
    }
    const template = messageTemplatesForBlock(event.display_block_id)[event.message_index];
    if (!template)
      return null;
    const env = parseStringRecord(event.format_env_json);
    const quickReplies = renderedQuickReplies(template.quickReplies, env);
    const segments = template.segments?.map((segment) => segment.kind === "text"
      ? { ...segment, text: renderTemplate(segment.text, env) }
      : segment);
    return {
      type: "message",
      seq: event.seq,
      id: event.id,
      role: template.senderRole === "owner" ? "user" : "assistant",
      body: renderTemplate(template.body, env),
      ...(segments ? { segments } : {}),
      ...(quickReplies.length ? { quickReplies } : {}),
      ...(typeof template.delayMs === "number" ? { delayMs: template.delayMs } : {}),
      ...(template.senderRole !== "owner" && typeof template.delayMs === "number" && template.delayMs > 0
        ? { delayOnFirstDisplay: true }
        : {}),
      sentAt: event.delivered_at
    };
  }
  function resolveSearchAgentEvents(events: readonly StoredSearchAgentEvent[]) {
    return [...events]
      .sort((left, right) => left.seq - right.seq)
      .flatMap((event) => {
      const resolved = resolveSearchAgentEvent(event);
      return resolved ? [resolved] : [];
    });
  }
  function searchAgentBlockEvents(input: {
    baseBlockId: string;
    displayBlockId: string;
    formatEnv: Record<string, unknown>;
    startSeq: number;
    baseSentAt: string;
    idPrefix: string;
  }) {
    const events: StoredSearchAgentMessageBlockEvent[] = [];
    let seq = input.startSeq;
    for (const [messageIndex] of messageTemplatesForBlock(input.displayBlockId).entries()) {
      seq += 1;
      const formatEnv = searchAgentMessageFormatEnv(input.displayBlockId, messageIndex, input.formatEnv);
      events.push({
        id: `${input.idPrefix}:${messageIndex + 1}`,
        kind: "search_agent",
        talk_id: SEARCH_AGENT_TALK_ID,
        event_type: "message_block",
        seq,
        base_block_id: input.baseBlockId,
        display_block_id: input.displayBlockId,
        message_index: messageIndex,
        format_env_json: formatEnv ? JSON.stringify(formatEnv) : null,
        delivered_at: isoWithOffset(input.baseSentAt, messageIndex * 1000)
      });
    }
    return { events, messages: resolveSearchAgentEvents(events), lastSeq: seq };
  }
  function searchAgentPlayerMessageEvent(input: {
    id: string;
    seq: number;
    body: string;
    deliveredAt: string;
  }): StoredSearchAgentPlayerMessageEvent {
    return {
      id: input.id,
      kind: "search_agent",
      talk_id: SEARCH_AGENT_TALK_ID,
      event_type: "player_message",
      seq: input.seq,
      body: input.body,
      delivered_at: input.deliveredAt
    };
  }
  function searchAgentResultEvent(input: {
    id: string;
    seq: number;
    query: string;
    results: readonly StoredSearchResult[];
    deliveredAt: string;
  }): StoredSearchAgentResultEvent {
    return {
      id: input.id,
      kind: "search_agent",
      talk_id: SEARCH_AGENT_TALK_ID,
      event_type: "search_result",
      seq: input.seq,
      query: input.query,
      found: input.results.length > 0,
      results_json: JSON.stringify(input.results),
      delivered_at: input.deliveredAt
    };
  }
  return {
    renderedQuickReplies,
    resolveTalkEvents,
    formatEnvForMessageBlockFromState,
    formatEnvForMessageBlock,
    resolveSingleTalkEvent: resolveTalkEvent,
    resolveSearchAgentEvent,
    resolveSearchAgentEvents,
    searchAgentBlockEvents,
    searchAgentPlayerMessageEvent,
    searchAgentResultEvent,
  };
}
