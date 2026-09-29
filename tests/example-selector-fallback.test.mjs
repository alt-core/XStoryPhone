import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { parseTsv } from "../scripts/lib/tsv-utils.mjs";
import { reportedTokenUsage } from "../src/worker/providers/providerUsage.ts";

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "xstoryphone-example-selector-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const scenarioDir = path.join(directory, "scenario");
  fs.cpSync("scenario/demo", scenarioDir, { recursive: true });
  const writeRows = (file, rows) => fs.writeFileSync(file, rows.map(row => row.map(value =>
    '"' + String(value ?? "").replaceAll('"', '""') + '"').join("\t")).join("\n") + "\n");
  const constantsFile = path.join(scenarioDir, "authoring/project_constants.tsv");
  const constants = parseTsv(fs.readFileSync(constantsFile, "utf8"));
  constants.find(row => row[constants[0].indexOf("key")] === "features.llm")[constants[0].indexOf("value")] = "true";
  writeRows(constantsFile, constants);
  const flowFile = path.join(scenarioDir, "authoring/talk_flow.tsv");
  const flow = parseTsv(fs.readFileSync(flowFile, "utf8"));
  const headers = flow[0], col = name => headers.indexOf(name);
  for (const values of flow.slice(1)) if (values[col("talk")] === "guide") values[col("example")] = "";
  flow.find(row => row[col("talk")] === "guide" && row[col("from")] === "intro" && row[col("type")] === "default")[col("example")] = "分かりません";
  const row = fields => headers.map(name => fields[name] ?? "");
  flow.push(row({talk:"guide",from:"intro",type:"context",text:"協力への返答を待っている。"}));
  flow.push(row({talk:"guide",from:"intro",type:"ai",intent:"協力を承諾",text:"協力を明確に承諾した。",example:"はい、協力します",next:"intro",mode:"stay"}));
  writeRows(flowFile, flow);

  const capture = path.join(directory, "requests.jsonl");
  const preload = path.join(directory, "fetch.mjs");
  fs.writeFileSync(preload, `
    import fs from "node:fs";
    const counts = { jev: 0, llm: 0 };
    globalThis.fetch = async (url, init) => {
      const variant = process.env.EXAMPLE_VARIANT;
      const body = JSON.parse(init.body);
      const jev = url === "https://api.typesafe.ai/v1/systemone";
      if (!jev && url !== "https://fixture.invalid/v1/chat/completions") throw new Error("実ネットワークは禁止");
      const kind = jev ? "jev" : "llm";
      const candidates = jev
        ? Object.values(body.questions.rule.criteria).map(value => typeof value === "string" ? "default" : "ai")
        : JSON.parse(body.messages[1].content).candidate_rules.map(rule => rule.default ? "default" : "ai");
      fs.appendFileSync(process.env.EXAMPLE_CAPTURE, JSON.stringify({kind, candidates}) + "\\n");
      counts[kind]++;
      if (variant === "retry" && counts[kind] === 1) return new Response("busy", {status:503});
      if (variant === "denied" && !jev) return new Response("denied", {status:403});
      if (jev) {
        if (variant === "invalid_first" && counts.jev === 1) return Response.json({answers:{},usage:{input_tokens:321}});
        const entries = Object.entries(body.questions.rule.criteria);
        const fallback = entries.find(([,value]) => typeof value === "string")[0];
        const agree = entries.find(([,value]) => typeof value === "object" && value.intent === "協力を承諾")[0];
        const choice = body.state.player_input === "分かりません" ? fallback : agree;
        return Response.json({ model:"jev-fixture", answers:{rule:{type:"choice",choice,
          confidence:variant === "high" ? 0.99 : 0.5,
          probabilities:Object.fromEntries(entries.map(([id])=>[id,id===choice?0.6:0.4]))}},
          ...(variant === "no_usage" ? {} : {usage:{input_tokens:321}}) });
      }
      const input = JSON.parse(body.messages[1].content);
      const expectedDefault = input.player_input === "分かりません";
      const selectedDefault = variant === "mismatch" ? !expectedDefault : expectedDefault;
      const selected = input.candidate_rules.find(rule => selectedDefault ? rule.default : !rule.default);
      return Response.json({model:"llm-fixture", choices:[{message:{content: variant === "bad_json" ? "not-json" : JSON.stringify({
        rule_id:selected.rule_id,confidence:0.99,reason_code:selected.default?"default_unclear":"matched_intent"
      })}}], ...(variant === "no_usage" ? {} : {usage:{prompt_tokens:10,completion_tokens:5,total_tokens:15,prompt_tokens_details:{cached_tokens:0}}})});
    };
  `);
  return {
    withoutAi() { writeRows(flowFile, flow.filter((values, index) => index === 0 || values[col("type")] !== "ai")); },
    commonAi() {
      flow.at(-1)[col("from")] = "*";
      for (const values of flow.slice(1)) if (values[col("talk")] === "guide" && values[col("type")] === "default") {
        values[col("example")] = "分かりません";
      }
      writeRows(flowFile, flow);
    },
    deterministicCollision(type) {
      writeRows(flowFile, [...flow, row({ talk:"guide", from:"intro", type,
        text:type === "secret" ? '"はい、協力します"' : "/^はい、協力します$/u", next:"message_reply", mode:"stay" })]);
    },
    run(variant = "fallback", extraEnv = {}, options = ["--live"]) {
      fs.writeFileSync(capture, "");
      const reportFile = path.join(directory, "report.json");
      // 未設定試験でローカル.dev.varsの実資格情報を補完しない。
      const blanks = Object.fromEntries(Object.keys(process.env).filter(key => /^(LLM_|TYPESAFE_)/u.test(key)).map(key => [key, " "]));
      const result = spawnSync(process.execPath, ["--import",preload,"scripts/scenario-llm-talk-flow-examples-test.mjs",
        "--talk=guide","--from=intro",...options,`--report=${reportFile}`,
        "--i-understand-this-test-calls-a-paid-llm-api-and-requires-user-confirmation"], {
        encoding:"utf8", maxBuffer:4*1024*1024, env:{...process.env,...blanks,
          XSTORYPHONE_SCENARIO_DIR:scenarioDir,EXAMPLE_VARIANT:variant,EXAMPLE_CAPTURE:capture,
          LLM_TALK_SELECTOR:"typesafe",TYPESAFE_API_KEY:"test-key",TYPESAFE_MODEL:"jev-fixture",
          TYPESAFE_LOW_CONFIDENCE_FALLBACK:"llm",TYPESAFE_MIN_CONFIDENCE:"0.65",TYPESAFE_GAME_OVER_MIN_CONFIDENCE:"0.9",
          LLM_API_KEY:"test-key",LLM_MODEL:"llm-fixture",LLM_BASE_URL:"https://fixture.invalid/v1",
          LLM_PROFILE_FAST_MODEL:" ",LLM_PROFILE_SUPER_MODEL:" ",LLM_PROFILE_ULTRA_MODEL:" ",
          LLM_ANALYTICS_ENABLED:"false",LLM_DEBUG_LOGS:"false",...extraEnv}
      });
      assert.ok(fs.existsSync(reportFile), result.stderr || result.stdout);
      return {...result, report:JSON.parse(fs.readFileSync(reportFile,"utf8")),
        requests:fs.readFileSync(capture,"utf8").trim().split("\n").filter(Boolean).map(JSON.parse)};
    }
  };
}

