import assert from "node:assert/strict";
import test from "node:test";
import {
  parseTalkFlowMatchSpec,
  buildTalkFlowMatchExtractionMessages,
  selectTalkFlowMatchGroupsFromAttempts
} from "../src/worker/product/talkFlowMatchExtraction.ts";

// 複数項目の一致、null、標本選択とprompt公開境界を共通契約として守る。
test("抽出のtuple・best・null・onceとprompt境界を保持する", () => {
  const parsed = parseTalkFlowMatchSpec(JSON.stringify({
    player_name: "呼び名として名乗った具体名だけを返す。なければ null。",
    player_name_kana: {
      rule: "呼び名をひらがな1〜5文字にする。できなければ null。",
      pick: "best"
    }
  }));
  assert.equal(parsed.ok, true, "match は最上位 key を id にした JSON object として読める");

  if (parsed.ok) {
    const userMessage = buildTalkFlowMatchExtractionMessages({
      talkId: "talk-a",
      fromId: "node-a",
      ruleId: "rule-a",
      playerInput: "山田です",
      recentMessages: [{ speaker: "相手", body: "呼び名を教えて" }],
      spec: parsed.spec
    }).find((message) => message.role === "user");
    assert.ok(userMessage, "match 抽出の user prompt を作れる");
    const userPayload = JSON.parse(userMessage.content);
    assert.deepEqual(
      Object.keys(userPayload),
      ["task", "items", "recent_messages", "player_input"],
      "match 抽出は抽出仕様を先、ターン固有の入力を後に置く"
    );
    assert.equal("talk_id" in userPayload, false, "match 抽出 prompt に内部 talk_id は渡さない");
    assert.equal("current_from_id" in userPayload, false, "match 抽出 prompt に内部 from ID は渡さない");
    assert.equal("selected_rule_id" in userPayload, false, "match 抽出 prompt に内部 rule ID は渡さない");
    for (const item of userPayload.items) {
      assert.equal("pick" in item, false, "pick は後段の採用ロジック専用なので LLM prompt に渡さない");
      assert.equal("null" in item, false, "null mode は後段の採用ロジック専用なので LLM prompt に渡さない");
    }

    const selected = selectTalkFlowMatchGroupsFromAttempts(
      parsed.spec,
      [
        { player_name: "山田", player_name_kana: "やまだ" },
        { player_name: "山田", player_name_kana: "やまた" },
        { player_name: "山田", player_name_kana: "やまだ" }
      ],
      ["player_name = $extract.player_name", "player_name_kana = $extract.player_name_kana"]
    );
    assert.deepEqual(
      selected,
      {
        ok: true,
        values: { player_name: "山田", player_name_kana: "やまだ" },
        matchGroups: { player_name: "山田", player_name_kana: "やまだ" },
        score: 1,
        maxScore: 1
      },
      "通常項目は tuple の2回一致で採用し、pick=best の項目は同じ値がある候補を優先する"
    );
  }

  const parsedBest = parseTalkFlowMatchSpec(JSON.stringify({
    player_name: {
      rule: "呼び名を返す。なければ null。",
      pick: "best"
    }
  }));
  assert.equal(parsedBest.ok, true);
  if (parsedBest.ok) {
    const selected = selectTalkFlowMatchGroupsFromAttempts(
      parsedBest.spec,
      [{ player_name: "山田" }, { player_name: "山多" }, { player_name: "山田" }]
    );
    assert.deepEqual(
      selected,
      {
        ok: true,
        values: { player_name: "山田" },
        matchGroups: { player_name: "山田" },
        score: 1,
        maxScore: 1
      },
      "pick=best だけの項目は同じ返答がある候補を優先する"
    );

    assert.deepEqual(
      selectTalkFlowMatchGroupsFromAttempts(parsedBest.spec, [
        { player_name: "山田" },
        { player_name: "山多" },
        { player_name: "山太" }
      ]),
      { ok: false, reason: "no_value" },
      "pick=best は最高スコアに届くまで早期採用しない"
    );

    assert.deepEqual(
      selectTalkFlowMatchGroupsFromAttempts(
        parsedBest.spec,
        [{ player_name: "山田" }, { player_name: "山多" }, { player_name: "山太" }],
        [],
        { acceptPartial: true }
      ),
      {
        ok: true,
        values: { player_name: "山田" },
        matchGroups: { player_name: "山田" },
        score: 0,
        maxScore: 1
      },
      "5回後相当では最高スコア未満でも最良候補を採用する"
    );
  }

  const parsedTuple = parseTalkFlowMatchSpec(JSON.stringify({
    player_name: "呼び名を返す。なければ null。",
    player_kind: "呼び名の種別を返す。なければ null。",
    player_name_kana: {
      rule: "呼び名をひらがなにする。できなければ null。",
      pick: "best"
    }
  }));
  assert.equal(parsedTuple.ok, true);
  if (parsedTuple.ok) {
    const selected = selectTalkFlowMatchGroupsFromAttempts(
      parsedTuple.spec,
      [
        { player_name: "A", player_kind: "x", player_name_kana: "えー" },
        { player_name: "A", player_kind: "y", player_name_kana: "えー" },
        { player_name: "B", player_kind: "y", player_name_kana: "びー" },
        { player_name: "B", player_kind: "y", player_name_kana: "びー" }
      ],
      ["player_name = $extract.player_name", "player_kind = $extract.player_kind"]
    );
    assert.deepEqual(
      selected,
      {
        ok: true,
        values: { player_name: "B", player_kind: "y", player_name_kana: "びー" },
        matchGroups: { player_name: "B", player_kind: "y", player_name_kana: "びー" },
        score: 1,
        maxScore: 1
      },
      "複数回一致必須項目は個別ではなく tuple として一致判定する"
    );
  }

  const parsedRequired = parseTalkFlowMatchSpec(JSON.stringify({
    player_name: "呼び名を返す。なければ null。"
  }));
  assert.equal(parsedRequired.ok, true);
  if (parsedRequired.ok) {
    assert.deepEqual(
      selectTalkFlowMatchGroupsFromAttempts(parsedRequired.spec, [
        { player_name: null },
        { player_name: "山田" }
      ]),
      { ok: false, reason: "no_value" },
      "null 非許容項目に null がある候補は一致判定から除外する"
    );

    assert.deepEqual(
      selectTalkFlowMatchGroupsFromAttempts(parsedRequired.spec, [
        { player_name: null },
        { player_name: "山田" },
        { player_name: "山田" }
      ]),
      {
        ok: true,
        values: { player_name: "山田" },
        matchGroups: { player_name: "山田" },
        score: 0,
        maxScore: 0
      },
      "null 非許容項目の null 候補を除いたあとに tuple が2回一致すれば採用する"
    );

    assert.deepEqual(
      selectTalkFlowMatchGroupsFromAttempts(
        parsedRequired.spec,
        [{ player_name: "山田" }],
        ["player_name = $extract.player_name"],
        { mode: "once" }
      ),
      {
        ok: true,
        values: { player_name: "山田" },
        matchGroups: { player_name: "山田" },
        score: 0,
        maxScore: 0
      },
      "once mode は 1 回の valid JSON で採用する"
    );

    assert.deepEqual(
      selectTalkFlowMatchGroupsFromAttempts(
        parsedRequired.spec,
        [{ player_name: null }, { player_name: "山田" }],
        ["player_name = $extract.player_name"],
        { mode: "once" }
      ),
      {
        ok: true,
        values: { player_name: "山田" },
        matchGroups: { player_name: "山田" },
        score: 0,
        maxScore: 0
      },
      "once mode でも null 非許容項目と set に必要な値は検証する"
    );
  }

  const parsedNull = parseTalkFlowMatchSpec(JSON.stringify({
    optional_alias: {
      rule: "別名があれば返す。なければ null。",
      null: "ok"
    }
  }));
  assert.equal(parsedNull.ok, true);
  if (parsedNull.ok) {
    const selected = selectTalkFlowMatchGroupsFromAttempts(
      parsedNull.spec,
      [{ optional_alias: null }, { optional_alias: null }]
    );
    assert.deepEqual(
      selected,
      {
        ok: true,
        values: { optional_alias: null },
        matchGroups: {},
        score: 0,
        maxScore: 0
      },
      "null: ok の項目だけ null を2回一致の採用対象にする"
    );
  }

  const parsedNullBest = parseTalkFlowMatchSpec(JSON.stringify({
    optional_alias: {
      rule: "別名があれば返す。なければ null。",
      pick: "best",
      null: "ok"
    }
  }));
  assert.equal(parsedNullBest.ok, true);
  if (parsedNullBest.ok) {
    assert.deepEqual(
      selectTalkFlowMatchGroupsFromAttempts(parsedNullBest.spec, [
        { optional_alias: null },
        { optional_alias: null }
      ]),
      {
        ok: true,
        values: { optional_alias: null },
        matchGroups: {},
        score: 1,
        maxScore: 1
      },
      "pick=best かつ null: ok の null は、同じ null が他候補にあれば通常の値と同じく +1 にする"
    );
  }

  const parsedNullWeak = parseTalkFlowMatchSpec(JSON.stringify({
    optional_alias: {
      rule: "別名があれば返す。なければ null。",
      pick: "best",
      null: "weak"
    }
  }));
  assert.equal(parsedNullWeak.ok, true);
  if (parsedNullWeak.ok) {
    assert.deepEqual(
      selectTalkFlowMatchGroupsFromAttempts(parsedNullWeak.spec, [
        { optional_alias: null },
        { optional_alias: null }
      ]),
      { ok: false, reason: "no_value" },
      "null: weak の null は、同じ null が複数あっても最高スコアにはしない"
    );

    assert.deepEqual(
      selectTalkFlowMatchGroupsFromAttempts(
        parsedNullWeak.spec,
        [{ optional_alias: null }, { optional_alias: null }],
        [],
        { acceptPartial: true }
      ),
      {
        ok: true,
        values: { optional_alias: null },
        matchGroups: {},
        score: -1,
        maxScore: 1
      },
      "5回後相当で null: weak の null を採用する時だけ -1 を付ける"
    );
  }
});
