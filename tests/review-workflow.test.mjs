import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { D1Store } from "../src/platform/cloudflare/d1Store.ts";
import { DynamoStore, dynamoDocument } from "../src/platform/aws/dynamoStore.ts";
import { workerScenario } from "../src/worker/scenario.ts";
import { decodeReviewCursor } from "../src/server/store.ts";
import { createApp } from "../src/server/app.ts";
import {
  dismissJudgment, replaceTalkBranchReviewClusters, simulateTalkBranchReviewSelection,
  talkBranchReviewFromDetail, talkBranchReviewReport, talkBranchReviewReportMarkdown
} from "../src/worker/admin/talkBranchReviewService.ts";

const sqlite = await import("node:sqlite").catch(() => null);
const databaseTest = sqlite ? test : test.skip;

function localStore() {
  const database = new sqlite.DatabaseSync(":memory:");
  database.exec(fs.readFileSync(new URL("../migrations/0001_initial.sql", import.meta.url), "utf8"));
  class Statement {
    constructor(sql, values = []) { this.sql = sql; this.values = values; }
    bind(...values) { return new Statement(this.sql, values); }
    async all() { return { results: database.prepare(this.sql).all(...this.values) }; }
    async run() { return { meta: { changes: Number(database.prepare(this.sql).run(...this.values).changes) } }; }
  }
  const store = new D1Store({
    prepare(sql) { return new Statement(sql); },
    async batch(statements) {
      database.exec("BEGIN");
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        database.exec("COMMIT");
        return results;
      } catch (error) { database.exec("ROLLBACK"); throw error; }
    }
  });
  return { database, store };
}

function talkFixture() {
  const talk = workerScenario.talks.find((item) => item.kind === "sms");
  const rule = talk.rules.find((item) => item.from === talk.initialFrom && item.isDefault);
  assert.ok(rule);
  return { talk, rule };
}

