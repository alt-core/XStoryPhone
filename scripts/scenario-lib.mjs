import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { evaluateCondition, validateConditionExpression, validateStateAssignments } from "../src/shared/condition.ts";
import { parseTalkMatchSpec } from "../src/shared/talkMatch.ts";
import { answerCandidates, parseMatchCriteria, parseTalkExtraction } from "../src/shared/talkCriteria.ts";
import { parseStoryDate } from "../src/shared/storyDate.ts";
import { APP_REGISTRY } from "../src/shared/appRegistry.ts";
import { MAX_SEARCH_AGENT_QUERY_LENGTH, SEARCH_AGENT_TALK_ID, SEARCH_OUTPUT_STATE_DEFINITIONS as searchOutputStateDefinitions } from "../src/shared/searchAgent.ts";
import {
  CORE_SCENARIO_HOOK_EVENTS,
  coreScenarioHookEventMetadata
} from "../src/shared/scenarioHookEvents.ts";
import { projectApps } from "../src/project/apps.ts";
import { parseTalkFlowRegexCriteria } from "../src/worker/product/talkFlowLlmSelection.ts";
import { collectScopedTalkBlocks, isRepeatTalkBlockId, resolveScopedTalkBlockId } from "./lib/talk-blocks.mjs";
import {
  outputStepNextFromKey,
  parseTalkOutputSteps
} from "./lib/talk-output-steps.mjs";
import { collectClientImportGraph } from "./lib/client-import-graph.mjs";
import { clientRevisionFor, transcriptRevisionFor } from "./lib/scenario-revisions.mjs";
import { activeRows } from "./lib/tsv-utils.mjs";
import { loadScenarioAuthoring } from "./lib/scenario-authoring.mjs";
import { resolveMediaRecord, usesStandardMedia } from "../src/shared/scenarioMedia.ts";
import { assignRuleIds } from "./lib/rule-ids.mjs";
import { talkFlowRows } from "./lib/talk-flow-rows.mjs";
import { validateScenarioParts } from "./lib/scenario-parts.mjs";
import { buildScenarioHooksModule, validateHookReferences } from "./lib/scenario-hooks.mjs";
import { normalizeRadioCues } from "./lib/radio-cues.mjs";
import { selectedScenarioDir } from "./lib/scenario-directory.mjs";

const rootDir = process.cwd();
const engineRootDir = path.resolve(import.meta.dirname, "..");
const scenarioDir = selectedScenarioDir(rootDir);
const idPattern = /^[a-z][a-z0-9_-]*$/u;
const engineAppIds = new Set(APP_REGISTRY.map((app) => app.id));
const projectAppById = new Map(projectApps.map((app) => [app.id, app]));
const supportedAppIds = new Set([...engineAppIds, ...projectAppById.keys()]);
const initialStates = new Set(["normal", "repairable", "hidden"]);
const systemStateVariableIds = new Set(["os_date", "os_time_label"]);
const MAX_TALK_INPUT_LENGTH = 500;
const reservedStateVariableIds = new Set([
  ...systemStateVariableIds,
  "player_input",
  ...Object.keys(searchOutputStateDefinitions)
]);
function validateObjectKeys(label, value, allowed, errors) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) errors.push(`${label}: 未知のkeyです: ${key}`);
  }
}

function validateTextLength(label, value, maxLength, errors) {
  if (typeof value === "string" && value.length > maxLength) {
    errors.push(`${label} は${maxLength}文字以内にしてください。`);
  }
}

function validateUniqueItems(label, items, errors) {
  const seen = new Set();
  for (const item of items) {
    const id = String(item?.id ?? "");
    if (!idPattern.test(id)) errors.push(`${label} id が不正です: ${id}`);
    else if (seen.has(id)) errors.push(`${label} id が重複しています: ${id}`);
    seen.add(id);
  }
}

function sourceSnapshot(files) {
  return files.map((file) => {
    const target = path.join(engineRootDir, file);
    return [file, fs.readFileSync(target, "utf8")];
  });
}

function clientSourceSnapshot(executionMode) {
  const graph = collectClientImportGraph(engineRootDir, undefined, { executionMode });
  return graph.files
    .map((file) => path.relative(engineRootDir, file))
    .filter((file) => !file.startsWith("src/client/generated/") && !file.startsWith("src/generated/"))
    .map((file) => [file, fs.readFileSync(path.join(engineRootDir, file), "utf8")]);
}

function stateVariableConfigurationFor(source, errors = []) {
  const values = {};
  const definitions = {};
  for (const [id, raw] of Object.entries(source.stateVariables ?? {})) {
    if (!idPattern.test(id)) {
      errors.push(`stateVariablesのIDが不正です: ${id}`);
      continue;
    }
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      const type = raw.type;
      const initial = raw.initial;
      if (!new Set(["boolean", "enum", "integer", "string"]).has(type)) {
        errors.push(`stateVariables.${id}.type が不正です。`);
        continue;
      }
      const valuesList = Array.isArray(raw.values) ? raw.values : [];
      const initialValid = type === "boolean" ? typeof initial === "boolean"
        : type === "integer" ? Number.isSafeInteger(initial)
          : typeof initial === "string";
      if (!initialValid) errors.push(`stateVariables.${id}.initial が${type}型ではありません。`);
      if (type === "enum") {
        if (!valuesList.length || valuesList.some((value) => typeof value !== "string" || !value.trim())) {
          errors.push(`stateVariables.${id}.values は空でない文字列の配列にしてください。`);
        } else if (new Set(valuesList).size !== valuesList.length) {
          errors.push(`stateVariables.${id}.values が重複しています。`);
        } else if (typeof initial === "string" && !valuesList.includes(initial)) {
          errors.push(`stateVariables.${id}.initial がvaluesにありません。`);
        }
      } else if (raw.values !== undefined) {
        errors.push(`stateVariables.${id}.values はenumの場合だけ指定してください。`);
      }
      values[id] = initial;
      definitions[id] = { type, ...(type === "enum" ? { values: valuesList } : {}) };
      continue;
    }
    const type = typeof raw === "boolean" ? "boolean"
      : typeof raw === "string" ? "string"
        : Number.isSafeInteger(raw) ? "integer" : null;
    if (!type) {
      errors.push(`stateVariables.${id} はboolean、整数、文字列、または型定義objectにしてください。`);
      continue;
    }
    values[id] = raw;
    definitions[id] = { type };
  }
  values.os_date = source.project?.date ?? "";
  values.os_time_label = source.project?.timeLabel ?? "";
  definitions.os_date = { type: "string" };
  definitions.os_time_label = { type: "string" };
  return { values, definitions };
}

function stateVariablesFor(source) {
  return stateVariableConfigurationFor(source).values;
}

function splitList(value) {
  return String(value ?? "").split(/\r?\n|;/u).map((item) => item.trim()).filter(Boolean);
}

function quickRepliesFromCell(value, label, errors) {
  const source = String(value ?? "");
  if (!source) return [];
  const replies = source.split(/\r?\n/u).map((item) => item.trim().normalize("NFC"));
  if (replies.some((item) => !item)) {
    errors.push(`${label}: quick_replies に空の選択肢を含められません。`);
  }
  const seen = new Set();
  for (const reply of replies) {
    if (seen.has(reply)) errors.push(`${label}: quick_replies が重複しています: ${reply}`);
    seen.add(reply);
    validateTextLength(`${label}: quick_replies`, reply, MAX_TALK_INPUT_LENGTH, errors);
    validateTemplateSyntax(`${label}: quick_replies`, reply, errors);
  }
  return replies.filter(Boolean);
}

function normalizeSearchTerms(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => Array.isArray(item)
    ? item.map((term) => String(term).trim())
    : String(item).trim());
}

function validateSearchTerms(label, value, errors, required = true) {
  if (!Array.isArray(value) || (required && value.length === 0)) {
    errors.push(`${label}: search ${required ? "が必要" : "は配列に"}です。`);
    return;
  }
  if (value.some((item) => (
    (typeof item === "string" && !item.trim())
    || (typeof item !== "string" && (
      !Array.isArray(item)
      || item.length === 0
      || item.some((term) => typeof term !== "string" || !term.trim())
    ))
  ))) {
    errors.push(`${label}: search は文字列、またはAND条件にする文字列配列の配列にしてください。`);
  }
}

function parseMessageLinkTarget(value) {
  const target = String(value ?? "").trim();
  if (/^https:\/\//iu.test(target)) {
    try {
      return new URL(target).protocol === "https:" ? { externalUrl: target } : null;
    } catch {
      return null;
    }
  }
  const parts = target.split(";").map((item) => item.trim()).filter(Boolean);
  const open = parts.find((item) => item.startsWith("open:"));
  const action = parts.find((item) => item.startsWith("action:"));
  const match = /^open:([a-zA-Z0-9_:-]+):([a-zA-Z0-9_:-]+)$/u.exec(open ?? "");
  if (!match) return null;
  return {
    appId: match[1],
    contentId: match[2],
    ...(action ? { actionId: action.slice("action:".length) } : {})
  };
}

function messageBody(value, onInvalidLink = () => {}) {
  const body = String(value ?? "");
  const segments = [];
  const linkPattern = /\[([^\]\n]+)\]\(([^)\n]+)\)/gu;
  let cursor = 0;
  let hasLink = false;
  for (const match of body.matchAll(linkPattern)) {
    const index = match.index ?? 0;
    if (index > cursor) segments.push({ kind: "text", text: body.slice(cursor, index) });
    const target = parseMessageLinkTarget(match[2]);
    if (target) {
      hasLink = true;
      segments.push({ kind: "link", text: match[1], ...target });
    } else {
      onInvalidLink(match[2]);
      segments.push({ kind: "text", text: match[0] });
    }
    cursor = index + match[0].length;
  }
  if (cursor < body.length) segments.push({ kind: "text", text: body.slice(cursor) });
  return hasLink ? { body: segments.map((segment) => segment.text).join(""), segments } : { body };
}

function templateReferences(value) {
  const source = String(value ?? "");
  const keys = [];
  const errors = [];
  let cursor = 0;
  while (cursor < source.length) {
    const start = source.indexOf("{{", cursor);
    if (start < 0) break;
    const end = source.indexOf("}}", start + 2);
    if (end < 0) {
      errors.push("閉じる }} がありません。");
      break;
    }
    const key = source.slice(start + 2, end);
    if (!/^[a-zA-Z0-9_]+$/u.test(key)) {
      errors.push(`placeholderの識別子が不正です: {{${key}}}`);
    } else {
      keys.push(key);
    }
    cursor = end + 2;
  }
  return { keys, errors };
}

function templateKeys(value) {
  return templateReferences(value).keys;
}

function validateTemplateSyntax(label, value, errors) {
  for (const error of templateReferences(value).errors) {
    errors.push(`${label}: template構文が不正です: ${error}`);
  }
}

function blockTemplateKeys(block) {
  return [...new Set((block?.messages ?? []).flatMap((message) => [
    ...templateKeys(message.body),
    ...(message.segments ?? []).flatMap((segment) => segment.kind === "text" ? templateKeys(segment.text) : []),
    ...(message.quickReplies ?? []).flatMap(templateKeys)
  ]))];
}

function stableId(namespace, value) {
  return `${namespace}_${createHash("sha256").update(`xstoryphone:v2\0${namespace}\0${value}`).digest("hex").slice(0, 12)}`;
}

function splitAssignments(value) {
  return String(value ?? "").split(";").map((item) => item.trim()).filter(Boolean);
}

