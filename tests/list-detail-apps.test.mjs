import assert from "node:assert/strict";
import test from "node:test";
import { talkForFocusedContent } from "../src/client/apps/talkContentFocus.ts";
import { createTalkDrafts } from "../src/client/apps/talkDrafts.ts";
import { componentScriptHarness } from "./helpers/component-script-harness.mjs";

const apps = [
  {
    label: "メモ・メール",
    url: new URL("../src/client/apps/DocumentListApp.svelte", import.meta.url),
    itemsProp: "documents",
    select: "selectDocument",
    openId: "openDocumentId",
    baseProps: { appTitle: "メモ", accent: "#fff", emptyIcon: null, emptyLabel: "" },
    item: (id, extra = {}) => ({ id, contentId: `content_${id}`, title: id, body: "", ...extra })
  },
  {
    label: "アルバム",
    url: new URL("../src/client/apps/PhotosApp.svelte", import.meta.url),
    itemsProp: "photos",
    select: "selectPhoto",
    openId: "openPhotoId",
    baseProps: {},
    item: (id, extra = {}) => ({ id, contentId: `content_${id}`, imageUrl: `/${id}.webp`, ...extra })
  },
  {
    label: "電話",
    url: new URL("../src/client/apps/PhoneApp.svelte", import.meta.url),
    itemsProp: "callLogs",
    select: "openCallHistoryEntry",
    openId: "detailCallId",
    baseProps: {},
    item: (id, extra = {}) => ({ id, contentId: `content_${id}`, name: id, kind: "incoming", at: "", durationLabel: "", ...extra })
  }
];

function harness(app, props = {}) {
  const events = [];
  const record = (kind) => (contentId) => events.push(`${kind}:${contentId}`);
  const items = props[app.itemsProp] ?? [app.item("a"), app.item("b"), app.item("broken", { corrupted: true })];
  const component = componentScriptHarness(app.url, {
    ...app.baseProps,
    [app.itemsProp]: items,
    onNavigate: record("navigate"),
    onContentOpen: record("open"),
    onDisplayedContentChange: record("display"),
    onBlockedContentOpen: record("blocked"),
    ...props
  }, {
    tick: () => Promise.resolve(),
    window: { dispatchEvent() {} },
    playAudio: async () => true,
    stopAudioPlayback() {}
  });
  const take = () => events.splice(0);
  return { component, items, take, open: () => component.evaluate(app.openId) };
}

for (const app of apps) {
  test(`${app.label}: ホームから開くと一覧で始まり、開封もしない`, () => {
    const h = harness(app);
    assert.equal(h.open(), "");
    assert.deepEqual(h.take(), ["display:"]);
  });

  test(`${app.label}: 一覧から開くたびに開封し、一覧ボタンで一覧へ戻る`, () => {
    const h = harness(app);
    h.take();
    h.component.evaluate(`${app.select}(${app.itemsProp}[0]);`);
    h.component.flush();
    assert.equal(h.open(), "a");
    assert.deepEqual(h.take(), ["navigate:content_a", "open:content_a", "display:content_a"]);
    h.component.evaluate("returnToList();");
    h.component.flush();
    assert.equal(h.open(), "");
    assert.deepEqual(h.take(), ["navigate:", "display:"]);
    h.component.evaluate(`${app.select}(${app.itemsProp}[0]);`);
    h.component.flush();
    assert.deepEqual(h.take(), ["navigate:content_a", "open:content_a", "display:content_a"], "同じ項目の再表示も開封する");
  });

  test(`${app.label}: 破損項目は開かず、案内のための報告だけを出す`, () => {
    const h = harness(app);
    h.take();
    h.component.evaluate(`${app.select}(${app.itemsProp}[2]);`);
    h.component.flush();
    assert.equal(h.open(), "");
    assert.deepEqual(h.take(), ["blocked:content_broken"]);
  });

  test(`${app.label}: 外からの指定は詳細を開き、一覧の指定・破損・見つからない項目では一覧を出す`, () => {
    const h = harness(app, { focusContentId: "content_b", focusContentRequestId: 1 });
    assert.equal(h.open(), "b");
    assert.deepEqual(h.take(), ["open:content_b", "display:content_b"]);

    h.component.update({ focusContentId: "content_b", focusContentRequestId: 2 });
    assert.deepEqual(h.take(), ["open:content_b"], "表示中の項目を外から開き直しても1回報告する");

    h.component.update({ focusContentId: "", focusContentRequestId: 3 });
    assert.equal(h.open(), "");
    assert.deepEqual(h.take(), ["display:"]);

    h.component.update({ focusContentId: "content_broken", focusContentRequestId: 4 });
    assert.equal(h.open(), "");
    assert.deepEqual(h.take(), ["blocked:content_broken"]);

    h.component.update({ focusContentId: "content_missing", focusContentRequestId: 5 });
    assert.equal(h.open(), "");
    assert.deepEqual(h.take(), []);

    h.component.update({ [app.itemsProp]: [...h.items, app.item("late")] });
    assert.equal(h.open(), "", "同じ指定を一覧の更新で再適用しない");
  });

  test(`${app.label}: 表示中の項目がcondで消えたら一覧へ戻り、何も開封しない`, () => {
    const h = harness(app, { focusContentId: "content_a", focusContentRequestId: 1 });
    h.take();
    h.component.update({ [app.itemsProp]: h.items.filter((item) => item.id !== "a") });
    assert.equal(h.open(), "");
    assert.deepEqual(h.take(), ["display:"]);
  });
}