function insertEvent(database, { id, talkId, fromId, ruleId, at = "2026-09-01T00:00:00.000Z", status = "completed", body = id }) {
  database.prepare(`INSERT INTO player_input_events
    (id,event_type,player_id,request_key,occurred_at,talk_id,from_id,user_input,normalized_input,status,rule_id)
    VALUES (?, 'talk_send', 'player', ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, id, at, talkId, fromId, body, body, status, ruleId);
}

function judgment(talk, rule, sourceEventIds) {
  return {
    id: "judgment-1", scope: "input", sourceEventIds, clusterId: null,
    talkId: talk.id, fromId: rule.from, actualRuleId: rule.id, expectedRuleId: rule.id,
    judgment: "hold", comment: "確認する", newBranchNote: "", reviewerLabel: "監修者",
    scenarioRevision: workerScenario.revision, status: "open",
    createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z"
  };
}

databaseTest("1000件窓の外でも現存cluster根拠・総数・report・applyの入力所属を維持する", async () => {
  const { database, store } = localStore();
  const { talk, rule } = talkFixture();
  try {
    for (let index = 0; index < 1001; index += 1) insertEvent(database, {
      id: `event-${index}`, talkId: talk.id, fromId: rule.from, ruleId: rule.id,
      at: new Date(index * 1000).toISOString()
    });
    insertEvent(database, { id: "other-group", talkId: talk.id, fromId: "elsewhere", ruleId: rule.id });
    await store.replaceReviewClusters(talk.id, rule.from, rule.id, workerScenario.revision, [{
      id: "cluster-old", fit: "blue", representativeInput: "event-0", sourceEventIds: ["event-0"],
      summaryJson: "{}", analysisVersion: "test"
    }]);
    await store.saveReviewJudgment(judgment(talk, rule, ["event-0"]));
    const detail = await talkBranchReviewFromDetail(store, talk.id, rule.from);
    const branch = detail.branches.find((item) => item.ruleId === rule.id);
    assert.equal(branch.inputCount, 1001);
    assert.equal(detail.totalInputCount, 1001);
    assert.equal(branch.clusters.find((item) => item.id === "cluster-old").inputs[0].input, "event-0");
    const report = await talkBranchReviewReport(store);
    assert.equal(report.items[0].sourceInputs[0].input, "event-0");
    const markdown = talkBranchReviewReportMarkdown(report);
    assert.match(markdown, /対象ステータス: 未対応/u);
    assert.match(markdown, /コメント者別: 監修者 1/u);
    assert.ok(markdown.includes(`会話ID: ${talk.id}`));
    assert.ok(markdown.includes(`会話地点ID: ${rule.from}`));
    assert.ok(markdown.includes(rule.id));

    const replacement = {
      talkId: talk.id, fromId: rule.from, actualRuleId: rule.id, scenarioRevision: workerScenario.revision,
      analysisVersion: "test", clusters: [{ id: "new", fit: "blue", representativeInput: "event-0", sourceEventIds: ["event-0"], reason: "確認" }]
    };
    assert.deepEqual(await replaceTalkBranchReviewClusters(store, replacement), { ok: true });
    assert.deepEqual(await replaceTalkBranchReviewClusters(store, {
      ...replacement, clusters: [{ ...replacement.clusters[0], sourceEventIds: ["other-group"] }]
    }), { ok: false, error: "invalid_source" });
    assert.equal(database.prepare("SELECT inputs_json FROM talk_branch_review_clusters WHERE id='new'").get().inputs_json, "[]");
  } finally { database.close(); }
});

databaseTest("500件より古い現存試行も指示IDから取得し、snapshotをJSONレポートへ返す", async () => {
  const { database, store } = localStore();
  const { talk, rule } = talkFixture();
  try {
    for (let index = 0; index < 501; index += 1) await store.saveReviewTrialInput({
      id: `trial-${index}`, talkId: talk.id, fromId: rule.from, actualRuleId: rule.id,
      userInput: `試行${index}`, nextFromId: rule.from, responseSnapshot: { response: `応答${index}` },
      createdAt: new Date(index * 1000).toISOString()
    });
    await store.saveReviewJudgment(judgment(talk, rule, ["trial-0"]));
    const report = await talkBranchReviewReport(store);
    assert.equal(report.items[0].sourceInputs[0].input, "試行0");
    assert.equal(report.items[0].sourceInputs[0].responseSnapshot.response, "応答0");
    assert.deepEqual(await store.reviewTrialInputs(talk.id, "wrong", ["trial-0"]), []);
  } finally { database.close(); }
});

databaseTest("applied指示は通常編集・dismiss・根拠整理から保護し、status専用変更は許可する", async () => {
  const { database, store } = localStore();
  const { talk, rule } = talkFixture();
  try {
    await store.saveReviewJudgment(judgment(talk, rule, ["source"]));
    await store.updateReviewJudgmentStatus(talk.id, rule.from, "judgment-1", "applied", "later");
    await store.updateReviewJudgment(talk.id, rule.from, "judgment-1", { comment: "古い画面", newBranchNote: "", reviewerLabel: "", updatedAt: "latest" });
    await store.updateReviewJudgmentSourceIds(talk.id, rule.from, "judgment-1", [], "latest");
    await dismissJudgment(store, talk.id, rule.from, "judgment-1");
    const [saved] = await store.reviewJudgments({ status: "applied" });
    assert.equal(saved.comment, "確認する");
    assert.deepEqual(saved.sourceEventIds, ["source"]);
    await store.updateReviewJudgmentStatus(talk.id, rule.from, "judgment-1", "open", "again");
    assert.equal((await store.reviewJudgments({ status: "open" })).length, 1);
  } finally { database.close(); }
});

databaseTest("入力一覧は期間・状態で絞り、同時刻の入力もcursorで重複欠落なく取得する", async () => {
  const { database, store } = localStore();
  const { talk, rule } = talkFixture();
  try {
    for (const id of ["a", "b", "c", "d", "e"]) insertEvent(database, { id, talkId: talk.id, fromId: rule.from, ruleId: rule.id });
    insertEvent(database, { id: "too-old", talkId: talk.id, fromId: rule.from, ruleId: rule.id, at: "2026-08-01T00:00:00.000Z" });
    insertEvent(database, { id: "different-status", talkId: talk.id, fromId: rule.from, ruleId: rule.id, status: "rejected" });
    const filters = { talkId: talk.id, status: "completed", after: "2026-09-01T00:00:00.000Z", before: "2026-10-01T00:00:00.000Z", limit: 2 };
    const first = await store.playerInputEvents(filters);
    const second = await store.playerInputEvents({ ...filters, cursor: first.nextCursor });
    const third = await store.playerInputEvents({ ...filters, cursor: second.nextCursor });
    assert.deepEqual([...first.items, ...second.items, ...third.items].map((item) => item.id), ["e", "d", "c", "b", "a"]);
    assert.equal(third.nextCursor, null);
    const app = createApp({ store, config: { appEnv: "development", llm: {} } });
    const response = await app.request("http://localhost/api/admin/player-input-review/events?cursor=broken");
    assert.equal(response.status, 400);
    const invalidDate = await app.request("http://localhost/api/admin/player-input-review/events?after=invalid");
    assert.equal(invalidDate.status, 400);
  } finally { database.close(); }
});

test("DynamoDBの入力cursorは同時刻でも最後に表示した実キーから続く", async () => {
  const rows = ["e", "d", "c", "b", "a"].map((id) => ({
    PK: "PLAYER#p", SK: `INPUT#${id}`, GSI2PK: "INPUT_REVIEW", GSI2SK: `INPUT#talk_send#2026-09-01T00:00:00.000Z#${id}`,
    id, playerId: "p", occurredAt: "2026-09-01T00:00:00.000Z", talkId: "talk", userInput: id, status: "completed"
  }));
  const store = new DynamoStore({
    async execute(operation, input) {
      assert.equal(operation, "Query");
      const previous = input.ExclusiveStartKey ? dynamoDocument.valueFromItem(input.ExclusiveStartKey) : null;
      const start = previous ? rows.findIndex((row) => row.SK === previous.SK) + 1 : 0;
      return { Items: rows.slice(start).map(dynamoDocument.item) };
    }
  }, "table");
  const first = await store.playerInputEvents({ limit: 2 });
  assert.equal(decodeReviewCursor(first.nextCursor).SK, "INPUT#d");
  const second = await store.playerInputEvents({ limit: 2, cursor: first.nextCursor });
  const third = await store.playerInputEvents({ limit: 2, cursor: second.nextCursor });
  assert.deepEqual([...first.items, ...second.items, ...third.items].map((item) => item.id), ["e", "d", "c", "b", "a"]);
  assert.equal(third.nextCursor, null);
});

