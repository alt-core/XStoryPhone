import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { activeRows, loadTsvSheet, splitList, text } from "./tsv-utils.mjs";
import { applyScenarioAuthoringSheetInheritance } from "./scenario-authoring-inheritance.mjs";
import { normalizeRadioCues } from "./radio-cues.mjs";
import { answerCandidates } from "../../src/shared/talkCriteria.ts";
import { projectApps } from "../../src/project/apps.ts";

// Sheetsの制作表を入力とし、現在の共通実行modelへ変換する。JSONは接続設定だけ。
const common = ["comment", "id", "cond", "initial", "search", "repair_label", "notes"];
export const AUTHORING_COLUMNS = {
  project_constants: ["comment", "key", "value", "exposure", "notes"],
  state_vars: ["comment", "id", "type", "initial", "values", "public", "notes"],
  home_items: [...common, "label", "icon", "accent", "badge_cond"],
  message_items: [...common, "name", "avatar", "start", "input_visible", "input_enabled"],
  chat_items: [...common, "name", "avatar", "start", "input_visible", "input_enabled"],
  call_items: [...common, "name", "kind", "at", "duration", "audio", "gen_audio", "transcript"],
  gen_audio: ["comment", "id", "title", "provider", "notes"],
  incoming_calls: ["comment", "id", "name", "cond", "audio", "transcript", "notes"],
  todo_items: ["comment", "id", "text", "cond", "notes"],
  hooks: ["comment", "event", "target", "cond", "script", "notes", "id", "llm"],
  passwords: ["comment", "content", "password", "load_part", "notes"],
  calendar_items: [...common, "title", "date", "time", "place", "memo"],
  photo_items: [...common, "image", "description", "audio", "video", "title", "tags"],
  note_items: [...common, "title", "body", "tags"],
  radio_items: [...common, "title", "audio", "gen_audio", "cues", "playback_cond", "playback_disabled_label", "form_kind", "form_id", "form_label", "form_url", "form_disabled_cond", "transcript"],
  notifications: ["comment", "id", "app", "target", "title", "body", "cond", "notes"],
  talk_people: ["comment", "id", "name", "role", "avatar", "notes"],
  talk_flow: ["comment", "talk", "from", "cond", "intent", "type", "text", "example", "extract", "next", "mode", "set", "notes"],
  talk_blocks: ["comment", "sender", "body", "attachment", "time", "delay_ms", "notes", "updated_at", "source", "quick_replies"],
  assistant_messages: ["comment", "id", "surface", "body", "weight", "cond", "agent_action", "notes"],
  attachments: ["comment", "id", "type", "asset", "content", "lock", "title", "body", "search", "search_app", "notes", "poster", "cond"],
  mail_items: [...common, "from", "to", "cc", "subject", "date", "body"],
  browser_items: [...common, "title", "url", "allowed_urls"],
  talk_history: [...common, "talk", "block"],
  schedules: ["comment", "id", "event", "delay_ms", "fields", "notes"],
  project_items: [...common, "app", "record"]
};

const optionalTables = new Set(["mail_items", "browser_items", "talk_history", "schedules", "project_items"]);
const requiredColumns = {
  project_constants: ["key", "value", "exposure"], state_vars: ["id", "type", "initial"],
  home_items: ["id", "label", "icon", "accent"], message_items: ["id", "name", "start"], chat_items: ["id", "name", "start"],
  call_items: ["id", "name", "kind", "duration"], gen_audio: ["id", "title", "provider"],
  incoming_calls: ["id", "name", "cond"], todo_items: ["id", "text"], hooks: ["event", "target", "cond", "script"],
  passwords: ["content", "password"], calendar_items: ["id", "title", "date", "time"],
  photo_items: ["id", "image", "description", "audio"], note_items: ["id", "title", "body"],
  radio_items: ["id", "title", "audio", "cues"], notifications: ["id", "app", "target", "title", "body"],
  talk_people: ["id", "name", "role", "avatar"], talk_flow: ["talk", "from", "cond", "intent", "type", "text", "example", "extract", "next", "mode"],
  talk_blocks: ["sender"], assistant_messages: ["id", "surface", "body"], attachments: ["id", "type", "asset", "search", "search_app", "poster"]
};
const requiredCells = {
  project_constants: ["key", "exposure"], state_vars: ["id", "type"],
  home_items: ["id", "label", "icon", "accent"], message_items: ["id", "name"], chat_items: ["id", "name"],
  call_items: ["id", "name", "kind", "duration"], gen_audio: ["id", "title", "provider"],
  incoming_calls: ["id", "name"], todo_items: ["id", "text"], hooks: ["event", "script"],
  passwords: ["content", "password"], calendar_items: ["id", "title", "date", "time"],
  photo_items: ["id"], note_items: ["id", "title", "body"], radio_items: ["id", "title"],
  notifications: ["id", "app", "target", "title", "body"], talk_people: ["id", "name", "role"],
  talk_flow: ["talk", "from", "type"], assistant_messages: ["id", "surface", "body"], attachments: ["id", "type"],
  mail_items: ["id", "from", "to", "subject", "date", "body"], browser_items: ["id", "title", "url"],
  talk_history: ["id", "talk", "block"], schedules: ["id", "event", "delay_ms"], project_items: ["id", "app", "record"]
};

