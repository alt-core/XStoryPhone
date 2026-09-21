import fs from "node:fs";
import path from "node:path";
import { loadAndValidateScenario } from "./scenario-lib.mjs";
import { collectClientImportGraph } from "./lib/client-import-graph.mjs";
import { auditStaticDistribution } from "./lib/static-audit.mjs";

const root = process.cwd();
const scenario = loadAndValidateScenario();
const staticExecution = scenario.worker.playerMode === "static";
const graph = collectClientImportGraph(root, undefined, { executionMode: scenario.worker.playerMode });
const reachable = new Set(graph.files);
const unresolved = graph.unresolved;

const forbiddenImports = [...reachable]
  .map((file) => path.relative(root, file))
  .filter((file) => (!staticExecution && file.startsWith("src/worker/")) || file === "src/generated/workerScenario.generated.ts"
    || file === "src/generated/scenarioHooks.generated.ts" || file === "src/generated/hookContext.generated.ts"
    || file.startsWith("scenario/") || (staticExecution && file.startsWith("src/worker/admin/")));
const deviceState = scenario.deviceState;
const leakedInitialCollections = [
  "messages",
  "photos",
  "notes",
  "mails",
  "calendarEvents",
  "callLogs",
  "browserTabs",
  "radioItems",
  "chatThreads",
  "todos"
].filter((key) => Array.isArray(deviceState[key]) && deviceState[key].length > 0);

function stringLeaves(value) {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(stringLeaves);
  if (value && typeof value === "object") return Object.values(value).flatMap(stringLeaves);
  return [];
}

function filesIn(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? filesIn(target) : [target];
  });
}

const publicInitialValues = new Set([
  ...stringLeaves(scenario.deviceState),
  ...stringLeaves(scenario.projectConstants)
]);
const publicSystemValues = new Set([
  "/system/call-caption-sample.wav",
  "/system/incoming-call-bell.wav",
  // 作者がclientからの呼出しを許可したevent名は、公開APIの指定値として使う。
  ...scenario.worker.clientCallableEvents
]);
const structuralValues = new Set(["normal", "repairable", "hidden", "image", "audio", "password", "missed", "search_agent"]);
const protectedValues = new Set([
  ...stringLeaves(scenario.worker.projectConstants),
  // 対象IDはStageの公開APIで指定する識別子。判定種別等の構造値を秘密文言と混同しない。
  ...scenario.worker.lockedContentPasswords.flatMap(({answers, loadParts}) => stringLeaves({answers, loadParts})),
  ...scenario.worker.apps.flatMap((app) => stringLeaves({
    label: app.label,
    repairLabel: app.repairLabel,
    search: app.search
  })),
  ...scenario.worker.contents.flatMap((content) => stringLeaves({
    repairLabel: content.repairLabel,
    search: content.search,
    record: content.record
  })),
  ...scenario.worker.talks.flatMap((talk) => stringLeaves({
    label: talk.label,
    repairLabel: talk.repairLabel,
    search: talk.search,
    avatarUrl: talk.avatarUrl,
    rules: talk.rules.map((rule) => ({
      intent: rule.intent,
      criteria: rule.criteria,
      match: rule.match,
      example: rule.example,
      notes: rule.notes,
      searchQueries: rule.outputSteps
        .filter((step) => step.kind === "search")
        .map((step) => step.queryTemplate)
    }))
  })),
  ...scenario.worker.talkPeople.flatMap((person) => stringLeaves({ name: person.name, avatar: person.avatar })),
  ...scenario.worker.talkBlocks.flatMap((block) => block.messages.flatMap((message) => stringLeaves(message))),
  ...scenario.worker.attachments.flatMap((attachment) => stringLeaves(attachment)),
  ...scenario.worker.incomingCalls.flatMap(stringLeaves),
  ...scenario.worker.initialSchedules.flatMap((schedule) => stringLeaves(schedule.fields)),
  ...scenario.worker.generatedAudio.flatMap(stringLeaves),
  ...scenario.worker.todos.flatMap(stringLeaves),
  ...scenario.worker.notifications.flatMap(stringLeaves),
  ...scenario.worker.assistantMessages.flatMap(stringLeaves)
].map((value) => value.trim()).filter((value) =>
  (value.startsWith("/") || value.length >= 10)
  && !publicInitialValues.has(value)
  && !publicSystemValues.has(value)
  && !structuralValues.has(value)
));
for (const content of scenario.worker.contents) {
  if (typeof content.record.unlockCode === "string") protectedValues.add(content.record.unlockCode);
}
for (const description of Object.values(scenario.worker.photoDescriptions ?? {})) {
  if (typeof description === "string" && description.trim()) protectedValues.add(description.trim());
}

const failures = [
  ...unresolved.map((item) => `クライアントimportを解決できません: ${item}`),
  ...forbiddenImports.map((item) => `クライアントから非公開シナリオを参照しています: ${item}`),
  ...leakedInitialCollections.map((key) => `初期クライアントデータへ ${key} を含めないでください。`)
];

for (const relativeBuildDir of process.argv.slice(2)) {
  const buildDir = path.resolve(root, relativeBuildDir);
  if (!fs.existsSync(buildDir)) {
    failures.push(`クライアントbuildがありません: ${relativeBuildDir}`);
    continue;
  }
  const buildFiles = filesIn(buildDir);
  for (const file of buildFiles.filter((item) => item.endsWith(".map"))) {
    failures.push(`${relativeBuildDir}: 公開成果物へsource mapを含めないでください: ${path.relative(buildDir, file)}`);
  }
  if (staticExecution) {
    try { failures.push(...auditStaticDistribution(buildDir, scenario.worker, scenario.hookScripts)); }
    catch (error) { failures.push(`static配布監査を完了できません: ${error.message}`); }
    continue;
  }
  const bundleFiles = buildFiles.filter((file) => new Set([".css", ".html", ".js"]).has(path.extname(file)));
  const bundle = bundleFiles.map((file) => fs.readFileSync(file, "utf8")).join("\n");
  for (const value of protectedValues) {
    if (bundle.includes(value)) failures.push(`${relativeBuildDir}: 未到達シナリオ値がclient buildへ混入しています: ${JSON.stringify(value)}`);
  }
}

if (failures.length) {
  console.error("未到達情報のクライアント境界監査に失敗しました。");
  console.error(failures.map((failure) => `- ${failure}`).join("\n"));
  process.exitCode = 1;
} else {
  console.log(`クライアント境界監査OK: 到達可能な${reachable.size}ファイルを確認`);
}
