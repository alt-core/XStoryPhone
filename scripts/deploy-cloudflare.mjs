import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadAndValidateScenario } from "./scenario-lib.mjs";

const environment = process.argv[2];
if (!new Set(["dev", "stg", "prod"]).has(environment)) {
  console.error("deploy先を明示してください: npm run deploy:cloudflare:dev / :stg / :prod");
  process.exit(1);
}

const root = fileURLToPath(new URL("../", import.meta.url));
const config = readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8");
if (!new RegExp(`"${environment}"\\s*:`).test(config)) {
  console.error(`wrangler.jsoncにenv.${environment}のD1設定を追加してから実行してください。`);
  process.exit(1);
}

function run(command, args, capture = false) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: capture ? "utf8" : undefined,
    stdio: capture ? ["ignore", "pipe", "inherit"] : "inherit",
    env: process.env
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
  return capture ? result.stdout : "";
}

const secretListArgs = ["secret", "list", "--format", "json", "--env", environment];
let secretList;
try {
  secretList = JSON.parse(run("wrangler", secretListArgs, true));
  if (!Array.isArray(secretList)) throw new Error("secret一覧が配列ではありません。");
} catch (error) {
  console.error(`Cloudflareのsecret一覧を確認できませんでした: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
const configuredSecrets = new Set(secretList.map((secret) => secret.name));
const requiredSecrets = [
  "ADMIN_REVIEW_SECRET",
  ...(loadAndValidateScenario().worker.playerMode === "browser" ? ["BROWSER_STATE_SECRET"] : [])
];
const missingSecrets = requiredSecrets.filter((name) => !configuredSecrets.has(name));
if (missingSecrets.length) {
  console.error(`Cloudflare環境にsecretが登録されていません: ${missingSecrets.join(", ")}`);
  process.exit(1);
}

run("npm", ["run", "audit:public"]);
run("npm", ["run", `build:cloudflare:${environment}`]);
run("npm", ["run", "audit:client:cloudflare"]);
run("wrangler", ["deploy", "--env", environment]);