export function readAuthoringManifest(scenarioDir) {
  const file = path.join(scenarioDir, "scenario.source.json");
  const manifest = JSON.parse(fs.readFileSync(file, "utf8"));
  const authoring = manifest.scenarioAuthoring;
  if (!authoring || authoring.sourceMode !== "tsv-export-first" || !authoring.exportDir || !authoring.tables) {
    throw new Error(`${file}: scenarioAuthoringのsourceMode/exportDir/tablesが必要です。`);
  }
  for (const id of Object.keys(AUTHORING_COLUMNS)) {
    if (!optionalTables.has(id) && !authoring.tables[id]) throw new Error(`必須制作表がありません: ${id}`);
  }
  for (const id of Object.keys(authoring.tables)) {
    if (!AUTHORING_COLUMNS[id]) throw new Error(`未知の制作表です: ${id}`);
  }
  if (new Set(Object.values(authoring.tables)).size !== Object.keys(authoring.tables).length) throw new Error("複数の制作表に同じSheet名を指定できません。");
  return { ...authoring, exportDir: path.resolve(scenarioDir, authoring.exportDir) };
}

export function loadWorkbook(authoring) {
  const workbook = {};
  for (const [tableId, sheetName] of Object.entries(authoring.tables)) {
    if (typeof sheetName !== "string" || !sheetName || /[\/\\]/u.test(sheetName)) throw new Error(`Sheet名が不正です: ${tableId}`);
    const sheet = loadTsvSheet(path.join(authoring.exportDir, `${sheetName}.tsv`), { trimHeaders: true, normalizeNewlines: true });
    const headerSet = new Set(sheet.headers);
    if (sheet.headers[0] !== "comment") throw new Error(`${tableId}: 必須headerがありません: comment（A列）`);
    if (headerSet.size !== sheet.headers.length) throw new Error(`${tableId}: headerが重複しています。`);
    for (const name of requiredColumns[tableId] ?? []) {
      if (!headerSet.has(name)) throw new Error(`${tableId}: 必須headerがありません: ${name}`);
    }
    for (const name of sheet.headers) {
      if (!AUTHORING_COLUMNS[tableId].includes(name)) throw new Error(`${tableId}: 未知または廃止済みのheaderです: ${name}`);
    }
    if (tableId !== "talk_blocks" && sheet.rows.some((row) => text(row, "comment").startsWith("*"))) {
      throw new Error(`${tableId}: *宣言はtalk_blocksでのみ使用できます。`);
    }
    // 空の行は継承値だけの有効行へ変換しない。元の行番号はエラー表示用に保持する。
    sheet.rows = sheet.rows.filter((row) => sheet.headers.some((header) => text(row, header)));
    workbook[tableId] = applyScenarioAuthoringSheetInheritance(tableId, sheet);
    for (const row of activeRows(workbook[tableId].rows)) for (const column of requiredCells[tableId] ?? []) {
      if (!text(row, column)) throw new Error(`${tableId}!${row.__rowNumber}: ${column}は必須です。`);
    }
  }
  return workbook;
}

function jsonCell(row, key, fallback) {
  if (!text(row, key)) return fallback;
  try { return JSON.parse(row[key]); } catch { throw new Error(`制作表!${row.__rowNumber}: ${key}はJSONで指定してください。`); }
}

