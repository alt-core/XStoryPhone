import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { answerCandidates } from "../../src/shared/talkCriteria.ts";
import { createAnswerDeriver, STATIC_ANSWER_ITERATIONS, STATIC_ANSWER_PREFIX_LENGTH } from "../../src/shared/staticAnswer.ts";
import { scenarioForParts, partOf, partCollectionKeys } from "../../src/worker/scenarioParts.ts";
import { resolveMediaRecord } from "../../src/shared/scenarioMedia.ts";
import { compileScenarioHooks } from "./scenario-hooks.mjs";
import { staticAudioSample } from "../../src/shared/staticAudio.ts";

export function staticPartLocators(root, projectId, partIds, initialize = false) {
  const file = path.join(root, ".secrets/static-parts.json");
  if (!fs.existsSync(file) && !initialize) throw new Error("staticの取得先対応がありません。npm run scenario:static:initを実行し、.secrets/static-parts.jsonを非公開で保管してください。");
  let projects = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
  if (!Object.hasOwn(projects, projectId)) {
    if (!initialize) throw new Error(`staticのproject対応がありません: ${projectId}。scenario:static:initで明示初期化してください。`);
    projects = { ...projects, [projectId]: {} };
  }
  const mapping = projects[projectId];
  if (!mapping || typeof mapping !== "object" || Array.isArray(mapping)) throw new Error("staticの取得先対応ファイルが不正です。");
  let changed = initialize;
  for (const id of partIds.filter(id => id !== "base")) {
    if (!Object.hasOwn(mapping, id)) { mapping[id] = randomBytes(16).toString("hex"); changed = true; }
    if (!/^[a-f0-9]{32}$/u.test(mapping[id])) throw new Error(`staticのlocatorが不正です: ${id}`);
  }
  if (new Set(Object.values(mapping)).size !== Object.values(mapping).length) throw new Error("staticのlocatorが重複しています。");
  if (changed) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temporary = `${file}.${randomBytes(8).toString("hex")}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(projects, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    fs.renameSync(temporary, file);
  }
  return mapping;
}

function stripAuthoring(value) {
  if (Array.isArray(value)) return value.map(stripAuthoring);
  if (!value || typeof value !== "object") return value;
  const metadata = "isDefault" in value ? ["intent", "example", "notes", "contextPart"]
    : "sender" in value && "attachmentId" in value ? ["notes", "updatedAt", "source"] : [];
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !metadata.includes(key))
    .map(([key, item]) => [key, stripAuthoring(item)]));
}

export async function buildStaticScenario({ root, outputDir, scenario, releaseId = randomBytes(12).toString("hex") }) {
  const worker = structuredClone(scenario.worker);
  if (worker.playerMode !== "static") return null;
  // 原本全体の高速digestを正答候補の照合器として先行配布しない。
  // staticの再開・表示更新は配布版で識別し、安定locatorは別に維持する。
  worker.revision = `static_${releaseId}`;
  worker.transcriptRevision = `transcript_static_${releaseId}`;
  const locators = staticPartLocators(root, worker.project.id, worker.parts ?? ["base"]);
  const settings = { salt: randomBytes(24).toString("hex"), iterations: STATIC_ANSWER_ITERATIONS };
  const derive = createAnswerDeriver(settings);
  const releaseDir = path.join(outputDir, "scenario", releaseId);
  const answersDir = path.join(releaseDir, "answers");
  fs.mkdirSync(answersDir, { recursive: true });
  const writeJson = (file, value) => fs.writeFileSync(file, JSON.stringify(value) + "\n");
  const loadedParts = ids => [...new Set(ids)].filter(id => id !== "base").map(id => {
    if (!locators[id]) throw new Error(`取得するpartが未定義です: ${id}`);
    return { id, locator: locators[id] };
  });
  async function indexFor(kind, candidates, loadParts, rule, fixedPin = false) {
    const id = randomBytes(16).toString("hex");
    const prefixes = new Set();
    const answer = { projectId: worker.project.id, releaseId, entryId: id, kind, parts: loadedParts(loadParts), ...(rule ? { rule: stripAuthoring({ ...rule, criteria: "" }) } : {}) };
    for (const candidate of candidates) {
      const key = await derive(candidate, id, fixedPin);
      prefixes.add(key.slice(0, STATIC_ANSWER_PREFIX_LENGTH));
      writeJson(path.join(answersDir, `${key}.json`), answer);
    }
    return { id, prefixes: [...prefixes] };
  }
  for (const talk of worker.talks) {
    talk.rules = await Promise.all(talk.rules.map(async rule => {
      if (rule.type === "ai" || (rule.match && !rule.match.startsWith("/"))) throw new Error(`staticではAI判定・AI抽出を使用できません: ${talk.id}/${rule.id}`);
      if (rule.type !== "secret") return { ...rule, ...(rule.isDefault ? { criteria: "" } : {}) };
      const answerIndex = await indexFor("talk", answerCandidates(rule.criteria, true).map(candidate => candidate.value), rule.loadParts ?? [], rule);
      return {
        id: `secret_${answerIndex.id}`, type: "secret", order: rule.order, part: partOf(rule), from: rule.from,
        cond: rule.cond, isDefault: false, criteria: "", match: "", loadParts: [], outputSteps: [], nextBlocks: [], nextFromId: "",
        set: [], mode: "", intent: "", example: "", notes: "", answerIndex
      };
    }));
  }
  worker.lockedContentPasswords = await Promise.all(worker.lockedContentPasswords.map(async password => ({
    ...password, answers: [], loadParts: [], answerIndex: await indexFor("password", password.answers, password.loadParts)
  })));
  if (worker.project.lockScreen.method === "fixed-pin") {
    const lock = worker.project.lockScreen;
    worker.project.lockScreen = { ...lock, pin: "", loadParts: [], answerIndex: await indexFor("pin", [lock.pin], lock.loadParts ?? [], undefined, true) };
  }
  worker.projectConstants = {};
  // 標準の固定サンプルはAPIと同じPCM内容をファイルにする。
  for (const audio of worker.generatedAudio) {
    if (audio.provider !== "static" && !audio.staticUrl && !audio.fallbackAttachmentId) {
      const consumers = worker.contents.filter(content => content.record.genAudioId === audio.id);
      const segmentUse = worker.contents.some(content => Array.isArray(content.record.audioSegments) && content.record.audioSegments.some(segment => segment.genAudioId === audio.id));
      if (segmentUse || !consumers.length || consumers.some(content => !resolveMediaRecord(content.record,worker.attachments).audioUrl)) {
        throw new Error(`staticの外部生成音声には各コンテンツの固定audioが必要です: ${audio.id}`);
      }
    }
    if (audio.provider === "static") {
      const file = `static-audio-${audio.publicId}.wav`;
      fs.writeFileSync(path.join(outputDir, file), staticAudioSample());
      audio.staticUrl = `/${file}`;
    }
  }
  const base = scenarioForParts(worker, ["base"]);
  const groups = partCollectionKeys;
  for (const partId of worker.parts ?? ["base"]) {
    const directory = partId === "base" ? path.join(releaseDir, "base") : path.join(releaseDir, "parts", locators[partId]);
    fs.mkdirSync(directory, { recursive: true });
    const definition = partId === "base" ? structuredClone(base) : {};
    const view = partId === "base" ? base : scenarioForParts(worker, [partId]);
    for (const group of groups) definition[group] = partId === "base" ? base[group] : view[group].filter(item => {
      if (partOf(item) === partId) return true;
      // password入口は任意partに置ける。さらに後の添付を開くための枠も入口と一緒に配る。
      const key = value => value.id ?? value.contentId ?? `hook:${value.order}`;
      return item.unavailable && !base[group].some(initial => key(initial) === key(item));
    });
    definition.talks = definition.talks.map(talk => ({ ...talk, rules: [] }));
    definition.hookTalkBlocks = Object.fromEntries(view.talks.map(talk => [talk.id,
      (worker.hookTalkBlocks?.[talk.id] ?? []).filter(key => worker.talkBlocks.some(block => block.talkId === talk.id && block.blockKey === key && partOf(block) === partId))
    ]));
    const stateIds = Object.keys(worker.stateVariables).filter(id => (worker.stateVariableParts?.[id] ?? "base") === partId);
    for (const key of ["stateVariables", "stateVariableDefinitions", "stateVariableParts"]) definition[key] = Object.fromEntries(stateIds.map(id => [id, worker[key]?.[id] ?? "base"]));
    definition.publicStateVariables = worker.publicStateVariables.filter(id => stateIds.includes(id));
    definition.photoDescriptions = Object.fromEntries(Object.entries(worker.photoDescriptions).filter(([id]) => worker.contents.some(item => item.id === id && partOf(item) === partId)));
    definition.repeatTalkBlocks = Object.fromEntries(Object.entries(worker.repeatTalkBlocks).filter(([id]) => worker.talkBlocks.some(item => item.id === id && partOf(item) === partId)));
    definition.albumMediaAttachmentLinks = worker.albumMediaAttachmentLinks.filter(link => worker.contents.some(item => item.id === link.photoId && partOf(item) === partId));
    if (partId !== "base") definition.publicIds = scenarioForParts(worker, [partId]).publicIds;
    const rules = worker.talks.flatMap(talk => talk.rules.filter(rule => partOf(rule) === partId).map(rule => ({ ...rule, talkId: talk.id })));
    const handlers = [...new Set(definition.hooks.map(hook => hook.handler))];
    if (definition.hooks.some(hook => hook.llm)) throw new Error(`staticではAIを使うhookは使用できません: ${partId}`);
    if (handlers.length) {
      fs.writeFileSync(path.join(directory, "hooks.js"), compileScenarioHooks(Object.fromEntries(handlers.map(id => [id, scenario.hookScripts[id]]))));
    }
    writeJson(path.join(directory, "part.json"), {
      projectId: worker.project.id, releaseId, id: partId, definition: stripAuthoring(definition), rules: stripAuthoring(rules),
      ...(handlers.length ? { hookModule: "hooks.js" } : {})
    });
  }
  const manifest = { projectId: worker.project.id, releaseId, clientRevision: worker.clientRevision, base: `scenario/${releaseId}/base/part.json`, ...settings };
  writeJson(path.join(outputDir, "static-entry.json"), manifest);
  return manifest;
}