test("アルバム: 拡大は静止画だけで、一覧へ戻ると拡大も閉じる", () => {
  const app = apps[1];
  const h = harness(app, {
    photos: [app.item("still"), app.item("video", { mediaKind: "video", videoUrl: "/video.mp4" })],
    focusContentId: "content_still", focusContentRequestId: 1
  });
  h.component.evaluate("openZoom();");
  assert.equal(h.component.evaluate("zoomed"), true);
  h.component.evaluate("returnToList();");
  h.component.flush();
  assert.equal(h.component.evaluate("zoomed"), false);
  h.component.update({ focusContentId: "content_video", focusContentRequestId: 2 });
  h.component.evaluate("openZoom();");
  assert.equal(h.component.evaluate("zoomed"), false);
});

test("アルバム: 拡大表示は短い辺を枠に合わせ、はみ出した方向だけ動かせる", () => {
  const app = apps[1];
  const h = harness(app, { focusContentId: "content_a", focusContentRequestId: 1 });
  h.component.evaluate("openZoom(); zoomFrameWidth = 300; zoomFrameHeight = 600; zoomNaturalWidth = 1200; zoomNaturalHeight = 800;");
  h.component.flush();
  assert.equal(h.component.evaluate("zoomImageHeight"), 600);
  assert.equal(h.component.evaluate("zoomImageWidth"), 900);
  h.component.evaluate("setZoomOffset(1000, 1000);");
  assert.equal(h.component.evaluate("zoomOffsetX"), 300);
  assert.equal(h.component.evaluate("zoomOffsetY"), 0);
  h.component.evaluate("zoomFrameWidth = 600; zoomFrameHeight = 300; zoomNaturalWidth = 800; zoomNaturalHeight = 1200;");
  h.component.flush();
  assert.equal(h.component.evaluate("zoomImageWidth"), 600);
  assert.equal(h.component.evaluate("zoomImageHeight"), 900);
  h.component.evaluate("setZoomOffset(-1000, -1000);");
  assert.equal(h.component.evaluate("zoomOffsetX"), 0);
  assert.equal(h.component.evaluate("zoomOffsetY"), -300);
});

test("電話: 一覧から録音を再生すると開封し、詳細では入った時の報告だけにする", () => {
  const app = apps[2];
  const h = harness(app, { callLogs: [app.item("voice", { audioUrl: "/voice.mp3" })] });
  h.take();
  h.component.evaluate("reportPlaybackOpen(callLogs[0]); reportPlaybackOpen(callLogs[0]);");
  assert.deepEqual(h.take(), ["open:content_voice"]);
  h.component.evaluate("openCallHistoryEntry(callLogs[0]);");
  h.component.flush();
  h.component.evaluate("reportPlaybackOpen(callLogs[0]);");
  assert.deepEqual(h.take(), ["navigate:content_voice", "open:content_voice", "display:content_voice"]);
});

