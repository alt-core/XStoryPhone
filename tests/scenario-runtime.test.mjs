import assert from "node:assert/strict";
import test from "node:test";
import { build } from "vite";
import path from "node:path";
import { workerScenario } from "../src/generated/workerScenario.generated.ts";
import { createScenarioRuntime } from "../src/worker/scenarioRuntime.ts";
import { createScenarioHooksRuntime } from "../src/worker/services/scenarioHooksRuntime.ts";
import { createPlayerOperations } from "../src/server/playerApp.ts";
import { createGeneratedAudioRuntime } from "../src/worker/services/generatedAudioRuntime.ts";
import { createPartSession } from "../src/worker/partSession.ts";

function fixture(label) {
  const scenario = structuredClone(workerScenario);
  scenario.playerMode = "browser";
  scenario.project.id = label;
  scenario.hooks = [];
  for (const block of scenario.talkBlocks) for (const message of block.messages) message.body = label;
  const runtime = createScenarioRuntime(scenario);
  const hooks = createScenarioHooksRuntime(runtime, {}, {});
  const operations = createPlayerOperations(runtime, hooks, createGeneratedAudioRuntime(runtime));
  const dependencies = {
    store: { async recordInputEvent(_event, enabled) { assert.equal(enabled, false); } },
    config: { appEnv: "dev", llm: {}, playerInputLogging: false }
  };
  return { runtime, operations, dependencies };
}

test("part選択は以前の定義snapshotとcatalogを上書きしない",async()=>{
  const catalog=structuredClone(workerScenario);
  catalog.parts=["base","later"];
  catalog.stateVariables.later_only=true;catalog.stateVariableDefinitions.later_only={type:"boolean"};catalog.stateVariableParts.later_only="later";
  const original=JSON.stringify(catalog);
  const session=createPartSession(catalog,{});
  const before=session.runtime.workerScenario;
  const state=session.runtime.createInitialPlayerState();
  const activated=await session.activate(state,["later"]);
  const after=session.runtime.workerScenario;
  assert.notEqual(after,before);
  assert.equal(before.stateVariables.later_only,undefined);
  assert.equal(after.stateVariables.later_only,true);
  const oldProjection = await session.runtimeFor(state);
  assert.equal(oldProjection.workerScenario.stateVariables.later_only,undefined);
  assert.equal(session.runtime.workerScenario,after,"以前の公開投影は実行中viewを変えない");
  await session.restore(state);
  assert.equal(session.runtime.workerScenario.stateVariables.later_only,undefined);
  assert.equal(after.stateVariables.later_only,true,"候補を捨てても候補snapshot自体は不変");
  assert.deepEqual(activated.state.loadedPartIds,["base","later"]);
  assert.equal(JSON.stringify(catalog),original);
});

test("シナリオ・履歴・hookを束ねた実行単位は別の定義と混ざらない", async () => {
  const left = fixture("左側の定義");
  const right = fixture("右側の定義");
  const responses = await Promise.all([left, right, left, right].map(async ({ operations, dependencies }) => {
    const response = await operations.execute("POST /api/session/start",{hostname:"localhost",body:{}},dependencies);
    assert.equal(response.status, 200);
    return response.payload;
  }));
  for (const [index, response] of responses.entries()) {
    const own = index % 2 ? "右側の定義" : "左側の定義";
    const other = index % 2 ? "左側の定義" : "右側の定義";
    assert.ok(JSON.stringify(response.playerState).includes(own));
    assert.ok(!JSON.stringify(response.playerState).includes(other));
  }
  const blockId = workerScenario.talkBlocks.find(block => block.messages.length)?.id;
  assert.equal(left.runtime.messageTemplatesForBlock(blockId)[0].body, "左側の定義");
  assert.equal(right.runtime.messageTemplatesForBlock(blockId)[0].body, "右側の定義");
});

test("共有する操作入口のbundleへ全台本・全hook・監修を巻き込まない", async () => {
  const output = await build({
    configFile: false, publicDir: false, logLevel: "silent",
    plugins: [{ name: "test-runtime-entry", resolveId(id) { if (id === "virtual:runtime-test") return id; }, load(id) {
      if (id !== "virtual:runtime-test") return;
      return ["src/server/playerApp.ts", "src/worker/scenarioRuntime.ts", "src/worker/services/scenarioHooksRuntime.ts"]
        .map(file => `export * from ${JSON.stringify(path.resolve(file))};`).join("\n");
    } }],
    build: { write: false, minify: false, rollupOptions: { input: "virtual:runtime-test", preserveEntrySignatures: "strict" } }
  });
  const chunks = output.output.filter(item => item.type === "chunk");
  const inputs = chunks.flatMap(chunk => Object.keys(chunk.modules));
  assert.deepEqual(inputs.filter(file => /(?:workerScenario|scenarioHooks|hookContext)\.generated/u.test(file) || file.includes("/admin/")), []);
  assert.ok(!chunks.map(chunk => chunk.code).join("\n").includes(workerScenario.talkBlocks.find(block => block.messages.some(message => message.body.length > 30))?.messages.find(message => message.body.length > 30)?.body));
});

test("取得していないdefaultへの通常遷移を止め、明示disable・hookの別地点への移動は許可する", async () => {
  const { runtime } = fixture("継続検証");
  const state = (await runtime.reconcileScenarioState(runtime.createInitialPlayerState(), "fixture")).state;
  const talk = runtime.workerScenario.talks.find(item => item.kind === "search_agent");
  const stored = state.talks[talk.id];
  stored.from = "search_agent::missing_default";
  assert.equal(runtime.talkCanPost(talk, state), false);
  assert.throws(() => runtime.validateTalkContinuation(talk.id, stored.from, state), /defaultが未取得/u);
  stored.inputEnabled = false;
  assert.doesNotThrow(() => runtime.validateTalkContinuation(talk.id, stored.from, state));
  stored.inputEnabled = true;
  assert.doesNotThrow(() => runtime.validateTalkContinuation(talk.id, "search_agent::another", state));
});

test("hook condの逐次guardはfalse→trueとtrue→falseを反映し、過ぎた行を再走査しない", async () => {
  const scenario = structuredClone(workerScenario);
  scenario.stateVariables.guard = false;
  scenario.stateVariableDefinitions.guard = { type: "boolean" };
  scenario.hooks = [
    { handler: "trace", cond: "guard" },
    { handler: "on", cond: "" },
    { handler: "trace", cond: "guard" },
    { handler: "off", cond: "guard" },
    { handler: "trace", cond: "guard" }
  ].map((row, index) => ({ ...row, event: "guard_probe", target: "", order: index, llm: false }));
  const trace = [];
  const runtime = createScenarioRuntime(scenario);
  const hooks = createScenarioHooksRuntime(runtime, {
    trace() { trace.push("実行"); }, on(context) { context.state.set("guard", true); }, off(context) { context.state.set("guard", false); }
  }, {});
  const result = await hooks.runScenarioHooks(runtime.createInitialPlayerState(), { eventId: "guard_probe" });
  assert.deepEqual(trace, ["実行"]);
  assert.equal(result.state.stateValues.guard ?? false, false);
});