function validateTalkInputOutputShape(label, steps, errors) {
  const inputSteps = steps.flatMap((step, index) => step.kind === "input" ? [{ action: step.action, index }] : []);
  const firstContentIndex = steps.findIndex((step) => step.kind !== "input");
  const lastContentIndex = steps.findLastIndex((step) => step.kind !== "input");
  for (const action of ["show", "hide", "enable", "disable"]) {
    if (inputSteps.filter((step) => step.action === action).length > 1) {
      errors.push(`${label}: /input ${action} は一つのstep列に1件までです。`);
    }
  }
  for (const action of ["hide", "disable"]) {
    const step = inputSteps.find((item) => item.action === action);
    if (step && firstContentIndex >= 0 && step.index > firstContentIndex) {
      errors.push(`${label}: /input ${action} は表示stepより前に置いてください。`);
    }
  }
  for (const action of ["show", "enable"]) {
    const step = inputSteps.find((item) => item.action === action);
    if (step && lastContentIndex >= 0 && step.index < lastContentIndex) {
      errors.push(`${label}: /input ${action} は表示stepより後に置いてください。`);
    }
  }
  for (const [offAction, onAction] of [["hide", "show"], ["disable", "enable"]]) {
    const off = inputSteps.find((step) => step.action === offAction);
    const on = inputSteps.find((step) => step.action === onAction);
    if (off && on && off.index > on.index) {
      errors.push(`${label}: /input ${onAction} の後に ${offAction} は置けません。`);
    } else if (off && on && !steps.slice(off.index + 1, on.index).some((step) => step.kind !== "input")) {
      errors.push(`${label}: /input ${offAction} と ${onAction} の間には表示stepを置いてください。`);
    }
  }
}

function validateSearchAgentOutputShape(label, steps, errors) {
  const searches = steps.filter((step) => step.kind === "search");
  if (searches.length > 1) errors.push(`${label}: /search は一つのnextのstep列に1件までです。`);
}

function validateCondition(label, value, stateVariableDefinitions, errors) {
  if (value === undefined) return;
  if (typeof value !== "string") {
    errors.push(`${label}: cond は文字列にしてください。`);
    return;
  }
  for (const error of validateConditionExpression(value, new Map(Object.entries(stateVariableDefinitions)))) {
    errors.push(`${label}: cond が不正です: ${error}`);
  }
}

function validateProject(project, playerMode, errors) {
  if (!["real", "scenario"].includes(project?.talkClock)) errors.push("project.talkClock はreal/scenarioにしてください。");
  if (typeof project?.repairParentApp !== "boolean") errors.push("project.repairParentApp はbooleanにしてください。");
  if (!["none", "required"].includes(project?.accessCode)) errors.push("project.accessCode はnone/requiredにしてください。");
  if (project?.accessCode === "required" && playerMode !== "browser") errors.push("player.access_code=required はbrowserモード専用です。serverはACCESS_CODE_SECRETを使い、staticでは入場認証を提供しません。");
  const requiredStrings = ["id", "name", "osName", "assistantName", "accentColor", "date", "timeLabel", "signalLabel", "wallpaperUrl"];
  for (const key of requiredStrings) {
    if (typeof project?.[key] !== "string" || !project[key].trim()) {
      errors.push(`project.${key} は空でない文字列にしてください。`);
    }
    validateTextLength(`project.${key}`, project?.[key], 1_200, errors);
  }
  if (typeof project?.id === "string" && project.id !== project.id.trim()) {
    errors.push("project.id の前後に空白を含めないでください。保存先が変わるため、自動では除去しません。");
  }
  if (!Number.isInteger(project?.batteryLevel) || project.batteryLevel < 0 || project.batteryLevel > 100) {
    errors.push("project.batteryLevel は0から100の整数にしてください。");
  }
  if (typeof project?.date === "string" && !parseStoryDate(project.date)) {
    errors.push("project.date は YYYY-MM-DD 形式の実在する日付にしてください。");
  }
  const lockScreen = project?.lockScreen;
  if (!lockScreen || typeof lockScreen !== "object" || Array.isArray(lockScreen)) {
    errors.push("project.lockScreen はobjectにしてください。");
    return;
  }
  validateObjectKeys("project.lockScreen", lockScreen, ["method", "pin", "loadParts"], errors);
  if (!new Set(["player-passcode", "fixed-pin", "none"]).has(lockScreen.method)) {
    errors.push("project.lockScreen.method は player-passcode、fixed-pin、none のいずれかにしてください。");
  } else if (lockScreen.method === "player-passcode" && playerMode !== "server") {
    errors.push("browser/staticモードでは project.lockScreen.method に player-passcode を指定できません。");
  }
  if (lockScreen.method === "fixed-pin") {
    if (typeof lockScreen.pin !== "string" || !/^\d{4,8}$/u.test(lockScreen.pin)) {
      errors.push("project.lockScreen.pin は4桁から8桁の数字文字列にしてください。");
    }
  } else if (lockScreen.pin !== undefined) {
    errors.push("project.lockScreen.pin は fixed-pin の場合だけ指定してください。");
  }
}

function validateCallTranscript(label, value, errors) {
  if (value === undefined) return;
  if (!Array.isArray(value) || !value.length) {
    errors.push(`${label} は1件以上の配列にしてください。`);
    return;
  }
  let previousAtMs = -1;
  for (const [index, cue] of value.entries()) {
    if (!cue || typeof cue !== "object" || Array.isArray(cue)
      || !Number.isInteger(cue.atMs) || cue.atMs < 0
      || typeof cue.text !== "string" || !cue.text.trim()) {
      errors.push(`${label}[${index}] は0以上の整数atMsと空でないtextを持つobjectにしてください。`);
      continue;
    }
    if (cue.atMs < previousAtMs) {
      errors.push(`${label} はatMsの昇順にしてください。`);
      break;
    }
    validateTextLength(`${label}[${index}].text`, cue.text, 600, errors);
    previousAtMs = cue.atMs;
  }
}

function cueAtMs(value) {
  try { return normalizeRadioCues({ __rowNumber: "record", cues: JSON.stringify({ cue: value }) })[0].atMs; }
  catch { return null; }
}

function isRootRelativeUrl(value) {
  return typeof value === "string" && /^\/(?!\/)[^\s]*$/u.test(value);
}

function validateRecord(content, errors) {
  const record = content?.record;
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    errors.push(`${content?.id ?? "content"}: record はobjectにしてください。`);
    return;
  }
  const requiredByApp = {
    phone: ["name", "kind", "at", "durationLabel"],
    notes: ["title", "body"],
    mail: ["from", "to", "subject", "date", "body"],
    photos: ["title"],
    calendar: ["title", "date", "time", "place", "memo"],
    radio: ["programTitle"],
    browser: ["title", "url"]
  };
  for (const key of requiredByApp[content.appId] ?? []) {
    if (typeof record[key] !== "string") {
      errors.push(`${content.id}: record.${key} は文字列にしてください。`);
    }
  }
  if (content.appId === "mail" && record.cc !== undefined && typeof record.cc !== "string") {
    errors.push(`${content.id}: record.cc は文字列にしてください。`);
  }
  if (content.appId === "mail") {
    for (const key of ["from", "to", "cc"]) validateTextLength(`${content.id}: record.${key}`, record[key], 80, errors);
    validateTextLength(`${content.id}: record.subject`, record.subject, 200, errors);
    validateTextLength(`${content.id}: record.body`, record.body, 4_000, errors);
  }
  if (content.appId === "notes") validateTextLength(`${content.id}: record.body`, record.body, 4_000, errors);
  if (content.appId === "browser") validateTextLength(`${content.id}: record.title`, record.title, 200, errors);
  if (["notes", "photos"].includes(content.appId) && record.tags !== undefined) {
    if (!Array.isArray(record.tags) || record.tags.some((tag) => typeof tag !== "string" || !tag.trim())) {
      errors.push(`${content.id}: record.tags は文字列の配列にし、空文字を含めないでください。`);
    }
    for (const [index, tag] of (Array.isArray(record.tags) ? record.tags : []).entries()) {
      validateTextLength(`${content.id}: record.tags[${index}]`, tag, 80, errors);
    }
  }
  if (content.appId === "photos" && record.mediaKind !== undefined) {
    if (!new Set(["still_video", "video"]).has(record.mediaKind)) {
      errors.push(`${content.id}: record.mediaKind は still_video または video にしてください。`);
    }
    if (record.mediaKind === "still_video" && !isRootRelativeUrl(record.audioUrl)) {
      errors.push(`${content.id}: still_videoのrecord.audioUrlは / から始めてください。`);
    }
    if (record.mediaKind === "video" && !isRootRelativeUrl(record.videoUrl)) {
      errors.push(`${content.id}: videoのrecord.videoUrlは / から始めてください。`);
    }
  }
  if (content.appId === "calendar" && typeof record.date === "string" && !parseStoryDate(record.date)) {
    errors.push(`${content.id}: record.date は YYYY-MM-DD 形式の実在する日付にしてください。`);
  }
  if (content.appId === "phone") {
    if (!new Set(["incoming", "missed", "outgoing", "voicemail"]).has(record.kind)) {
      errors.push(`${content.id}: record.kind は incoming、missed、outgoing、voicemail のいずれかにしてください。`);
    }
    validateCallTranscript(`${content.id}: record.transcript`, record.transcript, errors);
  }
  if (content.appId === "radio") {
    validateCallTranscript(`${content.id}: record.transcript`, record.transcript, errors);
  }
  if (content.appId === "browser") {
    if (!isRootRelativeUrl(record.url)) {
      errors.push(`${content.id}: record.url は / から始まる同一オリジンURLにしてください。`);
    }
    if (record.allowedUrls !== undefined && (
      !Array.isArray(record.allowedUrls)
      || record.allowedUrls.some((url) => !isRootRelativeUrl(url))
    )) {
      errors.push(`${content.id}: record.allowedUrls は / から始まる同一オリジンURLの配列にしてください。`);
    }
  }
}

function deviceStateFor(source, publicIds, revision) {
  const initialState = Object.fromEntries(Object.entries(stateVariablesFor(source)).filter(([id]) => (source.partOwnership?.stateVariables?.[id] ?? "base") === "base"));
  const notifications = source.notifications.filter((notification) => (source.partOwnership?.notifications?.[notification.id] ?? "base") === "base" && evaluateCondition(String(notification.cond ?? ""), initialState)).map((notification) => ({
    id: publicIds.notification[notification.id],
    appId: notification.appId,
    targetContentId: notification.targetTalkId
      ? publicIds.talk[notification.targetTalkId]
      : publicIds.content[notification.targetContentId] ?? notification.targetContentId,
    title: notification.title,
    body: notification.body
  }));
  return {
    revision,
    batteryLevel: source.project.batteryLevel,
    signalLabel: source.project.signalLabel,
    currentDate: source.project.date,
    currentTimeLabel: source.project.timeLabel,
    wallpaperUrl: source.project.wallpaperUrl,
    apps: source.apps.filter((app) => app.initialState !== "hidden" && ((source.partOwnership?.apps?.[app.id] ?? "base") === "base" || app.initialState === "repairable") && evaluateCondition(String(app.cond ?? ""), initialState)).map((app) => ({
      id: app.id,
      label: app.initialState === "repairable" ? app.repairLabel : app.label,
      icon: app.icon,
      accent: app.accent,
      available: app.initialState === "normal",
      ...(String(app.badgeCond ?? "").trim() && evaluateCondition(String(app.badgeCond), initialState) ? { badge: true } : {}),
      ...(app.initialState !== "normal" ? { initialState: app.initialState, repairLabel: app.repairLabel ?? app.label } : {})
    })),
    messages: [],
    photos: [],
    notes: [],
    mails: [],
    calendarEvents: [],
    callLogs: [],
    browserTabs: [],
    radioItems: [],
    chatThreads: [],
    notifications,
    todos: []
  };
}

