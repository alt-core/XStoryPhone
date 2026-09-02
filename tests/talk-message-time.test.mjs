import assert from "node:assert/strict";
import test from "node:test";
import { talkMessageTimeLabel } from "../src/client/apps/talkMessageTime.ts";

test("talk日時は日付を失わず、時刻だけの台本値はそのまま使う", () => {
  assert.match(talkMessageTimeLabel("2026-08-11T19:10:00+09:00"), /^8\/11 19:10$/u);
  assert.equal(talkMessageTimeLabel("20:14"), "20:14");
});
