import fs from "node:fs";
import path from "node:path";
import { partOf, scenarioForParts } from "../../src/worker/scenarioParts.ts";
import { compileStaticHooks } from "./static-scenario.mjs";
import { usesStandardMedia } from "../../src/shared/scenarioMedia.ts";

function leaves(value) {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(leaves);
  return value && typeof value === "object" ? Object.values(value).flatMap(leaves) : [];
}

function contentPayload(content) {
  const record = { ...content.record };
  // 標準の参照欄だけを除く。既知IDと同じ文字列の本文や、作品固有recordは免除しない。
  if (usesStandardMedia(content.appId)) {
    for (const key of ["imageAttachmentId", "audioAttachmentId", "videoAttachmentId"]) delete record[key];
    if (Array.isArray(record.audioSegments)) record.audioSegments = record.audioSegments.map(segment => {
      if (!segment || typeof segment !== "object" || segment.kind !== "audio") return segment;
      const { audioAttachmentId: _reference, ...payload } = segment;
      return payload;
    });
  }
  if (content.appId === "messages" || content.appId === "chat") {
    delete record.attachment;
    delete record.talk;
    delete record.block;
  }
  return record;
}

export function auditStaticDistribution(directory, worker, hookScripts) {
  const failures = [];
  const read = file => fs.readFileSync(path.join(directory, file), "utf8");
  const entry = JSON.parse(read("static-entry.json"));
  const base = JSON.parse(read(entry.base));
  if (entry.projectId !== worker.project.id || entry.clientRevision !== worker.clientRevision) failures.push("static入口とシナリオの作品/revisionが一致しません。");
  const initialFiles = new Set(["index.html", "static-entry.json", entry.base]);
  const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(item => item.isDirectory() ? walk(path.join(dir, item.name)) : [path.join(dir, item.name)]);
  for (const file of walk(path.join(directory, "assets"))) if (/\.(?:js|css)$/u.test(file)) initialFiles.add(path.relative(directory, file));
  if (base.hookModule) initialFiles.add(path.posix.join(path.posix.dirname(entry.base), base.hookModule));
  // baseから分かるHTML等の参照も辿る。任意JSで計算したURLの完全解析ではない。
  const pending = [...leaves(base.definition).filter(value => value.startsWith("/"))];
  while (pending.length) {
    const reference = pending.pop().split(/[?#]/u)[0];
    const file = path.resolve(directory, reference.replace(/^\/+/, ""));
    if (!file.startsWith(path.resolve(directory) + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile() || !/\.(?:html|js|css|svg|json)$/u.test(file)) continue;
    const relative = path.relative(directory, file);
    if (initialFiles.has(relative)) continue;
    initialFiles.add(relative);
    const content = fs.readFileSync(file, "utf8");
    for (const match of content.matchAll(/(?:src|href)=["']([^"']+)["']|["'](\/[^"']+)["']/gu)) {
      const target = match[1] ?? match[2];
      if (/^(?:https?:|data:|#)/u.test(target)) continue;
      pending.push(target.startsWith("/") ? target : "/" + path.posix.join(path.posix.dirname(relative), target));
    }
  }
  const initial = [...initialFiles].map(read).join("\n");
  if (initial.includes(worker.revision) || initial.includes(worker.transcriptRevision)) failures.push("原本由来のrevision digestがstaticの先行取得範囲にあります。");
  const publicBase = scenarioForParts(worker, ["base"]);
  const initialDefinitionValues = new Set([
    ...leaves(publicBase.publicIds), ...worker.projectAppIds,
    ...publicBase.contents.flatMap(item => leaves({ id: item.id, publicId: item.publicId, appId: item.appId, repairLabel: item.repairLabel, cond: item.cond, part: item.part })),
    ...publicBase.talkBlocks.flatMap(block => [block.id, block.talkId, block.blockKey, block.part, ...block.messages.map(message => message.id)]),
    ...publicBase.talks.flatMap(talk => [talk.id, talk.publicId, talk.part]),
    ...publicBase.talks.flatMap(talk => leaves({label:talk.label,search:talk.search,avatarUrl:talk.avatarUrl})),
    ...leaves(publicBase.photoDescriptions),
    ...publicBase.contents.flatMap(item => leaves(item.record)),
    ...publicBase.talkBlocks.flatMap(block => block.messages.flatMap(message => [message.body, ...leaves(message.segments), ...leaves(message.quickReplies)])),
    ...publicBase.attachments.flatMap(item => leaves({ asset: item.asset, title: item.title, body: item.body })),
    ...publicBase.talkPeople.flatMap(item => leaves({ name: item.name, avatar: item.avatar })),
    ...publicBase.incomingCalls.flatMap(item => leaves({ name: item.name, audioUrl: item.audioUrl, transcript: item.transcript })),
    ...publicBase.todos.map(item => item.text), ...publicBase.notifications.flatMap(item => [item.title, item.body]),
    ...publicBase.assistantMessages.map(item => item.body)
  ]);
  for (const rule of worker.talks.flatMap(talk => talk.rules).filter(rule => rule.type === "secret")) {
    if (initial.includes(rule.id)) failures.push("secretの元分岐IDが先行取得範囲にあります。回答前に原文由来の判定値を配布しないでください。");
  }
  const futureItems = key => worker[key].filter(item => partOf(item) !== "base");
  const future = [
    ...futureItems("talks").flatMap(item => leaves({label:item.label,search:item.search,avatarUrl:item.avatarUrl})),
    ...futureItems("contents").flatMap(item => leaves(worker.photoDescriptions[item.id])),
    ...futureItems("contents").flatMap(item => leaves({ record: contentPayload(item), search: item.search })),
    ...futureItems("talkBlocks").flatMap(block => block.messages.flatMap(message => [message.body, ...leaves(message.segments), ...leaves(message.quickReplies)])),
    ...futureItems("attachments").flatMap(item => leaves({ asset: item.asset, title: item.title, body: item.body })),
    ...futureItems("talkPeople").flatMap(item => leaves({ name: item.name, avatar: item.avatar })),
    ...futureItems("incomingCalls").flatMap(item => leaves({ name: item.name, audioUrl: item.audioUrl, transcript: item.transcript })),
    ...futureItems("generatedAudio").flatMap(item => leaves({ staticUrl: item.staticUrl })),
    ...futureItems("todos").map(item => item.text), ...futureItems("notifications").flatMap(item => [item.title, item.body]),
    ...futureItems("assistantMessages").map(item => item.body)
  ];
  for (const value of new Set(future)) {
    if ((value.length >= 10 || value.startsWith("/")) && !initialDefinitionValues.has(value) && initial.includes(value)) failures.push(`未取得partの値が先行取得範囲へ混入しています: ${JSON.stringify(value)}`);
  }
  const release = path.posix.dirname(path.posix.dirname(entry.base));
  for (const category of ["parts", "answers"]) {
    const target = path.join(directory, release, category);
    if (!fs.existsSync(target)) continue;
    for (const file of fs.readdirSync(target)) {
      const key = file.replace(/\.json$/u, "");
      if (initial.includes(key)) failures.push(`秘密の取得先が先行取得範囲にあります: ${category}/${key}`);
    }
  }
  const knownFiles = walk(path.join(directory, release)).filter(file => path.basename(file) === "part.json");
  for (const file of knownFiles) {
    const part = JSON.parse(fs.readFileSync(file, "utf8"));
    if (hookScripts) {
      const handlers = [...new Set(worker.hooks.filter(hook => partOf(hook) === part.id).map(hook => hook.handler))];
      const moduleFile = path.join(path.dirname(file), "hooks.js");
      const actual = fs.existsSync(moduleFile) ? fs.readFileSync(moduleFile, "utf8").trim() : "";
      const expected = handlers.length ? compileStaticHooks(Object.fromEntries(handlers.map(id => [id, hookScripts[id]]))).trim() : "";
      if (actual !== expected) failures.push(`hook moduleが所属partの原本と一致しません: ${part.id}`);
    }
    for (const rule of part.rules) {
      if (rule.intent || rule.example || rule.notes || (rule.isDefault && rule.criteria)) failures.push(`制作専用の分岐情報が配布されています: ${part.id}`);
      if (rule.type === "secret" && (!rule.answerIndex || rule.criteria || rule.match || rule.nextBlocks?.length || rule.outputSteps?.length || rule.set?.length || rule.loadParts?.length)) failures.push(`secretの継続が回答前に配布されています: ${part.id}`);
    }
    if ((part.definition.lockedContentPasswords ?? []).some(item => !item.answerIndex || item.answers.length || item.loadParts.length)) failures.push(`passwordの正答または継続が先行配布されています: ${part.id}`);
  }
  const lock = base.definition.project.lockScreen;
  if (lock.method === "fixed-pin" && (lock.pin || !lock.answerIndex || lock.loadParts?.length)) failures.push("PINの正答または継続が先行配布されています。");
  return failures;
}
