import assert from "node:assert/strict";
import test from "node:test";
import { browserPlayerRequestInit } from "../src/client/system/playerTransport.ts";

test("browserモードのplayer APIは進行tokenと操作を共通JSON bodyで送る", () => {
  const refresh = browserPlayerRequestInit({}, "signed-progress");
  assert.equal(refresh.method, "POST");
  assert.equal(refresh.headers["x-xstoryphone-progress"], undefined);
  assert.deepEqual(JSON.parse(refresh.body), { progressToken: "signed-progress" });

  const talk = browserPlayerRequestInit({
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ talkId: "t_search_agent", turnKey: "turn-1", message: "古いメモ" })
  }, "signed-progress");
  assert.equal(talk.method, "POST");
  assert.equal(talk.headers["x-xstoryphone-progress"], undefined);
  assert.deepEqual(JSON.parse(talk.body), {
    talkId: "t_search_agent",
    turnKey: "turn-1",
    message: "古いメモ",
    progressToken: "signed-progress"
  });
});
