import { evaluateCondition } from "../../shared/condition.ts";
import { parseRegexCriteria } from "../../shared/conversation.ts";
import type { ScenarioTalk, TalkRule } from "../../shared/scenario.ts";
import type { AppStore, ReviewJudgmentFilter, ReviewJudgmentStatus } from "../../server/store.ts";
import type { LlmProviderEnv } from "../providers/structuredOutput.ts";
import { contentByInternalId, messageTemplatesForBlock, talkBlockIdForRepeatDisplay, workerScenario } from "../scenario.ts";
import { internalizeTalkCommand, semanticInputForTalkCommand, talkCommand } from "../services/talkCommand.ts";
import { resolveScenarioTalkRule } from "../services/talkResolver.ts";

type JudgmentStatus = ReviewJudgmentStatus;

type Judgment = {
  id: string;
  scope: string;
  sourceEventIds: string[];
  clusterId: string | null;
  talkId: string;
  fromId: string;
  actualRuleId: string | null;
  expectedRuleId: string | null;
  judgment: string;
  comment: string;
  newBranchNote: string;
  reviewerLabel: string;
  status: JudgmentStatus;
  createdAt: string;
  updatedAt: string;
};

type InputEvent = {
  id: string;
  ruleId: string;
  userInput: string;
  normalizedInput: string;
};

type TrialInput = {
  id: string;
  actualRuleId: string;
  userInput: string;
};

function nowIso() {
  return new Date().toISOString();
}

function talkFor(talkId: string) {
  return workerScenario.talks.find((talk) => talk.id === talkId) ?? null;
}

function rulesFor(talk: ScenarioTalk, fromId: string) {
  return talk.rules.filter((rule) => rule.from === "*" || rule.from === fromId).sort((left, right) => left.order - right.order);
}

function fromIdsFor(talk: ScenarioTalk) {
  return [...new Set(talk.rules.filter((rule) => rule.from !== "*").map((rule) => rule.from))];
}

function line(body: string, speaker: string, metadata: { attachment?: string; source?: string; updatedAt?: string } = {}) {
  return {
    speaker,
    body,
    attachment: metadata.attachment ?? "",
    source: metadata.source ?? "",
    updatedAt: metadata.updatedAt ?? ""
  };
}

function shortBlockLabel(blockId: string) {
  return blockId.includes("::") ? blockId.slice(blockId.indexOf("::") + 2) : blockId;
}

function blockPreviewMessages(blockId: string) {
  return messageTemplatesForBlock(blockId).map((message) => line(message.body, message.senderName, {
    attachment: message.attachment ? "[attachment]" : "",
    source: message.source,
    updatedAt: message.updatedAt
  }));
}

function lastBlockPreviewMessage(blockId: string) {
  const messages = blockPreviewMessages(blockId);
  return messages[messages.length - 1] ?? null;
}

function representativeIncomingByTalkAndFrom() {
  const incoming = new Map<string, string[]>();
  for (const talk of workerScenario.talks) {
    for (const fromId of fromIdsFor(talk)) {
      for (const rule of talk.rules.filter((item) => item.from === fromId)) {
        if (rule.mode || !rule.nextBlocks.length) continue;
        const nextFrom = rule.nextBlocks[rule.nextBlocks.length - 1] ?? "";
        const key = `${talk.id}\0${nextFrom}`;
        if (!incoming.has(key)) incoming.set(key, [...rule.nextBlocks.slice(0, -1), nextFrom]);
      }
    }
  }
  return incoming;
}

function incomingBlocks(talk: ScenarioTalk, fromId: string) {
  return representativeIncomingByTalkAndFrom().get(`${talk.id}\0${fromId}`)
    ?? (fromId === talk.initialFrom ? [...talk.startBlocks] : [fromId]);
}

function ruleLabel(rule: TalkRule) {
  if (rule.isDefault) return "default";
  return rule.intent || rule.id;
}