test("exampleも本番と同じく、LLM回付設定の不足はJevを呼ぶ前に停止する", t => {
  const f=fixture(t);
  for(const variant of ["high","fallback"]) {
    const result=f.run(variant,{LLM_API_KEY:" ",LLM_MODEL:" "});
    assert.equal(result.status,1,result.stdout);
    assert.equal(result.requests.length,0);
    assert.equal(result.report.summary.attempted,1);
    assert.match(result.report.failures[0].error,/provider_unavailable/u);
    assert.equal(result.report.usage.providerCalls,0);
  }
  const high=f.run("high");
  assert.equal(high.status,0,high.stderr);
  assert.equal(high.requests.length,2);
  assert.equal(high.report.usage.fallbackCases,0);
  assert.deepEqual(high.requests.map(request=>request.kind),["jev","jev"]);
  const direct=f.run("fallback",{TYPESAFE_LOW_CONFIDENCE_FALLBACK:"default",LLM_API_KEY:" ",LLM_MODEL:" "});
  assert.equal(direct.status,1,"低確信度の通常例はguard後の一致検査で不合格になる");
  assert.equal(direct.requests.length,2);
  assert.equal(direct.report.usage.fallbackCases,0);
});

test("defaultより後の共通AI分岐も、本番と同じ候補順でJevとLLMへ渡す", t => {
  const f=fixture(t);
  f.commonAi();
  const result=f.run();
  assert.equal(result.status,0,result.stderr + result.stdout);
  assert.equal(result.requests.length,4);
  for(const request of result.requests) assert.deepEqual(request.candidates,["ai","default"]);
});

test("AIのexampleもmatch/secret優先で判定し、本番で届かない分岐を合格にしない", t => {
  const f=fixture(t);
  for(const type of ["match","secret"]) {
    f.deterministicCollision(type);
    for(const options of [["--live"],[],["--dry-run"]]) {
      const result=f.run("high",{},options);
      assert.equal(result.status,1,result.stderr + result.stdout);
      assert.equal(result.report.failures.length,1);
      assert.equal(result.report.failures[0].expected.label,"協力を承諾");
      assert.match(result.report.failures[0].error,/本番の選択処理/u);
      assert.equal(result.report.failures[0].promptInput,null,"AIを呼んでいなければ架空のpromptを報告しない");
      assert.equal(result.requests.length,options.includes("--live") ? 1 : 0,"外部判定はdefaultのexampleだけ");
    }
  }
});

