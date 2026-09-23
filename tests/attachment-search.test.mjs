import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createApp } from "../src/server/app.ts";
import { encodeBrowserProgress } from "../src/server/browserProgress.ts";
import {
  workerScenario, createInitialPlayerState, initializeTalkState, revealTalkMessages,
  searchScenario, openTargetExists, repairTarget, publicPlayerState
} from "../src/worker/scenario.ts";
import { talkForFocusedContent } from "../src/client/apps/talkContentFocus.ts";

function fixture(kind, { locked = false } = {}) {
  const talk = workerScenario.talks.find((item) => item.kind === kind && item.startBlocks.length === 1);
  const block = workerScenario.talkBlocks.find((item) => item.id === talk.startBlocks[0]);
  const attachment = workerScenario.attachments.find((item) => item.content && (locked ? item.lock === "password" : !item.lock));
  const content = workerScenario.contents.find((item) => item.id === attachment.content);
  const app = workerScenario.apps.find((item) => item.id === talk.appId);
  const originals = [talk, block, attachment, content, app].map((item) => structuredClone(item));
  Object.assign(talk, { cond: "", initialState: "normal" });
  Object.assign(app, { cond: "", initialState: "normal" });
  Object.assign(attachment, { title: "試験添付", search: [["添付", "手掛かり"]], searchApp: talk.appId, cond: "" });
  if (locked) Object.assign(attachment, { type: "document", body: "未解除の秘密本文", asset: undefined });
  Object.assign(content, { cond: "", search: [] });
  if (locked) Object.assign(content, { appId: talk.appId, initialState: "hidden", record: { attachment: attachment.id, unlockCode: "1234" } });
  block.messages = [{ ...block.messages[0], body: "添付があります", attachmentId: attachment.id }];
  const state = createInitialPlayerState();
  const initial = initializeTalkState(talk, "turn", workerScenario.stateVariables);
  state.talks[talk.id] = initial.state;
  return {
    talk, block, attachment, content, app, state,
    exposed: revealTalkMessages(state, talk.id, initial.messages),
    messages: initial.messages,
    restore() {
      [talk, block, attachment, content, app].forEach((item, index) => {
        for (const key of Object.keys(item)) delete item[key];
        Object.assign(item, originals[index]);
      });
    }
  };
}

for (const kind of ["sms", "chat"]) {
  test(`${kind}添付の検索targetは指定appへ向き、素材URLを候補へ出さない`, async () => {
    const f = fixture(kind);
    try {
      const result = searchScenario("添付の手掛かり", f.state).find((item) => item.contentId === f.content.publicId && item.appId === f.talk.appId);
      assert.ok(result);
      assert.equal(result.title, "試験添付");
      assert.equal(result.repairable, false);
      assert.equal(result.thumbnailUrl, undefined);
      assert.ok(!JSON.stringify(result).includes(f.attachment.asset));
      assert.equal(openTargetExists(f.content.publicId, f.talk.appId, f.state), false, "未露出では開けない");
      assert.equal(openTargetExists(f.content.publicId, f.talk.appId, f.exposed), true);
      assert.equal(openTargetExists(f.content.publicId, kind === "sms" ? "chat" : "messages", f.exposed), false, "別appへ能力を広げない");
      assert.equal(repairTarget(f.content.publicId, f.talk.appId), null, "添付タップで所有albumを横から修復しない");
      f.app.initialState = "repairable";
      assert.equal(openTargetExists(f.content.publicId, f.talk.appId, f.exposed), false, "appが使えなければ開けない");
      const previous = workerScenario.project.repairParentApp;
      try {
        workerScenario.project.repairParentApp = true;
        assert.equal(searchScenario("添付の手掛かり", f.exposed).find(item => item.contentId === f.content.publicId && item.appId === f.talk.appId)?.repairable, false,
          "親の同時修復を有効にしても、添付の検索結果から別アプリを修復しない");
      } finally { workerScenario.project.repairParentApp = previous; }
      f.app.initialState = "normal";
      f.attachment.cond = "false";
      assert.ok(!searchScenario("添付の手掛かり", f.exposed).some((item) => item.appId === f.talk.appId && item.contentId === f.content.publicId));
      f.attachment.cond = "";
      const second = { ...f.attachment, id: "same-target", search: [["手掛かり"]] };
      workerScenario.attachments.push(second);
      try {
        assert.equal(searchScenario("添付の手掛かり", f.exposed).filter((item) => item.appId === f.talk.appId && item.contentId === f.content.publicId).length, 1);
      } finally { workerScenario.attachments.pop(); }
    } finally { f.restore(); }
  });
}