function transitionFor(rule: TalkRule) {
  if (rule.mode === "game_over") {
    return { kind: "game-over", label: "GAME OVER" };
  }
  const nextFrom = rule.nextBlocks[rule.nextBlocks.length - 1] ?? "";
  if (rule.mode === "stay" || nextFrom === rule.from) {
    return { kind: "stay", label: "→ 同じfromに留まる" };
  }
  return { kind: "next", nextFromId: nextFrom, label: shortBlockLabel(nextFrom) };
}

function stateVarDefinitionsById() {
  return new Map(Object.entries(workerScenario.stateVariableDefinitions));
}

function stripOuterConditionParens(input: string) {
  let value = input.trim();
  let changed = true;
  while (changed && value.startsWith("(") && value.endsWith(")")) {
    changed = false;
    let depth = 0;
    let quote = "";
    let enclosesAll = true;
    for (let index = 0; index < value.length; index += 1) {
      const char = value[index] ?? "";
      if (quote) {
        if (char === "\\" && index + 1 < value.length) {
          index += 1;
          continue;
        }
        if (char === quote) quote = "";
        continue;
      }
      if (char === "\"" || char === "'") {
        quote = char;
        continue;
      }
      if (char === "(") depth += 1;
      else if (char === ")") {
        depth -= 1;
        if (depth === 0 && index < value.length - 1) {
          enclosesAll = false;
          break;
        }
      }
    }
    if (enclosesAll) {
      value = value.slice(1, -1).trim();
      changed = true;
    }
  }
  return value;
}

function splitTopLevelCondition(input: string, operator: "&&" | "||") {
  const parts: string[] = [];
  let depth = 0;
  let quote = "";
  let start = 0;
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index] ?? "";
    if (quote) {
      if (char === "\\" && index + 1 < input.length) {
        index += 1;
        continue;
      }
      if (char === quote) quote = "";
      continue;
    }
    if (char === "\"" || char === "'") {
      quote = char;
      continue;
    }
    if (char === "(") {
      depth += 1;
      continue;
    }
    if (char === ")") {
      depth -= 1;
      continue;
    }
    if (depth === 0 && input.slice(index, index + operator.length) === operator) {
      parts.push(input.slice(start, index).trim());
      index += operator.length - 1;
      start = index + 1;
    }
  }
  parts.push(input.slice(start).trim());
  return parts.filter(Boolean);
}

function conditionLiteralValue(input: string) {
  const value = input.trim();
  if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
    return { kind: "literal" as const, value: value.slice(1, -1) };
  }
  if (value === "true" || value === "false") return { kind: "literal" as const, value: value === "true" };
  if (/^-?\d+$/u.test(value)) return { kind: "literal" as const, value: Number.parseInt(value, 10) };
  if (/^[a-zA-Z_][a-zA-Z0-9_:-]*$/u.test(value)) return { kind: "identifier" as const, id: value };
  return null;
}

function valueForStateDefinition(stateId: string, value: unknown) {
  const definition = stateVarDefinitionsById().get(stateId);
  if (!definition) return undefined;
  if (definition.type === "boolean") return typeof value === "boolean" ? value : undefined;
  if (definition.type === "integer") return typeof value === "number" && Number.isInteger(value) ? value : undefined;
  if (definition.type === "enum") {
    const stringValue = String(value);
    return definition.values?.includes(stringValue) ? stringValue : undefined;
  }
  return typeof value === "string" ? value : undefined;
}

function alternativeConditionValue(stateId: string, forbidden: unknown) {
  const definition = stateVarDefinitionsById().get(stateId);
  if (!definition) return undefined;
  if (definition.type === "boolean" && typeof forbidden === "boolean") return !forbidden;
  if (definition.type === "integer" && typeof forbidden === "number") return forbidden === 0 ? 1 : 0;
  if (definition.type === "enum") return definition.values?.find((value) => value !== String(forbidden));
  if (definition.type === "string") return forbidden === "" ? "x" : "";
  return undefined;
}

function setPresetStateValue(stateValues: Record<string, unknown>, changes: Record<string, unknown>, stateId: string, value: unknown) {
  const normalized = valueForStateDefinition(stateId, value);
  if (normalized === undefined) return;
  stateValues[stateId] = normalized;
  changes[stateId] = normalized;
}