test("Jevと回付先LLMの使用量・実試行回数を別々に残し、再試行の未報告分を0にしない", t => {
  const f=fixture(t);
  const result=f.run("retry");
  assert.equal(result.status,0,result.stderr);
  const usage=result.report.usage;
  assert.equal(usage.cases,2);
  assert.equal(usage.aiSelectionCases,2);
  assert.equal(usage.fallbackCases,2);
  assert.equal(usage.providerCalls,4);
  assert.equal(usage.httpAttempts,6);
  assert.equal(result.requests.length,6);
  const jev=usage.providers.find(row=>row.stage==="jev");
  const llm=usage.providers.find(row=>row.stage==="llm_fallback");
  assert.equal(jev.calls,2); assert.equal(jev.retries,1);
  assert.deepEqual(jev.tokens.inputTokens,{reportedTotal:642,unreportedAttempts:1,reportedAverage:321});
  assert.deepEqual(jev.tokens.outputTokens,{reportedTotal:null,unreportedAttempts:3,reportedAverage:null});
  assert.deepEqual(llm.tokens.inputTokens,{reportedTotal:20,unreportedAttempts:1,reportedAverage:10});
  assert.deepEqual(llm.tokens.outputTokens,{reportedTotal:10,unreportedAttempts:1,reportedAverage:5});
  assert.equal(llm.retries,1);
  for(const row of result.report.results) {
    assert.equal(row.providerCalls.length,2);
    assert.equal(row.escalatedFrom.selector,"typesafe");
    assert.equal(row.model,"llm-fixture");
  }
  assert.match(result.stdout,/llm_fallback/u);
  assert.doesNotMatch(JSON.stringify(result.report),/test-key/u);
});

test("Jev不正応答の再試行前に受け取った使用量も集計し、未報告分と混同しない", t => {
  const result = fixture(t).run("invalid_first");
  assert.equal(result.status,0,result.stderr + result.stdout);
  assert.equal(result.report.usage.providerCalls,4);
  assert.equal(result.report.usage.httpAttempts,5);
  const jev = result.report.usage.providers.find(row => row.stage === "jev");
  assert.equal(jev.attempts,3);
  assert.deepEqual(jev.tokens.inputTokens,{reportedTotal:963,unreportedAttempts:0,reportedAverage:321});
  assert.deepEqual(jev.tokens.outputTokens,{reportedTotal:null,unreportedAttempts:3,reportedAverage:null});
});

test("期待不一致・途中失敗でも使用量を残し、認証拒否で後続exampleへ進まない", t => {
  const f=fixture(t);
  const mismatch=f.run("mismatch");
  assert.equal(mismatch.status,1);
  assert.equal(mismatch.report.results.length,0);
  assert.equal(mismatch.report.failures.length,2);
  assert.equal(mismatch.report.usage.httpAttempts,4);
  assert.equal(mismatch.report.usage.providers.find(row=>row.stage==="jev").tokens.inputTokens.reportedTotal,642);
  assert.equal(mismatch.report.failures[0].providerCalls.length,2);
  const denied=f.run("denied");
  assert.equal(denied.status,1);
  assert.equal(denied.report.summary.attempted,1);
  assert.match(denied.report.failures[0].error,/http=403/u);
  assert.equal(denied.requests.length,2);
  assert.equal(denied.report.usage.providers.find(row=>row.stage==="jev").tokens.inputTokens.reportedTotal,321);
  assert.deepEqual(denied.report.usage.providers.find(row=>row.stage==="llm_fallback").tokens.inputTokens,{reportedTotal:null,unreportedAttempts:1,reportedAverage:null});
  const invalid=f.run("bad_json");
  assert.equal(invalid.status,1);
  assert.equal(invalid.report.usage.providers.find(row=>row.stage==="llm_fallback").tokens.inputTokens.reportedTotal,20);
});

test("使用量の省略は不明、AI候補なしは実呼出し0と報告する", t => {
  const f=fixture(t);
  const missing=f.run("no_usage");
  assert.equal(missing.status,0,missing.stderr);
  for(const row of missing.report.usage.providers) {
    assert.deepEqual(row.tokens.inputTokens,{reportedTotal:null,unreportedAttempts:2,reportedAverage:null});
  }
  f.withoutAi();
  const none=f.run();
  assert.equal(none.status,0,none.stderr);
  assert.equal(none.requests.length,0);
  assert.equal(none.report.results[0].noAiCandidates,true);
  assert.deepEqual(none.report.usage,{cases:1,aiSelectionCases:0,fallbackCases:0,providerCalls:0,httpAttempts:0,providers:[]});
});

test("報告されたtokenだけを扱い、省略値・不正値を0に補完しない", () => {
  assert.deepEqual(reportedTokenUsage({usage:{input_tokens:0,output_tokens:-1,total_tokens:"100"}},"typesafe"),{
    inputTokens:0,outputTokens:null,totalTokens:null,cachedTokens:null
  });
  assert.deepEqual(reportedTokenUsage({usage:{prompt_tokens:10,completion_tokens:3,total_tokens:13,prompt_tokens_details:{cached_tokens:0}}},"openai-compatible"),{
    inputTokens:10,outputTokens:3,totalTokens:13,cachedTokens:0
  });
});