test("初期履歴にない添付も表示済block能力から開け、未来blockだけでは開けない", () => {
  const f = fixture("sms");
  const oldStart = f.talk.startBlocks;
  try {
    f.talk.startBlocks = [];
    assert.equal(openTargetExists(f.content.publicId, f.talk.appId, f.exposed), false);
    f.exposed.talks[f.talk.id].blockDisplayCounts[f.block.id] = 1;
    assert.equal(openTargetExists(f.content.publicId, f.talk.appId, f.exposed), true);
    f.talk.cond = "false";
    assert.equal(openTargetExists(f.content.publicId, f.talk.appId, f.exposed), false);
  } finally { f.talk.startBlocks = oldStart; f.restore(); }
});

for (const mode of ["server", "browser"]) {
  test(`${mode}のstandalone locked添付は会話内へ開き、解除するまで本文を公開しない`, async () => {
    const f = fixture("sms", { locked: true });
    const originalMode = workerScenario.playerMode;
    const password = workerScenario.lockedContentPasswords.find((item) => item.contentId === f.content.id);
    const originalAnswers = password.answers;
    const originalHooks = workerScenario.hooks;
    workerScenario.playerMode = mode;
    workerScenario.hooks = [];
    password.answers = ["1234"];
    let player = { id: "attachment-test", state: f.exposed, stateVersion: 0 };
    const store = {
      async playerForSession() { return structuredClone(player); },
      async savePlayer(_current, state) { player = { ...player, state: structuredClone(state), stateVersion: player.stateVersion + 1 }; return true; },
      async dueScheduledEvents() { return []; },
      async nextScheduledWakeAt() { return null; },
      async generatedAudioJobs() { return []; }
    };
    const secret = "local-static-test-key";
    const app = createApp({ store, config: { appEnv: "development", browserStateSecret: secret, llm: {} } });
    let token = mode === "browser" ? await encodeBrowserProgress(secret, workerScenario.project.id, player) : "";
    const post = async (route, data) => {
      const response = await app.request(`http://localhost${route}`, {
        method: "POST", headers: { "content-type": "application/json", ...(mode === "server" ? { authorization: "Bearer local" } : {}) },
        body: JSON.stringify({ ...data, ...(mode === "browser" ? { progressToken: token } : {}) })
      });
      const body = await response.json();
      token = body.playerState?.progressToken ?? token;
      return { response, body };
    };
    try {
      const initial = await publicPlayerState(f.exposed, 0);
      assert.ok(!JSON.stringify(initial).includes("未解除の秘密本文"));
      const opened = await post("/api/content/opened", { appId: f.talk.appId, contentId: f.content.publicId });
      assert.equal(opened.response.status, 200, JSON.stringify(opened.body));
      assert.ok(!opened.body.playerState.contentStates.some((item) => item.contentId === f.content.publicId && item.state === "repaired"));
      assert.ok(!JSON.stringify(opened.body).includes("未解除の秘密本文"));
      const unlocked = await post("/api/content/unlock", { contentId: f.content.publicId, password: "1234" });
      assert.equal(unlocked.response.status, 200, JSON.stringify(unlocked.body));
      assert.equal(unlocked.body.playerState.unlockedAttachments.find((item) => item.contentId === f.content.publicId)?.body, "未解除の秘密本文");
    } finally {
      password.answers = originalAnswers;
      workerScenario.playerMode = originalMode;
      workerScenario.hooks = originalHooks;
      f.restore();
    }
  });
}

test("複数roomの添付targetは該当threadを選び、通常thread指定・破損選択を維持する", () => {
  const threads = [
    { id: "first", messages: [] },
    { id: "broken", corrupted: true, messages: [{ attachment: { contentId: "target" } }] },
    { id: "second", contentId: "thread-content", messages: [{ attachment: { contentId: "target" } }] }
  ];
  assert.equal(talkForFocusedContent(threads, "target")?.id, "second");
  assert.equal(talkForFocusedContent(threads, "thread-content")?.id, "second");
  assert.equal(talkForFocusedContent(threads, "broken")?.id, "broken");
  assert.equal(talkForFocusedContent(threads, "missing"), undefined);
  for (const file of ["MessagesApp.svelte", "ChatApp.svelte"]) {
    const source = readFileSync(new URL(`../src/client/apps/${file}`, import.meta.url), "utf8");
    assert.match(source, /talkForFocusedContent\(threads, focusContentId\)/);
    assert.match(source, /data-attachment-content-id=\{message\.attachment\?\.contentId/);
  }
});
