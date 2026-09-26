import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { loadAndValidateScenario } from "../scripts/scenario-lib.mjs";
import { runHookCases } from "../scripts/lib/hook-case-runner.mjs";
import { parseTsv } from "../scripts/lib/tsv-utils.mjs";

const template = loadAndValidateScenario().worker;
function build(script, options = {}) {
  const worker = structuredClone(template);
  worker.features.llm = true;
  worker.stateVariables = { saved: "", count: 0, enabled: true };
  worker.stateVariableDefinitions = { saved: { type: "string" }, count: { type: "integer" }, enabled: { type: "boolean" } };
  worker.stateVariableParts = {};
  worker.publicStateVariables = [];
  worker.generatedAudio = [{ id: "announcement", part: "base" }];
  worker.hooks = [{ event: "form_submitted", target: "input_form", cond: "", handler: "check_input", part: "base", ...options }];
  return { worker, hookScripts: { check_input: script } };
}
const fixture = { id: "accept", event: { eventId: "form_submitted", formId: "input_form", fields: { text: "入力" } }, expectedOutcome: "completed" };
const screen = `const result = llm.screen("check", { source: "text", instructions: "入力を確認する", schema: { allowed: "boolean" } });`;

test("hook caseは生成handlerと本番実行系で拒否・終端・state・音声台本を検査し、ケース間で隔離する", async t => {
  t.mock.method(globalThis, "fetch", async () => { throw new Error("外部通信は禁止"); });
  const scenario = build(`
${screen}
state.set("count", state.get("count") + 1);
if (!result.allowed) form.deny("rewrite");
if (event.fields.text === "終了") effectSequence.gameOver("終了しました");
state.set("saved", event.fields.text);
genAudio.prepare("announcement", { inputText: \`一行目
二行目\` });`);
  const before = structuredClone(scenario);
  const cases = [
    { ...fixture, mockLlm: { check: { allowed: true } }, expectedState: { saved: /^入力$/u, count: 1 }, expectedAudio: { announcement: "一行目\n    二行目" } },
    { ...fixture, id: "reject", expectedOutcome: "rejected", mockLlm: { check: { allowed: false } }, expectedState: { count: 0, saved: "" } },
    { ...fixture, id: "end", event: { ...fixture.event, fields: { text: "終了" } }, expectedOutcome: "game_over", mockLlm: { check: { allowed: true } }, expectedState: { count: 1 } }
  ];
  const result = await runHookCases(scenario, cases);
  assert.deepEqual(result.failures, []);
  assert.deepEqual(result.results.map(row => row.outcome), ["completed", "rejected", "game_over"]);
  assert.equal(result.results[1].rejection.error, "rewrite");
  assert.equal(result.results[2].presentationSequence.reasonMessage, "終了しました");
  assert.deepEqual(result.results[0].executedHandlers, ["check_input"]);
  assert.equal(result.results[0].tasks[0].calls, 1);
  assert.deepEqual(scenario, before);
  assert.equal(globalThis.fetch.mock.callCount(), 0);
});

test("結果種類の配列でもstateと音声の期待を常に検査し、非文字列はregexへ変換しない", async () => {
  const scenario = build('state.set("saved", "実値"); state.set("count", 12); genAudio.prepare("announcement", { inputText: "短い本文" });');
  const result = await runHookCases(scenario, [
    { ...fixture, expectedOutcome: ["completed", "rejected"], expectedState: { saved: "期待値" }, expectedAudio: { announcement: /長い/u } },
    { ...fixture, id: "number", expectedState: { count: /12/u } },
    { ...fixture, id: "exact", expectedState: { count: 12, saved: /実値/gy }, expectedAudio: { announcement: /^短い本文$/u } }
  ]);
  assert.equal(result.failures.length, 2);
  assert.equal(result.failures[0].checks.outcome, true);
  assert.equal(result.failures[0].checks.state, false);
  assert.equal(result.failures[0].checks.audio, false);
  assert.equal(result.failures[1].checks.state, false);
  assert.equal(result.results.length, 1);
});