function numericConditionValue(operator: string, literal: number, reversed: boolean) {
  const effective = reversed
    ? operator === ">" ? "<"
      : operator === ">=" ? "<="
        : operator === "<" ? ">"
          : operator === "<=" ? ">="
            : operator
    : operator;
  if (effective === ">") return literal + 1;
  if (effective === ">=") return literal;
  if (effective === "<") return literal - 1;
  if (effective === "<=") return literal;
  return undefined;
}

function applyConditionAtomPreset(atom: string, stateValues: Record<string, unknown>, changes: Record<string, unknown>) {
  const value = stripOuterConditionParens(atom);
  const notMatch = value.match(/^!\s*([a-zA-Z_][a-zA-Z0-9_:-]*)$/u);
  if (notMatch) {
    setPresetStateValue(stateValues, changes, notMatch[1] ?? "", false);
    return;
  }
  const bareMatch = value.match(/^([a-zA-Z_][a-zA-Z0-9_:-]*)$/u);
  if (bareMatch) {
    setPresetStateValue(stateValues, changes, bareMatch[1] ?? "", true);
    return;
  }
  const binaryMatch = value.match(/^(.+?)\s*(==|!=|>=|<=|>|<)\s*(.+)$/u);
  if (!binaryMatch) return;
  const [, leftRaw = "", operator = "", rightRaw = ""] = binaryMatch;
  const left = conditionLiteralValue(leftRaw);
  const right = conditionLiteralValue(rightRaw);
  if (!left || !right) return;
  const leftId = left.kind === "identifier" ? left.id : "";
  const rightId = right.kind === "identifier" ? right.id : "";
  if (operator === "==" && leftId && right.kind === "literal") {
    setPresetStateValue(stateValues, changes, leftId, right.value);
    return;
  }
  if (operator === "==" && rightId && left.kind === "literal") {
    setPresetStateValue(stateValues, changes, rightId, left.value);
    return;
  }
  if (operator === "!=" && leftId && right.kind === "literal") {
    setPresetStateValue(stateValues, changes, leftId, alternativeConditionValue(leftId, right.value));
    return;
  }
  if (operator === "!=" && rightId && left.kind === "literal") {
    setPresetStateValue(stateValues, changes, rightId, alternativeConditionValue(rightId, left.value));
    return;
  }
  if (leftId && right.kind === "literal" && typeof right.value === "number") {
    setPresetStateValue(stateValues, changes, leftId, numericConditionValue(operator, right.value, false));
    return;
  }
  if (rightId && left.kind === "literal" && typeof left.value === "number") {
    setPresetStateValue(stateValues, changes, rightId, numericConditionValue(operator, left.value, true));
  }
}

function applyConditionPresetExpression(expression: string, stateValues: Record<string, unknown>, changes: Record<string, unknown>) {
  const value = stripOuterConditionParens(expression);
  const orParts = splitTopLevelCondition(value, "||");
  if (orParts.length > 1) {
    applyConditionPresetExpression(orParts[0] ?? "", stateValues, changes);
    return;
  }
  const andParts = splitTopLevelCondition(value, "&&");
  if (andParts.length > 1) {
    for (const part of andParts) applyConditionPresetExpression(part, stateValues, changes);
    return;
  }
  applyConditionAtomPreset(value, stateValues, changes);
}

function talkBranchReviewStatePresetForCond(cond: string) {
  const stateValues: Record<string, unknown> = { ...workerScenario.stateVariables };
  const changes: Record<string, unknown> = {};
  const trimmed = cond.trim();
  if (trimmed) applyConditionPresetExpression(trimmed, stateValues, changes);
  const lines = Object.entries(changes).map(([key, value]) => `${key} = ${typeof value === "string" ? JSON.stringify(value) : String(value)}`);
  return { stateValues, lines, condSatisfied: evaluateCondition(cond, stateValues) };
}

function internalizeReviewTalkCommand(value: string) {
  const command = talkCommand(value);
  return command && contentByInternalId(command.contentId) ? value : internalizeTalkCommand(value);
}

async function loadJudgments(
  store: AppStore,
  filter: ReviewJudgmentFilter
) {
  return (await store.reviewJudgments(filter)).map((row): Judgment => ({ ...row }));
}

