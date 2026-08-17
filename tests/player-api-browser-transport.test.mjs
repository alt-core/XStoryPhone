import assert from "node:assert/strict";
import test from "node:test";
import { browserPlayerRequestInit } from "../src/client/system/playerTransport.ts";

test("browserモードのplayer APIは進行tokenと操作を共通JSON bodyで送る", () => {
  const refresh = browserPlayerRequestInit({}, "signed-progress");
  assert.equal(refresh.method, "POST");
  assert.equal(refresh.headers["x-xstoryphone-progress"], undefined);
  assert.deepEqual(JSON.parse(refresh.body), { progressToken: "signed-progress" });

  const search = browserPlayerRequestInit({
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query: "古いメモ", requestId: "request-1" })
  }, "signed-progress");
  assert.equal(search.method, "POST");
  assert.equal(search.headers["x-xstoryphone-progress"], undefined);
  assert.deepEqual(JSON.parse(search.body), {
    query: "古いメモ",
    requestId: "request-1",
    progressToken: "signed-progress"
  });
});
