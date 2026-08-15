import assert from "node:assert/strict";
import test from "node:test";
import { prunePlayerSessions, recordInputEvent } from "../src/worker/repository.ts";

function fakeD1() {
  const calls = [];
  return {
    calls,
    db: {
      prepare(sql) {
        const call = { sql, bindings: [] };
        calls.push(call);
        return {
          bind(...bindings) {
            call.bindings = bindings;
            return {
              async run() {
                return { meta: { changes: 1 } };
              }
            };
          }
        };
      }
    }
  };
}

const sampleInputEvent = {
  eventType: "search",
  playerId: "player-1",
  requestKey: "request-1",
  appId: "search-agent",
  userInput: "古いメモ",
  status: "completed",
  matched: true
};

test("入力ログが無効ならplayer_input_eventsへ書き込まない", async () => {
  const fake = fakeD1();
  await recordInputEvent(fake.db, sampleInputEvent, false);
  assert.equal(fake.calls.length, 0);
});

test("入力ログが明示的に有効な場合だけplayer_input_eventsへ書き込む", async () => {
  const fake = fakeD1();
  await recordInputEvent(fake.db, sampleInputEvent, true);
  assert.equal(fake.calls.length, 1);
  assert.match(fake.calls[0].sql, /INSERT OR IGNORE INTO player_input_events/u);
});

test("sessionは現在のtokenと直近4件だけを残す", async () => {
  const fake = fakeD1();
  await prunePlayerSessions(fake.db, "player-1", "current-token-hash");

  assert.match(fake.calls[0].sql, /DELETE FROM sessions/u);
  assert.match(fake.calls[0].sql, /ORDER BY last_seen_at DESC, created_at DESC/u);
  assert.deepEqual(fake.calls[0].bindings, [
    "player-1",
    "current-token-hash",
    "player-1",
    "current-token-hash",
    4
  ]);
});