test("発火なしは完了と区別し、取得partと先行hookの状態更新を本番同様に扱う", async () => {
  const scenario = build('state.set("saved", "後のpart");', { part: "later" });
  scenario.worker.parts = ["base", "later"];
  const result = await runHookCases(scenario, [
    { ...fixture },
    { ...fixture, id: "inactive", expectedOutcome: "skipped", expectedState: { saved: "" } },
    { ...fixture, id: "loaded", loadedParts: ["later"], expectedState: { saved: "後のpart" } }
  ]);
  assert.equal(result.failures[0].outcome, "skipped");
  assert.equal(result.results.length, 2);
  scenario.worker.hooks.unshift({ event: "form_submitted", target: "input_form", cond: "", handler: "first", part: "base" });
  scenario.hookScripts.first = 'state.set("enabled", false);';
  scenario.worker.hooks[1].cond = "enabled";
  const ordered = await runHookCases(scenario, [{ ...fixture, loadedParts: ["later"], expectedState: { saved: "", enabled: false } }]);
  assert.deepEqual(ordered.failures, []);
  assert.deepEqual(ordered.results[0].executedHandlers, ["first"]);
});

test("all_clearと一時演出を混同せず、音声生成未使用のhookも試験できる", async () => {
  const scenario = build('effect.flash();');
  const completed = await runHookCases(scenario, [fixture]);
  assert.equal(completed.results[0].outcome, "completed");
  assert.deepEqual(completed.results[0].tasks, []);
  const content = scenario.worker.contents.find(item => item.appId === "notes");
  scenario.hookScripts.check_input = `effectSequence.allClear(${JSON.stringify(content.appId)}, ${JSON.stringify(content.id)}, false);`;
  const cleared = await runHookCases(scenario, [{ ...fixture, expectedOutcome: "all_clear" }]);
  assert.equal(cleared.results[0].presentationSequence.autoplay, false);
});

test("hook matchは本番のstable標本・fallbackを使い、fallbackを期待一致でも合格にしない", async () => {
  const scenario = build(`const result = llm.match("color", { input: "色", match: { color: { rule: "色", pick: "same" } }, fallback: { color: "未判定" } }); state.set("saved", result.color);`);
  const result = await runHookCases(scenario, [
    { ...fixture, mockLlm: { color: { color: "青" } }, expectedState: { saved: "青" } },
    { ...fixture, id: "broken", mockLlm: { color: { color: 123 } }, expectedState: { saved: "未判定" } },
    { ...fixture, id: "disagree", mockLlm: { color: ["赤", "青", "黄", "緑", "紫"].map(color => ({ color })) }, expectedState: { saved: "未判定" } }
  ]);
  assert.equal(result.results[0].tasks[0].calls, 2);
  assert.equal(result.summary.fallback, 2);
  assert.deepEqual(result.failures.map(row => row.tasks[0].errorCode), ["invalid_response", "no_match"]);
  assert.ok(result.failures.every(row => row.checks.state && row.checks.outcome && !row.checks.llm));
});

test("LLM無効・利用不能とmock漏れは明示失敗にし、他のcaseは続ける", async () => {
  const scenario = build(`${screen} state.set("enabled", result.allowed);`);
  const missing = await runHookCases(scenario, [fixture, { ...fixture, id: "valid", mockLlm: { check: { allowed: true } } }]);
  assert.equal(missing.failures[0].failureStage, "configuration");
  assert.equal(missing.results.length, 1);
  scenario.worker.features.llm = false;
  const disabled = await runHookCases(scenario, [{ ...fixture, mockLlm: { check: { allowed: true } } }]);
  assert.equal(disabled.failures[0].failureStage, "llm");
  assert.equal(disabled.failures[0].tasks[0].errorCode, "provider_unavailable");
  scenario.worker.features.llm = true;
  const liveMissing = await runHookCases(scenario, [fixture], { live: true });
  assert.equal(liveMissing.failures[0].tasks[0].status, "unavailable");
});

