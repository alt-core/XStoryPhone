import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { evaluateCondition } from "../src/shared/condition.ts";
import { parseStoryDate } from "../src/shared/storyDate.ts";
import { collectScopedTalkBlocks, resolveScopedTalkBlockId } from "./lib/talk-blocks.mjs";

const rootDir = process.cwd();
const scenarioDir = path.join(rootDir, "scenario/demo");
const scenarioPath = path.join(scenarioDir, "scenario.json");
const talkFlowPath = path.join(scenarioDir, "authoring/talk_flow.tsv");
const talkBlocksPath = path.join(scenarioDir, "authoring/talk_blocks.tsv");
const idPattern = /^[a-z][a-z0-9_-]*$/u;
const supportedAppIds = new Set(["phone", "messages", "photos", "chat", "notes", "calendar", "radio"]);
const initialStates = new Set(["normal", "repairable", "hidden"]);

function parseTsv(source, label) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index <= source.length; index += 1) {
    const char = source[index] ?? "\n";
    if (quoted) {
      if (char === '"' && source[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
      continue;
    }
    if (char === '"' && cell === "") {
      quoted = true;
    } else if (char === "\t") {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      row.push(cell.replace(/\r$/u, ""));
      if (row.some((value) => value.trim())) {
        rows.push(row);
      }
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }

  if (quoted) {
    throw new Error(`${label} の引用符が閉じていません。`);
  }
  const [headers, ...values] = rows;
  if (!headers) {
    throw new Error(`${label} が空です。`);
  }
  return values.map((cells, index) => ({
    __rowNumber: index + 2,
    ...Object.fromEntries(headers.map((header, column) => [header.trim(), cells[column] ?? ""]))
  }));
}

function splitList(value) {
  return String(value ?? "").split(/\r?\n|;/u).map((item) => item.trim()).filter(Boolean);
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

function messageBody(value) {
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
      segments.push({ kind: "text", text: match[0] });
    }
    cursor = index + match[0].length;
  }
  if (cursor < body.length) segments.push({ kind: "text", text: body.slice(cursor) });
  return hasLink ? { body: segments.map((segment) => segment.text).join(""), segments } : { body };
}

function regexCriteriaError(criteria) {
  const source = criteria.trim();
  if (!source.startsWith("/")) return null;
  let escaped = false;
  let inClass = false;
  let end = -1;
  for (let index = 1; index < source.length; index += 1) {
    const char = source[index];
    if (escaped) escaped = false;
    else if (char === "\\") escaped = true;
    else if (char === "[") inClass = true;
    else if (char === "]") inClass = false;
    else if (char === "/" && !inClass) end = index;
  }
  if (end < 1) return "正規表現を閉じる / がありません。";
  try {
    new RegExp(source.slice(1, end), source.slice(end + 1));
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

function stableId(namespace, value) {
  return `${namespace}_${createHash("sha256").update(`xstoryphone:v2\0${namespace}\0${value}`).digest("hex").slice(0, 12)}`;
}

function splitAssignments(value) {
  return String(value ?? "").split(";").map((item) => item.trim()).filter(Boolean);
}

function validateCondition(label, value, stateVariables, errors) {
  if (value === undefined) return;
  if (typeof value !== "string") {
    errors.push(`${label}: cond は文字列にしてください。`);
    return;
  }
  try {
    const knownStateVariables = new Proxy(stateVariables, {
      get(target, key) {
        if (typeof key === "string" && !Object.hasOwn(target, key)) {
          throw new Error(`未定義の状態変数です: ${key}`);
        }
        return Reflect.get(target, key);
      }
    });
    evaluateCondition(value, knownStateVariables);
  } catch (error) {
    errors.push(`${label}: cond が不正です: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function validateProject(project, playerMode, errors) {
  const requiredStrings = ["id", "name", "osName", "assistantName", "accentColor", "date", "timeLabel", "signalLabel", "wallpaperUrl"];
  for (const key of requiredStrings) {
    if (typeof project?.[key] !== "string" || !project[key].trim()) {
      errors.push(`project.${key} は空でない文字列にしてください。`);
    }
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
  if (!new Set(["player-passcode", "fixed-pin", "none"]).has(lockScreen.method)) {
    errors.push("project.lockScreen.method は player-passcode、fixed-pin、none のいずれかにしてください。");
  } else if (lockScreen.method === "player-passcode" && playerMode === "browser") {
    errors.push("browserモードでは project.lockScreen.method に player-passcode を指定できません。");
  }
  if (lockScreen.method === "fixed-pin") {
    if (typeof lockScreen.pin !== "string" || !/^\d{4,8}$/u.test(lockScreen.pin)) {
      errors.push("project.lockScreen.pin は4桁から8桁の数字文字列にしてください。");
    }
  } else if (lockScreen.pin !== undefined) {
    errors.push("project.lockScreen.pin は fixed-pin の場合だけ指定してください。");
  }
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
    photos: ["title"],
    calendar: ["title", "date", "time", "place", "memo"],
    radio: ["programTitle"]
  };
  for (const key of requiredByApp[content.appId] ?? []) {
    if (typeof record[key] !== "string") {
      errors.push(`${content.id}: record.${key} は文字列にしてください。`);
    }
  }
  if (["notes", "photos"].includes(content.appId) && record.tags !== undefined) {
    if (!Array.isArray(record.tags) || record.tags.some((tag) => typeof tag !== "string" || !tag.trim())) {
      errors.push(`${content.id}: record.tags は文字列の配列にし、空文字を含めないでください。`);
    }
  }
  if (content.appId === "calendar" && typeof record.date === "string" && !parseStoryDate(record.date)) {
    errors.push(`${content.id}: record.date は YYYY-MM-DD 形式の実在する日付にしてください。`);
  }
}

function deviceStateFor(source, publicIds, revision) {
  const initialState = source.stateVariables ?? {};
  const notifications = source.notifications.filter((notification) => evaluateCondition(String(notification.cond ?? ""), initialState)).map((notification) => ({
    id: stableId("notification", notification.id),
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
    apps: source.apps.filter((app) => app.initialState !== "hidden" && evaluateCondition(String(app.cond ?? ""), initialState)).map((app) => ({
      id: app.id,
      label: app.initialState === "repairable" ? app.repairLabel : app.label,
      icon: app.icon,
      accent: app.accent,
      available: app.initialState === "normal",
      ...(app.initialState !== "normal" ? { initialState: app.initialState, repairLabel: app.repairLabel ?? app.label } : {})
    })),
    messages: [],
    photos: [],
    notes: [],
    calendarEvents: [],
    callLogs: [],
    radioItems: [],
    chatThreads: [],
    notifications,
    todos: []
  };
}

export function loadAndValidateScenario() {
  const errors = [];
  const source = JSON.parse(fs.readFileSync(scenarioPath, "utf8"));
  const rawRules = parseTsv(fs.readFileSync(talkFlowPath, "utf8"), "talk_flow.tsv")
    .filter((row) => !String(row.comment ?? "").trim().startsWith(";"));
  const rawBlocks = parseTsv(fs.readFileSync(talkBlocksPath, "utf8"), "talk_blocks.tsv");
  const blockScope = collectScopedTalkBlocks(rawBlocks, errors);

  if (source.schemaVersion !== 1) errors.push("schemaVersion は 1 にしてください。");
  const playerMode = source.playerMode ?? "server";
  if (!new Set(["server", "browser"]).has(playerMode)) errors.push("playerMode は server または browser にしてください。");
  validateProject(source.project, playerMode, errors);
  const publicStateVariables = Array.isArray(source.publicStateVariables)
    ? source.publicStateVariables.map((id) => String(id).trim())
    : [];
  if (source.publicStateVariables !== undefined && !Array.isArray(source.publicStateVariables)) {
    errors.push("publicStateVariables は配列にしてください。");
  }
  const seenPublicStateVariables = new Set();
  for (const id of publicStateVariables) {
    if (!idPattern.test(id) || !Object.hasOwn(source.stateVariables ?? {}, id)) {
      errors.push(`publicStateVariables の状態変数が未定義です: ${id}`);
    } else if (seenPublicStateVariables.has(id)) {
      errors.push(`publicStateVariables が重複しています: ${id}`);
    }
    seenPublicStateVariables.add(id);
  }

  const apps = Array.isArray(source.apps) ? source.apps : [];
  const appIds = new Set();
  for (const app of apps) {
    if (!idPattern.test(app?.id ?? "") || !supportedAppIds.has(app.id)) errors.push(`app id が不正です: ${app?.id ?? ""}`);
    else if (appIds.has(app.id)) errors.push(`app id が重複しています: ${app.id}`);
    appIds.add(app.id);
    if (!initialStates.has(app?.initialState)) errors.push(`${app?.id ?? "app"}: initialState が不正です。`);
    if (app?.initialState !== "normal" && !app?.repairLabel) errors.push(`${app?.id ?? "app"}: repairLabel が必要です。`);
    if (!Array.isArray(app?.search) || !app.search.length) errors.push(`${app?.id ?? "app"}: search が必要です。`);
    validateCondition(`app ${app?.id ?? ""}`, app?.cond, source.stateVariables ?? {}, errors);
  }

  const contents = Array.isArray(source.contents) ? source.contents : [];
  const contentIds = new Set();
  for (const content of contents) {
    if (!idPattern.test(content?.id ?? "")) errors.push(`content id が不正です: ${content?.id ?? ""}`);
    else if (contentIds.has(content.id)) errors.push(`content id が重複しています: ${content.id}`);
    contentIds.add(content.id);
    if (!appIds.has(content?.appId) || content.appId === "messages" || content.appId === "chat") errors.push(`${content?.id ?? "content"}: appId が不正です。`);
    if (!initialStates.has(content?.initialState)) errors.push(`${content?.id ?? "content"}: initialState が不正です。`);
    if (!Array.isArray(content?.search) || !content.search.length) errors.push(`${content?.id ?? "content"}: search が必要です。`);
    validateCondition(`content ${content?.id ?? ""}`, content?.cond, source.stateVariables ?? {}, errors);
    validateRecord(content, errors);
  }

  const talks = Array.isArray(source.talks) ? source.talks : [];
  const talkIds = new Set();
  for (const talk of talks) {
    if (!idPattern.test(talk?.id ?? "")) errors.push(`talk id が不正です: ${talk?.id ?? ""}`);
    else if (talkIds.has(talk.id)) errors.push(`talk id が重複しています: ${talk.id}`);
    talkIds.add(talk.id);
    if ((talk.kind !== "sms" && talk.kind !== "chat") || talk.appId !== (talk.kind === "sms" ? "messages" : "chat")) errors.push(`${talk?.id ?? "talk"}: kind と appId の組み合わせが不正です。`);
    if (!talk?.label || !Array.isArray(talk?.startBlocks) || talk.startBlocks.length === 0) {
      errors.push(`${talk?.id ?? "talk"}: label と startBlocks は必須です。`);
    }
    validateCondition(`talk ${talk?.id ?? ""}`, talk?.cond, source.stateVariables ?? {}, errors);
  }

  const talkPeople = Array.isArray(source.talkPeople) ? source.talkPeople : [];
  const talkPeopleById = new Map();
  for (const person of talkPeople) {
    if (!idPattern.test(person?.id ?? "") || !person?.name || !["owner", "npc"].includes(person?.role)) {
      errors.push(`talkPeople が不正です: ${person?.id ?? ""}`);
      continue;
    }
    if (talkPeopleById.has(person.id)) errors.push(`talkPeople id が重複しています: ${person.id}`);
    talkPeopleById.set(person.id, person);
  }

  const attachments = Array.isArray(source.attachments) ? source.attachments : [];
  const attachmentsById = new Map();
  for (const attachment of attachments) {
    if (!idPattern.test(attachment?.id ?? "") || !["image", "audio"].includes(attachment?.type) || !attachment?.asset) {
      errors.push(`attachment が不正です: ${attachment?.id ?? ""}`);
      continue;
    }
    if (attachmentsById.has(attachment.id)) errors.push(`attachment id が重複しています: ${attachment.id}`);
    if (attachment.content && !contentIds.has(attachment.content)) errors.push(`${attachment.id}: content が未定義です。`);
    if (attachment.lock && attachment.lock !== "password") errors.push(`${attachment.id}: lock が不正です。`);
    attachmentsById.set(attachment.id, attachment);
  }
  for (const attachment of attachments) {
    if (attachment.poster && attachmentsById.get(attachment.poster)?.type !== "image") {
      errors.push(`${attachment.id}: poster はimage attachmentを指定してください。`);
    }
    if (attachment.lock === "password") {
      const lockedContent = contents.find((content) => content.id === attachment.content);
      if (!lockedContent || typeof lockedContent.record?.unlockCode !== "string") {
        errors.push(`${attachment.id}: password lockにはunlockCodeを持つcontentが必要です。`);
      }
    }
  }

  const talkBlocks = [...blockScope.blocks.entries()].map(([id, rows]) => {
    const info = blockScope.infoById.get(id);
    if (!talkIds.has(info?.talkId ?? "")) errors.push(`${id}: 所属talkが未定義です。`);
    return {
      id,
      talkId: info?.talkId ?? "",
      blockKey: info?.blockKey ?? "",
      ...(info?.repeatOf ? { repeatOf: info.repeatOf, repeatIndex: info.repeatIndex } : {}),
      messages: rows.map((row, index) => {
        const sender = String(row.sender ?? "").trim();
        const attachmentId = String(row.attachment ?? "").trim();
        if (!talkPeopleById.has(sender)) errors.push(`talk_blocks.tsv:${row.__rowNumber}: sender が未定義です: ${sender}`);
        if (attachmentId && !attachmentsById.has(attachmentId)) errors.push(`talk_blocks.tsv:${row.__rowNumber}: attachment が未定義です: ${attachmentId}`);
        const delayMs = String(row.delay_ms ?? "").trim() ? Number(row.delay_ms) : undefined;
        if (delayMs !== undefined && (!Number.isInteger(delayMs) || delayMs < 0)) {
          errors.push(`talk_blocks.tsv:${row.__rowNumber}: delay_ms は0以上の整数にしてください。`);
        }
        if (!String(row.body ?? "") && !attachmentId) errors.push(`talk_blocks.tsv:${row.__rowNumber}: body または attachment が必要です。`);
        const content = messageBody(row.body);
        for (const segment of content.segments ?? []) {
          if (segment.kind !== "link" || !("contentId" in segment)) continue;
          const validApp = appIds.has(segment.appId);
          const validTarget = contentIds.has(segment.contentId) || talkIds.has(segment.contentId);
          if (!validApp || !validTarget) errors.push(`talk_blocks.tsv:${row.__rowNumber}: メッセージリンクの対象が未定義です。`);
        }
        return {
          id: `${id}_${index + 1}`,
          sender,
          ...content,
          attachmentId,
          sentAt: String(row.time ?? "").trim(),
          ...(delayMs === undefined ? {} : { delayMs }),
          notes: String(row.notes ?? "").trim(),
          updatedAt: String(row.updated_at ?? "").trim(),
          source: String(row.source ?? "").trim()
        };
      })
    };
  });

  const generatedAudio = Array.isArray(source.generatedAudio) ? source.generatedAudio : [];
  const generatedAudioIds = new Set(generatedAudio.map((item) => item.id));
  for (const audio of generatedAudio) {
    if (!idPattern.test(audio?.id ?? "") || !idPattern.test(audio?.provider ?? "") || !audio?.title) errors.push(`generatedAudio が不正です: ${audio?.id ?? ""}`);
  }

  const incomingCalls = Array.isArray(source.incomingCalls) ? source.incomingCalls : [];
  const incomingCallIds = new Set();
  for (const call of incomingCalls) {
    if (!idPattern.test(call?.id ?? "") || !call?.name) errors.push(`incomingCall が不正です: ${call?.id ?? ""}`);
    if (incomingCallIds.has(call.id)) errors.push(`incomingCall id が重複しています: ${call.id}`);
    incomingCallIds.add(call.id);
  }

  const initialSchedules = Array.isArray(source.initialSchedules) ? source.initialSchedules : [];
  const scheduleIds = new Set();
  for (const schedule of initialSchedules) {
    if (!idPattern.test(schedule?.id ?? "") || !idPattern.test(schedule?.eventId ?? "") || !Number.isInteger(schedule?.delayMs) || schedule.delayMs < 0) {
      errors.push(`initialSchedule が不正です: ${schedule?.id ?? ""}`);
    }
    if (scheduleIds.has(schedule.id)) errors.push(`initialSchedule id が重複しています: ${schedule.id}`);
    if (schedule.fields !== undefined && (!schedule.fields || typeof schedule.fields !== "object" || Array.isArray(schedule.fields))) {
      errors.push(`${schedule.id}: fields はobjectにしてください。`);
    }
    scheduleIds.add(schedule.id);
  }

  const hooks = Array.isArray(source.hooks) ? source.hooks : [];
  const hookEvents = new Set(["session_started", "content_repaired", "content_opened", "content_unlocked", "talk_sent", "scenario_event"]);
  const hookIds = new Set();
  for (const hook of hooks) {
    if (!hookEvents.has(hook?.event)) errors.push(`hook event が不正です: ${hook?.event ?? ""}`);
    if (!idPattern.test(hook?.handler ?? "")) errors.push(`hook handler id が不正です: ${hook?.handler ?? ""}`);
    hookIds.add(hook.handler);
    if (["content_repaired", "content_opened", "content_unlocked"].includes(hook.event) && !contentIds.has(hook.target)) errors.push(`${hook.handler}: targetが未定義です。`);
    if (source.features?.llm !== true && hook?.llm === true) errors.push(`${hook.handler}: LLM無効時はllm hookを使用できません。`);
    if (hook?.clientCallable !== undefined) errors.push(`${hook.handler}: clientCallable はhookではなくclientCallableEventsへ指定してください。`);
    validateCondition(`hook ${hook?.handler ?? ""}`, hook?.cond, source.stateVariables ?? {}, errors);
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
    if (!hooks.some((hook) => hook.event === "scenario_event" && hook.target === eventId)) {
      errors.push(`clientCallableEvents に対応するscenario_event hookがありません: ${eventId}`);
    }
    seenClientCallableEvents.add(eventId);
  }

  const rules = rawRules.map((row) => {
    const label = `talk_flow.tsv:${row.__rowNumber}`;
    const order = row.__rowNumber;
    if (!talkIds.has(row.talk)) errors.push(`${label}: 未定義のtalkです: ${row.talk}`);
    if (!row.from || !row.next) errors.push(`${label}: from と next は必須です。`);
    const isDefault = !String(row.intent ?? "").trim() && !String(row.match ?? "").trim();
    const criteria = String(row.criteria ?? "").trim();
    const match = String(row.match ?? "").trim();
    if (isDefault && (criteria || match)) errors.push(`${label}: default rule に criteria / match は書けません。`);
    if (!isDefault && !criteria) errors.push(`${label}: defaultでないruleにはcriteriaが必要です。`);
    const regexError = regexCriteriaError(criteria);
    if (regexError) errors.push(`${label}: criteria が不正です: ${regexError}`);
    if (source.features?.llm !== true && criteria && !criteria.startsWith("/")) errors.push(`${label}: LLM無効時は自然文criteriaを使用できません。`);
    if (source.features?.llm !== true && match) errors.push(`${label}: LLM無効時はmatchを使用できません。`);
    if (match) {
      try {
        const parsed = JSON.parse(match);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
      } catch {
        errors.push(`${label}: match はJSON objectにしてください。`);
      }
    }
    const mode = String(row.mode ?? "").trim();
    if (!["", "stay", "game_over"].includes(mode)) errors.push(`${label}: modeが不正です。`);
    const assignments = splitAssignments(row.set);
    validateCondition(label, row.cond, source.stateVariables ?? {}, errors);
    for (const assignment of assignments) {
      const found = /^([A-Za-z_][A-Za-z0-9_.-]*)\s*=/u.exec(assignment);
      if (!found || !(found[1] in (source.stateVariables ?? {}))) errors.push(`${label}: 状態更新が不正です: ${assignment}`);
    }
    return {
      id: stableId("rule", `${row.talk}\0${row.from}\0${order}\0${criteria}\0${row.next}`),
      talkId: row.talk,
      order,
      from: row.from === "*" ? "*" : resolveScopedTalkBlockId(blockScope, row.talk, row.from),
      isDefault,
      cond: String(row.cond ?? "").trim(),
      intent: String(row.intent ?? "").trim(),
      criteria,
      match,
      nextBlocks: splitList(row.next).map((blockKey) => resolveScopedTalkBlockId(blockScope, row.talk, blockKey)),
      set: assignments,
      mode,
      notes: String(row.notes ?? "").trim(),
      example: String(row.example ?? "").trim()
    };
  });

  for (const talk of talks) {
    const talkRules = rules.filter((rule) => rule.talkId === talk.id);
    const fromIds = new Set(talkRules.filter((rule) => rule.from !== "*").map((rule) => rule.from));
    const startBlocks = talk.startBlocks.map((blockKey) => resolveScopedTalkBlockId(blockScope, talk.id, blockKey));
    const initialFrom = startBlocks.at(-1) ?? "";
    if (startBlocks.some((blockId) => !blockId)) errors.push(`${talk.id}: startBlocks に未定義blockがあります。`);
    if (!fromIds.has(initialFrom)) errors.push(`${talk.id}: startBlocksの最後に対応するruleがありません。`);
    for (const from of fromIds) {
      const defaults = talkRules.filter((rule) => rule.from === from && rule.isDefault);
      if (defaults.length !== 1) errors.push(`${talk.id}/${from}: default rule は1件必要です。`);
    }
    for (const rule of talkRules) {
      if (rule.nextBlocks.some((blockId) => !blockId)) errors.push(`${talk.id}/${rule.from}: nextに未定義blockがあります。`);
      const nextFrom = rule.nextBlocks.at(-1) ?? "";
      if (!rule.mode && !fromIds.has(nextFrom)) errors.push(`${talk.id}/${rule.from}: nextの最後に対応するruleがありません。`);
    }
  }

  const scenarioEventIds = [...new Set(
    hooks.filter((hook) => hook.event === "scenario_event").map((hook) => hook.target).filter(Boolean)
  )];
  for (const schedule of initialSchedules) {
    if (!scenarioEventIds.includes(schedule.eventId)) errors.push(`${schedule.id}: eventId に対応するscenario_event hookがありません。`);
  }
  for (const [collection, items] of [
    ["todo", source.todos],
    ["notification", source.notifications],
    ["assistantMessage", source.assistantMessages],
    ["searchResponse", source.searchResponses]
  ]) {
    for (const item of Array.isArray(items) ? items : []) {
      validateCondition(`${collection} ${item?.id ?? ""}`, item?.cond, source.stateVariables ?? {}, errors);
    }
  }
  validateCondition("chatAuthGate", source.chatAuthGate?.cond, source.stateVariables ?? {}, errors);
  validateCondition("chatAuthGate.linkSentCond", source.chatAuthGate?.linkSentCond, source.stateVariables ?? {}, errors);

  if (errors.length) throw new Error(errors.map((error) => `- ${error}`).join("\n"));

  const publicIds = {
    content: Object.fromEntries(contents.map((content) => [content.id, stableId("c", content.id)])),
    talk: Object.fromEntries(talks.map((talk) => [talk.id, stableId("t", talk.id)])),
    generatedAudio: Object.fromEntries(generatedAudio.map((audio) => [audio.id, stableId("g", audio.id)])),
    scenarioEvent: Object.fromEntries(scenarioEventIds.map((eventId) => [eventId, stableId("e", eventId)]))
  };
  const normalizedApps = apps.map((app) => ({ ...app, cond: String(app.cond ?? "").trim() }));
  const normalizedContents = contents.map((content) => ({ ...content, cond: String(content.cond ?? "").trim(), publicId: publicIds.content[content.id] }));
  const normalizedTalks = talks.map((talk) => ({
    ...talk,
    cond: String(talk.cond ?? "").trim(),
    publicId: publicIds.talk[talk.id],
    startBlocks: talk.startBlocks.map((blockKey) => resolveScopedTalkBlockId(blockScope, talk.id, blockKey)),
    initialFrom: resolveScopedTalkBlockId(blockScope, talk.id, talk.startBlocks.at(-1)),
    rules: rules.filter((rule) => rule.talkId === talk.id).map(({ talkId: _talkId, ...rule }) => rule)
  }));
  const normalizedAudio = generatedAudio.map((audio) => ({
    ...audio,
    publicId: publicIds.generatedAudio[audio.id],
    staticUrl: `/api/generated-audio/static/${publicIds.generatedAudio[audio.id]}`
  }));
  const canonical = JSON.stringify({ source, rules, talkBlocks });
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
  const searchResponses = Array.isArray(source.searchResponses) ? source.searchResponses : [];
  for (const response of searchResponses) {
    if (!idPattern.test(response?.id ?? "") || !["", "found", "not_found"].includes(response?.when ?? "") || !response?.body) {
      errors.push(`searchResponse が不正です: ${response?.id ?? ""}`);
    }
    if (response?.search !== undefined && !Array.isArray(response.search)) errors.push(`${response?.id ?? "searchResponse"}: search は配列にしてください。`);
  }
  const normalizedSearchResponses = searchResponses.map((response) => ({
    ...response,
    when: response.when ?? "",
    search: Array.isArray(response.search) ? response.search.map(String) : [],
    cond: String(response.cond ?? "").trim(),
    suppressResults: response.suppressResults === true
  }));
  const chatAuthGate = source.chatAuthGate && typeof source.chatAuthGate === "object" && !Array.isArray(source.chatAuthGate)
    ? {
        cond: String(source.chatAuthGate.cond ?? "").trim(),
        linkSentCond: String(source.chatAuthGate.linkSentCond ?? "").trim()
      }
    : null;
  if (chatAuthGate && !chatAuthGate.cond) errors.push("chatAuthGate.cond は必須です。");
  if (errors.length) throw new Error(errors.map((error) => `- ${error}`).join("\n"));
  const worker = {
    revision,
    playerMode,
    project: source.project,
    apps: normalizedApps,
    features: { llm: source.features?.llm === true },
    stateVariables: source.stateVariables ?? {},
    publicStateVariables,
    contents: normalizedContents,
    talks: normalizedTalks,
    talkPeople,
    talkBlocks,
    attachments,
    repeatTalkBlocks: Object.fromEntries(blockScope.repeatIdsByBase),
    incomingCalls,
    initialSchedules: initialSchedules.map((schedule) => ({ ...schedule, fields: schedule.fields ?? {} })),
    todos: normalizedTodos,
    notifications: normalizedNotifications,
    assistantMessages: normalizedAssistantMessages,
    searchResponses: normalizedSearchResponses,
    chatAuthGate,
    clientCallableEvents,
    generatedAudio: normalizedAudio,
    hooks: normalizedHooks,
    publicIds
  };
  return {
    revision,
    worker,
    deviceState: deviceStateFor(source, publicIds, revision),
    projectConstants: {
      "project.id": source.project.id,
      "project.name": source.project.name,
      "device.os_name": source.project.osName,
      "device.lock_method": source.project.lockScreen.method,
      "device.lock_pin_length": source.project.lockScreen.method === "fixed-pin" ? source.project.lockScreen.pin.length : 0,
      "device.date": source.project.date,
      "device.wallpaper_url": source.project.wallpaperUrl,
      "search_agent.name": source.project.assistantName,
      "player.mode": playerMode,
      "searchAgent.broken_link_tutorial_body": `ごめんなさい。アプリへのリンクが破損しています。右下の${source.project.assistantName}を開いて「メッセージ」と検索してみてください。`,
      "searchAgent.broken_link_body": `リンクが破損しています。中身が分かれば、${source.project.assistantName}の検索結果から開けるかもしれません。`,
      "client.runtime_revision": revision
    },
    hookIds: [...hookIds].sort()
  };
}