for (const [label, file] of [["メッセージ", "MessagesApp"], ["チャット", "ChatApp"]]) {
  const url = new URL(`../src/client/apps/${file}.svelte`, import.meta.url);
  const threads = [
    { id: "a", contentId: "talk_a", messages: [] },
    { id: "b", contentId: "talk_b", messages: [] },
    { id: "broken", contentId: "talk_broken", corrupted: true, messages: [] }
  ];

  function talkHarness(props = {}) {
    const events = [];
    const record = (kind) => (contentId) => events.push(`${kind}:${contentId}`);
    const component = componentScriptHarness(url, {
      threads,
      onNavigate: record("navigate"),
      onContentOpen: record("open"),
      onDisplayedThreadChange: record("display"),
      onBlockedContentOpen: record("blocked"),
      ...props
    }, {
      talkForFocusedContent,
      createTalkDrafts,
      restoreFailedTalkDraft() {},
      resolvedTalkInputState: () => ({ visible: true, canSubmit: true }),
      latestQuickReplyPlacement: () => undefined,
      loadTalkDelaySeenMessages: () => ({}),
      saveTalkDelaySeenMessages() {},
      shouldDelayTalkMessage: () => false,
      shouldQueueTalkMessage: () => false,
      queuedTalkMessageDelayMs: () => 0,
      consumeConversationScroll: () => undefined,
      isConversationNearBottom: () => true,
      rememberConversationScrollForLink() {},
      restoreConversationScrollAfterTick() {},
      scrollConversationToBottomAfterTick() {},
      brokenRangesAfterMessages: () => [],
      brokenRangesBeforeMessage: () => [],
      afterUpdate() {}, beforeUpdate() {},
      window: { clearTimeout() {}, setTimeout() { return 1; } }
    });
    return { component, take: () => events.splice(0) };
  }

  test(`${label}: 指定された会話から始め、空の指定では一覧から始める`, () => {
    const home = talkHarness({ focusContentId: "talk_a", focusContentRequestId: 1 });
    assert.equal(home.component.evaluate("pickerOpen"), false);
    assert.deepEqual(home.take(), ["open:talk_a", "display:talk_a"]);
    const list = talkHarness();
    assert.equal(list.component.evaluate("pickerOpen"), true);
    assert.deepEqual(list.take(), ["display:"]);
    const broken = talkHarness({ focusContentId: "talk_broken", focusContentRequestId: 1 });
    assert.equal(broken.component.evaluate("pickerOpen"), true, "破損した会話の指定では一覧を出す");
    assert.deepEqual(broken.take(), ["blocked:talk_broken", "display:"]);
  });

  test(`${label}: 一覧を挟んで同じ会話を開き直すたびに開封し、破損した会話は開かない`, () => {
    const h = talkHarness({ focusContentId: "talk_a", focusContentRequestId: 1 });
    h.take();
    h.component.evaluate(`${file === "MessagesApp" ? "openThreadPicker" : "openRoomPicker"}();`);
    h.component.flush();
    h.component.evaluate('selectThread("a");');
    h.component.flush();
    assert.deepEqual(h.take(), ["navigate:", "display:", "navigate:talk_a", "open:talk_a", "display:talk_a"]);
    h.component.evaluate('selectThread("broken");');
    h.component.flush();
    assert.deepEqual(h.take(), ["blocked:talk_broken"]);
    assert.equal(h.component.evaluate("selectedThreadId"), "a");
  });

  test(`${label}: 表示中の会話がcondで消えたら一覧へ戻る`, () => {
    const h = talkHarness({ focusContentId: "talk_b", focusContentRequestId: 1 });
    h.take();
    h.component.update({ threads: threads.filter((thread) => thread.id !== "b") });
    assert.equal(h.component.evaluate("pickerOpen"), true);
    assert.deepEqual(h.take(), ["display:"]);
  });

  test(`${label}: 履歴で一覧や別会話へ戻っても、読んだ会話の既読を失わない`, () => {
    const reads = [];
    const h = talkHarness({
      threads: threads.slice(0, 2).map(thread => ({ ...thread, unread: true, messages: [
        { id: `latest_${thread.id}`, sender: "other", body: "新しい発話", sentAt: "10/3 20:14" }
      ] })),
      focusContentId: "talk_b", focusContentRequestId: 1,
      onRead(talkId, messageId) { reads.push([talkId, messageId]); }
    });
    assert.deepEqual(reads, []);
    h.component.update({ focusContentId: "", focusContentRequestId: 2 });
    assert.deepEqual(reads, [["b", "latest_b"]]);
    h.component.update({ focusContentId: "talk_a", focusContentRequestId: 3 });
    h.component.update({ focusContentId: "talk_b", focusContentRequestId: 4 });
    assert.deepEqual(reads, [["b", "latest_b"], ["a", "latest_a"]]);
  });

  test(`${label}: 写真選択中の履歴復元ではモーダルを閉じ、下書きは維持する`, () => {
    const pickerChanges = [];
    const h = talkHarness({ focusContentId: "talk_b", focusContentRequestId: 1,
      onPickerOpenChange(open) { pickerChanges.push(open); }
    });
    h.component.evaluate('composer.text = "送信前の本文"; setPhotoPickerOpen(true);');
    h.component.update({ focusContentId: "", focusContentRequestId: 2 });
    assert.equal(h.component.evaluate("pickerOpen"), true);
    assert.equal(h.component.evaluate("photoPickerOpen"), false);
    assert.equal(pickerChanges.at(-1), false);
    assert.equal(h.component.evaluate("composer.text"), "送信前の本文");
  });

  test(`${label}: 写真選択中に会話が利用不能になってもモーダルを残さない`, () => {
    const h = talkHarness({ focusContentId: "talk_b", focusContentRequestId: 1 });
    h.component.evaluate("setPhotoPickerOpen(true);");
    h.component.update({ threads: threads.filter(thread => thread.id !== "b") });
    assert.equal(h.component.evaluate("pickerOpen"), true);
    assert.equal(h.component.evaluate("photoPickerOpen"), false);
  });
}
