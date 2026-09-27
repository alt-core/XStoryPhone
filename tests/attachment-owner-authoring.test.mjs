import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { loadTsvSheet } from "../scripts/lib/tsv-utils.mjs";
import { REQUIRED_ASSISTANT_TRIGGERS } from "../src/shared/assistantMessages.ts";
import { createPartSession } from "../src/worker/partSession.ts";
import { createPlayerOperations } from "../src/server/playerApp.ts";
import { createGeneratedAudioRuntime } from "../src/worker/services/generatedAudioRuntime.ts";
import { encodeBrowserProgress } from "../src/server/browserProgress.ts";

// 不要なMessages参照を残したデモの部分的な検査ではなく、最小の実TSV一式を生成する。
function fixture(t, appIds, receivingApps, searchApp = "chat") {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "xstoryphone-attachment-owner-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.cpSync("scenario/demo", directory, { recursive: true });
  const base = "scenario/demo/authoring/";
  const constants = loadTsvSheet(base + "project_constants.tsv").rows.filter(row =>
    row.key && !row.key.startsWith("chat_auth.") && row.key !== "event.client_callable");
  constants.find(row => row.key === "search_agent.start").value = "intro";
  constants.find(row => row.key === "player.mode").value = "browser";
  const rowsByTable = {
    project_constants: constants,
    state_vars: loadTsvSheet(base + "state_vars.tsv").rows,
    home_items: appIds.map(id => ({ id, label: id, icon: "message_circle", accent: "#5cc8a7" })),
    talk_people: [{ id: "contact", name: "連絡先", role: "npc" }],
    attachments: [{ id: "secret_image", type: "image", asset: "/fixture/secret.png", content: "secret_file", lock: "password", title: "ファイル", search_app: searchApp }],
    passwords: [{ content: "secret_file", password: '"0420"' }],
    message_items: receivingApps.includes("messages") ? [{ id: "sms_room", name: "連絡先", start: "intro" }] : [],
    chat_items: receivingApps.includes("chat") ? [{ id: "chat_room", name: "連絡先", start: "intro" }] : [],
    talk_blocks: [{ comment: "*search_agent" }, { comment: "intro" }, { sender: "search_agent", body: "表示確認" },
      ...receivingApps.flatMap(appId => [
        { comment: appId === "messages" ? "*sms_room" : "*chat_room" },
        { comment: "intro" }, { sender: "contact", attachment: "secret_image", time: "2030-01-01T12:00:00+09:00" }
      ])],
    assistant_messages: loadTsvSheet(base + "assistant_messages.tsv").rows.filter(row => REQUIRED_ASSISTANT_TRIGGERS.includes(row.trigger))
  };
  for (const name of fs.readdirSync(path.join(directory, "authoring")).filter(name => name.endsWith(".tsv"))) {
    const file = path.join(directory, "authoring", name);
    const { headers } = loadTsvSheet(file);
    const rows = rowsByTable[name.slice(0, -4)] ?? [];
    const quote = value => `"${String(value ?? "").replaceAll('"', '""')}"`;
    fs.writeFileSync(file, [headers, ...rows.map(row => headers.map(key => row[key]))].map(row => row.map(quote).join("\t")).join("\n") + "\n");
  }
  const built = spawnSync(process.execPath, ["--input-type=module", "--eval",
    'import {loadAndValidateScenario} from "./scripts/scenario-lib.mjs"; console.log(JSON.stringify(loadAndValidateScenario().worker));'],
  { encoding: "utf8", maxBuffer: 4 * 1024 * 1024, env: { ...process.env, XSTORYPHONE_SCENARIO_DIR: directory } });
  assert.equal(built.status, 0, built.stderr);
  return JSON.parse(built.stdout);
}

for (const appId of ["chat", "messages"]) test(`${appId}だけの作品で、item行のない鍵付き添付を受信・解錠できる`, async t => {
  // 検索先の指定は管理先や開錠資格を決めない。
  const worker = fixture(t, [appId], [appId], appId === "chat" ? "messages" : "chat");
  assert.equal(worker.contents.find(item => item.id === "secret_file").appId, appId);
  const parts = createPartSession(worker, {});
  const runtime = parts.runtime;
  const talk = worker.talks.find(item => item.appId === appId);
  const initial = runtime.initializeTalkState(talk, "turn", worker.stateVariables);
  let state = runtime.createInitialPlayerState();
  state.talks[talk.id] = initial.state;
  state = runtime.revealTalkMessages(state, talk.id, initial.messages);
  const secret = "local-attachment-owner";
  const token = await encodeBrowserProgress(secret, worker.project.id, { id: "fixture", state, stateVersion: 0 });
  const operations = createPlayerOperations(runtime, parts.hooks, createGeneratedAudioRuntime(runtime), undefined, parts);
  const dependencies = { store: {}, config: { appEnv: "development", browserStateSecret: secret, llm: {} } };
  const request = password => operations.execute("POST /api/content/unlock", { hostname: "localhost", body: {
    progressToken: token, contentId: worker.publicIds.content.secret_file, password
  } }, dependencies);
  const before = await runtime.publicPlayerState(state, 0);
  assert.equal(JSON.stringify(before).includes("/fixture/secret.png"), false);
  assert.equal((await request("wrong")).status, 400);
  const result = await request("0420");
  assert.equal(result.status, 200, JSON.stringify(result));
  assert.equal(result.payload.playerState.unlockedAttachments[0].media.imageUrl, "/fixture/secret.png");
});

test("両アプリがあっても実際の受信先を使い、未参照添付の定義も余計に禁止しない", t => {
  const used = fixture(t, ["messages", "chat"], ["chat"], "messages");
  assert.equal(used.contents.find(item => item.id === "secret_file").appId, "chat");
  const both = fixture(t, ["messages", "chat"], ["chat", "messages"]);
  assert.equal(both.contents.find(item => item.id === "secret_file").appId, "chat");
  const unused = fixture(t, ["chat"], []);
  assert.equal(unused.contents.find(item => item.id === "secret_file").appId, "chat");
});