async function loadInputEvents(store: AppStore, talkId: string, fromId: string) {
  return await store.reviewInputEvents(talkId, fromId) satisfies InputEvent[];
}

async function loadTrialInputs(store: AppStore, talkId: string, fromId: string) {
  return await store.reviewTrialInputs(talkId, fromId) satisfies TrialInput[];
}

async function loadSavedClusters(store: AppStore, talkId: string, fromId: string) {
  return store.reviewClusters(talkId, fromId, workerScenario.revision);
}

function rawClustersFor(events: InputEvent[], ruleId: string) {
  const groups = new Map<string, InputEvent[]>();
  for (const event of events.filter((item) => item.ruleId === ruleId)) {
    const key = event.normalizedInput || event.userInput;
    groups.set(key, [...(groups.get(key) ?? []), event]);
  }
  return [...groups.entries()].map(([key, items]) => ({
    id: `raw:${ruleId}:${key}`,
    fit: "yellow",
    representativeInput: items[0]?.userInput ?? key,
    inputCount: items.length,
    sourceEventIds: items.map((item) => item.id),
    inputs: items.map((item) => ({ id: item.id, input: item.userInput }))
  }));
}

function parsedClusterInputs(raw: string, sourceIds: string[], currentInputs: Map<string, string>) {
  const savedInputs = new Map<string, string>();
  try {
    const value = JSON.parse(raw) as unknown;
    if (Array.isArray(value)) {
      value.forEach((item, index) => {
        if (typeof item === "string") {
          savedInputs.set(sourceIds[index] ?? `${index}`, item);
          return;
        }
        const record = item as { id?: unknown; input?: unknown };
        const id = typeof record?.id === "string" ? record.id : sourceIds[index] ?? `${index}`;
        savedInputs.set(id, typeof record?.input === "string" ? record.input : "");
      });
    }
  } catch {
    // 保存済み本文が壊れていても、代表入力を個別入力だったようには表示しない。
  }
  return sourceIds.map((id) => ({
    id,
    input: (currentInputs.get(id) ?? savedInputs.get(id)) || "（本文を確認できません）"
  }));
}

export async function talkBranchReviewFromItems(store: AppStore) {
  const judgments = await loadJudgments(store, { status: "open" });
  return workerScenario.talks.flatMap((talk) => fromIdsFor(talk).map((fromId) => {
    const lineMeta = incomingBlocks(talk, fromId).flatMap(blockPreviewMessages);
    const lastMessage = lineMeta[lineMeta.length - 1] ?? line("", talk.label);
    return {
      talkId: talk.id,
      fromId,
      label: `${talk.label} / ${shortBlockLabel(fromId)}`,
      lastMessage,
      lineMeta,
      hasComment: judgments.some((item) => item.talkId === talk.id && item.fromId === fromId)
    };
  }));
}

