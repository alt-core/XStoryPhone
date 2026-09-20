import assert from "node:assert/strict";
import test from "node:test";
import { auditTalkCriteria } from "../scripts/lib/talk-criteria-audit.mjs";

const rule = { __rowNumber: 2, talk: "fixture", from: "question", intent: "分岐", criteria: "プレイヤーが具体的な質問をしている。", match: "", example: "質問です", mode: "" };

test("criteriaの任意lintは場面説明・入力条件・写真・game overの書き分けを診断する", () => {
  const { findings, summary } = auditTalkCriteria([
    { ...rule, __rowNumber: 2, intent: "", criteria: "" },
    { ...rule, __rowNumber: 3, criteria: "次へ進める" },
    { ...rule, __rowNumber: 4, criteria: "写真", example: "photo:sample" },
    { ...rule, __rowNumber: 5, criteria: "相手を困らせる", mode: "game_over" },
    { ...rule, __rowNumber: 6, criteria: "/unterminated" }
  ]);
  const codes = new Set(findings.map((item) => item.code));
  for (const code of ["default_context_empty", "normal_criteria_contains_response_or_flow", "photo_rule_missing_photo_id", "normal_criteria_too_generic", "game_over_boundary_weak", "normal_criteria_regex_invalid"]) {
    assert.ok(codes.has(code), code);
  }
  assert.equal(summary.total, 5);
  assert.equal("withProperName" in summary, false);
  assert.ok(findings.every((item) => item.row >= 2 && item.talk === "fixture" && item.suggestion));
});

test("正規表現の条件を自然文lintへ混ぜず、既定文脈や長さの診断を保持する", () => {
  const { findings } = auditTalkCriteria([
    { ...rule, criteria: "/^次へ$/u", mode: "game_over" },
    { ...rule, __rowNumber: 3, intent: "", criteria: "説明" },
    { ...rule, __rowNumber: 4, intent: "", criteria: "通常候補に一致しない場合に待つ。".repeat(30) },
    { ...rule, __rowNumber: 5, criteria: "プレイヤーが具体的な対象を挙げている。".repeat(10) }
  ]);
  assert.equal(findings.some((item) => item.row === 2), false);
  assert.ok(findings.some((item) => item.code === "default_boundary_weak"));
  assert.ok(findings.some((item) => item.code === "default_context_long"));
  assert.ok(findings.some((item) => item.code === "normal_criteria_long"));
});

test("正規表現だけの場面へLLM用のdefault文脈を要求しない", () => {
  const fallback = { ...rule, intent: "", criteria: "" };
  assert.deepEqual(auditTalkCriteria([
    fallback,
    { ...rule, criteria: "/^確認$/u" }
  ]).findings, []);
  assert.ok(auditTalkCriteria([
    fallback,
    { ...rule, from: "*", criteria: "プレイヤーが明示的な質問をしている" }
  ]).findings.some((item) => item.code === "default_context_empty"));
});
