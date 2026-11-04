import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { createTalkDrafts, restoreFailedTalkDraft } from "../src/client/apps/talkDrafts.ts";
import { talkForFocusedContent } from "../src/client/apps/talkContentFocus.ts";
import { quickReplyLabel, quickReplyText } from "../src/shared/quickReplies.ts";
import { parse } from "svelte/compiler";

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
  const componentSource = readFileSync(new URL(`../src/client/apps/${app}.svelte`, import.meta.url), "utf8");
  const source = componentSource.match(/<script[^>]*>([\s\S]*?)<\/script>/)[1];
  const parsed = ts.createSourceFile(`${app}.ts`, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const names = new Set([
    "submitMessage", "sendQuickReply", "selectThread", "selectPhoto", "applyInitialShareDraft",
    "matchesThreadId", "openThreadPicker", "openRoomPicker", "applyFocus", "focusThread", "enterThread"
  ]);
  const functions = parsed.statements.filter((statement) =>
    ts.isFunctionDeclaration(statement) && names.has(statement.name?.text));
  const reactive = parsed.statements.filter((statement) => ts.isLabeledStatement(statement))
    .map((statement) => statement.getText(parsed));
  const selection = reactive.filter((statement) =>
    statement.startsWith("$: selectedThread =") || statement.startsWith("$: composer ="));
  const notification = reactive.find((statement) => statement === "$: applyFocus(focusContentId, focusContentRequestId);");
  assert.equal(selection.length, 2);
  assert.ok(notification);
  const code = ts.transpileModule([
    ...functions.map((statement) => statement.getText(parsed)),
    `function syncSelection() { ${selection.join("\n")} }`,
    `function applyNotification() { ${notification} syncSelection(); }`
  ].join("\n"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  const response = deferred();
  const transmissions = [];
  const focusCalls = [];
  let scrollCount = 0;
  const draftForThread = createTalkDrafts();
  const context = {
    threads: ["A", "B"].map((id) => ({
      id, contentId: `content-${id}`, messages: [{ attachment: { contentId: `attachment-${id}` } }]
    })),
    selectedThreadId: "A", selectedThread: undefined, composer: draftForThread("A"),
    draftForThread, restoreFailedTalkDraft, quickReplyLabel, quickReplyText, selectedThreadCanPost: true, sending: false,
    get selectedPhoto() { return this.composer.photoId ? { id: this.composer.photoId } : undefined; },
    readDividerArmed: true, readDividerAfterMessageId: "", pickerOpen: false, photoPickerOpen: false,
    focusContentId: "", focusContentRequestId: 0, focusHistoryRepairId: "",
    appliedFocusRequestId: 0, entrySerial: 0, onNavigate() {},
    pendingHistoryRepairId: "", pendingAttachmentContentId: "", lastHistorySignature: "", lastHistoryThreadId: "",
    lastAppliedShareDraftRequestId: 0, authError: "", unlockError: "",
    flushPendingRead() {}, setPhotoPickerOpen() {}, onNoise() {}, onBlockedContentOpen() {},
    onInitialShareDraftConsumed() {},
    talkForFocusedContent(threads, contentId) {
      focusCalls.push(contentId);
      return talkForFocusedContent(threads, contentId);
    },
    onSend(talkId, body, options) {
      transmissions.push({ talkId, body, ...(options ? { options: { ...options } } : {}) });
      return response.promise;
    },
    scrollHistoryToBottom() { scrollCount += 1; }
  };
  vm.createContext(context);
  vm.runInContext(code, context);
  context.syncSelection();
  return {
    context, response, transmissions,
    get scrollCount() { return scrollCount; },
    renderedQuickReplyHandler(message) {
      // 実テンプレートのcallbackを、描画時の発話に結び付けて実行する。
      let callback;
      function visit(node) {
        if (!node || typeof node !== "object") return;
        if (node.type === "Component" && node.name === "QuickReplies") {
          callback = node.attributes.find((attribute) => attribute.name === "onSelect")?.value.expression;
          return;
        }
        for (const child of Object.values(node)) {
          if (child && typeof child === "object") for (const item of Array.isArray(child) ? child : [child]) visit(item);
        }
      }
      visit(parse(componentSource, { modern: true }).fragment);
      assert.ok(callback);
      context.renderedMessage = message;
      return vm.runInContext(`((message) => (${componentSource.slice(callback.start, callback.end)}))(renderedMessage)`, context);
    },
    select(talkId, via = "一覧") {
      if (via === "通知" || via === "添付検索") {
        context.focusContentId = `${via === "添付検索" ? "attachment" : "content"}-${talkId}`;
        context.focusContentRequestId += 1;
        const before = focusCalls.length;
        context.applyNotification();
        assert.equal(focusCalls.length, before + 1, "実componentが本体のfocus helperを一度呼ぶ");
        assert.equal(focusCalls[before], context.focusContentId);
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

  for (const via of ["一覧", "通知", "添付検索"]) {
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

  test(`${app}: 発言を変える候補は描画した発話のseqを送り、通常下書きを消さない`, async () => {
    for (const text of ["はい、お願いします", ""]) {
      const harness = composerHarness(app);
      const { context, response, transmissions } = harness;
      context.composer.text = "Aの未送信本文";
      context.composer.photoId = "photo-a";
      const select = harness.renderedQuickReplyHandler({ seq: 42 });
      context.selectedThread.messages.push({ seq: 99, sender: "other", body: "遅れて届いた発話" });
      const pending = select({ label: "はい", text });
      assert.deepEqual(transmissions, [{ talkId: "A", body: "はい", options: { display: text, quickReplySeq: 42 } }]);
      assert.equal(context.composer.text, "Aの未送信本文");
      assert.equal(context.composer.photoId, "photo-a");
      await context.sendQuickReply({ label: "二度目", text: "" }, 99);
      assert.equal(transmissions.length, 1, "送信待ち中は無発言の候補も二重送信しない");
      response.resolve({ ok: true });
      await pending;
      assert.equal(context.sending, false);
      assert.equal(context.composer.text, "Aの未送信本文");
    }
  });

  test(`${app}: 無発言候補の失敗は元ルームだけに残し、別ルームと元の本文・添付を保つ`, async () => {
    for (const rejected of [false, true]) {
      const harness = composerHarness(app);
      const { context, response, transmissions } = harness;
      Object.assign(context.composer, { text: "Aの未送信本文", share });
      const pending = context.sendQuickReply({ label: "続きを読む", text: "" }, 42);
      harness.select("B", "通知");
      context.composer.text = "Bの未送信本文";
      if (rejected) response.reject(new Error("通信切断"));
      else response.resolve({ ok: false, error: "無発言候補の送信失敗" });
      await pending;
      assert.deepEqual(context.composer, { ...emptyDraft, text: "Bの未送信本文" });
      assert.equal(harness.scrollCount, 0);
      harness.select("A");
      assert.deepEqual(context.composer, {
        ...emptyDraft, text: "Aの未送信本文", share,
        error: rejected ? "送信に失敗しました。" : "無発言候補の送信失敗"
      });
      assert.deepEqual(transmissions, [{ talkId: "A", body: "続きを読む", options: { display: "", quickReplySeq: 42 } }]);
    }
  });
}

test("下書きのメモリはcomponent相当の生成単位で分離し、再生成後は空になる", () => {
  const first = createTalkDrafts();
  first("A").text = "前の画面の下書き";
  const remounted = createTalkDrafts();
  assert.deepEqual(remounted("A"), emptyDraft);
});