function booleanCell(value, label, fallback) {
  if (value === undefined || String(value).trim() === "") return fallback;
  if (String(value).trim() === "true") return true;
  if (String(value).trim() === "false") return false;
  throw new Error(`${label}: true/falseで指定してください。`);
}

function searchTerms(value) {
  return splitList(value).map((line) => {
    const terms = line.split(/[\s\u3000]+/u).filter(Boolean);
    return terms.length === 1 ? terms[0] : terms;
  });
}

function optional(row, mapping) {
  return Object.fromEntries(Object.entries(mapping).filter(([column]) => text(row, column)).map(([column, key]) => [key, column === "body" ? String(row[column]) : text(row, column)]));
}

function integerCell(row, column, label) {
  const value = text(row, column);
  if (!/^-?\d+$/u.test(value) || !Number.isSafeInteger(Number(value))) throw new Error(`${label}: ${column}は整数で指定してください。`);
  return Number(value);
}

function item(row, appId, record) {
  const initialState = text(row, "initial") || "normal";
  return {
    id: text(row, "id"), appId, initialState, cond: text(row, "cond"), search: searchTerms(row.search),
    ...(initialState === "repairable" ? { repairLabel: text(row, "repair_label") || "破損データ" } : {}), record
  };
}

export function compileScenarioAuthoring(workbook) {
  const rows = (id) => activeRows(workbook[id]?.rows ?? []);
  const constants = {};
  const publicConstants = {};
  for (const row of rows("project_constants")) {
    const key = text(row, "key");
    if (!/^[a-z][a-z0-9_.-]*$/u.test(key) || Object.hasOwn(constants, key)) throw new Error(`project_constants!${row.__rowNumber}: keyが不正または重複です。`);
    const exposure = text(row, "exposure");
    if (exposure !== "public" && exposure !== "private") throw new Error(`project_constants!${row.__rowNumber}: exposureはpublic/privateです。`);
    if (["client.runtime_revision", "client.public_id_revision", "device.lock_pin_length"].includes(key)) throw new Error(`${key}は自動生成される予約定数です。`);
    if (key === "device.lock_pin" && exposure === "public") throw new Error("固定PINはprivateにしてください。");
    if (["search_agent.broken_link_tutorial_body", "search_agent.broken_link_body"].includes(key) && exposure !== "public") {
      throw new Error(`${key}は初期画面で使う案内文のため、exposureをpublicにしてください。`);
    }
    constants[key] = String(row.value ?? "");
    if (exposure === "public") publicConstants[key] = constants[key];
  }
  const value = (key, fallback = "") => constants[key] ?? fallback;
  const required = ["project.id", "project.name", "device.os_name", "search_agent.name", "device.date", "device.time_label", "search_agent.start", "search_agent.broken_link_tutorial_body", "search_agent.broken_link_body"];
  for (const key of required) if (!value(key)) throw new Error(`project_constants: 必須定数がありません: ${key}`);
  const stateVariables = {};
  const publicStateVariables = [];
  for (const row of rows("state_vars")) {
    const id = text(row, "id"), type = text(row, "type");
    if (Object.hasOwn(stateVariables, id)) throw new Error(`state_vars: idが重複しています: ${id}`);
    const initial = type === "boolean" ? booleanCell(row.initial, `state_vars.${id}.initial`)
      : type === "integer" ? integerCell(row, "initial", `state_vars.${id}`) : String(row.initial ?? "");
    stateVariables[id] = { type, initial, ...(type === "enum" ? { values: splitList(row.values) } : {}) };
    if (booleanCell(row.public, `state_vars.${id}.public`, false)) publicStateVariables.push(id);
  }
  const attachments = rows("attachments").map((row) => ({
    id: text(row, "id"), type: text(row, "type"),
    ...optional(row, { asset: "asset", content: "content", lock: "lock", title: "title", body: "body", poster: "poster", search_app: "searchApp", cond: "cond" }),
    ...(text(row, "search") ? { search: searchTerms(row.search) } : {})
  }));
  const byAttachment = new Map(attachments.map((attachment) => [attachment.id, attachment]));
  function asset(id, type) {
    if (!id) return undefined;
    const attachment = byAttachment.get(id);
    if (!attachment || attachment.type !== type) throw new Error(`素材参照が不正です: ${id} (${type})`);
    return id;
  }
  const apps = rows("home_items").map((row) => ({
    id: text(row, "id"), label: text(row, "label"), icon: text(row, "icon"), accent: text(row, "accent"),
    initialState: text(row, "initial") || "normal", cond: text(row, "cond"), search: searchTerms(row.search),
    ...optional(row, { repair_label: "repairLabel", badge_cond: "badgeCond" }),
    ...(text(row, "initial") && text(row, "initial") !== "normal" && !text(row, "repair_label") ? { repairLabel: "破損アプリ" } : {})
  }));
  const talks = ["message_items", "chat_items"].flatMap((id) => rows(id).map((row) => ({
    id: text(row, "id"), kind: id === "message_items" ? "sms" : "chat", appId: id === "message_items" ? "messages" : "chat",
    label: text(row, "name"), startBlocks: splitList(row.start), initialState: text(row, "initial") || "normal",
    search: searchTerms(row.search), cond: text(row, "cond"), ...optional(row, { avatar: "avatarUrl", repair_label: "repairLabel" }),
    inputVisible: booleanCell(row.input_visible, `${id}.input_visible`, true), inputEnabled: booleanCell(row.input_enabled, `${id}.input_enabled`, true)
  })));
  talks.push({ id: "search_agent", kind: "search_agent", startSteps: splitList(value("search_agent.start")),
    inputVisible: booleanCell(value("search_agent.input_visible"), "search_agent.input_visible", true),
    inputEnabled: booleanCell(value("search_agent.input_enabled"), "search_agent.input_enabled", true) });
  const contents = [];
  const photoDescriptions = {};
  const mediaLinks = [];
  for (const row of rows("note_items")) contents.push(item(row, "notes", { title: row.title ?? "", body: row.body ?? "", ...(text(row, "tags") ? { tags: splitList(row.tags) } : {}) }));
  for (const row of rows("photo_items")) {
    const image = text(row, "image"), audio = text(row, "audio"), video = text(row, "video");
    if (!image && !video) throw new Error(`photo_items.${row.id}: imageまたはvideoが必要です。`);
    const record = { title: text(row, "title"), ...(image ? { imageAttachmentId: asset(image, "image") } : {}),
      ...(video ? { mediaKind: "video", videoAttachmentId: asset(video, "video") } : audio ? { mediaKind: "still_video", audioAttachmentId: asset(audio, "audio") } : {}),
      ...(text(row, "tags") ? { tags: splitList(row.tags) } : {}) };
    contents.push(item(row, "photos", record));
    if (text(row, "description")) photoDescriptions[row.id] = row.description;
    const attachmentId = video || audio || image;
    if (attachmentId) mediaLinks.push({ attachmentId, photoId: text(row, "id") });
  }
  for (const row of rows("calendar_items")) contents.push(item(row, "calendar", Object.fromEntries(["title", "date", "time", "place", "memo"].map((key) => [key, row[key] ?? ""]))));
  for (const row of rows("call_items")) contents.push(item(row, "phone", {
    name: row.name ?? "", kind: text(row, "kind"), at: row.at ?? "", durationLabel: row.duration ?? "",
    ...(text(row, "audio") ? { audioAttachmentId: asset(text(row, "audio"), "audio") } : {}),
    ...optional(row, { gen_audio: "genAudioId" }), ...(text(row, "transcript") ? { transcript: jsonCell(row, "transcript") } : {})
  }));
  for (const row of rows("radio_items")) {
    const audio = splitList(row.audio);
    const record = { programTitle: row.title ?? "", ...optional(row, { gen_audio: "genAudioId", playback_cond: "playbackCond", playback_disabled_label: "playbackDisabledLabel", form_disabled_cond: "formDisabledCond" }),
      ...(text(row, "transcript") ? { transcript: jsonCell(row, "transcript") } : {}) };
    if (audio.length === 1 && !audio[0].startsWith("gen_audio:")) record.audioAttachmentId = asset(audio[0], "audio");
    else if (audio.length) record.audioSegments = audio.map((id) => id.startsWith("gen_audio:")
      ? { kind: "generated", genAudioId: id.slice(10) } : { kind: "audio", audioAttachmentId: asset(id, "audio") });
    if (text(row, "cues")) record.audioCues = normalizeRadioCues(row).map(({ id, atMs }) => ({ id, atMs }));
    if (text(row, "form_kind")) {
      if (text(row, "form_kind") !== "html") throw new Error(`radio_items.${row.id}: form_kindはhtmlです。`);
      record.form = { id: text(row, "form_id"), kind: "html", label: row.form_label ?? "", url: text(row, "form_url") };
    }
    contents.push(item(row, "radio", record));
  }
  for (const row of rows("mail_items")) contents.push(item(row, "mail", { ...Object.fromEntries(["from", "to", "subject", "date", "body"].map((key) => [key, row[key] ?? ""])), ...optional(row, { cc: "cc" }) }));
  for (const row of rows("browser_items")) contents.push(item(row, "browser", { title: row.title ?? "", url: text(row, "url"), ...(text(row, "allowed_urls") ? { allowedUrls: splitList(row.allowed_urls) } : {}) }));
  for (const row of rows("talk_history")) {
    const talk = talks.find((talk) => talk.id === text(row, "talk") && talk.kind !== "search_agent");
    if (!talk) throw new Error(`talk_history.${row.id}: talkが未定義です。`);
    contents.push(item(row, talk.appId, { talk: talk.id, block: text(row, "block") }));
  }
  for (const row of rows("project_items")) contents.push(item(row, text(row, "app"), jsonCell(row, "record", {})));
  const projectContentIds = new Set(rows("project_items").map(row => text(row, "id")));
  const passwords = new Set();
  for (const row of rows("passwords")) {
    const id = text(row, "content");
    const password = text(row, "password");
    const candidates = answerCandidates(password, true);
    if (candidates.some(candidate => candidate.value.length > 80)) throw new Error(`passwords.${id}: 各候補は80文字以内にしてください。`);
    if (passwords.has(id)) throw new Error(`passwords: contentが重複しています: ${id}`);
    passwords.add(id);
    let content = contents.find((content) => content.id === id);
    const attachment = attachments.find((attachment) => attachment.content === id && attachment.lock === "password");
    const projectContent = content && projectContentIds.has(id) && projectApps.some(app => app.id === content.appId);
    if (!attachment && !projectContent) throw new Error(`passwords.${id}: lock=passwordの添付、またはproject_itemsの作品アプリのコンテンツが必要です。`);
    if (!content) {
      // item行を持たない添付も、非公開の開封データとして保持する。一覧には出さない。
      content = { id, appId: attachment.searchApp || "messages", initialState: "hidden", cond: "", search: [], record: { attachment: attachment.id } };
      contents.push(content);
    }
    content.record.unlockCode = password;
    content.record.unlockLoadParts = splitList(row.load_part);
  }
  const hookScripts = {};
  const hooks = rows("hooks").map((row) => {
    const script = String(row.script ?? "").trim();
    if (!script) throw new Error(`hooks!${row.__rowNumber}: scriptが必要です。`);
    const handler = text(row, "id") || `hook_${createHash("sha256").update(JSON.stringify([text(row, "event"), text(row, "target"), text(row, "cond"), script])).digest("hex").slice(0, 16)}`;
    if (Object.hasOwn(hookScripts, handler) && hookScripts[handler] !== script) throw new Error(`hooks: idに異なるscriptがあります: ${handler}`);
    hookScripts[handler] = script;
    return { event: text(row, "event"), target: text(row, "target"), cond: text(row, "cond"), handler,
      llm: booleanCell(row.llm, `hooks.${handler}.llm`, /\bllm\.(extract|screen|match)\s*\(/u.test(script)) };
  });
  const method = value("device.lock_method", "none");
  const source = {
    schemaVersion: 1, playerMode: value("player.mode", "server"), features: { llm: booleanCell(value("features.llm"), "features.llm", false) },
    project: { id: value("project.id"), name: value("project.name"), osName: value("device.os_name"), assistantName: value("search_agent.name"),
      accentColor: value("device.accent_color", "#8fd2ff"), date: value("device.date"), timeLabel: value("device.time_label"),
      batteryLevel: Number(value("device.battery_level", "72")), signalLabel: value("device.signal_label", "4G"), wallpaperUrl: value("device.wallpaper_url"),
      lockScreen: { method, ...(method === "fixed-pin" ? { pin: value("device.lock_pin"), loadParts: splitList(value("device.unlock_load_part")) } : {}) } },
    stateVariables, publicStateVariables, apps, contents, talks, photoDescriptions, attachments, hooks,
    talkPeople: rows("talk_people").map((row) => ({ id: text(row, "id"), name: row.name ?? "", role: text(row, "role"), ...optional(row, { avatar: "avatar" }) })),
    todos: rows("todo_items").map((row) => ({ id: text(row, "id"), text: row.text ?? "", cond: text(row, "cond") })),
    notifications: rows("notifications").map((row) => ({ id: text(row, "id"), appId: text(row, "app"), title: row.title ?? "", body: row.body ?? "", cond: text(row, "cond"),
      ...(talks.some((talk) => talk.id === text(row, "target")) ? { targetTalkId: text(row, "target") } : { targetContentId: text(row, "target") }) })),
    assistantMessages: rows("assistant_messages").map((row) => ({ id: text(row, "id"), surface: text(row, "surface"), body: row.body ?? "", weight: text(row, "weight") ? Number(row.weight) : 1, cond: text(row, "cond"), ...optional(row, { agent_action: "agentAction" }) })),
    generatedAudio: rows("gen_audio").map((row) => ({ id: text(row, "id"), title: row.title ?? "", provider: text(row, "provider") })),
    incomingCalls: rows("incoming_calls").map((row) => ({ id: text(row, "id"), name: row.name ?? "", cond: text(row, "cond"), ...(text(row, "audio") ? { audioAttachmentId: asset(text(row, "audio"), "audio") } : {}), ...(text(row, "transcript") ? { transcript: jsonCell(row, "transcript") } : {}) })),
    initialSchedules: rows("schedules").map((row) => ({ id: text(row, "id"), eventId: text(row, "event"), delayMs: integerCell(row, "delay_ms", `schedules.${row.id}`), fields: jsonCell(row, "fields", {}) })),
    clientCallableEvents: splitList(value("event.client_callable")),
    ...(value("chat_auth.cond") ? { chatAuthGate: { cond: value("chat_auth.cond"), linkSentCond: value("chat_auth.link_sent_cond") } } : {}),
    projectConstants: constants, publicProjectConstants: publicConstants, albumMediaAttachmentLinks: mediaLinks
  };
  // 結合前の原本で所属を決め、本文と素材を結合した後も失わないようにする。
  const groups = {
    apps: ["home_items"], talks: ["message_items", "chat_items"],
    contents: ["note_items", "photo_items", "calendar_items", "call_items", "radio_items", "mail_items", "browser_items", "project_items", "talk_history"],
    attachments: ["attachments"], talkPeople: ["talk_people"], incomingCalls: ["incoming_calls"],
    generatedAudio: ["gen_audio"], todos: ["todo_items"], notifications: ["notifications"],
    assistantMessages: ["assistant_messages"], stateVariables: ["state_vars"]
  };
  source.partOwnership = Object.fromEntries(Object.entries(groups).map(([group, tables]) => [group,
    Object.fromEntries(tables.flatMap(table => rows(table).map(row => [text(row, "id"), row.__part ?? "base"])))
  ]));
  source.partOwnership.passwords = Object.fromEntries(rows("passwords").map(row => [text(row, "content"), row.__part ?? "base"]));
  source.partOwnership.hooks = Object.fromEntries(rows("hooks").map((row, index) => [String(index), row.__part ?? "base"]));
  for (const attachment of attachments) {
    if (attachment.content && !source.partOwnership.contents[attachment.content]) {
      source.partOwnership.contents[attachment.content] = source.partOwnership.attachments[attachment.id] ?? "base";
    }
  }
  source.partIds = [...new Set(["base", ...Object.values(workbook).flatMap(sheet => sheet.rows.map(row => row.__part ?? "base"))])];
  return { source, hookScripts };
}

export function loadScenarioAuthoring(scenarioDir) {
  const workbook = loadWorkbook(readAuthoringManifest(scenarioDir));
  return { workbook, ...compileScenarioAuthoring(workbook) };
}
