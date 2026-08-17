import assert from "node:assert/strict";
import test from "node:test";
import { limitedSearchMessages } from "../src/client/system/transcriptLimit.ts";

test("browser側の検索履歴キャッシュも直近200メッセージへ制限する", () => {
  const messages = limitedSearchMessages(Array.from({ length: 202 }, (_, index) => ({
      seq: index + 1,
      id: `search-${index + 1}`,
      requestId: `request-${index}`,
      role: "user",
      body: "検索",
      sentAt: "2026-08-17T00:00:00.000Z"
    })));
  assert.equal(messages.length, 200);
  assert.equal(messages[0].seq, 3);
});