test("DynamoDBの絞込みページはbackendの継続取得を跨いでも対象入力を欠落させない", async () => {
  const rows = Array.from({ length: 12 }, (_, index) => {
    const id = String(12 - index).padStart(2, "0");
    return {
      PK: "PLAYER#p", SK: `INPUT#${id}`, GSI2PK: "INPUT_REVIEW",
      GSI2SK: `INPUT#talk_send#2026-09-01T00:00:00.000Z#${id}`,
      id, playerId: "p", occurredAt: "2026-09-01T00:00:00.000Z", talkId: "talk",
      userInput: "入力", normalizedInput: "入力", status: index % 2 ? "completed" : "rejected",
      responseSnapshot: { response: "検索対象" }
    };
  });
  let queries = 0;
  const store = new DynamoStore({
    async execute(operation, input) {
      assert.equal(operation, "Query");
      queries += 1;
      const previous = input.ExclusiveStartKey ? dynamoDocument.valueFromItem(input.ExclusiveStartKey) : null;
      const start = previous ? rows.findIndex((row) => row.SK === previous.SK) + 1 : 0;
      const page = rows.slice(start, start + 2);
      const last = page.at(-1);
      return {
        Items: page.map(dynamoDocument.item),
        ...(start + page.length < rows.length ? { LastEvaluatedKey: dynamoDocument.item({
          PK: last.PK, SK: last.SK, GSI2PK: last.GSI2PK, GSI2SK: last.GSI2SK
        }) } : {})
      };
    }
  }, "table");
  const ids = [];
  let cursor;
  do {
    const page = await store.playerInputEvents({ limit: 2, status: "completed", query: "検索対象", cursor });
    ids.push(...page.items.map((item) => item.id));
    cursor = page.nextCursor;
  } while (cursor);
  assert.deepEqual(ids, ["11", "09", "07", "05", "03", "01"]);
  assert.ok(queries > 3, "画面のページ数より多くbackendのページを取得する");
});

