import assert from "node:assert/strict";
import test from "node:test";
import { D1Store } from "../src/platform/cloudflare/d1Store.ts";

function fakeD1({ rows = [], changes = 1 } = {}) {
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
              async all() {
                return { results: rows };
              },
              async run() {
                return { meta: { changes } };
              }
            };
          }
        };
      }
    }
  };
}

test("実行中の予定イベントは5分のlease満了時刻を次のwakeにする", async () => {
  const fake = fakeD1({
    rows: [
      { due_at: "2026-08-12T20:20:00.000Z", status: "queued", updated_at: "2026-08-12T20:00:00.000Z" },
      { due_at: "2026-08-12T20:00:00.000Z", status: "running", updated_at: "2026-08-12T20:10:00.000Z" }
    ]
  });

  assert.equal(await new D1Store(fake.db).nextScheduledWakeAt("player-1"), "2026-08-12T20:15:00.000Z");
});

test("5分以上孤立したrunningイベントをdue対象に含める", async () => {
  const fake = fakeD1();
  await new D1Store(fake.db).dueScheduledEvents("player-1", "2026-08-12T20:10:00.000Z");

  assert.match(fake.calls[0].sql, /status = 'running' AND updated_at <= \?/u);
  assert.match(fake.calls[0].sql, /LIMIT 5/u);
  assert.deepEqual(fake.calls[0].bindings, [
    "player-1",
    "2026-08-12T20:10:00.000Z",
    "2026-08-12T20:05:00.000Z"
  ]);
});

test("claimはqueuedまたは5分以上孤立したrunningだけを獲得する", async () => {
  const fake = fakeD1();
  const before = Date.now();
  assert.equal(await new D1Store(fake.db).claimScheduledEvent("player-1", "event-1"), true);
  const after = Date.now();

  assert.match(fake.calls[0].sql, /status = 'queued' OR \(status = 'running' AND updated_at <= \?\)/u);
  const [claimedAt, eventId, playerId, leaseCutoff] = fake.calls[0].bindings;
  assert.equal(eventId, "event-1");
  assert.equal(playerId, "player-1");
  assert.ok(Date.parse(claimedAt) >= before && Date.parse(claimedAt) <= after);
  assert.equal(Date.parse(claimedAt) - Date.parse(leaseCutoff), 5 * 60 * 1_000);
});

test("予定イベントは成功時だけcompleted、失敗時は同じ行をqueuedへ戻す", async () => {
  const completed = fakeD1();
  await new D1Store(completed.db).completeScheduledEvent("player-1", "event-1");
  assert.match(completed.calls[0].sql, /SET status = 'completed'/u);
  assert.match(completed.calls[0].sql, /status = 'running'/u);

  const requeued = fakeD1();
  await new D1Store(requeued.db).requeueScheduledEvent("player-1", "event-1");
  assert.match(requeued.calls[0].sql, /SET status = 'queued'/u);
  assert.match(requeued.calls[0].sql, /status = 'running'/u);
});
