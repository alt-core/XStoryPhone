import fs from "node:fs";
import path from "node:path";
import { loadAndValidateScenario } from "./scenario-lib.mjs";

const root = process.cwd();
const entry = path.join(root, "src/client/main.ts");
const extensions = ["", ".ts", ".js", ".svelte", ".css"];
const importPatterns = [
  /(?:from\s+|import\s*\()\s*["']([^"']+)["']/gu,
  /import\s+["']([^"']+)["']/gu
];

function resolveImport(fromFile, specifier) {
  if (!specifier.startsWith(".")) return null;
  const base = path.resolve(path.dirname(fromFile), specifier);
  for (const suffix of extensions) {
    const candidate = `${base}${suffix}`;
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  for (const suffix of extensions.slice(1)) {
    const candidate = path.join(base, `index${suffix}`);
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return null;
}

const reachable = new Set();
const pending = [entry];
const unresolved = [];
while (pending.length) {
  const file = pending.pop();
  if (!file || reachable.has(file)) continue;
  reachable.add(file);
  const source = fs.readFileSync(file, "utf8");
  for (const pattern of importPatterns) {
    for (const match of source.matchAll(pattern)) {
      if (!match[1].startsWith(".")) continue;
      const resolved = resolveImport(file, match[1]);
      if (resolved) pending.push(resolved);
      else unresolved.push(`${path.relative(root, file)} -> ${match[1]}`);
    }
  }
}

const forbiddenImports = [...reachable]
  .map((file) => path.relative(root, file))
  .filter((file) => file.startsWith("src/worker/") || file === "src/generated/workerScenario.generated.ts" || file.startsWith("scenario/"));
const scenario = loadAndValidateScenario();
const deviceState = scenario.deviceState;
const leakedInitialCollections = [
  "messages",
  "photos",
  "notes",
  "calendarEvents",
  "callLogs",
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
const structuralValues = new Set(["normal", "repairable", "hidden", "image", "audio", "password", "missed"]);
const protectedValues = new Set([
  ...scenario.worker.contents.flatMap((content) => stringLeaves({
    repairLabel: content.repairLabel,
    search: content.search,
    record: content.record
  })),
  ...scenario.worker.talks.flatMap((talk) => stringLeaves({ label: talk.label })),
  ...scenario.worker.talkBlocks.flatMap((block) => block.messages.flatMap((message) => stringLeaves(message))),
  ...scenario.worker.attachments.flatMap((attachment) => stringLeaves(attachment)),
  ...scenario.worker.incomingCalls.flatMap(stringLeaves),
  ...scenario.worker.todos.flatMap(stringLeaves),
  ...scenario.worker.notifications.flatMap(stringLeaves),
  ...scenario.worker.assistantMessages.flatMap(stringLeaves),
  ...scenario.worker.searchResponses.flatMap(stringLeaves)
].map((value) => value.trim()).filter((value) =>
  (value.startsWith("/") || value.length >= 10)
  && !publicInitialValues.has(value)
  && !structuralValues.has(value)
));
for (const content of scenario.worker.contents) {
  if (typeof content.record.unlockCode === "string") protectedValues.add(content.record.unlockCode);
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
  const bundleFiles = filesIn(buildDir).filter((file) => new Set([".css", ".html", ".js"]).has(path.extname(file)));
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
