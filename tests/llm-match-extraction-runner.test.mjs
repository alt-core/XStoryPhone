import assert from "node:assert/strict";
import test from "node:test";
import { runTalkFlowMatchExtractionSamples } from "../src/worker/product/llmMatchExtractionRunner.ts";

const spec = { items: [{ id: "value", rule: "値", pick: "same", nullMode: "no" }] };

test("stable抽出は最初の2標本を並行し、合意時点で終了する", async () => {
  let active = 0;
  let maxActive = 0;
  let calls = 0;
  const result = await runTalkFlowMatchExtractionSamples(spec, [], async () => {
    calls += 1;
    active += 1;
    maxActive = Math.max(maxActive, active);
    await Promise.resolve();
    active -= 1;
    return { status: "ready", output: { value: "同じ" } };
  });
  assert.equal(result.ok, true);
  assert.equal(calls, 2);
  assert.equal(maxActive, 2);
});

test("once抽出は1標本ずつ評価し、壊れた応答の次の正常値を採用する", async () => {
  let calls = 0;
  const result = await runTalkFlowMatchExtractionSamples(spec, [], async () => {
    calls += 1;
    return calls === 1
      ? { status: "invalid_response" }
      : { status: "ready", output: { value: "採用" } };
  }, { selectionMode: "once", maxSamples: 5 });
  assert.equal(result.ok, true);
  assert.equal(calls, 2);
});

test("provider障害は早期終了し、全応答破損と正常候補の不一致を区別する", async () => {
  let providerCalls = 0;
  const providerError = await runTalkFlowMatchExtractionSamples(spec, [], async (sampleIndex) => {
    providerCalls += 1;
    return sampleIndex === 1
      ? { status: "provider_error" }
      : { status: "ready", output: { value: "値" } };
  });
  assert.deepEqual(providerError, { ok: false, reason: "provider_error", outputs: [] });
  assert.equal(providerCalls, 2);

  const invalid = await runTalkFlowMatchExtractionSamples(spec, [], async () => ({ status: "invalid_response" }));
  assert.deepEqual(invalid, { ok: false, reason: "invalid_response", outputs: [] });

  let index = 0;
  const values = ["A", "B", "C", "D", "E"];
  const noMatch = await runTalkFlowMatchExtractionSamples(spec, [], async () => ({
    status: "ready",
    output: { value: values[index++] }
  }));
  assert.equal(noMatch.ok, false);
  assert.equal(noMatch.reason, "no_match");
  assert.equal(noMatch.outputs.length, 5);
});

test("stable抽出のpartial候補は最終標本を取得した後だけ採用する", async () => {
  const partialSpec = {
    items: [
      { id: "same", rule: "共通値", pick: "same", nullMode: "no" },
      { id: "best", rule: "補助値", pick: "best", nullMode: "no" }
    ]
  };
  let calls = 0;
  const result = await runTalkFlowMatchExtractionSamples(partialSpec, [], async () => ({
    status: "ready",
    output: { same: "共通", best: `候補${++calls}` }
  }));
  assert.equal(calls, 5);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.values, { same: "共通", best: "候補1" });
    assert.equal(result.score, 0);
    assert.equal(result.maxScore, 1);
  }
});