export async function talkBranchReviewFromDetail(store: AppStore, talkId: string, fromId: string) {
  const talk = talkFor(talkId);
  if (!talk || !fromIdsFor(talk).includes(fromId)) return null;
  const [events, trials, judgments, savedClusters] = await Promise.all([
    loadInputEvents(store, talkId, fromId),
    loadTrialInputs(store, talkId, fromId),
    loadJudgments(store, { talkId, fromId, status: "open" }),
    loadSavedClusters(store, talkId, fromId)
  ]);
  const incomingMessages = incomingBlocks(talk, fromId).flatMap(blockPreviewMessages);
  const currentInputs = new Map(events.map((event) => [event.id, event.userInput]));
  const branches = rulesFor(talk, fromId).map((rule) => {
    const regexCriteria = parseRegexCriteria(rule.criteria);
    const savedSourceIds = new Set<string>();
    const ruleSavedClusters = savedClusters.filter((cluster) => cluster.actualRuleId === rule.id).map((cluster) => {
      const sourceEventIds = cluster.sourceEventIds;
      sourceEventIds.forEach((id) => savedSourceIds.add(id));
      return {
        id: cluster.id,
        fit: cluster.fit,
        representativeInput: cluster.representativeInput,
        inputCount: cluster.inputCount,
        sourceEventIds,
        inputs: parsedClusterInputs(cluster.inputsJson, sourceEventIds, currentInputs)
      };
    });
    const unsavedEvents = events.filter((event) => event.ruleId === rule.id && !savedSourceIds.has(event.id));
    return {
      ruleId: rule.id,
      label: ruleLabel(rule),
      isDefault: rule.isDefault,
      isCommon: rule.from === "*",
      intent: rule.intent,
      notes: rule.notes,
      cond: rule.cond,
      match: rule.match,
      criteria: rule.isDefault
        ? "どの分岐条件にも一致しない入力"
        : regexCriteria.kind === "ready"
          ? `機械的な一致判定：${regexCriteria.regex}`
          : rule.criteria,
      stateUpdates: [...rule.set],
      mode: rule.mode || "normal",
      example: rule.example,
      fromLast: incomingMessages[incomingMessages.length - 1] ?? null,
      nextMessages: rule.nextBlocks.flatMap(blockPreviewMessages),
      repeatNextMessages: rule.nextBlocks.flatMap((blockId) => {
        const repeatBlockId = talkBlockIdForRepeatDisplay(blockId, 1);
        return repeatBlockId === blockId ? [] : blockPreviewMessages(repeatBlockId);
      }),
      transition: transitionFor(rule),
      inputCount: events.filter((event) => event.ruleId === rule.id).length,
      trialInputs: trials.filter((trial) => trial.actualRuleId === rule.id).map((trial) => ({ id: trial.id, input: trial.userInput })),
      clusters: [...ruleSavedClusters, ...rawClustersFor(unsavedEvents, rule.id)],
      judgments: judgments.filter((judgment) => judgment.actualRuleId === rule.id)
    };
  });
  return {
    talkId,
    fromId,
    context: `${talk.label}（${talk.kind === "sms" ? "メッセージ" : "チャット"}） / ${shortBlockLabel(fromId)}`,
    incomingMessages,
    branches,
    judgments
  };
}

export async function talkBranchReviewAnalysisInputs(store: AppStore, talkId: string, fromId: string) {
  const talk = talkFor(talkId);
  if (!talk || !fromIdsFor(talk).includes(fromId)) return null;
  return {
    scenarioRevision: workerScenario.revision,
    talkId,
    fromId,
    events: await loadInputEvents(store, talkId, fromId)
  };
}

export async function replaceTalkBranchReviewClusters(store: AppStore, input: {
  talkId: string;
  fromId: string;
  actualRuleId: string;
  scenarioRevision: string;
  analysisVersion: string;
  clusters: Array<{
    id: string;
    fit: "blue" | "yellow" | "red";
    representativeInput: string;
    sourceEventIds: string[];
    reason: string;
  }>;
}) {
  const talk = talkFor(input.talkId);
  const rule = talk ? rulesFor(talk, input.fromId).find((item) => item.id === input.actualRuleId) : null;
  if (!talk || !fromIdsFor(talk).includes(input.fromId) || !rule) {
    return { ok: false as const, error: "not_found" };
  }
  if (input.scenarioRevision !== workerScenario.revision) {
    return { ok: false as const, error: "revision_conflict" };
  }
  const events = await loadInputEvents(store, input.talkId, input.fromId);
  const allowedIds = new Set(events.filter((event) => event.ruleId === input.actualRuleId).map((event) => event.id));
  const assignedIds = new Set<string>();
  for (const cluster of input.clusters) {
    if (!cluster.sourceEventIds.length) return { ok: false as const, error: "invalid_source" };
    for (const id of cluster.sourceEventIds) {
      if (!allowedIds.has(id) || assignedIds.has(id)) return { ok: false as const, error: "invalid_source" };
      assignedIds.add(id);
    }
  }
  await store.replaceReviewClusters(
    input.talkId,
    input.fromId,
    input.actualRuleId,
    input.scenarioRevision,
    input.clusters.map((cluster) => ({
      id: cluster.id,
      fit: cluster.fit,
      representativeInput: cluster.representativeInput,
      sourceEventIds: cluster.sourceEventIds,
      summaryJson: JSON.stringify({ reason: cluster.reason }),
      analysisVersion: input.analysisVersion
    }))
  );
  return { ok: true as const };
}

