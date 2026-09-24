import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadAndValidateScenario } from "./scenario-lib.mjs";
import { runTalkCases, talkCaseEvaluationConfig } from "./lib/talk-case-runner.mjs";
import { createStructuredOutputProvider } from "../src/worker/providers/structuredOutput.ts";

const paidConfirmation = "--i-understand-this-test-calls-a-paid-llm-api-and-requires-user-confirmation";

function consoleRow(result) {
  return {
    id: result.id,
    expected: result.expectedRuleId ?? result.expectedIntent,
    forbiddenMode: result.forbiddenMode,
    actual: result.actual?.intent,
    ruleId: result.actual?.ruleId,
    mode: result.actual?.mode,
    source: result.actual?.source,
    selection: result.selection?.intent,
    confidence: result.reviewSelection?.decision?.confidence,
    model: result.model ?? result.reviewSelection?.model,
    fallbackReason: result.reviewSelection?.fallbackReason,
    match: result.expectationMatch,
    selectionCalls: result.selectionCalls,
    extractionCalls: result.extractionCalls,
    selectionDurationMs: result.selectionDurationMs,
    failureStage: result.failureStage,
    httpStatus: result.httpStatus,
    error: result.error
  };
}

export async function main(argv = process.argv.slice(2)) {
  const options = new Map();
  const flags = new Set();
  for (const arg of argv) {
    const equal = arg.indexOf("=");
    if (equal >= 0 && ["--fixture", "--case", "--report"].includes(arg.slice(0, equal))) {
      const name = arg.slice(0, equal);
      if (options.has(name)) throw new Error(`引数が重複しています: ${name}`);
      options.set(name, arg.slice(equal + 1));
    } else if (["--live", "--selection-only", paidConfirmation].includes(arg)) flags.add(arg);
    else throw new Error(`未対応の引数です: ${arg}`);
  }
  const live = flags.has("--live");
  const selectionOnly = flags.has("--selection-only");
  if (live && !flags.has(paidConfirmation)) {
    throw new Error(`実APIで課金される可能性があります。ユーザー確認後に ${paidConfirmation} を明示してください。`);
  }
  const fixturePath = options.get("--fixture");
  if (!fixturePath) throw new Error("--fixture=試験case.mjs を指定してください。");
  const scenario = loadAndValidateScenario().worker;
  const module = await import(pathToFileURL(path.resolve(fixturePath)).href);
  const cases = (module.cases ?? []).filter((item) => !options.get("--case") || item.id === options.get("--case"));
  const provider = live ? createStructuredOutputProvider(process.env) : null;
  const evaluation = { live, provider, selectionOnly, env: live ? process.env : {} };
  const result = await runTalkCases(scenario, cases, evaluation);
  console.table(result.results.map(consoleRow));
  if (result.failures.length) console.table(result.failures.map(consoleRow));
  console.table({ selection: result.summary.selection, forbiddenMode: result.summary.forbiddenMode, extraction: result.summary.extraction });
  if (options.get("--report")) {
    const output = path.resolve(options.get("--report"));
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, `${JSON.stringify({
      mode: live ? "live" : "mock", scope: selectionOnly ? "selection" : "selection_and_extraction",
      generatedAt: new Date().toISOString(), scenarioRevision: scenario.revision,
      configuration: talkCaseEvaluationConfig(evaluation), ...result
    }, null, 2)}\n`);
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
