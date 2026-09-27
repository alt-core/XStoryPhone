import assert from "node:assert/strict";
import test from "node:test";
import {
  albumMediaAddedAssistantKey,
  assistantHiddenByComposerPhotoDraft,
  clearAlbumAssistantStateForPhotoDraft,
  selectAssistantSurfaceMessage
} from "../src/client/system/albumAssistantUiState.ts";
const noticeBody = "登録しました。";

test("アルバム追加案内の待機キーはアプリ単位で分離する", () => {
  assert.equal(albumMediaAddedAssistantKey("messages", "photo-1"), "messages:photo-1");
  assert.equal(albumMediaAddedAssistantKey("chat", "photo-1"), "chat:photo-1");
});

test("写真下書きは同じ会話アプリのアルバム案内だけを隠す", () => {
  assert.equal(assistantHiddenByComposerPhotoDraft("messages", { messages: true }), true);
  assert.equal(assistantHiddenByComposerPhotoDraft("chat", { messages: true }), false);
  assert.equal(assistantHiddenByComposerPhotoDraft("photos", { photos: true }), false);
});

test("写真下書き開始時は同じアプリの一時案内だけを消す", () => {
  const transientMessage = {
    id: "album-added",
    notice: "album_added",
    surface: "messages",
    body: noticeBody,
    weight: 1
  };
  const result = clearAlbumAssistantStateForPhotoDraft({
    appId: "messages",
    pendingKeys: ["messages:photo-1", "chat:photo-2", "broken-key"],
    transientMessage
  });
  assert.deepEqual(result.pendingKeys, ["chat:photo-2", "broken-key"]);
  assert.equal(result.transientMessage, undefined);

  const otherApp = clearAlbumAssistantStateForPhotoDraft({
    appId: "chat",
    pendingKeys: [],
    transientMessage
  });
  assert.equal(otherApp.transientMessage, transientMessage);
});

test("本文が同じでも通知を取り違えず、操作への案内と通常画面の案内を混ぜない", () => {
  const authored = { id: "hint", trigger: "screen:home", body: noticeBody, weight: 1 };
  const blocked = { ...authored, id: "temporary", trigger: "blocked_link", surface: "home", notice: "blocked_link" };
  assert.equal(selectAssistantSurfaceMessage(blocked, authored), blocked);
  assert.equal(selectAssistantSurfaceMessage(blocked, undefined), blocked);
  assert.equal(clearAlbumAssistantStateForPhotoDraft({ appId: "home", pendingKeys: [], transientMessage: blocked }).transientMessage, blocked);
  const repaired = { ...blocked, notice: "repaired" };
  assert.equal(selectAssistantSurfaceMessage(repaired, authored), repaired, "修復通知など他の優先順位は変えない");
  const added = { ...blocked, notice: "album_added", body: "文言を変更" };
  assert.equal(clearAlbumAssistantStateForPhotoDraft({ appId: "home", pendingKeys: [], transientMessage: added }).transientMessage, undefined);
});
