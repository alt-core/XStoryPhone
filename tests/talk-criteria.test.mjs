import assert from "node:assert/strict";
import test from "node:test";
import { answerCandidates, criteriaMatches, normalizeAnswer, parseTalkExtraction, regexExtract } from "../src/shared/talkCriteria.ts";
import { parseSetStatements } from "../src/shared/setExpression.ts";
import { applyStateAssignments, evaluateCondition, validateStateAssignments } from "../src/shared/condition.ts";
import { setExtractionIds, splitSetStatements } from "../src/shared/setExpression.ts";
import { createAnswerDeriver } from "../src/shared/staticAnswer.ts";

test("setとcondは引用符とescapeを同じ意味で読み、文字列内の区切りや抽出表記を再解釈しない", () => {
  const defs = new Map([["label", {type:"string"}], ["count", {type:"integer"}]]);
  for (const literal of [String.raw`"A\"B"`, String.raw`'A\'B'`, String.raw`"A\\B"`, '"A;B"', '"$extract.name"']) {
    const input = `label = ${literal}; count += 1`;
    const assignments = splitSetStatements(input);
    assert.equal(assignments.length, 2, input);
    assert.deepEqual(validateStateAssignments(assignments, defs), []);
    const values = applyStateAssignments({label:"",count:0},assignments,{},defs);
    assert.equal(evaluateCondition(`label == ${literal}`,values),true,literal);
    assert.equal(values.count,1);
    assert.deepEqual(setExtractionIds(assignments),[]);
  }
  assert.deepEqual(setExtractionIds(['label = "$extract.name"', 'label = $extract.name']), ['name']);
  assert.equal(applyStateAssignments({label:"",count:0}, ['label = $extract.name'], {name:"抽出値"}, defs).label,"抽出値");
});

test("候補一覧は部分一致と全文一致を混ぜ、NFKC・前後空白・大小だけを揃える", () => {
  const text = '調査結果\n資料を見せて\n"鍵"\n"ＡＢＣ"';
  assert.equal(criteriaMatches(text, "調査結果をください"), true);
  assert.equal(criteriaMatches(text, "鍵をください"), false);
  assert.equal(criteriaMatches(text, " 鍵 "), true);
  assert.equal(criteriaMatches(text, "abc"), true);
  assert.equal(criteriaMatches('"AB C"', "a b c"), false);
  assert.notEqual(normalizeAnswer("あお"), normalizeAnswer("アオ"));
  assert.equal(criteriaMatches('"①"', "1", true), true);
});

test("secretは有限全文一致のみ。同じ正規化結果を重複生成しない", () => {
  assert.deepEqual(answerCandidates('"ＡＢＣ"\n"abc"\n" abc "', true), [{ value: "abc", exact: true }]);
  for (const text of ['abc', '/abc/', '"abc', '""', '"abc" trailing']) {
    assert.throws(() => answerCandidates(text, true));
  }
  assert.throws(() => answerCandidates('abc\n/def/u'));
  assert.equal(criteriaMatches('/ABC/u', 'abc'), false);
  assert.equal(criteriaMatches('/ABC/iu', 'abc'), true);
});

test("名前付きregexとAI抽出は同じID一覧を返し、regexは一回だけ実行する", () => {
  assert.deepEqual(parseTalkExtraction('/^名前は(?<name>.+)です$/u').ids, ['name']);
  assert.deepEqual(regexExtract('/^名前は(?<name>.+)です$/u', '名前は花子です'), { name: '花子' });
  assert.deepEqual(regexExtract('/(?<letter>a)/g', 'aaa'), { letter: 'a' });
  assert.deepEqual(regexExtract('/^(?<one>a)(?<two>b)?$/u', 'a'), { one: 'a' });
  assert.equal(regexExtract('/^(?<one>a)$/u', 'b'), null);
  assert.equal(parseTalkExtraction('{"name":"名乗った名前"}').kind, 'ai');
  assert.deepEqual(parseTalkExtraction('{"name":"名乗った名前"}').ids, ['name']);
  assert.throws(() => parseTalkExtraction('/abc/u'));
  assert.throws(() => parseTalkExtraction('/(?<name>{{value}})/u'));
  assert.throws(() => parseTalkExtraction('/(?<name>a)(?<名前>b)/u'), /capture名/u);
  assert.deepEqual(regexExtract('/(?<=名前)(?<name>.+)/u', '名前花子'), { name: '花子' });
  assert.ok(parseSetStatements('name=$extract.名前').errors.length);
  assert.ok(parseSetStatements('name=$match.name').errors.length);
});

test("secretが複数あっても同じ入力のKDFは共有し、取得先は入口ごとに分ける", async () => {
  const original = crypto.subtle.deriveBits;
  let calls = 0;
  crypto.subtle.deriveBits = function (...args) { calls += 1; return original.apply(this, args); };
  try {
    const derive = createAnswerDeriver({ salt: "test-only", iterations: 100_000 });
    const [first, second, repeat] = await Promise.all([derive(" ＡＢＣ ", "entry1"), derive("abc", "entry2"), derive("abc", "entry1")]);
    assert.equal(calls, 1);
    assert.equal(first, repeat);
    assert.notEqual(first, second);
    assert.match(first, /^[a-f0-9]{64}$/u);
  } finally { crypto.subtle.deriveBits = original; }
});
