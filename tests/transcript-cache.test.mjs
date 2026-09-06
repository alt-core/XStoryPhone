import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { serverTranscriptFetchPlans } from "../src/client/system/playerApi.ts";
import { transcriptCacheCompatible } from "../src/client/system/transcriptCachePolicy.ts";
import { limitedSearchAgentItems } from "../src/client/system/transcriptLimit.ts";

test("検索talk cacheは表示項目を直近200件に制限する", () => {
  const items = limitedSearchAgentItems([
    { seq: 1, kind: "message" },
    ...Array.from({ length: 200 }, (_, index) => ({ seq: index + 2, kind: "message" }))
  ]);
  assert.equal(items.length, 200);
  assert.equal(items[0].seq, 2);
  assert.equal(items.at(-1).seq, 201);
});

test("server履歴cacheはsessionとscenario更新が一致する時だけ再利用する", () => {
  const stored = {
    version: 4,
    credential: "session-a",
    clientRevision: "client-revision",
    transcriptRevision: "old-revision",
    transcripts: { talk: {} }
  };
  assert.equal(transcriptCacheCompatible(stored, "session-a", "new-revision"), false);
  assert.equal(transcriptCacheCompatible(stored, "session-a", "old-revision"), true);
  assert.equal(transcriptCacheCompatible(stored, "session-b", "old-revision"), false);
  assert.equal(transcriptCacheCompatible({ ...stored, version: 3 }, "session-a", "old-revision"), false);
});

test("server履歴cacheが空またはdeltaに欠番があれば取得し直し、通常の連続deltaは再取得しない", () => {
  const message = (seq) => ({
    seq,
    id: `message-${seq}`,
    talkId: "guide",
    sender: seq % 2 ? "owner" : "other",
    body: `本文${seq}`,
    attachment: null,
    sentAt: "2026-08-30T00:00:00.000Z"
  });
  const publicState = {
    talks: [{
      talkId: "guide",
      kind: "sms",
      canPost: true,
      turnKey: "turn-2",
      transcriptKey: "transcript-guide",
      lastMessageSeq: 10,
      historyRevision: 0,
      inputVisible: true,
      inputVisibleAfterSeq: 0,
      inputEnabled: true,
      inputEnabledAfterSeq: 0
    }, {
      talkId: "search_agent",
      kind: "search_agent",
      label: "検索AIナビ",
      canPost: true,
      turnKey: "turn-search",
      transcriptKey: "transcript-search",
      lastMessageSeq: 0,
      historyRevision: 0,
      inputVisible: true,
      inputVisibleAfterSeq: 0,
      inputEnabled: true,
      inputEnabledAfterSeq: 0
    }],
    transcriptDeltas: [{
      kind: "sms",
      talkId: "guide",
      transcriptKey: "transcript-guide",
      messages: [message(9), message(10)]
    }]
  };

  assert.deepEqual(serverTranscriptFetchPlans(publicState, {
    talk: {
      search_agent: { kind: "search_agent", transcriptKey: "transcript-search", messages: [] }
    }
  }), [{ stream: "guide", after: 0 }]);

  assert.deepEqual(serverTranscriptFetchPlans(publicState, {
    talk: {
      guide: {
        kind: "sms",
        transcriptKey: "transcript-guide",
        historyRevision: 0,
        messages: Array.from({ length: 8 }, (_, index) => message(index + 1))
      },
      search_agent: { kind: "search_agent", transcriptKey: "transcript-search", messages: [] }
    }
  }), []);

  for (const seq of [undefined, 0, -1, 1.5, "8"]) {
    assert.deepEqual(serverTranscriptFetchPlans({ ...publicState, talks: [publicState.talks[0]] }, {
      talk: { guide: { kind: "sms", transcriptKey: "transcript-guide", messages: [message(seq)] } }
    }), [{ stream: "guide", after: 0 }], "不正なseqを配列位置から推測せず取得し直す");
  }

  assert.deepEqual(serverTranscriptFetchPlans({
    ...publicState,
    talks: [{ ...publicState.talks[0], lastMessageSeq: 7 }],
    transcriptDeltas: [{
      kind: "sms",
      talkId: "guide",
      transcriptKey: "transcript-guide",
      messages: [message(7)]
    }]
  }, {
    talk: {
      guide: {
        kind: "sms",
        transcriptKey: "transcript-guide",
        historyRevision: 0,
        messages: Array.from({ length: 4 }, (_, index) => message(index + 1))
      },
      search_agent: { kind: "search_agent", transcriptKey: "transcript-search", messages: [] }
    }
  }), [{ stream: "guide", after: 4 }]);
});

test("server履歴の不正cacheを破棄して全取得し、不正なAPIのseqは保存しない", async () => {
  const message = (seq) => ({ seq, id: `m-${seq}`, talkId: "guide", sender: "other", body: `本文${seq}` });
  const cache = { talk: { guide: { kind: "sms", transcriptKey: "key", messages: [message(undefined)] } } };
  const calls = [];
  const context = {
    loadTranscriptCache: () => cache,
    saveTranscriptCache: () => calls.push("save"),
    async fetchTranscriptDelta(_credential, stream, after) {
      calls.push(`${stream}:${after}`);
      return { kind: "sms", talkId: "guide", transcriptKey: "key", messages: [message(1), message(2)] };
    },
    limitedSearchAgentItems
  };
  const source = ts.createSourceFile("playerApi.ts", readFileSync(new URL("../src/client/system/playerApi.ts", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const names = ["hydratePlayerState", "serverTranscriptFetchPlans", "missingTranscriptAfter", "lastMessageSeq", "messageSeq", "applyTranscriptDelta", "mergeMessages", "publicStateWithoutTransportFields"];
  const functions = source.statements.filter((item) => ts.isFunctionDeclaration(item) && names.includes(item.name?.text));
  vm.createContext(context);
  vm.runInContext(ts.transpileModule(functions.map((item) => item.getText(source).replace(/^export /u, "")).join("\n"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022 }
  }).outputText, context);
  const state = { talks: [{ talkId: "guide", transcriptKey: "key", lastMessageSeq: 2, historyRevision: 0 }], transcriptDeltas: [] };
  const hydrated = await context.hydratePlayerState(state, "session");
  assert.deepEqual(calls, ["guide:0", "save"]);
  assert.deepEqual(Array.from(hydrated.smsMessages, (item) => item.seq), [1, 2]);
  calls.length = 0;
  await assert.rejects(context.hydratePlayerState({
    ...state, transcriptDeltas: [{ kind: "sms", talkId: "guide", transcriptKey: "key", messages: [message(undefined)] }]
  }, "session"), /transcript_invalid_seq/u);
  assert.deepEqual(calls, [], "不正応答を永続cacheへ書き込まない");
});
