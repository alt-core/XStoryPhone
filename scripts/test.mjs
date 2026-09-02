import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const generatedDirectories = ["src/generated", "src/client/generated"];
// assets:build が上書きする公開生成物だけを明示的に退避する。
const generatedAssetFiles = [
  "public/search-agent/search-agent-spritesheet.svg",
  "public/system/incoming-call-bell.wav",
  "public/system/call-caption-sample.wav",
  "public/system/radio-caption-sample.wav"
];

function filesBelow(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? filesBelow(target) : entry.isFile() ? [target] : [];
  });
}

export function snapshotGeneratedFiles(rootDir, directories = generatedDirectories, explicitFiles = generatedAssetFiles) {
  const files = new Map();
  for (const directory of directories) {
    for (const file of filesBelow(path.join(rootDir, directory))) {
      files.set(path.relative(rootDir, file), fs.readFileSync(file));
    }
  }
  for (const relative of explicitFiles) {
    const file = path.join(rootDir, relative);
    if (fs.existsSync(file) && fs.statSync(file).isFile()) files.set(relative, fs.readFileSync(file));
  }
  return { rootDir, directories, explicitFiles, files };
}

export function restoreGeneratedFiles(snapshot) {
  const currentFiles = [
    ...snapshot.directories.flatMap((directory) => filesBelow(path.join(snapshot.rootDir, directory))),
    ...snapshot.explicitFiles
      .map((relative) => path.join(snapshot.rootDir, relative))
      .filter((file) => fs.existsSync(file) && fs.statSync(file).isFile())
  ];
  for (const file of currentFiles) {
    if (!snapshot.files.has(path.relative(snapshot.rootDir, file))) fs.rmSync(file);
  }
  for (const [relative, content] of snapshot.files) {
    const file = path.join(snapshot.rootDir, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const current = fs.existsSync(file) ? fs.readFileSync(file) : null;
    if (!current?.equals(content)) fs.writeFileSync(file, content);
  }
}

export function signalExitCode(signal) {
  const number = signal ? os.constants.signals?.[signal] : undefined;
  // 不明なシグナルでも、シグナル終了として判別できる非ゼロ値を返す。
  return 128 + (typeof number === "number" ? number : 0);
}

function runCommand(rootDir, command, arguments_, environment = process.env) {
  const detached = process.platform !== "win32";
  const child = spawn(command, arguments_, {
    cwd: rootDir,
    env: environment,
    detached,
    stdio: "inherit"
  });
  let forwardedSignal = null;
  const signals = ["SIGINT", "SIGTERM", "SIGHUP"];
  const handlers = signals.map((signal) => {
    const handler = () => {
      forwardedSignal ??= signal;
      try {
        if (detached && child.pid) process.kill(-child.pid, signal);
        else child.kill(signal);
      } catch {
        // 終了済みなら、そのままexit結果の処理へ進む。
      }
    };
    process.once(signal, handler);
    return [signal, handler];
  });
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ code, signal: signal ?? forwardedSignal }));
  }).finally(() => {
    for (const [signal, handler] of handlers) process.removeListener(signal, handler);
  });
}

async function runEngineTests(rootDir, extraArguments = []) {
  const environment = { ...process.env, XSTORYPHONE_SCENARIO_DIR: "scenario/demo" };
  for (const arguments_ of [
    ["scripts/generate-search-agent-sprites.mjs"],
    ["scripts/scenario-build.mjs"]
  ]) {
    const result = await runCommand(rootDir, process.execPath, arguments_, environment);
    if (result.code !== 0 || result.signal) return result;
  }
  const testFiles = fs.readdirSync(path.join(rootDir, "tests"))
    .filter((file) => file.endsWith(".test.mjs"))
    .sort()
    .map((file) => path.join("tests", file));
  return runCommand(rootDir, process.execPath, ["--test", ...extraArguments, ...testFiles], environment);
}

async function main() {
  const rootDir = process.cwd();
  const snapshot = snapshotGeneratedFiles(rootDir);
  try {
    const result = await runEngineTests(rootDir, process.argv.slice(2));
    process.exitCode = result.signal ? signalExitCode(result.signal) : result.code ?? 1;
  } finally {
    restoreGeneratedFiles(snapshot);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
