import assert from "node:assert/strict";
import test from "node:test";
import { talkFlowRows } from "../scripts/lib/talk-flow-rows.mjs";
import { auditTalkCriteria } from "../scripts/lib/talk-criteria-audit.mjs";

const row = { __rowNumber: 2, talk: "guide", from: "intro", type: "match", text: "/^終了$/u", extract: "" };
const ruleFor = mode => talkFlowRows([{ ...row, mode }]).rules[0];

test("既存のmodeと引数なしgame_overは従来の意味を保つ", () => {
  for (const mode of ["", "stay", "game_over"]) {
    assert.equal(ruleFor(mode).mode, mode);
    assert.equal(ruleFor(mode).gameOverReason, "");
  }
  for (const mode of ["game_over()", 'game_over("")', ' game_over ( "  " ) ']) {
    assert.equal(ruleFor(mode).mode, "game_over");
    assert.equal(ruleFor(mode).gameOverReason, "");
  }
});

test("game_overの理由は引用符・括弧・escape・実改行を文字列として解釈する", () => {
  const reason = '原因の「引用」と"二重引用符"、\\、(括弧)。\n次の行動。';
  for (const argument of [JSON.stringify(reason), JSON.stringify(reason).replaceAll("\\n", "\r\n")]) {
    assert.equal(ruleFor(`game_over(${argument})`).gameOverReason, reason);
  }
  assert.equal(ruleFor(`game_over(${JSON.stringify("  原因。\r\n次の行動。\r補足。  ")})`).gameOverReason, "原因。\n次の行動。\n補足。");
  const slashBeforeNewline = '末尾\\\n次行';
  assert.equal(ruleFor(`game_over(${JSON.stringify(slashBeforeNewline).replaceAll("\\n", "\n")})`).gameOverReason, slashBeforeNewline);
  assert.throws(() => ruleFor('game_over("末尾\\\n次行")'), /引数は二重引用符/u);
});

test("game_overの引数は文字列1個に限定し、式を実行しない", () => {
  for (const mode of ["advance", "stay(\"理由\")", "game_over(理由)", "game_over(null)", "game_over(123)", "game_over(true)", "game_over([])", "game_over({})", 'game_over("理由", "追加")', 'game_over("理由" + "追加")', "game_over(globalThis.process.exit())", "game_over('理由')", 'game_over("未終了)', 'game_over("理由") trailing']) {
    assert.throws(() => ruleFor(mode), /modeが不正|引数は二重引用符/u, mode);
  }
});

test("game_overの理由は展開後の改行込み160 UTF-16単位で検査する", () => {
  for (const reason of ["あ".repeat(160), "😀".repeat(80), "あ".repeat(79) + "\n" + "い".repeat(80)]) {
    assert.equal(ruleFor(`game_over(${JSON.stringify(reason)})`).gameOverReason, reason);
  }
  for (const reason of ["あ".repeat(161), "😀".repeat(81), "あ".repeat(80) + "\n" + "い".repeat(80)]) {
    assert.throws(() => ruleFor(`game_over(${JSON.stringify(reason)})`), /理由は160文字以内/u);
  }
  for (const argument of ['"{{topic}}"', '"{{未終了"', String.raw`"\u007b\u007btopic}}"`]) {
    assert.throws(() => ruleFor(`game_over(${argument})`), /理由にはtemplateを指定できません/u);
  }
});

test("引数付きgame_overも制作lintでgame_overとして診断し、行ごとの構文エラーを収集する", () => {
  const rules = talkFlowRows([{ ...row, type: "ai", text: "相手を困らせる", mode: 'game_over("理由")' }]).rules;
  const audit = auditTalkCriteria(rules);
  assert.equal(audit.summary.gameOver, 1);
  assert.ok(audit.findings.some(item => item.code === "game_over_boundary_weak"));
  const errors = [];
  talkFlowRows([{ ...row, mode: "unknown" }, { ...row, __rowNumber: 3, mode: "game_over(123)" }], error => errors.push(error));
  assert.equal(errors.length, 2);
  assert.match(errors[0], /talk_flow.tsv:2/u);
  assert.match(errors[1], /talk_flow.tsv:3/u);
});