export async function simulateTalkBranchReviewSelection(
  env: LlmProviderEnv,
  store: AppStore,
  input: { talkId: string; fromId: string; targetRuleId: string; message: string }
) {
  const talk = talkFor(input.talkId);
  const targetRule = talk ? rulesFor(talk, input.fromId).find((rule) => rule.id === input.targetRuleId) : null;
  if (!talk || !targetRule) return { ok: false as const, error: "not_found", status: 404 as const };
  const preset = talkBranchReviewStatePresetForCond(targetRule.cond);
  const playerInput = internalizeReviewTalkCommand(input.message);
  const selected = await resolveScenarioTalkRule({
    env,
    llmEnabled: workerScenario.features.llm,
    talk,
    from: input.fromId,
    playerInput,
    semanticPlayerInput: semanticInputForTalkCommand(playerInput),
    stateValues: preset.stateValues
  });
  if (!selected.ok) return { ok: false as const, error: selected.error, status: 503 as const };
  const selectedRule = selected.rule;
  const now = nowIso();
  const id = crypto.randomUUID();
  const nextFromId = selectedRule.mode === "stay" || selectedRule.mode === "game_over"
    ? input.fromId
    : selectedRule.nextBlocks[selectedRule.nextBlocks.length - 1] ?? input.fromId;
  const response = selectedRule.nextBlocks.flatMap(blockPreviewMessages).map((message) => message.body).join("\n");
  await store.saveReviewTrialInput({
    id,
    talkId: input.talkId,
    fromId: input.fromId,
    actualRuleId: selectedRule.id,
    userInput: input.message,
    nextFromId,
    responseSnapshot: {
      response,
      selectionSource: selected.source,
      match: selected.matchGroups
    },
    createdAt: now
  });
  return {
    ok: true as const,
    result: {
      selectedRuleId: selectedRule.id,
      label: ruleLabel(selectedRule),
      intent: selectedRule.intent,
      isDefault: selectedRule.isDefault,
      isCommon: selectedRule.from === "*",
      mode: selectedRule.mode || "normal",
      nextFromId,
      match: selected.matchGroups,
      targetCondSatisfied: preset.condSatisfied,
      condPreset: preset.lines,
      event: { id, input: input.message }
    }
  };
}

export async function saveJudgment(store: AppStore, input: {
  scope: string;
  sourceEventIds: string[];
  clusterId: string | null;
  talkId: string;
  fromId: string;
  actualRuleId: string | null;
  expectedRuleId: string | null;
  judgment: string;
  comment: string;
  newBranchNote: string;
  reviewerLabel: string;
}) {
  const id = crypto.randomUUID();
  const now = nowIso();
  await store.saveReviewJudgment({
    id,
    ...input,
    scenarioRevision: workerScenario.revision,
    status: "open",
    createdAt: now,
    updatedAt: now
  });
  return id;
}

export async function updateJudgment(store: AppStore, talkId: string, fromId: string, id: string, input: {
  comment: string;
  newBranchNote: string;
  reviewerLabel: string;
}) {
  await store.updateReviewJudgment(talkId, fromId, id, { ...input, updatedAt: nowIso() });
}

export async function dismissJudgment(store: AppStore, talkId: string, fromId: string, id: string) {
  await store.updateReviewJudgmentStatus(talkId, fromId, id, "dismissed", nowIso());
}

export async function updateJudgmentStatus(store: AppStore, talkId: string, fromId: string, id: string, status: JudgmentStatus) {
  await store.updateReviewJudgmentStatus(talkId, fromId, id, status, nowIso());
}

export async function deleteTrialInputs(store: AppStore, talkId: string, fromId: string, ids: string[]) {
  const deletedIds: string[] = [];
  for (const id of ids) {
    if (await store.deleteReviewTrialInput(talkId, fromId, id, nowIso())) deletedIds.push(id);
  }
  if (deletedIds.length) {
    const judgments = await loadJudgments(store, { talkId, fromId, status: "open" });
    const deleted = new Set(deletedIds);
    for (const judgment of judgments) {
      const remaining = judgment.sourceEventIds.filter((id) => !deleted.has(id));
      if (remaining.length === judgment.sourceEventIds.length) continue;
      if (remaining.length) {
        await store.updateReviewJudgmentSourceIds(judgment.talkId, judgment.fromId, judgment.id, remaining, nowIso());
      } else {
        await dismissJudgment(store, judgment.talkId, judgment.fromId, judgment.id);
      }
    }
  }
  return { deleted: deletedIds.length, deletedIds };
}