test("DynamoDBの根拠ID取得と件数はGSI prefixが似た別fromを混ぜない", async () => {
  const rows = [
    { id: "valid", talkId: "talk", fromId: "question", ruleId: "rule", userInput: "本文", occurredAt: "2026-09-01" },
    { id: "other", talkId: "talk", fromId: "question#child", ruleId: "rule", userInput: "別地点", occurredAt: "2026-09-01" }
  ];
  const store = new DynamoStore({ async execute() { return { Items: rows.map(dynamoDocument.item) }; } }, "table");
  assert.deepEqual(await store.reviewInputCounts("talk", "question"), { rule: 1 });
  assert.deepEqual((await store.reviewInputEvents("talk", "question", { ids: ["valid", "other"] })).map((item) => item.id), ["valid"]);
});

test("試行snapshotはset後の返信本文・添付・Quick Reply・選択根拠を保存する", async () => {
  const { talk, rule } = talkFixture();
  const block = workerScenario.talkBlocks.find((item) => item.id === rule.nextBlocks[0]);
  const message = block.messages[0];
  const previous = { body: message.body, attachmentId: message.attachmentId, quickReplies: message.quickReplies, set: rule.set, llm: workerScenario.features.llm };
  let saved;
  try {
    workerScenario.features.llm = false;
    workerScenario.stateVariables.review_probe_name = "変更前";
    workerScenario.stateVariableDefinitions.review_probe_name = { type: "string" };
    rule.set = ['review_probe_name = "変更後"'];
    message.body = "こんにちは、{{review_probe_name}}";
    message.quickReplies = ["{{review_probe_name}}です"];
    message.attachmentId = workerScenario.attachments.find((item) => item.type === "image").id;
    const result = await simulateTalkBranchReviewSelection({}, { saveReviewTrialInput: async (input) => { saved = input; } }, {
      talkId: talk.id, fromId: rule.from, targetRuleId: rule.id, message: "試行です"
    });
    assert.equal(result.ok, true);
    assert.equal(saved.responseSnapshot.messages[0].body, "こんにちは、変更後");
    assert.equal(saved.responseSnapshot.messages[0].attachment.kind, "image");
    assert.deepEqual(saved.responseSnapshot.messages[0].quickReplies, ["変更後です"]);
    assert.equal(saved.responseSnapshot.playerInput, "試行です");
    assert.equal(saved.responseSnapshot.reviewSelection.finalRuleId, rule.id);
    assert.equal(workerScenario.stateVariables.review_probe_name, "変更前", "監修でシナリオ初期値を書き換えない");
  } finally {
    Object.assign(message, { body: previous.body, attachmentId: previous.attachmentId, quickReplies: previous.quickReplies });
    rule.set = previous.set;
    workerScenario.features.llm = previous.llm;
    delete workerScenario.stateVariables.review_probe_name;
    delete workerScenario.stateVariableDefinitions.review_probe_name;
  }
});

