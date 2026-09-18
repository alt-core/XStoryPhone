import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));

export function staticBuildArguments(arguments_) {
  // 成果物の場所やビルド設定の差し替えは受け付けず、監査対象を固定する。
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (/^--(?:base|mode)=.+$/u.test(argument)) continue;
    if ((argument === "--base" || argument === "--mode") && arguments_[index + 1] && !arguments_[index + 1].startsWith("--")) {
      index += 1;
      continue;
    }
    throw new Error(`静的ビルドの未知または不完全な引数です: ${argument}（--base、--modeのみ指定できます）`);
  }
  return arguments_;
}

function runCommand(command, arguments_) {
  const result = spawnSync(command, arguments_, {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, BUILD_PLATFORM: "static" }
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const error = new Error(`静的ビルドの処理に失敗しました: ${command}`);
    error.exitCode = result.status ?? 1;
    throw error;
  }
}

export function runStaticBuild(arguments_ = [], run = runCommand) {
  const viteArguments = staticBuildArguments(arguments_);
  run("npm", ["run", "assets:build"]);
  run("npm", ["run", "scenario:build"]);
  run(process.execPath, [path.join(root, "node_modules/vite/bin/vite.js"), "build", ...viteArguments]);
  run("npm", ["run", "audit:client:static"]);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    runStaticBuild(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = error.exitCode ?? 1;
  }
}
