import assert from "node:assert/strict";
import test from "node:test";
import {
  mergeTranscriptAppend
} from "../src/server/store.ts";
import { MAX_SEARCH_AGENT_DISPLAY_ITEMS, SEARCH_AGENT_STREAM_ID } from "../src/shared/searchAgent.ts";
import {
  resolveSearchAgentEvent,
  searchAgentBlockEvents,
  searchAgentPlayerMessageEvent,
  searchAgentResultEvent
} from "../src/worker/talkEvents.ts";
import { workerScenario } from "../src/generated/workerScenario.generated.ts";

function playerEvent(seq, body = `入力${seq}`) {
  return searchAgentPlayerMessageEvent({
    id: `player-${seq}`,
    seq,
    body,
    deliveredAt: `2026-08-30T00:00:${String(seq % 60).padStart(2, "0")}.000Z`
  });
}

test("search agent transcriptは絶対seqを保ち、直近200表示itemだけを残す", () => {
  const events = Array.from({ length: 201 }, (_, index) => playerEvent(index + 1));
  const merged = mergeTranscriptAppend(
    { streamId: SEARCH_AGENT_STREAM_ID, transcriptKey: "old", messages: [] },
    { streamId: SEARCH_AGENT_STREAM_ID, transcriptKey: "key", messages: events }
  );

  assert.equal(merged.messages.length, MAX_SEARCH_AGENT_DISPLAY_ITEMS);
  assert.equal(merged.messages[0].seq, 2);
  assert.equal(merged.messages.at(-1).seq, 201);

  const continued = mergeTranscriptAppend(merged, {
    streamId: SEARCH_AGENT_STREAM_ID,
    transcriptKey: "key",
    messages: [playerEvent(202)]
  });
  assert.equal(continued.messages.at(-1).seq, 202);
  assert.equal(continued.messages.length, MAX_SEARCH_AGENT_DISPLAY_ITEMS);
});

test("search agent transcriptは同じseqの同内容を冪等に扱い、異内容と欠番を拒否する", () => {
  const first = mergeTranscriptAppend(
    { streamId: SEARCH_AGENT_STREAM_ID, transcriptKey: "key", messages: [] },
    { streamId: SEARCH_AGENT_STREAM_ID, transcriptKey: "key", messages: [playerEvent(1)] }
  );
  assert.deepEqual(mergeTranscriptAppend(first, {
    streamId: SEARCH_AGENT_STREAM_ID,
    transcriptKey: "key",
    messages: [playerEvent(1)]
  }), first);
  assert.throws(() => mergeTranscriptAppend(first, {
    streamId: SEARCH_AGENT_STREAM_ID,
    transcriptKey: "key",
    messages: [playerEvent(1, "異なる入力")]
  }), /search_agent_transcript_seq_conflict/u);
  assert.throws(() => mergeTranscriptAppend(first, {
    streamId: SEARCH_AGENT_STREAM_ID,
    transcriptKey: "key",
    messages: [playerEvent(3)]
  }), /search_agent_transcript_seq_gap/u);
});

test("search agent block eventは本文を保存せずblockとmessage indexから復元する", () => {
  const block = workerScenario.talkBlocks.find((candidate) => candidate.messages.length > 0);
  assert.ok(block);
  const rendered = searchAgentBlockEvents({
    baseBlockId: block.id,
    displayBlockId: block.id,
    formatEnv: {},
    startSeq: 0,
    baseSentAt: "2026-08-30T00:00:00.000Z",
    idPrefix: "search-block"
  });
  assert.equal(rendered.events.length, block.messages.length);
  assert.equal("body" in rendered.events[0], false);
  assert.equal(rendered.events[0].message_index, 0);
  assert.equal(resolveSearchAgentEvent(rendered.events[0])?.type, "message");

  const resultEvent = searchAgentResultEvent({
    id: "result-1",
    seq: rendered.lastSeq + 1,
    query: "記録",
    results: [{ contentId: "content", appId: "notes", targetKind: "content", repairable: true }],
    deliveredAt: "2026-08-30T00:00:10.000Z"
  });
  const resolvedResult = resolveSearchAgentEvent(resultEvent);
  assert.equal(resolvedResult?.type, "search_result");
  assert.equal(resolvedResult?.results.length, 1);
});