test("集計CLIは全件数から分岐別に取得し、context/modeを渡し実入力を代表にする", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "xstoryphone-review-analysis-"));
  try {
    const { talk, rule } = talkFixture();
    const scenarioLib = pathToFileURL(path.resolve("scripts/scenario-lib.mjs")).href;
    const prelude = `
      import { loadAndValidateScenario } from ${JSON.stringify(scenarioLib)};
      const scenario = loadAndValidateScenario();
      globalThis.fetch = async (url, options = {}) => {
        if (String(url).includes('/analysis-inputs?')) return Response.json({ ok:true, scenarioRevision:scenario.worker.revision,
          inputCounts:{[${JSON.stringify(rule.id)}]:1500}, events:[{id:'real-1',ruleId:${JSON.stringify(rule.id)},userInput:'実際の入力'}] });
        if (String(url).endsWith('/chat/completions')) {
          const request=JSON.parse(options.body); console.log('CAPTURE:'+JSON.stringify(request));
          return Response.json({choices:[{message:{content:JSON.stringify({clusters:[{event_ids:['real-1','real-1'],representative_input:'捏造された代表',fit:'blue',reason:'確認'}]})}}]});
        }
        throw new Error('未許可の通信:'+url);
      };
    `;
    const result = spawnSync(process.execPath, [
      `--import=data:text/javascript,${encodeURIComponent(prelude)}`,
      path.resolve("scripts/analyze-talk-branch-review-clusters.mjs"),
      `--talk=${talk.id}`, `--from=${rule.from}`, `--rule=${rule.id}`,
      "--i-understand-this-sends-player-inputs-to-paid-llm"
    ], { cwd: directory, encoding: "utf8", env: {
      ...process.env, XSTORYPHONE_SCENARIO_DIR: path.resolve("scenario/demo"),
      LLM_API_KEY: "fixture-only", LLM_MODEL: "fixture-model", LLM_BASE_URL: "https://example.invalid/v1", ADMIN_REVIEW_SECRET: "fixture-only"
    } });
    assert.equal(result.status, 0, result.stderr + result.stdout);
    const request = JSON.parse(result.stdout.split("\n").find((line) => line.startsWith("CAPTURE:")).slice(8));
    const input = JSON.parse(request.messages[1].content);
    assert.equal(input.context, rule.criteria);
    assert.equal(input.branch.mode, rule.mode || "advance");
    const output = JSON.parse(fs.readFileSync(path.join(directory, ".wrangler/talk-branch-review-clusters.json"), "utf8"));
    assert.deepEqual(output.groups[0].clusters[0].sourceEventIds, ["real-1"]);
    assert.equal(output.groups[0].clusters[0].representativeInput, "実際の入力");
    assert.match(result.stdout, /1\/1500件/u);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test("LLM監修試行にもdecision・confidence・reason・hashが同じsnapshotへ届く", async (t) => {
  const { talk, rule } = talkFixture();
  const semanticRule = { ...rule, id: "review-ai-fixture", order: -1, isDefault: false, intent: "確認", criteria: "監修用の選択条件", match: "" };
  const previousLlm = workerScenario.features.llm;
  let saved;
  t.mock.method(globalThis, "fetch", async () => Response.json({
    choices: [{ message: { content: JSON.stringify({ rule_id: semanticRule.id, confidence: 0.98, reason_code: "matched_intent" }) } }]
  }));
  talk.rules.push(semanticRule);
  workerScenario.features.llm = true;
  try {
    const result = await simulateTalkBranchReviewSelection({ LLM_API_KEY: "fixture-only", LLM_MODEL: "fixture-model" }, {
      saveReviewTrialInput: async (input) => { saved = input; }
    }, { talkId: talk.id, fromId: rule.from, targetRuleId: semanticRule.id, message: "監修の意味判定だけを試す" });
    assert.equal(result.ok, true);
    const evidence = saved.responseSnapshot.reviewSelection;
    assert.equal(evidence.decision.confidence, 0.98);
    assert.equal(evidence.decision.reason_code, "matched_intent");
    assert.equal(evidence.selectedRuleId, semanticRule.id);
    assert.equal(evidence.finalRuleId, semanticRule.id);
    for (const key of ["inputHash", "promptHash", "schemaHash"]) assert.match(evidence[key], /^[a-f0-9]{64}$/u);
    assert.equal("providerPayload" in evidence, false);
    assert.equal("prompt" in evidence, false);
  } finally {
    talk.rules.splice(talk.rules.indexOf(semanticRule), 1);
    workerScenario.features.llm = previousLlm;
  }
});
