import { validateConditionExpression } from "../../src/shared/condition.ts";
import ts from "typescript";
import { mediaAttachmentIds, usesStandardMedia } from "../../src/shared/scenarioMedia.ts";
import { messageTemplateKeys, templateVariableNames } from "../../src/shared/messageTemplateKeys.ts";
import { parseSetStatements } from "../../src/shared/setExpression.ts";
import { parseTalkExtraction } from "../../src/shared/talkCriteria.ts";
import { SEARCH_OUTPUT_STATE_DEFINITIONS } from "../../src/shared/searchAgent.ts";

export function validateScenarioParts(worker, { workbook, hookScripts = {} } = {}) {
  const errors = [];
  const warnings = new Set();
  const knownParts = new Set(worker.parts ?? ["base"]);
  const owner = item => item.part ?? "base";
  const stateOwner = id => worker.stateVariableParts?.[id] ?? "base";
  const baseStates = new Map(Object.entries(worker.stateVariableDefinitions).filter(([id]) => stateOwner(id) === "base"));
  const startupParts = new Set(["base", ...(worker.project.lockScreen.method === "fixed-pin" ? worker.project.lockScreen.loadParts ?? [] : [])]);
  const startupStates = new Set(Object.keys(worker.stateVariables).filter(id => startupParts.has(stateOwner(id))));
  const definitionsFor = parts => new Map(Object.entries(worker.stateVariableDefinitions).filter(([id]) => parts.has(stateOwner(id))));
  const locate = (table, id, column = "id") => {
    const row = workbook?.[table]?.rows.find(row => !row.comment && row[column] === id);
    return row ? `${table}.tsv:${row.__rowNumber}` : `${table}.${id}`;
  };
  const contentTables = { notes: "note_items", photos: "photo_items", calendar: "calendar_items", phone: "call_items", radio: "radio_items", mail: "mail_items", browser: "browser_items" };
  const contentLabel = content => {
    if (["messages", "chat"].includes(content.appId) && typeof content.record.attachment === "string") return locate("attachments", content.record.attachment);
    const standardTable = contentTables[content.appId] ?? "talk_history";
    const table = [standardTable, "project_items"].find(table => workbook?.[table]?.rows.some(row => row.id === content.id)) ?? standardTable;
    return locate(table, content.id);
  };
  const requireStartupCond = (label, cond) => {
    for (const error of validateConditionExpression(cond ?? "", definitionsFor(startupParts))) {
      errors.push(`${label}: 開始時に評価できない条件です: ${error}`);
    }
  };
  const checkLoads = (label, ids) => {
    for (const id of ids) if (!knownParts.has(id)) errors.push(`${label}: 取得するpartが未定義です: ${id}`);
  };
  checkLoads("device.unlock_load_part", [...startupParts]);
  for (const password of worker.lockedContentPasswords) checkLoads(`passwords.${password.contentId}.load_part`, password.loadParts);
  for (const app of worker.apps) if (owner(app) === "base" || app.initialState === "repairable") {
    for (const error of validateConditionExpression(app.cond, baseStates)) errors.push(`home_items.${app.id}: 初期表示で使う変数はbaseへ置いてください: ${error}`);
    for (const error of validateConditionExpression(app.badgeCond, baseStates)) errors.push(`home_items.${app.id}.badge_cond: ${error}`);
  }
  for (const notification of worker.notifications.filter(item => owner(item) === "base")) {
    for (const error of validateConditionExpression(notification.cond, baseStates)) errors.push(`notifications.${notification.id}: ${error}`);
  }
  for (const content of worker.contents.filter(item => item.initialState === "repairable" && owner(item) !== "base")) {
    for (const error of validateConditionExpression(content.cond, baseStates)) errors.push(`${content.id}: 初期破損枠で使う変数はbaseへ置いてください: ${error}`);
  }
  for (const content of worker.contents.filter(item => startupParts.has(owner(item)))) requireStartupCond(contentLabel(content), content.cond);
  for (const talk of worker.talks.filter(item => item.kind !== "search_agent" && (startupParts.has(owner(item)) || item.initialState === "repairable"))) {
    requireStartupCond(locate(talk.kind === "sms" ? "message_items" : "chat_items", talk.id), talk.cond);
  }
  for (const message of worker.assistantMessages.filter(item => startupParts.has(owner(item)))) requireStartupCond(locate("assistant_messages", message.id), message.cond);
  for (const notification of worker.notifications.filter(item => owner(item) !== "base" && startupParts.has(owner(item)))) requireStartupCond(locate("notifications", notification.id), notification.cond);
  for (const app of worker.apps.filter(item => owner(item) !== "base" && startupParts.has(owner(item)))) {
    requireStartupCond(locate("home_items", app.id), app.cond);
    requireStartupCond(`${locate("home_items", app.id)}.badge_cond`, app.badgeCond);
  }
  if (worker.chatAuthGate) requireStartupCond(locate("project_constants", "chat_auth.cond", "key"), worker.chatAuthGate.cond);
  for (const talk of worker.talks.filter(item => startupParts.has(owner(item)))) {
    if (talk.inputEnabled && talk.rules.some(rule=>rule.from===talk.initialFrom) && !talk.rules.some(rule => rule.from === talk.initialFrom && rule.isDefault && startupParts.has(owner(rule)))) errors.push(`${talk.id}: 初期の入力に必要なdefaultが未取得です。`);
    const ids = talk.kind === "search_agent" ? talk.startSteps.flatMap(step => step.kind === "block" ? [step.blockId] : []) : talk.startBlocks;
    for (const id of ids) {
      const block = worker.talkBlocks.find(item => item.id === id);
      if (!block) continue;
      if (!startupParts.has(owner(block)) && !worker.contents.some(content => content.record.talk === talk.id && content.record.block === id && content.initialState === "repairable")) {
        errors.push(`${talk.id}/${block.blockKey}: 未取得の初期blockはtalk_historyの破損枠として定義してください。`);
      }
      const values = block.messages.flatMap(message => [message.body, ...(message.quickReplies ?? []), ...(message.segments ?? []).flatMap(segment => segment.kind === "text" ? [segment.text] : [])]);
      if (startupParts.has(owner(block))) for (const message of block.messages) {
        const attachment = worker.attachments.find(item => item.id === message.attachmentId);
        if (attachment && !startupParts.has(owner(attachment))) {
          const password = worker.lockedContentPasswords.find(item => item.contentId === attachment.content);
          if (attachment.lock !== "password" || !password || !startupParts.has(owner(password))) errors.push(`${talk.id}/${block.blockKey}: 初期表示する添付またはpassword入口が未取得です: ${attachment.id}`);
        }
        if (attachment?.poster && !startupParts.has(owner(worker.attachments.find(item => item.id === attachment.poster)))) errors.push(`${talk.id}/${block.blockKey}: 初期posterが未取得です: ${attachment.poster}`);
      }
      for (const value of values) for (const [, key] of value.matchAll(/\{\{([a-zA-Z0-9_]+)\}\}/gu)) {
        if (!startupStates.has(key)) errors.push(`${talk.id}/${block.blockKey}: 初期履歴envに必要な変数が開始時に未取得です: ${key}`);
      }
    }
  }
  for (const talk of worker.talks) for (const rule of talk.rules) checkLoads(`${talk.id}/${rule.id}`, rule.loadParts ?? []);
  // ここで計算するのは「確実に取得済みの下限」。不足は不正の証明ではない。
  // 前の操作で取得したpartや任意hookの経路を推測して、自動load／一律拒否しない。
  const entries = [{ label: "新規開始", before: startupParts, after: startupParts, loads: [...startupParts] }];
  const warnCond = (label, cond, parts, localDefinitions = {}) => {
    const definitions = new Map([...definitionsFor(parts), ...Object.entries(localDefinitions)]);
    for (const error of validateConditionExpression(cond ?? "", definitions).filter(error => error.includes("未定義"))) {
      warnings.add(`${label}: ${error}。使用時に必要なpartを取得してください（この入口で保証できるpart: ${[...parts].join(", ")}）。`);
    }
  };
  const needPart = (label, item, parts) => {
    if (item && !parts.has(owner(item))) warnings.add(`${label}: ${item.id ?? item.contentId}はpart ${owner(item)}にあります。この入口だけでは取得を保証できません。`);
  };
  const needState = (label, id, parts) => {
    if (Object.hasOwn(worker.stateVariableDefinitions, id)) needPart(label, {id,part:stateOwner(id)}, parts);
  };
  const needAttachment = (label, id, parts) => {
    const attachment = worker.attachments.find(item => item.id === id);
    if (!attachment) return; // 未定義IDは通常の制作検査で拒否する。
    // 本文未取得でも、取得済password入口にある鍵付き枠は表示できる。
    if (!parts.has(owner(attachment)) && attachment.lock === "password"
      && worker.lockedContentPasswords.some(item => item.contentId === attachment.content && parts.has(owner(item)))) return;
    needPart(label, attachment, parts);
    if (attachment.poster) needPart(label, worker.attachments.find(item => item.id === attachment.poster), parts);
  };
  for (const talk of worker.talks) for (const rule of talk.rules) {
    const label = `talk_flow.tsv:${rule.order} (${talk.id}/${rule.id})`;
    const before = new Set([...startupParts, owner(talk), owner(rule)]);
    const after = new Set([...before, ...(rule.loadParts ?? [])]);
    warnCond(label, rule.cond, before);
    for (const key of templateVariableNames(rule.criteria)) needState(`${label}.text`, key, before);
    for (const {stateId} of parseSetStatements(rule.set).statements) needState(`${label}.set`, stateId, after);
    const extracted = new Set(parseTalkExtraction(rule.match).ids);
    const blockIds = new Set(rule.nextBlocks.flatMap(id => [id, ...(worker.repeatTalkBlocks[id] ?? [])]));
    for (const id of blockIds) {
      const block = worker.talkBlocks.find(item => item.id === id);
      needPart(label, block, after);
      for (const message of block?.messages ?? []) {
        needAttachment(`${label} / ${id}`, message.attachmentId, after);
        for (const key of messageTemplateKeys(message)) if (!extracted.has(key)) needState(`${label} / ${id}.template`, key, after);
      }
    }
    for (const step of rule.outputSteps) {
      if (step.kind === "if") warnCond(`${label}.next /if`, step.cond, after, {
        ...SEARCH_OUTPUT_STATE_DEFINITIONS, player_input: {type:"string"},
        ...Object.fromEntries([...extracted].map(id => [id, {type:"string"}]))
      });
      if (step.kind === "search") for (const key of templateVariableNames(step.queryTemplate)) {
        if (!extracted.has(key)) needState(`${label}.next /search`, key, after);
      }
    }
    const lastInputAction = rule.outputSteps.filter(step => step.kind === "input" && ["enable", "disable"].includes(step.action)).at(-1)?.action;
    if (!rule.mode && lastInputAction !== "disable" && worker.talkBlocks.find(block => block.id === rule.nextFromId)?.acceptsInput
      && !talk.rules.some(next => next.from === rule.nextFromId && next.isDefault && after.has(owner(next)))) {
      warnings.add(`${label}: 遷移先 ${rule.nextFromId}のdefaultは、この入口の取得済partだけでは保証できません。`);
    }
    if (rule.loadParts?.length) entries.push({label,before,after,loads:rule.loadParts});
  }
  if (worker.chatAuthGate) warnCond(locate("project_constants", "chat_auth.link_sent_cond", "key"), worker.chatAuthGate.linkSentCond, startupParts);
  for (const audio of worker.generatedAudio) {
    if (audio.fallbackAttachmentId) needAttachment(locate("gen_audio", audio.id), audio.fallbackAttachmentId, new Set([...startupParts, owner(audio)]));
  }
  for (const password of worker.lockedContentPasswords) {
    const before = new Set([...startupParts, owner(password)]);
    const after = new Set([...before, ...password.loadParts]);
    const label = locate("passwords", password.contentId, "content");
    needPart(label, worker.contents.find(content => content.id === password.contentId), after);
    if (password.loadParts.length) entries.push({label,before,after,loads:password.loadParts});
  }
  for (const content of worker.contents) {
    for (const id of usesStandardMedia(content.appId) ? mediaAttachmentIds(content.record) : []) {
      const asset = worker.attachments.find(item => item.id === id);
      if (!asset) continue; // 通常の参照検査が未定義IDを診断する。
      const app = worker.apps.find(item => item.id === content.appId);
      const requiredAtStart = startupParts.has(owner(content)) && content.initialState === "normal" && !content.cond
        && app?.initialState === "normal" && !app.cond && startupParts.has(owner(app));
      if (requiredAtStart && !startupParts.has(owner(asset))) errors.push(`${contentLabel(content)}: 開始時に表示する素材 ${asset.id}のpart ${owner(asset)}が未取得です。`);
      else needPart(contentLabel(content), asset, new Set([...startupParts, owner(content)]));
    }
  }
  for (const call of worker.incomingCalls) for (const id of mediaAttachmentIds(call)) {
    needPart(locate("incoming_calls", call.id), worker.attachments.find(item => item.id === id), new Set([...startupParts, owner(call)]));
  }
  for (const schedule of worker.initialSchedules) {
    if (!worker.hooks.some(hook => hook.event === "scheduled_event" && hook.target === schedule.eventId && startupParts.has(owner(hook)))) {
      errors.push(`${locate("schedules", schedule.id)}: 初期予約 ${schedule.eventId}を受けるhookのpartが開始時に未取得です。`);
    }
  }
  for (const hook of worker.hooks) {
    const label = locate("hooks", hook.handler);
    const contexts = hook.event === "part_loaded"
      ? entries.filter(entry => entry.after.has(owner(hook)) && (hook.target === "*" || entry.loads.includes(hook.target)))
      : [{label:"使用時",after:new Set([...startupParts,owner(hook)])}];
    const tree = ts.createSourceFile("hook.ts", `function hook(){${hookScripts[hook.handler] ?? ""}\n}`, ts.ScriptTarget.Latest, true);
    for (const context of contexts) {
      const here = `${label} / ${context.label}`;
      if (context.label === "新規開始" || (hook.event === "session_started" && startupParts.has(owner(hook)))) requireStartupCond(here, hook.cond);
      else warnCond(here, hook.cond, context.after);
      const inspect = node => {
        if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && ts.isStringLiteralLike(node.arguments[0] ?? tree)) {
          const api = node.expression.getText(tree).replace(/^context\./u, "");
          const id = node.arguments[0].text;
          if (api === "state.get" || api === "state.set") needPart(here, {id,part:stateOwner(id)}, context.after);
          if (api === "schedule.after" && !worker.hooks.some(item => item.event === "scheduled_event" && item.target === id && context.after.has(owner(item)))) {
            warnings.add(`${here}: 予約 ${id}のhandlerは、この入口の取得済partだけでは保証できません。`);
          }
        }
        ts.forEachChild(node, inspect);
      };
      inspect(tree);
    }
  }
  if (worker.playerMode === "static") {
    for (const talk of worker.talks) for (const rule of talk.rules) {
      if (rule.type === "ai" || (rule.match && !rule.match.startsWith("/"))) errors.push(`${talk.id}/${rule.id}: staticではAI判定・AI抽出を使用できません。`);
    }
    for (const hook of worker.hooks) if (hook.llm) errors.push(`hooks.${hook.handler}: staticではAIを使うhookを使用できません。`);
  }
  if (errors.length) throw new Error(errors.map(error => `- ${error}`).join("\n"));
  return [...warnings];
}