test("一部のhookだけ動いた場合も未使用mockを検出し、次のcaseは独立して実行する", async () => {
  const scenario = build(screen, { cond: "enabled" });
  scenario.worker.hooks.unshift({ event: "form_submitted", target: "input_form", cond: "", handler: "normal", part: "base" });
  scenario.hookScripts.normal = 'state.set("saved", "通常処理");';
  const result = await runHookCases(scenario, [
    { ...fixture, stateValues: { enabled: false }, mockLlm: { check: { allowed: true } }, expectedState: { saved: "通常処理" } },
    { ...fixture, id: "used", mockLlm: { check: { allowed: true } } }
  ]);
  assert.equal(result.failures.length, 1);
  const failure = result.failures[0];
  assert.equal(failure.failureStage, "configuration");
  assert.match(failure.error, /未使用のmockLlm.*check/u);
  assert.equal(failure.outcome, "completed");
  assert.equal(failure.checks.state, true);
  assert.deepEqual(failure.executedHandlers, ["normal"]);
  assert.deepEqual(failure.tasks, []);
  assert.equal(result.results[0].id, "used");
});

test("mockは到達するtaskだけ指定し、意図的な未発火・早期終了・未消費標本を許す", async () => {
  const skipped = await runHookCases(build(screen, { cond: "enabled" }), [
    { ...fixture, stateValues: { enabled: false }, expectedOutcome: "skipped" },
    { ...fixture, id: "unused", stateValues: { enabled: false }, expectedOutcome: "skipped", mockLlm: { check: { allowed: true } } }
  ]);
  assert.equal(skipped.results.length, 1);
  assert.equal(skipped.failures[0].failureStage, "configuration");
  for (const [end, outcome] of [['form.deny("rewrite");', "rejected"], ['effectSequence.gameOver("終了");', "game_over"]]) {
    const ended = await runHookCases(build(`${end}\n${screen}`), [
      { ...fixture, expectedOutcome: outcome },
      { ...fixture, id: "unused", expectedOutcome: outcome, mockLlm: { check: { allowed: true } } }
    ]);
    assert.equal(ended.results.length, 1);
    assert.equal(ended.failures[0].failureStage, "configuration");
    assert.equal(ended.failures[0].outcome, outcome);
  }
  const consensus = await runHookCases(build('llm.match("check", { input: "入力", match: { color: "色" } });'), [{
    ...fixture, mockLlm: { check: [{ color: "青" }, { color: "青" }, { color: "赤" }] }
  }]);
  assert.deepEqual(consensus.failures, []);
  assert.equal(consensus.results[0].tasks[0].calls, 2);
});

test("liveではmockの応答内容と未使用taskを無視する", async () => {
  const result = await runHookCases(build(screen), [{
    ...fixture, mockLlm: { check: { allowed: false }, unused: { allowed: false } }
  }], { live: true, provider: { id: "fake", async completeJson() {
    return { ok: true, value: { allowed: true }, raw: "{}" };
  } } });
  assert.deepEqual(result.failures, []);
  assert.equal(result.results[0].tasks[0].calls, 1);
});

test("liveの認証失敗はfallbackと後続caseを止め、利用量と実profileは秘密なしで報告する", async () => {
  const scenario = build(`const result = llm.match("check", { profile: "super", mode: "once", input: "入力", match: { name: "呼び名" }, fallback: { name: "仮名" } }); state.set("saved", result.name);`);
  for (const httpStatus of [401, 403]) {
    let calls = 0;
    const result = await runHookCases(scenario, [fixture, { ...fixture, id: "later" }], {
      live: true, env: { LLM_PROFILE_SUPER_MODEL: "configured-model" }, provider: { id: "fake", async completeJson() { calls += 1; return { ok: false, error: "provider_error", httpStatus }; } }
    });
    assert.equal(calls, 1);
    assert.equal(result.summary.planned, 2);
    assert.equal(result.summary.attempted, 1);
    assert.equal(result.failures[0].httpStatus, httpStatus);
    assert.equal(result.summary.fallback, 0);
  }
  const result = await runHookCases(scenario, [{ ...fixture, expectedState: { saved: "案内役" } }], {
    live: true, env: { LLM_API_KEY: "fixture-private-key", LLM_PROFILE_SUPER_MODEL: "configured-model", LLM_PROFILE_SUPER_REASONING_EFFORT: "omit" },
    provider: { id: "fake", async completeJson(request) {
      assert.equal(request.model, "configured-model");
      assert.equal(request.reasoningEffort, "omit");
      return { ok: true, value: { name: "案内役" }, raw: "{}", model: "returned-model", usage: { totalTokens: 12 } };
    } }
  });
  assert.deepEqual(result.failures, []);
  assert.equal(result.results[0].tasks[0].model, "returned-model");
  assert.equal(result.results[0].tasks[0].usage.totalTokens, 12);
  assert.ok(!JSON.stringify(result).includes("fixture-private-key"));
});

