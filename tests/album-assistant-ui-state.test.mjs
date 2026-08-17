import assert from "node:assert/strict";
import test from "node:test";
import {
  ALBUM_MEDIA_ADDED_ASSISTANT_BODY,
  albumMediaAddedAssistantKey,
  assistantHiddenByComposerPhotoDraft,
  clearAlbumAssistantStateForPhotoDraft
} from "../src/client/system/albumAssistantUiState.ts";

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
    surface: "messages",
    body: ALBUM_MEDIA_ADDED_ASSISTANT_BODY,
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
