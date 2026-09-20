import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadAndValidateScenario } from "./scenario-lib.mjs";
import { runTalkCases } from "./lib/talk-case-runner.mjs";
import { createStructuredOutputProvider } from "../src/worker/providers/structuredOutput.ts";

const paidConfirmation = "--i-understand-this-test-calls-a-paid-llm-api-and-requires-user-confirmation";

export async function main(argv = process.argv.slice(2)) {
  const options = new Map();
  const flags = new Set();
  for (const arg of argv) {
    const equal = arg.indexOf("=");
    if (equal >= 0 && ["--fixture", "--case", "--report"].includes(arg.slice(0, equal))) {
      const name = arg.slice(0, equal);
      if (options.has(name)) throw new Error(`引数が重複しています: ${name}`);
      options.set(name, arg.slice(equal + 1));
    } else if (["--live", paidConfirmation].includes(arg)) flags.add(arg);
    else throw new Error(`未対応の引数です: ${arg}`);
  }
  const live = flags.has("--live");
  if (live && !flags.has(paidConfirmation)) {
    throw new Error(`実APIで課金される可能性があります。ユーザー確認後に ${paidConfirmation} を明示してください。`);
  }
  const fixturePath = options.get("--fixture");
  if (!fixturePath) throw new Error("--fixture=試験case.mjs を指定してください。");
  const scenario = loadAndValidateScenario().worker;
  const module = await import(pathToFileURL(path.resolve(fixturePath)).href);
  const cases = (module.cases ?? []).filter((item) => !options.get("--case") || item.id === options.get("--case"));
  const provider = live ? createStructuredOutputProvider(process.env) : null;
  const result = await runTalkCases(scenario, cases, { live, provider, env: live ? process.env : {} });
  console.table(result.results);
  if (result.failures.length) console.table(result.failures);
  if (options.get("--report")) {
    const output = path.resolve(options.get("--report"));
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, `${JSON.stringify({ mode: live ? "live" : "mock", scenarioRevision: scenario.revision, ...result }, null, 2)}\n`);
  }
  if (result.failures.length) process.exitCode = 1;
  console.log(`会話case ${live ? "live" : "mock"}: 成功${result.results.length}件 / 失敗${result.failures.length}件`);
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