test("fixture誤記・未知state/part・重複IDは黙って成功にせず、修復前提を明示指定できる", async () => {
  const scenario = build('state.set("count", state.get("count") + 1);');
  const invalid = [
    { expectedStates: {} }, { stateValues: { absent: "x" } }, { stateValues: { toString: "x" } }, { stateValues: { count: "1" } },
    { expectedOutcome: "unknown" }, { loadedParts: ["missing"] }, { expectedAudio: { missing: "x" } },
    { expectedState: { absent: "x" } }, { repairedContentIds: ["missing"] }
  ];
  const result = await runHookCases(scenario, invalid.map((fields, id) => ({ ...fixture, ...fields, id: String(id) })));
  assert.equal(result.failures.length, invalid.length);
  assert.ok(result.failures.every(row => row.failureStage === "configuration"));
  await assert.rejects(runHookCases(scenario, [fixture, fixture]), /重複/u);
  const valid = await runHookCases(scenario, [{ ...fixture, repairedAppIds: ["notes"], stateValues: { count: 2 }, expectedState: { count: 3 } }]);
  assert.deepEqual(valid.failures, []);
});

test("hook CLIは課金確認を先に要求し、選択中TSVを生成して一件を実行・報告する", t => {
  const denied = spawnSync(process.execPath, ["scripts/scenario-hook-cases-test.mjs", "--live", "--fixture=missing.mjs"], { encoding: "utf8" });
  assert.equal(denied.status, 1);
  assert.match(denied.stderr, /ユーザー確認後/u);
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "xstoryphone-hook-cases-"));
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const dir = path.join(temporary, "story");
  fs.cpSync("scenario/demo", dir, { recursive: true });
  const hookFile = path.join(dir, "authoring/hooks.tsv");
  const rows = parseTsv(fs.readFileSync(hookFile, "utf8"));
  const hook = { event: "fixture_event", id: "fixture_handler", script: 'state.set("session_started", true);' };
  rows.push(rows[0].map(key => hook[key] ?? ""));
  fs.writeFileSync(hookFile, rows.map(row => row.map(cell => `"${cell.replaceAll('"', '""')}"`).join("\t")).join("\n") + "\n");
  const caseFile = path.join(temporary, "cases.mjs");
  fs.writeFileSync(caseFile, `export const cases = ${JSON.stringify([
    { id: "chosen", event: { eventId: "fixture_event" }, expectedOutcome: "completed", expectedState: { session_started: true } },
    { id: "not_chosen", event: { eventId: "fixture_event" }, expectedOutcome: "rejected" }
  ])};`);
  const reportFile = path.join(temporary, "report.json");
  const run = args => spawnSync(process.execPath, ["scripts/scenario-hook-cases-test.mjs", `--fixture=${caseFile}`, `--report=${reportFile}`, ...args], {
    encoding: "utf8", env: { ...process.env, XSTORYPHONE_SCENARIO_DIR: dir }
  });
  const ok = run(["--case=chosen"]);
  assert.equal(ok.status, 0, ok.stderr);
  const report = JSON.parse(fs.readFileSync(reportFile, "utf8"));
  assert.equal(report.mode, "mock");
  assert.equal(report.summary.attempted, 1);
  assert.deepEqual(report.results[0].executedHandlers, ["fixture_handler"]);
  assert.equal(run([]).status, 1);
  assert.equal(run(["--case=missing"]).status, 1);
});
