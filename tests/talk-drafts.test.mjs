import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { createTalkDrafts, restoreFailedTalkDraft } from "../src/client/apps/talkDrafts.ts";

const emptyDraft = { text: "", photoId: "", share: null, error: "" };
const share = { appId: "notes", contentId: "note-a", title: "Aの共有" };

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((accept, fail) => { resolve = accept; reject = fail; });
  return { promise, resolve, reject };
}

// 実componentの送信・選択handlerを使い、通信の完了順だけを固定する。
// DOM描画は扱わず、ルーム切替時は実ソースのリアクティブ代入を実行する。
function composerHarness(app) {
  const source = readFileSync(new URL(`../src/client/apps/${app}.svelte`, import.meta.url), "utf8")
    .match(/<script[^>]*>([\s\S]*?)<\/script>/)[1];
  const parsed = ts.createSourceFile(`${app}.ts`, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const names = new Set([
    "submitMessage", "sendQuickReply", "selectThread", "selectPhoto", "applyInitialShareDraft",
    "matchesThreadId", "openThreadPicker", "openRoomPicker"
  ]);
  const functions = parsed.statements.filter((statement) =>
    ts.isFunctionDeclaration(statement) && names.has(statement.name?.text));
  const reactive = parsed.statements.filter((statement) => ts.isLabeledStatement(statement))
    .map((statement) => statement.getText(parsed));
  const selection = reactive.filter((statement) =>
    statement.startsWith("$: selectedThread =") || statement.startsWith("$: composer ="));
  const notification = reactive.find((statement) => statement.includes("const focused = threads.find"));
  assert.equal(selection.length, 2);
  assert.ok(notification);
  const code = ts.transpileModule([
    ...functions.map((statement) => statement.getText(parsed)),
    `function syncSelection() { ${selection.join("\n")} }`,
    `function applyNotification() { ${notification} syncSelection(); }`
  ].join("\n"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  const response = deferred();
  const transmissions = [];
  let scrollCount = 0;
  const draftForThread = createTalkDrafts();
  const context = {
    threads: ["A", "B"].map((id) => ({ id, contentId: `content-${id}` })),
    selectedThreadId: "A", selectedThread: undefined, composer: draftForThread("A"),
    draftForThread, restoreFailedTalkDraft, selectedThreadCanPost: true, sending: false,
    get selectedPhoto() { return this.composer.photoId ? { id: this.composer.photoId } : undefined; },
    readDividerArmed: true, readDividerAfterMessageId: "", pickerOpen: false,
    focusContentId: "", focusContentRequestId: 0, focusHistoryRepairId: "",
    lastAppliedFocusContentId: "", lastAppliedFocusContentRequestId: 0,
    pendingHistoryRepairId: "", lastHistorySignature: "", lastHistoryThreadId: "",
    lastAppliedShareDraftRequestId: 0, authError: "", unlockError: "",
    flushPendingRead() {}, setPhotoPickerOpen() {}, onNoise() {}, onBlockedContentOpen() {},
    onInitialShareDraftConsumed() {},
    onSend(talkId, body) { transmissions.push({ talkId, body }); return response.promise; },
    scrollHistoryToBottom() { scrollCount += 1; }
  };
  vm.createContext(context);
  vm.runInContext(code, context);
  context.syncSelection();
  return {
    context, response, transmissions,
    get scrollCount() { return scrollCount; },
    select(talkId, via = "一覧") {
      if (via === "通知") {
        context.focusContentId = `content-${talkId}`;
        context.focusContentRequestId += 1;
        context.applyNotification();
      } else {
        (context.openThreadPicker ?? context.openRoomPicker)();
        context.selectThread(talkId);
        context.syncSelection();
      }
    }
  };
}

for (const app of ["MessagesApp", "ChatApp"]) {
  test(`${app}: 未送信本文・写真・共有は一覧／通知で別ルームへ持ち越さない`, () => {
    for (const initial of [{ text: "Aの本文" }, { photoId: "photo-a" }, { share }]) {
      const harness = composerHarness(app);
      Object.assign(harness.context.composer, initial);
      harness.select("B");
      assert.deepEqual(harness.context.composer, emptyDraft);
      harness.context.composer.text = "Bの本文";
      harness.select("A", "通知");
      assert.deepEqual(harness.context.composer, { ...emptyDraft, ...initial });
      harness.select("B", "通知");
      assert.equal(harness.context.composer.text, "Bの本文");
    }
  });

  for (const via of ["一覧", "通知"]) {
    test(`${app}: A送信→${via}でB→A失敗は本文・添付・エラーをAへだけ復元する`, async () => {
      for (const initial of [{ text: " Aの本文 " }, { photoId: "photo-a" }, { share }]) {
        const harness = composerHarness(app);
        const { context, response, transmissions } = harness;
        context.draftForThread("B").text = "Bの新しい本文";
        Object.assign(context.composer, initial);
        const pending = context.submitMessage();
        assert.equal(context.sending, true);
        assert.deepEqual(context.composer, emptyDraft);
        harness.select("B", via);
        await context.submitMessage();
        await context.sendQuickReply("Bの候補");
        assert.equal(transmissions.length, 1, "別ルームでも同時送信を抑止する");
        response.resolve({ ok: false, error: "Aの通信失敗" });
        await pending;
        assert.equal(context.sending, false);
        assert.deepEqual(context.composer, { ...emptyDraft, text: "Bの新しい本文" });
        harness.select("A", via);
        assert.deepEqual(context.composer, { ...emptyDraft, ...initial, error: "Aの通信失敗" });
        assert.deepEqual(transmissions, [{
          talkId: "A", body: initial.photoId ? "photo:photo-a" : initial.share ? "share:note-a" : "Aの本文"
        }]);
      }
    });
  }

  test(`${app}: 送信元の新しい共有を失敗復元で上書きしない`, async () => {
    const harness = composerHarness(app);
    const { context, response } = harness;
    context.composer.text = "古い本文";
    const pending = context.submitMessage();
    harness.select("B");
    const nextShare = { ...share, contentId: "note-new", title: "新しい共有" };
    context.applyInitialShareDraft({ requestId: 1, talkId: "A", ...nextShare });
    context.syncSelection();
    response.reject(new Error("通信切断"));
    await pending;
    assert.equal(context.sending, false);
    assert.equal(context.selectedThreadId, "A");
    assert.equal(context.composer.text, "");
    assert.deepEqual({ ...context.composer.share }, nextShare);
    assert.equal(context.composer.error, "送信に失敗しました。");
  });

  test(`${app}: rejectでも元ルームへ復元し、成功なら下書きは消えたまま`, async () => {
    for (const ok of [false, true]) {
      const harness = composerHarness(app);
      const { context, response } = harness;
      context.composer.text = "Aの本文";
      const pending = context.submitMessage();
      harness.select("B", "通知");
      if (ok) response.resolve({ ok: true });
      else response.reject(new Error("通信切断"));
      await pending;
      assert.equal(context.sending, false);
      assert.deepEqual(context.composer, emptyDraft);
      assert.equal(harness.scrollCount, 0, "Aの送信完了はBをスクロールしない");
      harness.select("A");
      assert.equal(context.composer.text, ok ? "" : "Aの本文");
      assert.equal(context.composer.error, ok ? "" : "送信に失敗しました。");
    }
  });

  test(`${app}: Quick Reply失敗のエラーも元ルームに残し通常下書きは保持する`, async () => {
    const harness = composerHarness(app);
    const { context, response, transmissions } = harness;
    context.composer.text = "Aの未送信本文";
    const pending = context.sendQuickReply("Aの候補");
    harness.select("B", "通知");
    response.resolve({ ok: false, error: "候補の送信失敗" });
    await pending;
    assert.equal(context.composer.error, "");
    harness.select("A");
    assert.equal(context.composer.text, "Aの未送信本文");
    assert.equal(context.composer.error, "候補の送信失敗");
    assert.deepEqual(transmissions, [{ talkId: "A", body: "Aの候補" }]);
  });
}

test("下書きのメモリはcomponent相当の生成単位で分離し、再生成後は空になる", () => {
  const first = createTalkDrafts();
  first("A").text = "前の画面の下書き";
  const remounted = createTalkDrafts();
  assert.deepEqual(remounted("A"), emptyDraft);
});