export async function talkBranchReviewReport(store: AppStore, status: JudgmentStatus = "open") {
  const judgments = await loadJudgments(store, { status });
  const groups = [...new Map(judgments.map((item) => [
    `${item.talkId}\0${item.fromId}`,
    { talkId: item.talkId, fromId: item.fromId }
  ])).values()];
  const sourceRows = (await Promise.all(groups.map(async ({ talkId, fromId }) => {
    const [events, trials] = await Promise.all([
      loadInputEvents(store, talkId, fromId),
      loadTrialInputs(store, talkId, fromId)
    ]);
    return [...events, ...trials].map((row) => ({ id: row.id, userInput: row.userInput }));
  }))).flat();
  const sourceInputById = new Map(sourceRows.map((row) => [row.id, row.userInput]));
  return {
    generatedAt: nowIso(),
    scenarioRevision: workerScenario.revision,
    status,
    items: judgments.map((item) => ({
      ...item,
      fromLabel: `${talkFor(item.talkId)?.label ?? item.talkId} / ${item.fromId}`,
      actualRuleLabel: item.actualRuleId
        ? ruleLabel(talkFor(item.talkId)?.rules.find((rule) => rule.id === item.actualRuleId) ?? ({ id: item.actualRuleId, isDefault: false, intent: item.actualRuleId } as TalkRule))
        : "",
      expectedRuleLabel: item.expectedRuleId
        ? ruleLabel(talkFor(item.talkId)?.rules.find((rule) => rule.id === item.expectedRuleId) ?? ({ id: item.expectedRuleId, isDefault: false, intent: item.expectedRuleId } as TalkRule))
        : "",
      sourceInputs: item.sourceEventIds.map((id) => ({ id, input: sourceInputById.get(id) ?? "" }))
    }))
  };
}

export function talkBranchReviewReportMarkdown(report: Awaited<ReturnType<typeof talkBranchReviewReport>>) {
  const lines = [
    "# 会話分岐レビュー結果レポート",
    "",
    `- 作成日時: ${report.generatedAt}`,
    `- シナリオリビジョン: ${report.scenarioRevision}`,
    `- 対象ステータス: ${report.status}`,
    `- 指示数: ${report.items.length}`,
    ""
  ];
  for (const item of report.items) {
    lines.push(
      `## ${item.fromLabel}`,
      "",
      `- 指示ID: ${item.id}`,
      `- 対象範囲: ${item.scope}`,
      `- 指示種別: ${item.judgment}`,
      `- 現在の分岐: ${item.actualRuleLabel || "-"}`,
      `- 期待する分岐: ${item.expectedRuleLabel || "-"}`,
      `- コメント者: ${item.reviewerLabel || "-"}`,
      "",
      item.sourceInputs.length ? `### 根拠入力\n${item.sourceInputs.map((source) => `- ${source.input || source.id}`).join("\n")}\n` : "",
      item.newBranchNote ? `### 新規分岐メモ\n${item.newBranchNote}\n` : "",
      item.comment && item.comment.trim() !== item.newBranchNote.trim() ? `### コメント\n${item.comment}\n` : ""
    );
  }
  return `${lines.filter((line) => line !== "").join("\n").replace(/\n+$/u, "")}\n`;
}

export function cleanId(value: unknown, maxLength = 160) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

export function cleanMessage(value: unknown, maxLength = 500) {
  return typeof value === "string" ? value.normalize("NFC").trim().slice(0, maxLength) : "";
}

export function cleanStringArray(value: unknown, maxItems = 200) {
  return Array.isArray(value)
    ? value.map((item) => cleanId(item)).filter(Boolean).slice(0, maxItems)
    : [];
}
