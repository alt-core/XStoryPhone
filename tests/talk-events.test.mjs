import assert from "node:assert/strict";
import test from "node:test";
import {
  formatEnvForMessageBlock,
  formatEnvForMessageBlockFromState,
  resolveTalkEvents
} from "../src/worker/talkEvents.ts";
import { workerScenario } from "../src/worker/scenario.ts";

test("player本文とmessage block参照から会話履歴を復元する", () => {
  const rows = [
    {
      id: "sms_player_turn",
      kind: "sms",
      talk_id: "guide",
      event_type: "player_message",
      body: "プレイヤー入力",
      block_id: null,
      format_env_json: null,
      delivered_at: "2026-08-12T11:00:00.000Z"
    },
    {
      id: "sms_block_turn_1",
      kind: "sms",
      talk_id: "guide",
      event_type: "message_block",
      body: null,
      block_id: "guide::message_reply",
      format_env_json: null,
      delivered_at: "2026-08-12T11:00:01.000Z"
    }
  ];
  const messages = resolveTalkEvents(rows);
  assert.equal(messages[0].id, "sms_player_turn");
  assert.equal(messages[0].body, "プレイヤー入力");
  assert.equal(messages[1].id, "sms_block_turn_1:1");
  assert.equal(messages[1].body, "メッセージの送受信を確認できました。");
  assert.equal(messages[1].sentAt, "2026-08-12T11:00:01.000Z");
  assert.equal(messages[1].delayMs, 350);
  assert.equal(messages[1].delayOnFirstDisplay, true);
});

test("message blockは参照する文字列だけをenvへ保存し、現在台本で再展開する", () => {
  const block = workerScenario.talkBlocks.find((item) => item.id === "guide::message_reply");
  assert.ok(block);
  const originalBody = block.messages[0].body;
  block.messages[0].body = "{{player_name}}さん、{{unused_in_state}}";
  try {
    assert.deepEqual(formatEnvForMessageBlock(block.id, {
      player_name: "田中",
      unused_in_state: "確認",
      unrelated: "保存しない",
      numeric: 12,
      boolean: true
    }), {
      player_name: "田中",
      unused_in_state: "確認"
    });
    const event = {
      id: "sms_block_template",
      kind: "sms",
      talk_id: "guide",
      event_type: "message_block",
      body: null,
      block_id: block.id,
      format_env_json: JSON.stringify({ player_name: "田中", unused_in_state: "確認" }),
      delivered_at: "2026-08-12T11:00:00.000Z"
    };
    assert.equal(resolveTalkEvents([event])[0].body, "田中さん、確認");
    block.messages[0].body = "{{player_name}}さん、更新後";
    assert.equal(resolveTalkEvents([event])[0].body, "田中さん、更新後");
  } finally {
    block.messages[0].body = originalBody;
  }
});

test("templateが参照する型付き状態値だけを文字列化して保存する", () => {
  const block = workerScenario.talkBlocks.find((item) => item.id === "guide::message_reply");
  assert.ok(block);
  const originalBody = block.messages[0].body;
  block.messages[0].body = "{{visit_count}}回 / {{ready}}";
  try {
    assert.deepEqual(formatEnvForMessageBlockFromState(block.id, {
      visit_count: 12,
      ready: false,
      unrelated: "保存しない"
    }), {
      visit_count: "12",
      ready: "false"
    });
  } finally {
    block.messages[0].body = originalBody;
  }
});

test("repeat blockは初期blockやplayer投稿を数えず同じtalkとbase blockのeventだけを数える", () => {
  const base = {
    kind: "sms",
    talk_id: "guide",
    event_type: "message_block",
    body: null,
    block_id: "guide::message_reply",
    format_env_json: null
  };
  const messages = resolveTalkEvents([
    { ...base, id: "block-1", delivered_at: "2026-08-12T11:00:00.000Z" },
    {
      id: "player-between",
      kind: "sms",
      talk_id: "guide",
      event_type: "player_message",
      body: "間の入力",
      block_id: null,
      format_env_json: null,
      delivered_at: "2026-08-12T11:00:01.000Z"
    },
    { ...base, id: "block-2", delivered_at: "2026-08-12T11:00:02.000Z" }
  ]);
  assert.match(messages[0].body, /送受信を確認/u);
  assert.equal(messages[1].body, "間の入力");
  assert.match(messages[2].body, /追加のメッセージ/u);
});

test("壊れたformat envと未知blockは安全に空として扱う", () => {
  const event = {
    id: "unknown-block",
    kind: "chat",
    talk_id: "lobby",
    event_type: "message_block",
    body: null,
    block_id: "lobby::unknown",
    format_env_json: "{broken",
    delivered_at: "2026-08-12T11:00:00.000Z"
  };
  assert.deepEqual(resolveTalkEvents([event]), []);
});