export function loadAndValidateScenario(overrides = {}) {
  const errors = [];
  const authoring = loadScenarioAuthoring(scenarioDir);
  buildScenarioHooksModule(authoring.hookScripts);
  // 純粋な検証fixtureの注入。製品CLIは常にSheets由来TSVを読み、JSON原本へfallbackしない。
  const source = overrides.source ?? authoring.source;
  const talkFlowSheet = authoring.workbook.talk_flow;
  const talkBlocksSheet = authoring.workbook.talk_blocks;
  const { contexts, rules: rawRules } = talkFlowRows(activeRows(talkFlowSheet.rows), error => errors.push(error));
  const rawBlocks = talkBlocksSheet.rows;
  const blockScope = collectScopedTalkBlocks(rawBlocks, { onError: (error) => errors.push(error) });

  validateObjectKeys("scenario", source, [
    "schemaVersion", "playerMode", "features", "project", "stateVariables", "publicStateVariables",
    "photoDescriptions", "apps", "contents", "talkPeople", "attachments", "talks", "todos",
    "notifications", "assistantMessages", "chatAuthGate", "generatedAudio",
    "incomingCalls", "initialSchedules", "clientCallableEvents", "hooks", "projectConstants", "publicProjectConstants", "albumMediaAttachmentLinks", "partOwnership", "partIds"
  ], errors);
  validateObjectKeys("features", source.features, ["llm"], errors);
  if (source.features?.llm !== undefined && typeof source.features.llm !== "boolean") {
    errors.push("features.llm はbooleanにしてください。");
  }
  validateObjectKeys("project", source.project, [
    "id", "name", "osName", "assistantName", "accentColor", "lockScreen", "date", "timeLabel",
    "batteryLevel", "signalLabel", "wallpaperUrl", "talkClock", "repairParentApp", "accessCode"
  ], errors);
  const seenProjectAppIds = new Set();
  for (const app of projectApps) {
    if (app.id === "search_agent" || !idPattern.test(app.id) || engineAppIds.has(app.id) || seenProjectAppIds.has(app.id)) {
      errors.push(`project app idが不正、予約済み、または重複しています: ${app.id}`);
    }
    if (typeof app.icon !== "string" || !app.icon.trim()) errors.push(`${app.id}: project app iconが必要です。`);
    const componentPath = path.join(engineRootDir, `src/project/apps/${app.id}/App.svelte`);
    if (!fs.existsSync(componentPath)) errors.push(`${app.id}: 規約componentがありません: src/project/apps/${app.id}/App.svelte`);
    seenProjectAppIds.add(app.id);
  }

  if (source.schemaVersion !== 1) errors.push("schemaVersion は 1 にしてください。");
  const playerMode = source.playerMode ?? "server";
  if (!new Set(["server", "browser", "static"]).has(playerMode)) errors.push("playerMode は server/browser/static にしてください。");
  validateProject(source.project, playerMode, errors);
  const stateConfiguration = stateVariableConfigurationFor(source, errors);
  const stateVariables = stateConfiguration.values;
  const stateVariableDefinitions = stateConfiguration.definitions;
  for (const id of reservedStateVariableIds) {
    if (Object.hasOwn(source.stateVariables ?? {}, id)) {
      errors.push(systemStateVariableIds.has(id)
        ? `stateVariables.${id} はprojectから自動設定される予約変数です。`
        : `stateVariables.${id} はシステムの予約変数です。`);
    }
  }
  const publicStateVariables = Array.isArray(source.publicStateVariables)
    ? source.publicStateVariables.map((id) => String(id).trim())
    : [];
  if (source.publicStateVariables !== undefined && !Array.isArray(source.publicStateVariables)) {
    errors.push("publicStateVariables は配列にしてください。");
  }
  const seenPublicStateVariables = new Set();
  for (const id of publicStateVariables) {
    if (!idPattern.test(id) || !Object.hasOwn(stateVariables, id)) {
      errors.push(`publicStateVariables の状態変数が未定義です: ${id}`);
    } else if (seenPublicStateVariables.has(id)) {
      errors.push(`publicStateVariables が重複しています: ${id}`);
    }
    seenPublicStateVariables.add(id);
  }

  const apps = Array.isArray(source.apps) ? source.apps : [];
  const appIds = new Set();
  for (const app of apps) {
    validateObjectKeys(`app ${app?.id ?? ""}`, app, ["id", "label", "repairLabel", "icon", "accent", "initialState", "search", "cond", "badgeCond"], errors);
    if (app?.id === "search_agent" || !idPattern.test(app?.id ?? "") || !supportedAppIds.has(app.id)) {
      errors.push(`app id が不正または予約済みです: ${app?.id ?? ""}`);
    }
    else if (appIds.has(app.id)) errors.push(`app id が重複しています: ${app.id}`);
    appIds.add(app.id);
    for (const key of ["label", "accent"]) {
      if (typeof app?.[key] !== "string" || !app[key].trim()) errors.push(`${app?.id ?? "app"}: ${key} が必要です。`);
    }
    if (engineAppIds.has(app?.id) && (typeof app?.icon !== "string" || !app.icon.trim())) errors.push(`${app?.id ?? "app"}: icon が必要です。`);
    validateTextLength(`${app?.id ?? "app"}.label`, app?.label, 24, errors);
    validateTextLength(`${app?.id ?? "app"}.icon`, app?.icon, 40, errors);
    validateTextLength(`${app?.id ?? "app"}.accent`, app?.accent, 16, errors);
    validateTextLength(`${app?.id ?? "app"}.repairLabel`, app?.repairLabel, 24, errors);
    if (!initialStates.has(app?.initialState)) errors.push(`${app?.id ?? "app"}: initialState が不正です。`);
    if (app?.initialState !== "normal" && !app?.repairLabel) errors.push(`${app?.id ?? "app"}: repairLabel が必要です。`);
    validateSearchTerms(app?.id ?? "app", app?.search ?? [], errors, false);
    validateCondition(`app ${app?.id ?? ""}`, app?.cond, stateVariableDefinitions, errors);
    validateCondition(`app ${app?.id ?? ""}.badgeCond`, app?.badgeCond, stateVariableDefinitions, errors);
  }

  const sourceTalks = Array.isArray(source.talks) ? source.talks : [];
  const talks = sourceTalks.filter((talk) => talk?.kind !== "search_agent" && talk?.id !== "search_agent");
  const searchAgentTalks = sourceTalks.filter((talk) => talk?.kind === "search_agent" || talk?.id === "search_agent");
  const searchAgentSource = searchAgentTalks.find((talk) => talk?.id === "search_agent" && talk?.kind === "search_agent") ?? null;
  const deviceTalkById = new Map(talks.map((talk) => [talk?.id, talk]));
  const deviceTalkIds = new Set(talks.map((talk) => talk?.id).filter(Boolean));
  const talkIds = new Set();
  for (const talk of sourceTalks) {
    const searchAgent = talk?.id === "search_agent" || talk?.kind === "search_agent";
    validateObjectKeys(
      `talk ${talk?.id ?? ""}`,
      talk,
      searchAgent
        ? ["id", "kind", "inputVisible", "inputEnabled", "startSteps"]
        : ["id", "kind", "appId", "label", "avatarUrl", "initialState", "repairLabel", "search", "cond", "inputVisible", "inputEnabled", "startBlocks"],
      errors
    );
    if (!idPattern.test(talk?.id ?? "")) errors.push(`talk id が不正です: ${talk?.id ?? ""}`);
    else if (talkIds.has(talk.id)) errors.push(`talk id が重複しています: ${talk.id}`);
    talkIds.add(talk.id);
    for (const key of ["inputVisible", "inputEnabled"]) {
      if (talk?.[key] !== undefined && typeof talk[key] !== "boolean") {
        errors.push(`${talk?.id ?? "talk"}: ${key} はbooleanにしてください。`);
      }
    }
    if (searchAgent) {
      if (talk?.id !== "search_agent" || talk?.kind !== "search_agent") {
        errors.push("検索AI talkは id と kind をともに search_agent にしてください。");
      }
      if (!Array.isArray(talk?.startSteps) || !talk.startSteps.length) {
        errors.push("search_agent: startSteps は空でない文字列配列にしてください。");
      }
      continue;
    }
    if ((talk.kind !== "sms" && talk.kind !== "chat") || talk.appId !== (talk.kind === "sms" ? "messages" : "chat")) errors.push(`${talk?.id ?? "talk"}: kind と appId の組み合わせが不正です。`);
    if (!talk?.label || !Array.isArray(talk?.startBlocks)) {
      errors.push(`${talk?.id ?? "talk"}: label と startBlocks は必須です。`);
    }
    if (Array.isArray(talk?.startBlocks) && talk.startBlocks.some((block) => typeof block !== "string")) {
      errors.push(`${talk?.id ?? "talk"}: startBlocks はblock IDの文字列配列にしてください。初期block単位のcondは仕様にありません。`);
    }
    const initialState = talk?.initialState ?? "normal";
    if (!initialStates.has(initialState)) errors.push(`${talk?.id ?? "talk"}: initialState が不正です。`);
    if (talk?.avatarUrl !== undefined && !isRootRelativeUrl(talk.avatarUrl)) {
      errors.push(`${talk?.id ?? "talk"}: avatarUrl は / から始まる同一オリジンURLにしてください。`);
    }
    if (initialState === "repairable" && talk?.repairLabel !== undefined && (typeof talk.repairLabel !== "string" || !talk.repairLabel.trim())) {
      errors.push(`${talk?.id ?? "talk"}: repairLabel は空でない文字列にしてください。`);
    }
    if (initialState !== "repairable" && talk?.repairLabel !== undefined) {
      errors.push(`${talk?.id ?? "talk"}: repairLabel は initialState=repairable のtalkだけで使えます。`);
    }
    validateTextLength(`${talk?.id ?? "talk"}.repairLabel`, talk?.repairLabel, 80, errors);
    validateSearchTerms(talk?.id ?? "talk", talk?.search ?? [], errors, false);
    validateCondition(`talk ${talk?.id ?? ""}`, talk?.cond, stateVariableDefinitions, errors);
  }
  if (searchAgentTalks.length !== 1 || !searchAgentSource) {
    errors.push("talksには id=search_agent / kind=search_agent の検索AI talkを1件だけ定義してください。");
  }

  const contents = Array.isArray(source.contents) ? source.contents : [];
  const contentIds = new Set();
  const audioCueTargets = new Set();
  const repairableTalkBlockIds = new Set();
  const repairableTalkContentIds = new Set();
  for (const content of contents) {
    validateObjectKeys(`content ${content?.id ?? ""}`, content, ["id", "appId", "initialState", "repairLabel", "search", "cond", "record"], errors);
    if (!idPattern.test(content?.id ?? "")) errors.push(`content id が不正です: ${content?.id ?? ""}`);
    else if (contentIds.has(content.id)) errors.push(`content id が重複しています: ${content.id}`);
    else if (talkIds.has(content.id)) errors.push(`content id がtalk idと重複しています: ${content.id}`);
    contentIds.add(content.id);
    if (!appIds.has(content?.appId)) errors.push(`${content?.id ?? "content"}: appId が不正です。`);
    if (!initialStates.has(content?.initialState)) errors.push(`${content?.id ?? "content"}: initialState が不正です。`);
    validateTextLength(`${content?.id ?? "content"}.repairLabel`, content?.repairLabel, 80, errors);
    validateSearchTerms(content?.id ?? "content", content?.search ?? [], errors, false);
    validateCondition(`content ${content?.id ?? ""}`, content?.cond, stateVariableDefinitions, errors);
    validateRecord(usesStandardMedia(content.appId) ? {...content,record:resolveMediaRecord(content.record, source.attachments)} : content, errors);
    const projectApp = projectAppById.get(content?.appId);
    if (projectApp && content?.record && typeof content.record === "object" && !Array.isArray(content.record)) {
      const { unlockCode: _password, unlockLoadParts: _parts, ...record } = content.record;
      projectApp.validateRecord(record, (message) => errors.push(`${content.id}: ${message}`));
    }
    if ((content?.appId === "messages" || content?.appId === "chat") && !content.record?.attachment) {
      repairableTalkContentIds.add(content.id);
      const record = content?.record && typeof content.record === "object" && !Array.isArray(content.record)
        ? content.record
        : {};
      const talk = talks.find((item) => item.id === record.talk);
      const blockId = talk ? resolveScopedTalkBlockId(blockScope, talk.id, record.block) : "";
      if (content.initialState !== "repairable" || !content.repairLabel) {
        errors.push(`${content.id}: talk初期履歴は initialState=repairable と repairLabel が必要です。`);
      }
      if (!talk || talk.appId !== content.appId) {
        errors.push(`${content.id}: record.talk は同じアプリのtalkを指定してください。`);
      } else if ((talk.initialState ?? "normal") !== "normal") {
        errors.push(`${content.id}: talk単位のinitialStateと初期履歴block修復は同時に使えません。`);
      } else if (!blockId || !Array.isArray(talk.startBlocks) || talk.startBlocks.filter((item) => item === record.block).length !== 1) {
        errors.push(`${content.id}: record.block は指定talkのstartBlocksに含まれるblockを指定してください。`);
      } else if (repairableTalkBlockIds.has(blockId)) {
        errors.push(`${content.id}: 同じ初期履歴blockを複数の修復対象にできません。`);
      } else {
        repairableTalkBlockIds.add(blockId);
      }
    }
  }

  const authoredTalkPeople = Array.isArray(source.talkPeople) ? source.talkPeople : [];
  const talkPeopleById = new Map();
  for (const person of authoredTalkPeople) {
    validateObjectKeys(`talkPerson ${person?.id ?? ""}`, person, ["id", "name", "role", "avatar"], errors);
    if (!idPattern.test(person?.id ?? "") || !person?.name || !["owner", "npc", "system"].includes(person?.role)) {
      errors.push(`talkPeople が不正です: ${person?.id ?? ""}`);
      continue;
    }
    if (person.id === "search_agent") {
      errors.push("talkPeople.search_agent はproject.assistantNameから自動生成される予約IDです。");
      continue;
    }
    if (talkPeopleById.has(person.id)) errors.push(`talkPeople id が重複しています: ${person.id}`);
    talkPeopleById.set(person.id, person);
  }
  const searchAgentPerson = {
    id: "search_agent",
    name: source.project?.assistantName ?? "検索AI",
    role: "npc"
  };
  talkPeopleById.set(searchAgentPerson.id, searchAgentPerson);
  const talkPeople = [...authoredTalkPeople.filter((person) => person?.id !== "search_agent"), searchAgentPerson];

  const attachments = Array.isArray(source.attachments) ? source.attachments : [];
  const attachmentsById = new Map();
  for (const attachment of attachments) {
    validateObjectKeys(`attachment ${attachment?.id ?? ""}`, attachment, ["id", "type", "asset", "content", "lock", "title", "body", "poster", "search", "searchApp", "cond"], errors);
    validateCondition(`attachment ${attachment?.id ?? ""}`, attachment?.cond, stateVariableDefinitions, errors);
    if (attachment.search?.length) {
      validateSearchTerms(`attachment ${attachment.id}`, attachment.search, errors);
      if (!attachment.content || !["messages", "chat"].includes(attachment.searchApp)) errors.push(`${attachment.id}: 添付検索にはcontentとmessages/chatのsearchAppが必要です。`);
    }
    const mediaType = ["image", "audio", "video"].includes(attachment?.type);
    const documentType = attachment?.type === "document";
    if (!idPattern.test(attachment?.id ?? "") || (!mediaType && !documentType) || (mediaType && !attachment?.asset)) {
      errors.push(`attachment が不正です: ${attachment?.id ?? ""}`);
      continue;
    }
    if (documentType && (!String(attachment.body ?? "").trim() || attachment.lock !== "password" || !attachment.content)) {
      errors.push(`${attachment.id}: documentはbody、content、lock=passwordが必要です。`);
    }
    validateTextLength(`${attachment?.id ?? "attachment"}.body`, attachment?.body, 4_000, errors);
    if (attachmentsById.has(attachment.id)) errors.push(`attachment id が重複しています: ${attachment.id}`);
    if (attachment.content && !contentIds.has(attachment.content)) errors.push(`${attachment.id}: content が未定義です。`);
    if (attachment.content && repairableTalkContentIds.has(attachment.content)) {
      errors.push(`${attachment.id}: talk初期履歴の修復contentをattachment対象にできません。`);
    }
    if (attachment.lock && attachment.lock !== "password") errors.push(`${attachment.id}: lock が不正です。`);
    attachmentsById.set(attachment.id, attachment);
  }
  for (const attachment of attachments) {
    if (attachment.poster && attachmentsById.get(attachment.poster)?.type !== "image") {
      errors.push(`${attachment.id}: poster はimage attachmentを指定してください。`);
    }
    if (attachment.lock === "password") {
      const lockedContent = contents.find((content) => content.id === attachment.content);
      if (!lockedContent || typeof lockedContent.record?.unlockCode !== "string" || !lockedContent.record.unlockCode.trim()) {
        errors.push(`${attachment.id}: password lockにはunlockCodeを持つcontentが必要です。`);
      } else {
        try { answerCandidates(lockedContent.record.unlockCode, true); }
        catch (error) { errors.push(`${attachment.id}: ${error.message}`); }
      }
    }
  }

  const messageLinkActionIds = new Set();
  const talkBlocks = [...blockScope.blocks.entries()].map(([id, rows]) => {
    const info = blockScope.blockInfo.get(id);
    if (!talkIds.has(info?.talkId ?? "")) errors.push(`${id}: 所属talkが未定義です。`);
    return {
      id,
      talkId: info?.talkId ?? "",
      blockKey: info?.blockKey ?? "",
      part: info?.part ?? "base",
      order: info?.order ?? 0,
      ...(info?.repeatOf ? { repeatOf: info.repeatOf, repeatIndex: info.repeatIndex } : {}),
      messages: rows.map((row, index) => {
        const sender = String(row.sender ?? "").trim();
        const attachmentId = String(row.attachment ?? "").trim();
        const quickReplies = quickRepliesFromCell(row.quick_replies, `talk_blocks.tsv:${row.__rowNumber}`, errors);
        const updatedAt = String(row.updated_at ?? "").trim();
        const authoringSource = String(row.source ?? "").trim();
        if (!talkPeopleById.has(sender)) errors.push(`talk_blocks.tsv:${row.__rowNumber}: sender が未定義です: ${sender}`);
        if (attachmentId && !attachmentsById.has(attachmentId)) errors.push(`talk_blocks.tsv:${row.__rowNumber}: attachment が未定義です: ${attachmentId}`);
        const delayMs = String(row.delay_ms ?? "").trim() ? Number(row.delay_ms) : undefined;
        if (delayMs !== undefined && (!Number.isInteger(delayMs) || delayMs < 0)) {
          errors.push(`talk_blocks.tsv:${row.__rowNumber}: delay_ms は0以上の整数にしてください。`);
        }
        if (updatedAt && !/^\d{4}-\d{2}-\d{2}$/u.test(updatedAt)) errors.push(`talk_blocks.tsv:${row.__rowNumber}: updated_at は YYYY-MM-DD にしてください。`);
        if (authoringSource && !["human", "ai", "ai_edited"].includes(authoringSource)) errors.push(`talk_blocks.tsv:${row.__rowNumber}: source は human / ai / ai_edited にしてください。`);
        if (updatedAt && !authoringSource) errors.push(`talk_blocks.tsv:${row.__rowNumber}: updated_atを使う場合はsourceが必要です。`);
        if (authoringSource && !updatedAt) errors.push(`talk_blocks.tsv:${row.__rowNumber}: sourceを使う場合はupdated_atが必要です。`);
        if (quickReplies.length && talkPeopleById.get(sender)?.role !== "npc") {
          errors.push(`talk_blocks.tsv:${row.__rowNumber}: quick_replies はNPCメッセージだけに指定できます。`);
        }
        if (quickReplies.length && index !== rows.length - 1) {
          errors.push(`talk_blocks.tsv:${row.__rowNumber}: quick_replies はblock最後のメッセージだけに指定できます。`);
        }
        validateTextLength(`talk_blocks.tsv:${row.__rowNumber}: body`, String(row.body ?? ""), 1_200, errors);
        validateTemplateSyntax(`talk_blocks.tsv:${row.__rowNumber}: body`, row.body, errors);
        validateTextLength(`talk_blocks.tsv:${row.__rowNumber}: notes`, String(row.notes ?? ""), 4_000, errors);
        if (!String(row.body ?? "") && !attachmentId) errors.push(`talk_blocks.tsv:${row.__rowNumber}: body または attachment が必要です。`);
        const content = messageBody(row.body, (target) => errors.push(`talk_blocks.tsv:${row.__rowNumber}: メッセージリンクが不正です: ${target}`));
        for (const segment of content.segments ?? []) {
          if (segment.kind !== "link" || !("contentId" in segment)) continue;
          const validApp = appIds.has(segment.appId);
          const targetContent = contents.find((item) => item.id === segment.contentId);
          const targetTalk = talks.find((item) => item.id === segment.contentId);
          const validTarget = Boolean(targetContent || targetTalk);
          if (!validApp || !validTarget) errors.push(`talk_blocks.tsv:${row.__rowNumber}: メッセージリンクの対象が未定義です。`);
          else if ((targetContent?.appId ?? targetTalk?.appId) !== segment.appId) {
            errors.push(`talk_blocks.tsv:${row.__rowNumber}: メッセージリンクは対象と同じアプリを指定してください。`);
          }
          if (segment.actionId) messageLinkActionIds.add(segment.actionId);
          if (repairableTalkContentIds.has(segment.contentId)) {
            errors.push(`talk_blocks.tsv:${row.__rowNumber}: talk初期履歴の修復contentは検索結果から開いてください。`);
          }
        }
        const segments = content.segments?.map((segment, segmentIndex) => (
          info?.talkId === SEARCH_AGENT_TALK_ID && segment.kind === "link" && "contentId" in segment
            ? {
                ...segment,
                linkId: stableId(
                  "search-link",
                  `${id}:${index + 1}:${segmentIndex + 1}:${segment.appId}:${segment.contentId}:${segment.actionId ?? ""}`
                )
              }
            : segment
        ));
        return {
          id: `${id}_${index + 1}`,
          sender,
          ...content,
          ...(segments ? { segments } : {}),
          attachmentId,
          sentAt: String(row.time ?? "").trim(),
          ...(delayMs === undefined ? {} : { delayMs }),
          ...(quickReplies.length ? { quickReplies } : {}),
          notes: String(row.notes ?? "").trim(),
          updatedAt,
          source: authoringSource
        };
      })
    };
  });
  for (const block of talkBlocks.filter((item) => item.talkId === SEARCH_AGENT_TALK_ID)) {
    for (const message of block.messages) {
      if (message.sender !== "search_agent") {
        errors.push(`${block.talkId}/${block.blockKey}: senderはsearch_agentにしてください。`);
      }
      if (message.attachmentId || message.segments?.some((segment) => segment.kind === "link" && "externalUrl" in segment)) {
        errors.push(`${block.talkId}/${block.blockKey}: search_agentの発話は本文、内部リンク、Quick Replyだけを使用してください。`);
      }
      if (message.sentAt) {
        errors.push(`${block.talkId}/${block.blockKey}: search_agentの発話時刻は実行時に決まるためtimeを指定できません。`);
      }
    }
  }
  for (const blockId of repairableTalkBlockIds) {
    const block = talkBlocks.find((item) => item.id === blockId);
    if (!block?.messages.length) {
      errors.push(`${blockId}: 修復対象の初期履歴blockにはメッセージが必要です。`);
      continue;
    }
    if (block.messages.some((message) => !message.sentAt)) {
      errors.push(`${blockId}: 修復対象の初期履歴blockでは全メッセージのtimeを指定してください。`);
    }
  }

  const generatedAudio = Array.isArray(source.generatedAudio) ? source.generatedAudio : [];
  validateUniqueItems("generatedAudio", generatedAudio, errors);
  const generatedAudioIds = new Set(generatedAudio.map((item) => item.id));
  for (const audio of generatedAudio) {
    validateObjectKeys(`generatedAudio ${audio?.id ?? ""}`, audio, ["id", "title", "provider", "fallbackAttachmentId"], errors);
    if (!idPattern.test(audio?.id ?? "") || !idPattern.test(audio?.provider ?? "") || !audio?.title) errors.push(`generatedAudio が不正です: ${audio?.id ?? ""}`);
    if (audio.fallbackAttachmentId && !source.attachments?.some(item => item.id === audio.fallbackAttachmentId && item.type === "audio")) errors.push(`gen_audio ${audio.id}: fallbackは定義済みのaudio attachment IDを指定してください。`);
  }
  const formIds = new Set();
  for (const content of contents) {
    const record = usesStandardMedia(content.appId) ? resolveMediaRecord(content.record ?? {},source.attachments) : content.record ?? {};
    if (record.form !== undefined) {
      if (!record.form || typeof record.form !== "object" || Array.isArray(record.form) || !idPattern.test(record.form.id ?? "")) {
        errors.push(`${content.id}: record.form.id が不正です。`);
      } else if (formIds.has(record.form.id)) {
        errors.push(`${content.id}: record.form.id が重複しています: ${record.form.id}`);
      } else {
        formIds.add(record.form.id);
      }
    }
    const genAudioIds = [record.genAudioId];
    if (Array.isArray(record.audioSegments)) {
      for (const [index, segment] of record.audioSegments.entries()) {
        if (!segment || typeof segment !== "object" || Array.isArray(segment)) {
          errors.push(`${content.id}: record.audioSegments[${index}] が不正です。`);
          continue;
        }
        if (segment.kind === "audio") {
          if (!isRootRelativeUrl(segment.audioUrl)) errors.push(`${content.id}: 音声segmentのaudioUrlは / から始めてください。`);
        } else if (segment.kind === "generated") {
          genAudioIds.push(segment.genAudioId);
        } else {
          errors.push(`${content.id}: audioSegments.kind は audio または generated にしてください。`);
        }
      }
    }
    for (const id of genAudioIds.filter((item) => item !== undefined && item !== "")) {
      if (typeof id !== "string" || !generatedAudioIds.has(id)) errors.push(`${content.id}: genAudioId が未定義です: ${String(id)}`);
    }
    if (content.appId !== "radio") continue;
    validateCondition(`${content.id}: record.playbackCond`, record.playbackCond, stateVariableDefinitions, errors);
    validateCondition(`${content.id}: record.formDisabledCond`, record.formDisabledCond, stateVariableDefinitions, errors);
    if (record.playbackDisabledLabel !== undefined && (typeof record.playbackDisabledLabel !== "string" || !record.playbackDisabledLabel.trim())) {
      errors.push(`${content.id}: record.playbackDisabledLabel は空でない文字列にしてください。`);
    }
    if (record.audioCues !== undefined && !Array.isArray(record.audioCues)) {
      errors.push(`${content.id}: record.audioCues は配列にしてください。`);
    }
    const cueIds = new Set();
    let previousAtMs = -1;
    for (const [index, cue] of (Array.isArray(record.audioCues) ? record.audioCues : []).entries()) {
      if (cue && typeof cue === "object" && !Array.isArray(cue) && cue.atMs === undefined && cue.at !== undefined) {
        cue.atMs = cueAtMs(cue.at);
        delete cue.at;
      }
      if (!cue || typeof cue !== "object" || Array.isArray(cue) || !idPattern.test(cue.id ?? "") || !Number.isInteger(cue.atMs) || cue.atMs < 0) {
        errors.push(`${content.id}: record.audioCues[${index}] が不正です。`);
        continue;
      }
      if (cueIds.has(cue.id)) errors.push(`${content.id}: audio cue id が重複しています: ${cue.id}`);
      if (cue.atMs < previousAtMs) errors.push(`${content.id}: record.audioCues はatMsの昇順にしてください。`);
      cueIds.add(cue.id);
      audioCueTargets.add(`${content.id}:${cue.id}`);
      previousAtMs = cue.atMs;
    }
  }

  const incomingCalls = Array.isArray(source.incomingCalls) ? source.incomingCalls : [];
  const incomingCallIds = new Set();
  for (const call of incomingCalls) {
    validateObjectKeys(`incomingCall ${call?.id ?? ""}`, call, ["id", "name", "audioUrl", "audioAttachmentId", "transcript", "cond"], errors);
    if (!idPattern.test(call?.id ?? "") || !call?.name) errors.push(`incomingCall が不正です: ${call?.id ?? ""}`);
    if (incomingCallIds.has(call.id)) errors.push(`incomingCall id が重複しています: ${call.id}`);
    if (call.audioUrl !== undefined && (typeof call.audioUrl !== "string" || !call.audioUrl.trim())) {
      errors.push(`${call.id}: incomingCall.audioUrl は空でない文字列にしてください。`);
    }
    validateCallTranscript(`${call.id}: incomingCall.transcript`, call.transcript, errors);
    if (call.transcript !== undefined && !resolveMediaRecord(call,source.attachments).audioUrl) {
      errors.push(`${call.id}: incomingCall.transcriptを使う場合はaudioUrlが必要です。`);
    }
    validateCondition(`${call.id}: incomingCall.cond`, call.cond, stateVariableDefinitions, errors);
    incomingCallIds.add(call.id);
  }

  const initialSchedules = Array.isArray(source.initialSchedules) ? source.initialSchedules : [];
  const scheduleIds = new Set();
  for (const schedule of initialSchedules) {
    validateObjectKeys(`initialSchedule ${schedule?.id ?? ""}`, schedule, ["id", "delayMs", "eventId", "fields"], errors);
    if (!idPattern.test(schedule?.id ?? "") || !idPattern.test(schedule?.eventId ?? "") || !Number.isInteger(schedule?.delayMs) || schedule.delayMs < 0) {
      errors.push(`initialSchedule が不正です: ${schedule?.id ?? ""}`);
    }
    if (scheduleIds.has(schedule.id)) errors.push(`initialSchedule id が重複しています: ${schedule.id}`);
    if (schedule.fields !== undefined && (!schedule.fields || typeof schedule.fields !== "object" || Array.isArray(schedule.fields))) {
      errors.push(`${schedule.id}: fields はobjectにしてください。`);
    } else if (schedule.fields && Object.values(schedule.fields).some((value) => typeof value !== "string")) {
      errors.push(`${schedule.id}: fields の値は文字列にしてください。`);
    }
    scheduleIds.add(schedule.id);
  }

  const hooks = Array.isArray(source.hooks) ? source.hooks : [];
  const hookEvents = new Set(Object.keys(CORE_SCENARIO_HOOK_EVENTS));
  const hookIds = new Set();
  for (const hook of hooks) {
    validateObjectKeys(`hook ${hook?.handler ?? ""}`, hook, ["event", "target", "handler", "cond", "llm"], errors);
    if (!hookEvents.has(hook?.event) && !idPattern.test(hook?.event ?? "")) errors.push(`hook event が不正です: ${hook?.event ?? ""}`);
    if (["scenario_event", "talk_sent"].includes(hook?.event)) errors.push(`${hook.handler}: 廃止済みhook eventです: ${hook.event}`);
    if (!idPattern.test(hook?.handler ?? "")) errors.push(`hook handler id が不正です: ${hook?.handler ?? ""}`);
    hookIds.add(hook.handler);
    const metadata = coreScenarioHookEventMetadata(hook.event);
    const target = typeof hook.target === "string" ? hook.target.trim() : "";
    if (metadata?.targetRequired && !target) {
      errors.push(`${hook.handler}: ${hook.event} のtargetは必須です。`);
    } else if (metadata?.targetKind === "blocked_app" && target !== "*" && !appIds.has(target)) {
      errors.push(`${hook.handler}: target appが未定義です。`);
    } else if (metadata?.targetKind === "content_open" && target
      && !contentIds.has(target) && !appIds.has(target) && !deviceTalkIds.has(target)) {
      errors.push(`${hook.handler}: targetが未定義です。`);
    } else if (metadata?.targetKind === "content" && target && !contentIds.has(target)) {
      errors.push(`${hook.handler}: content targetが未定義です。`);
    } else if (metadata?.targetKind === "audio_cue" && target && !audioCueTargets.has(target)) {
      errors.push(`${hook.handler}: audio cue targetが未定義です。`);
    } else if (metadata?.targetKind === "incoming_call" && target && !incomingCallIds.has(target)) {
      errors.push(`${hook.handler}: call targetが未定義です。`);
    } else if (metadata?.targetKind === "message_action" && target && !/^[a-zA-Z0-9_:-]+$/u.test(target)) {
      errors.push(`${hook.handler}: message action targetが不正です。`);
    } else if (metadata?.targetKind === "talk" && target && !talkIds.has(target)) {
      errors.push(`${hook.handler}: talk targetが未定義です。`);
    } else if (metadata?.targetKind === "form" && target && !formIds.has(target)) {
      errors.push(`${hook.handler}: form targetが未定義です。`);
    } else if (metadata?.targetKind === "schedule" && target && !/^[a-zA-Z0-9_:-]+$/u.test(target)) {
      errors.push(`${hook.handler}: schedule targetが不正です。`);
    } else if (metadata?.targetKind === "part" && target !== "*" && !(source.partIds ?? ["base"]).includes(target)) {
      errors.push(`${hook.handler}: part targetが未定義です。`);
    }
    if (source.features?.llm !== true && hook?.llm === true) errors.push(`${hook.handler}: LLM無効時はllm hookを使用できません。`);
    if (hook?.llm !== undefined && typeof hook.llm !== "boolean") errors.push(`${hook.handler}: llm はbooleanにしてください。`);
    if (hook?.clientCallable !== undefined) errors.push(`${hook.handler}: clientCallable はhookではなくclientCallableEventsへ指定してください。`);
    validateCondition(`hook ${hook?.handler ?? ""}`, hook?.cond, stateVariableDefinitions, errors);
  }
  for (const actionId of messageLinkActionIds) {
    if (!hooks.some((hook) => hook.event === "message_link_opened" && hook.target === actionId)) {
      errors.push(`action付きメッセージリンクに対応するhookがありません: ${actionId}`);
    }
  }

  const clientCallableEvents = Array.isArray(source.clientCallableEvents)
    ? source.clientCallableEvents.map((eventId) => String(eventId).trim())
    : [];
  if (source.clientCallableEvents !== undefined && !Array.isArray(source.clientCallableEvents)) {
    errors.push("clientCallableEvents は配列にしてください。");
  }
  const seenClientCallableEvents = new Set();
  for (const eventId of clientCallableEvents) {
    if (!idPattern.test(eventId)) errors.push(`clientCallableEvents のevent idが不正です: ${eventId}`);
    if (seenClientCallableEvents.has(eventId)) errors.push(`clientCallableEvents が重複しています: ${eventId}`);
    if (!hooks.some((hook) => hook.event === eventId)) {
      errors.push(`clientCallableEvents に対応するcustom event hookがありません: ${eventId}`);
    }
    seenClientCallableEvents.add(eventId);
  }

  const todoItems = Array.isArray(source.todos) ? source.todos : [];
  validateUniqueItems("todo", todoItems, errors);
  for (const todo of todoItems) {
    validateObjectKeys(`todo ${todo?.id ?? ""}`, todo, ["id", "text", "cond"], errors);
    if (typeof todo?.text !== "string" || !todo.text.trim()) errors.push(`${todo?.id ?? "todo"}: text が必要です。`);
    validateTextLength(`${todo?.id ?? "todo"}.text`, todo?.text, 80, errors);
  }

  const notificationItems = Array.isArray(source.notifications) ? source.notifications : [];
  validateUniqueItems("notification", notificationItems, errors);
  for (const notification of notificationItems) {
    validateObjectKeys(`notification ${notification?.id ?? ""}`, notification, ["id", "appId", "targetTalkId", "targetContentId", "title", "body", "cond"], errors);
    if (!appIds.has(notification?.appId)) errors.push(`${notification?.id ?? "notification"}: appId が未定義です。`);
    if (notification?.targetTalkId && !deviceTalkIds.has(notification.targetTalkId)) {
      errors.push(`${notification.id}: targetTalkId が未定義またはアプリに属さないtalkです。`);
    } else if (notification?.targetTalkId && deviceTalkById.get(notification.targetTalkId)?.appId !== notification.appId) {
      errors.push(`${notification.id}: targetTalkId はnotification.appIdと同じアプリのtalkを指定してください。`);
    }
    if (notification?.targetContentId && !contentIds.has(notification.targetContentId) && !appIds.has(notification.targetContentId)) {
      errors.push(`${notification.id}: targetContentId が未定義です。`);
    } else if (notification?.targetContentId) {
      const targetContent = contents.find((content) => content.id === notification.targetContentId);
      const targetAppId = targetContent?.appId ?? notification.targetContentId;
      if (targetAppId !== notification.appId) {
        errors.push(`${notification.id}: targetContentId はnotification.appIdと同じアプリの対象を指定してください。`);
      }
    }
    if (!notification?.targetTalkId && !notification?.targetContentId) errors.push(`${notification?.id ?? "notification"}: targetTalkId または targetContentId が必要です。`);
    if (typeof notification?.title !== "string" || !notification.title.trim() || typeof notification?.body !== "string" || !notification.body.trim()) {
      errors.push(`${notification?.id ?? "notification"}: title と body が必要です。`);
    }
    validateTextLength(`${notification?.id ?? "notification"}.body`, notification?.body, 300, errors);
  }

  const assistantItems = Array.isArray(source.assistantMessages) ? source.assistantMessages : [];
  validateUniqueItems("assistantMessage", assistantItems, errors);
  for (const message of assistantItems) {
    validateObjectKeys(`assistantMessage ${message?.id ?? ""}`, message, ["id", "surface", "body", "weight", "agentAction", "cond"], errors);
    if (typeof message?.surface !== "string" || !message.surface.trim() || typeof message?.body !== "string" || !message.body.trim()) {
      errors.push(`${message?.id ?? "assistantMessage"}: surface と body が必要です。`);
    }
    if (!Number.isFinite(message?.weight)) errors.push(`${message?.id ?? "assistantMessage"}: weight は数値にしてください。`);
    validateTextLength(`${message?.id ?? "assistantMessage"}.body`, message?.body, 600, errors);
  }

  for (const [id, description] of Object.entries(source.photoDescriptions ?? {})) {
    validateTextLength(`photoDescriptions.${id}`, description, 300, errors);
  }

  let rules = rawRules.map((row) => {
    const label = `talk_flow.tsv:${row.__rowNumber}`;
    const order = row.__rowNumber;
    const talkSource = sourceTalks.find((talk) => talk?.id === row.talk);
    const searchAgent = talkSource?.kind === "search_agent";
    if (!talkIds.has(row.talk)) errors.push(`${label}: 未定義のtalkです: ${row.talk}`);
    if (!row.from || !row.next) errors.push(`${label}: from と next は必須です。`);
    const type = String(row.type ?? "").trim();
    if (!["match", "secret", "ai", "default"].includes(type)) errors.push(`${label}: typeはmatch/secret/ai/default/contextです。`);
    const isDefault = type === "default";
    const context = contexts.get(`${row.talk}\0${row.from}`);
    const criteria = String(isDefault ? context?.text ?? "" : row.criteria ?? "").trim();
    const match = String(row.match ?? "").trim();
    if (isDefault && String(row.text ?? "").trim()) errors.push(`${label}: defaultのtextは空欄にし、場面説明はcontext行へ書いてください。`);
    if (isDefault && match) errors.push(`${label}: default rule に match は書けません。`);
    if (!isDefault && !criteria) errors.push(`${label}: defaultでないruleにはcriteriaが必要です。`);
    if (type === "ai" || isDefault || (type === "match" && criteria.startsWith("/"))) validateTextLength(`${label}: text`, criteria, 2_000, errors);
    validateTextLength(`${label}: example`, String(row.example ?? ""), 300, errors);
    validateTemplateSyntax(`${label}: criteria`, criteria, errors);
    const parsedRegex = parseTalkFlowRegexCriteria(type === "match" ? criteria : "");
    if (parsedRegex.kind === "invalid") errors.push(`${label}: criteria が不正です: ${parsedRegex.error}`);
    if (source.features?.llm !== true && type === "ai") {
      errors.push(`${label}: LLM無効時は自然文criteriaを使用できません。`);
    }
    try {
      if (type === "match" || type === "secret") {
        const parsed = parseMatchCriteria(criteria, type === "secret");
        if (parsed.kind === "candidates") for (const candidate of parsed.candidates) validateTextLength(`${label}: textの候補`, candidate.value, MAX_TALK_INPUT_LENGTH, errors);
      }
      if ((type === "secret" || (type === "match" && !criteria.startsWith("/"))) && criteria.includes("{{")) errors.push(`${label}: 候補一覧にはtemplateを指定できません。`);
      if (match && parseTalkExtraction(match).kind === "ai" && source.features?.llm !== true) errors.push(`${label}: LLM無効時はAI抽出を使用できません。`);
    } catch (error) { errors.push(`${label}: ${error.message}`); }
    for (const key of templateKeys(criteria)) {
      if (!Object.hasOwn(stateVariableDefinitions, key)) errors.push(`${label}: criteriaのtemplateが未定義です: {{${key}}}`);
    }
    const mode = String(row.mode ?? "").trim();
    if (!["", "stay", "game_over"].includes(mode)) errors.push(`${label}: modeが不正です。`);
    if (searchAgent && mode === "game_over") errors.push(`${label}: search_agentではmode=game_overを使用できません。`);
    const assignments = splitAssignments(row.set);
    validateCondition(label, row.cond, stateVariableDefinitions, errors);
    let matchIds = new Set();
    if (match) {
      try {
        matchIds = new Set(parseTalkExtraction(match).ids);
      } catch {
        // JSON自体のエラーは直前で報告済み。
      }
    }
    if (searchAgent) {
      for (const id of matchIds) {
        if (id === "player_input" || Object.hasOwn(searchOutputStateDefinitions, id)) {
          errors.push(`${label}: search_agentのmatch IDに予約名を使用できません: ${id}`);
        }
      }
    }
    for (const error of validateStateAssignments(assignments, new Map(Object.entries(stateVariableDefinitions)), matchIds)) {
      errors.push(`${label}: 状態更新が不正です: ${error}`);
    }
    const parsedOutput = parseTalkOutputSteps(row.next);
    for (const error of parsedOutput.errors) errors.push(`${label}: next ${error}`);
    const loadParts = [...new Set(parsedOutput.steps.filter(step => step.kind === "load").map(step => step.partId))];
    if (loadParts.length && type !== "secret") errors.push(`${label}: /loadはsecret行だけに指定できます。`);
    for (const partId of loadParts) if (!(source.partIds ?? ["base"]).includes(partId)) errors.push(`${label}: 未定義のpartです: ${partId}`);
    parsedOutput.steps = parsedOutput.steps.filter(step => step.kind !== "load");
    if (mode === "game_over" && parsedOutput.steps.some((step) => step.kind === "input")) {
      errors.push(`${label}: mode=game_overでは/inputを使用できません。`);
    }
    if (!searchAgent && parsedOutput.steps.some((step) => step.kind === "search" || step.kind === "if")) {
      errors.push(`${label}: /search と /if はsearch_agentのnextだけで使用できます。`);
    }
    validateTalkInputOutputShape(label, parsedOutput.steps, errors);
    if (searchAgent) validateSearchAgentOutputShape(label, parsedOutput.steps, errors);
    const hasSearch = parsedOutput.steps.some((step) => step.kind === "search");
    const outputDefinitions = new Map(Object.entries({
      ...stateVariableDefinitions,
      player_input: { type: "string" },
      ...Object.fromEntries([...matchIds].map((id) => [id, { type: "string" }])),
      ...(hasSearch ? searchOutputStateDefinitions : {})
    }));
    const queryTemplateIds = new Set([...Object.keys(stateVariableDefinitions), ...matchIds, "player_input"]);
    for (const step of parsedOutput.steps) {
      if (step.kind === "search") {
        validateTextLength(`${label}: /search query`, step.queryTemplate, MAX_SEARCH_AGENT_QUERY_LENGTH, errors);
        validateTemplateSyntax(`${label}: /search query`, step.queryTemplate, errors);
        for (const key of templateKeys(step.queryTemplate)) {
          if (!queryTemplateIds.has(key)) errors.push(`${label}: /search queryのtemplateが未定義です: {{${key}}}`);
        }
      } else if (step.kind === "if") {
        for (const error of validateConditionExpression(step.cond, outputDefinitions)) {
          errors.push(`${label}: /if cond が不正です: ${error}`);
        }
      }
    }
    const resolvedFrom = row.from === "*" ? "*" : resolveScopedTalkBlockId(blockScope, row.talk, row.from);
    const outputSteps = parsedOutput.steps.map((step) => {
      if (step.kind === "block") {
        return { kind: "block", blockId: resolveScopedTalkBlockId(blockScope, row.talk, step.blockKey) };
      }
      if (step.kind === "if") {
        return { kind: "if", cond: step.cond, blockId: resolveScopedTalkBlockId(blockScope, row.talk, step.blockKey) };
      }
      return step;
    });
    const resolvedNextBlocks = outputSteps.flatMap((step) => step.kind === "block" || step.kind === "if" ? [step.blockId] : []);
    const nextFromKey = outputStepNextFromKey(parsedOutput.steps);
    const nextFromId = nextFromKey ? resolveScopedTalkBlockId(blockScope, row.talk, nextFromKey) : "";
    if (resolvedFrom !== "*" && isRepeatTalkBlockId(blockScope, resolvedFrom)) {
      errors.push(`${label}: repeat生成blockをfromへ指定できません。`);
    }
    if (resolvedNextBlocks.some((blockId) => isRepeatTalkBlockId(blockScope, blockId))) {
      errors.push(`${label}: repeat生成blockをnextへ指定できません。`);
    }
    const lastDisplayStep = [...parsedOutput.steps].reverse().find((step) => step.kind !== "input");
    if (searchAgent && !mode && lastDisplayStep?.kind !== "block") {
      errors.push(`${label}: search_agentの通常遷移は入力制御を除くnextの最後を無条件blockにしてください。`);
    }
    return {
      id: `validation_row_${order}`,
      type,
      part: row.__part ?? "base",
      loadParts,
      ...(isDefault && context ? { contextPart: context.__part ?? "base" } : {}),
      talkId: row.talk,
      order,
      from: resolvedFrom,
      isDefault,
      cond: String(row.cond ?? "").trim(),
      intent: String(row.intent ?? "").trim(),
      criteria,
      match,
      outputSteps,
      nextBlocks: resolvedNextBlocks,
      nextFromId,
      set: assignments,
      mode,
      notes: String(row.notes ?? "").trim(),
      example: String(row.example ?? "").trim()
    };
  });

  for (const [key, context] of contexts) {
    if (!rawRules.some(row => `${row.talk}\0${row.from}` === key && row.type === "default")) errors.push(`talk_flow.tsv:${context.__rowNumber}: contextに対応するdefault行がありません。`);
  }

  const parsedSearchStart = parseTalkOutputSteps(searchAgentSource?.startSteps ?? []);
  for (const error of parsedSearchStart.errors) errors.push(`search_agent.startSteps: ${error}`);
  if (parsedSearchStart.steps.some((step) => step.kind !== "block" && step.kind !== "input")) {
    errors.push("search_agent.startStepsではblockと/inputだけを使用できます。");
  }
  validateTalkInputOutputShape("search_agent.startSteps", parsedSearchStart.steps, errors);
  validateSearchAgentOutputShape("search_agent.startSteps", parsedSearchStart.steps, errors);
  const searchStartSteps = parsedSearchStart.steps.map((step) => step.kind === "block"
    ? { kind: "block", blockId: resolveScopedTalkBlockId(blockScope, "search_agent", step.blockKey) }
    : step);
  const searchStartBlocks = searchStartSteps.flatMap((step) => step.kind === "block" ? [step.blockId] : []);
  const searchInitialFromKey = outputStepNextFromKey(parsedSearchStart.steps);
  const searchInitialFrom = searchInitialFromKey
    ? resolveScopedTalkBlockId(blockScope, "search_agent", searchInitialFromKey)
    : "";
  if (!searchInitialFrom) errors.push("search_agent.startStepsには無条件blockを1件以上指定してください。");

  const stateTemplateIds = new Set(Object.keys(stateVariableDefinitions));
  const blockContexts = new Map();
  function addBlockContext(blockId, allowed, sourceLabel) {
    const contexts = blockContexts.get(blockId) ?? [];
    contexts.push({ allowed, sourceLabel });
    blockContexts.set(blockId, contexts);
  }
  for (const talk of talks) {
    for (const blockKey of talk.startBlocks ?? []) {
      addBlockContext(resolveScopedTalkBlockId(blockScope, talk.id, blockKey), stateTemplateIds, `${talk.id}: startBlocks`);
    }
  }
  for (const blockId of searchStartBlocks) {
    addBlockContext(blockId, stateTemplateIds, "search_agent: startSteps");
  }
  for (const [index, rule] of rules.entries()) {
    const rawMatch = rawRules[index]?.match;
    let matchIds = [];
    if (rawMatch) {
      try {
        matchIds = parseTalkExtraction(rawMatch).ids;
      } catch {
        // match構文自体のerrorはrule検証で報告する。
      }
    }
    const searchRule = rule.talkId === "search_agent";
    const allowed = new Set([
      ...stateTemplateIds,
      ...matchIds,
      ...(searchRule ? ["player_input"] : []),
      ...(searchRule && rule.outputSteps.some((step) => step.kind === "search")
        ? Object.keys(searchOutputStateDefinitions)
        : [])
    ]);
    for (const blockId of rule.nextBlocks) addBlockContext(blockId, allowed, `${rule.talkId}/${rule.from}`);
  }
  for (const block of talkBlocks) {
    const contexts = blockContexts.get(block.id)
      ?? (block.repeatOf ? blockContexts.get(block.repeatOf) : undefined)
      ?? [{ allowed: stateTemplateIds, sourceLabel: "独立またはhook block" }];
    for (const key of blockTemplateKeys(block)) {
      for (const context of contexts) {
        if (!context.allowed.has(key)) {
          errors.push(`${block.talkId}/${block.blockKey}: 未定義template {{${key}}} を ${context.sourceLabel} から解決できません。`);
        }
      }
    }
  }

  for (const talk of talks) {
    const talkRules = rules.filter((rule) => rule.talkId === talk.id);
    const fromIds = new Set(talkRules.filter((rule) => rule.from !== "*").map((rule) => rule.from));
    const startBlocks = talk.startBlocks.map((blockKey) => resolveScopedTalkBlockId(blockScope, talk.id, blockKey));
    const initialFrom = startBlocks.at(-1) ?? "";
    if (startBlocks.some((blockId) => !blockId)) errors.push(`${talk.id}: startBlocks に未定義blockがあります。`);
    if (startBlocks.some((blockId) => isRepeatTalkBlockId(blockScope, blockId))) errors.push(`${talk.id}: repeat生成blockをstartBlocksへ指定できません。`);
    for (const from of fromIds) {
      const defaults = talkRules.filter((rule) => rule.from === from && rule.isDefault);
      if (defaults.length !== 1) errors.push(`${talk.id}/${from}: default rule は1件必要です。`);
      const llmRules = talkRules.filter((rule) => rule.from === from && rule.type === "ai");
      if (llmRules.length) {
        for (const rule of llmRules) {
          if (!rule.intent || !rule.criteria || !rule.example) errors.push(`${talk.id}/${from}: LLM ruleはintent / criteria / exampleが必要です: ${rule.id}`);
        }
        if (!defaults[0]?.example) errors.push(`${talk.id}/${from}: LLMを使うfromのdefault ruleにはexampleが必要です。`);
      }
    }
    if (talkRules.some((rule) => rule.from === "*" && rule.isDefault)) errors.push(`${talk.id}: from=* にdefault ruleは指定できません。`);
    for (const rule of talkRules) {
      if (rule.nextBlocks.some((blockId) => !blockId)) errors.push(`${talk.id}/${rule.from}: nextに未定義blockがあります。`);
    }
  }
  if (searchAgentSource) {
    const talkRules = rules.filter((rule) => rule.talkId === "search_agent");
    const fromIds = new Set(talkRules.filter((rule) => rule.from !== "*").map((rule) => rule.from));
    if (searchStartBlocks.some((blockId) => !blockId)) errors.push("search_agent.startStepsに未定義blockがあります。");
    if (searchStartBlocks.some((blockId) => isRepeatTalkBlockId(blockScope, blockId))) {
      errors.push("search_agent.startStepsへrepeat生成blockを指定できません。");
    }
    for (const from of fromIds) {
      const defaults = talkRules.filter((rule) => rule.from === from && rule.isDefault);
      if (defaults.length !== 1) errors.push(`search_agent/${from}: default rule は1件必要です。`);
      const llmRules = talkRules.filter((rule) => rule.from === from && rule.type === "ai");
      for (const rule of llmRules) {
        if (!rule.intent || !rule.criteria || !rule.example) errors.push(`search_agent/${from}: LLM ruleはintent / criteria / exampleが必要です: ${rule.id}`);
      }
      if (llmRules.length && !defaults[0]?.example) errors.push(`search_agent/${from}: LLMを使うfromのdefault ruleにはexampleが必要です。`);
    }
    if (talkRules.some((rule) => rule.from === "*" && rule.isDefault)) errors.push("search_agent: from=* にdefault ruleは指定できません。");
    for (const rule of talkRules) {
      if (rule.nextBlocks.some((blockId) => !blockId)) errors.push(`search_agent/${rule.from}: nextに未定義blockがあります。`);
      if (!rule.mode && !rule.nextFromId) {
        errors.push(`search_agent/${rule.from}: nextの最後の無条件blockに対応するruleがありません。`);
      }
    }
  }

  const scenarioEventIds = [...new Set([
    ...hooks.filter((hook) => !hookEvents.has(hook.event)).map((hook) => hook.event),
    ...hooks.filter((hook) => hook.event === "scheduled_event").map((hook) => hook.target)
  ].filter(Boolean))];
  for (const schedule of initialSchedules) {
    if (!hooks.some((hook) => hook.event === "scheduled_event" && hook.target === schedule.eventId)) errors.push(`${schedule.id}: eventId に対応するscheduled_event hookがありません。`);
  }
  for (const [collection, items] of [
    ["todo", source.todos],
    ["notification", source.notifications],
    ["assistantMessage", source.assistantMessages]
  ]) {
    for (const item of Array.isArray(items) ? items : []) {
      validateCondition(`${collection} ${item?.id ?? ""}`, item?.cond, stateVariableDefinitions, errors);
    }
  }
  for (const notification of Array.isArray(source.notifications) ? source.notifications : []) {
    if (repairableTalkContentIds.has(notification?.targetContentId)) {
      errors.push(`${notification.id}: talk初期履歴の修復contentを通知対象にできません。`);
    }
  }
  validateCondition("chatAuthGate", source.chatAuthGate?.cond, stateVariableDefinitions, errors);
  validateCondition("chatAuthGate.linkSentCond", source.chatAuthGate?.linkSentCond, stateVariableDefinitions, errors);

  if (errors.length) throw new Error(errors.map((error) => `- ${error}`).join("\n"));

  if (!overrides.source) validateHookReferences(authoring.hookScripts, source, talkBlocks);
  rules = assignRuleIds(rules);
  const publicIds = {
    content: Object.fromEntries(contents.map((content) => [content.id, stableId("c", content.id)])),
    talk: Object.fromEntries(sourceTalks.map((talk) => [talk.id, stableId("t", talk.id)])),
    attachment: Object.fromEntries(attachments.map((attachment) => [attachment.id, stableId("a", attachment.id)])),
    incomingCall: Object.fromEntries(incomingCalls.map((call) => [call.id, stableId("call", call.id)])),
    form: Object.fromEntries(contents.flatMap((content) => {
      const form = content.record?.form;
      return form && typeof form === "object" && !Array.isArray(form) && typeof form.id === "string"
        ? [[form.id, stableId("form", form.id)]]
        : [];
    })),
    notification: Object.fromEntries((Array.isArray(source.notifications) ? source.notifications : []).map((notification) => [notification.id, stableId("notification", notification.id)])),
    generatedAudio: Object.fromEntries(generatedAudio.map((audio) => [audio.id, stableId("g", audio.id)])),
    scenarioEvent: Object.fromEntries(scenarioEventIds.map((eventId) => [eventId, stableId("e", eventId)]))
  };
  const seenPublicIds = new Set();
  for (const ids of Object.values(publicIds)) for (const id of Object.values(ids)) {
    if (seenPublicIds.has(id)) throw new Error(`公開IDが衝突しました: ${id}`);
    seenPublicIds.add(id);
  }
  const normalizedApps = apps.map((app) => ({
    ...app,
    icon: app.icon || `project:${app.id}`,
    search: normalizeSearchTerms(app.search),
    cond: String(app.cond ?? "").trim(),
    badgeCond: String(app.badgeCond ?? "").trim()
  }));
  const normalizedContents = contents.map((content) => {
    const record = Object.fromEntries(Object.entries(content.record ?? {}).filter(([key]) => key !== "unlockCode" && key !== "unlockLoadParts"));
    const talk = (content.appId === "messages" || content.appId === "chat")
      ? talks.find((item) => item.id === record.talk)
      : undefined;
    return {
      ...content,
      record: talk
        ? { ...record, block: resolveScopedTalkBlockId(blockScope, talk.id, record.block) }
        : record,
      search: normalizeSearchTerms(content.search),
      cond: String(content.cond ?? "").trim(),
      publicId: publicIds.content[content.id]
    };
  });
  const photoDescriptions = source.photoDescriptions && typeof source.photoDescriptions === "object" && !Array.isArray(source.photoDescriptions)
    ? Object.fromEntries(Object.entries(source.photoDescriptions).map(([id, description]) => [id, String(description).trim()]))
    : {};
  for (const [id, description] of Object.entries(photoDescriptions)) {
    if (!contents.some((content) => content.id === id && content.appId === "photos")) {
      errors.push(`photoDescriptions の対象が写真ではありません: ${id}`);
    }
    if (!description) errors.push(`photoDescriptions.${id} は空でない文字列にしてください。`);
  }
  const normalizedDeviceTalks = talks.map((talk) => ({
    ...talk,
    initialState: talk.initialState ?? "normal",
    search: normalizeSearchTerms(talk.search),
    cond: String(talk.cond ?? "").trim(),
    inputVisible: talk.inputVisible ?? true,
    inputEnabled: talk.inputEnabled ?? true,
    publicId: publicIds.talk[talk.id],
    startBlocks: talk.startBlocks.map((blockKey) => resolveScopedTalkBlockId(blockScope, talk.id, blockKey)),
    initialFrom: talk.startBlocks.length ? resolveScopedTalkBlockId(blockScope, talk.id, talk.startBlocks.at(-1)) : "",
    rules: rules.filter((rule) => rule.talkId === talk.id).map(({ talkId: _talkId, ...rule }) => rule)
  }));
  const normalizedSearchAgentTalk = {
    id: "search_agent",
    publicId: publicIds.talk.search_agent,
    kind: "search_agent",
    label: source.project?.assistantName ?? "検索AI",
    inputVisible: searchAgentSource?.inputVisible ?? true,
    inputEnabled: searchAgentSource?.inputEnabled ?? true,
    startSteps: searchStartSteps,
    initialFrom: searchInitialFrom,
    rules: rules.filter((rule) => rule.talkId === "search_agent").map(({ talkId: _talkId, ...rule }) => rule)
  };
  const normalizedTalkById = new Map([
    ...normalizedDeviceTalks.map((talk) => [talk.id, talk]),
    ["search_agent", normalizedSearchAgentTalk]
  ]);
  const normalizedTalks = sourceTalks.flatMap((talk) => normalizedTalkById.has(talk.id) ? [normalizedTalkById.get(talk.id)] : []);
  const normalizedAudio = generatedAudio.map((audio) => ({
    ...audio,
    publicId: publicIds.generatedAudio[audio.id],
    staticUrl: audio.provider === "static" ? `/api/generated-audio/static/${publicIds.generatedAudio[audio.id]}.wav` : ""
  }));
  const normalizedIncomingCalls = incomingCalls.map((call) => ({
    ...call,
    cond: String(call.cond ?? "").trim(),
    publicId: publicIds.incomingCall[call.id]
  }));
  const albumMediaAttachmentLinks = [...(source.albumMediaAttachmentLinks ?? []), ...attachments.flatMap((attachment) => {
    if (attachment.lock || !attachment.content || !["image", "audio", "video"].includes(attachment.type)) return [];
    const content = contents.find((item) => item.id === attachment.content);
    return content?.appId === "photos" ? [{ attachmentId: attachment.id, photoId: content.id }] : [];
  })].filter((link, index, links) => !attachmentsById.get(link.attachmentId)?.lock && links.findIndex((candidate) => candidate.attachmentId === link.attachmentId && candidate.photoId === link.photoId) === index);
  const lockedContentPasswords = contents.flatMap((content) => {
    const attachment = attachments.find(item => item.lock === "password" && item.content === content.id);
    if (!attachment && !projectAppById.has(content.appId)) return [];
    const password = typeof content.record?.unlockCode === "string" ? content.record.unlockCode : "";
    return password
      ? [{ contentId: content.id, target: attachment ? "attachment" : "content", answers: answerCandidates(password, true).map(candidate => candidate.value), loadParts: content.record.unlockLoadParts ?? [] }]
      : [];
  });
  const canonical = JSON.stringify({ source, rules, talkBlocks, hookScripts: authoring.hookScripts });
  const revision = createHash("sha256").update(canonical).digest("hex").slice(0, 16);
  const normalizedHooks = hooks.map((hook) => ({
    ...hook,
    target: hook.target ?? "",
    cond: hook.cond ?? "",
    llm: hook.llm === true
  }));
  const normalizedTodos = (Array.isArray(source.todos) ? source.todos : []).map((todo) => ({
    ...todo,
    cond: String(todo.cond ?? "").trim()
  }));
  const normalizedNotifications = (Array.isArray(source.notifications) ? source.notifications : []).map((notification) => ({
    ...notification,
    cond: String(notification.cond ?? "").trim()
  }));
  const normalizedAssistantMessages = (Array.isArray(source.assistantMessages) ? source.assistantMessages : []).map((message) => ({
    ...message,
    cond: String(message.cond ?? "").trim()
  }));
  const chatAuthGate = source.chatAuthGate && typeof source.chatAuthGate === "object" && !Array.isArray(source.chatAuthGate)
    ? {
        cond: String(source.chatAuthGate.cond ?? "").trim(),
        linkSentCond: String(source.chatAuthGate.linkSentCond ?? "").trim()
      }
    : null;
  if (chatAuthGate && !chatAuthGate.cond) errors.push("chatAuthGate.cond は必須です。");
  if (errors.length) throw new Error(errors.map((error) => `- ${error}`).join("\n"));
  const packageVersion = JSON.parse(fs.readFileSync(path.join(engineRootDir, "package.json"), "utf8")).version ?? "0.0.0";
  const baseProjectConstants = {
    ...(source.publicProjectConstants ?? {}),
    "project.id": source.project.id,
    "project.name": source.project.name,
    "device.os_name": source.project.osName,
    "device.lock_method": source.project.lockScreen.method,
    "device.lock_pin_length": source.project.lockScreen.method === "fixed-pin" ? source.project.lockScreen.pin.length : 0,
    "device.date": source.project.date,
    "device.wallpaper_url": source.project.wallpaperUrl,
    "search_agent.name": source.project.assistantName,
    "player.mode": playerMode,
    "player.access_code": source.project.accessCode,
    "searchAgent.broken_link_tutorial_body": source.projectConstants?.["search_agent.broken_link_tutorial_body"] ?? "",
    "searchAgent.broken_link_body": source.projectConstants?.["search_agent.broken_link_body"] ?? ""
  };
  const transcriptRevision = transcriptRevisionFor({
    version: 1,
    talks: normalizedTalks.map(({ search: _search, cond: _cond, repairLabel: _repairLabel, ...talk }) => talk),
    talkPeople,
    talkBlocks,
    attachments,
    publicIds: {
      content: publicIds.content,
      talk: publicIds.talk,
      attachment: publicIds.attachment
    },
    runtime: sourceSnapshot(["src/worker/talkEventsRuntime.ts", "src/worker/scenarioRuntime.ts", "src/worker/talkMessageClock.ts", "src/worker/talkDisplayClock.ts"])
  });
  const clientRevision = clientRevisionFor({
    packageVersion,
    projectConstants: baseProjectConstants,
    deviceState: deviceStateFor(source, publicIds, ""),
    publicIds,
    source: clientSourceSnapshot(playerMode)
  });
  const worker = {
    revision,
    clientRevision,
    transcriptRevision,
    playerMode,
    project: source.project,
    projectConstants: source.projectConstants ?? {},
    apps: normalizedApps,
    projectAppIds: projectApps.map((app) => app.id),
    features: { llm: source.features?.llm === true },
    stateVariables,
    stateVariableDefinitions,
    publicStateVariables,
    photoDescriptions,
    contents: normalizedContents,
    talks: normalizedTalks,
    talkPeople,
    talkBlocks,
    attachments,
    repeatTalkBlocks: Object.fromEntries(
      [...blockScope.repeatInfoByBlock.entries()].reduce((groups, [repeatId, info]) => {
        const variants = groups.get(info.repeatOf) ?? [];
        variants.push({ id: repeatId, index: info.repeatIndex });
        groups.set(info.repeatOf, variants);
        return groups;
      }, new Map()).entries().map(([baseId, variants]) => [
        baseId,
        variants.sort((left, right) => left.index - right.index).map((variant) => variant.id)
      ])
    ),
    incomingCalls: normalizedIncomingCalls,
    initialSchedules: initialSchedules.map((schedule) => ({ ...schedule, fields: schedule.fields ?? {} })),
    todos: normalizedTodos,
    notifications: normalizedNotifications,
    assistantMessages: normalizedAssistantMessages,
    chatAuthGate,
    clientCallableEvents,
    generatedAudio: normalizedAudio,
    albumMediaAttachmentLinks,
    lockedContentPasswords,
    hooks: normalizedHooks,
    publicIds
  };
  worker.parts = source.partIds ?? ["base"];
  worker.talkBlocks = worker.talkBlocks.map(block=>({...block,acceptsInput:worker.talks.some(talk=>talk.id===block.talkId && talk.rules.some(rule=>rule.from===block.id))}));
  worker.stateVariableParts = Object.fromEntries(Object.keys(stateVariables).map(id => [id, source.partOwnership?.stateVariables?.[id] ?? "base"]));
  for (const key of ["apps", "contents", "talks", "talkPeople", "attachments", "incomingCalls", "generatedAudio", "todos", "notifications", "assistantMessages", "hooks"]) {
    worker[key] = worker[key].map((item, index) => ({
      ...item, part: source.partOwnership?.[key]?.[key === "hooks" ? index : item.id] ?? "base", order: index
    }));
  }
  worker.lockedContentPasswords = worker.lockedContentPasswords.map(item => ({
    ...item, part: source.partOwnership?.passwords?.[item.contentId] ?? "base"
  }));
  function hookBlockTemplateKeys(block) {
    return [block, ...talkBlocks.filter((candidate) => candidate.repeatOf === block.id)]
      .flatMap((candidate) => blockTemplateKeys(candidate));
  }
  const hookTalkBlocksByTalk = Object.fromEntries(normalizedTalks.map((talk) => [
    talk.id,
    talkBlocks
      .filter((block) => (
        block.talkId === talk.id
        && !block.repeatOf
        && hookBlockTemplateKeys(block).every((key) => stateTemplateIds.has(key))
      ))
      .map((block) => block.blockKey)
  ]));
  worker.hookTalkBlocks = hookTalkBlocksByTalk;
  const partWarnings = validateScenarioParts(worker, {workbook:authoring.workbook, hookScripts:authoring.hookScripts});
  return {
    partWarnings,
    revision,
    clientRevision,
    transcriptRevision,
    worker,
    deviceState: deviceStateFor(source, publicIds, clientRevision),
    projectConstants: {
      ...baseProjectConstants,
      "client.runtime_revision": clientRevision
    },
    hookIds: [...hookIds].sort(),
    hookScripts: authoring.hookScripts,
    hookTalkBlocksByTalk,
    projectApps: projectApps.map((app) => ({ id: app.id, icon: app.icon }))
  };
}
