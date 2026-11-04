import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { parseTalkOutputSteps } from "../scripts/lib/talk-output-steps.mjs";
import { validateScenarioParts } from "../scripts/lib/scenario-parts.mjs";
import { workerScenario } from "../src/generated/workerScenario.generated.ts";
import { readScenarioFixture } from "./helpers/authoring-fixture.mjs";

const scenarioLibUrl = new URL("./helpers/authoring-fixture.mjs", import.meta.url).href;

function copiedScenario() {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), "xstoryphone-talk-input-authoring-"));
  fs.cpSync("scenario/demo", target, { recursive: true });
  return target;
}

function validateScenario(scenarioDir) {
  return spawnSync(process.execPath, [
    "--input-type=module",
    "-e",
    `import(${JSON.stringify(scenarioLibUrl)}).then(({ loadAndValidateScenario }) => {
      const result = loadAndValidateScenario();
      const guide = result.worker.talks.find((talk) => talk.id === "guide");
      const search = result.worker.talks.find((talk) => talk.id === "search_agent");
      const intro = result.worker.talkBlocks.find((block) => block.talkId === "search_agent" && block.blockKey === "intro");
      process.stdout.write(JSON.stringify({ guide, search, quickReplies: intro?.messages.at(-1)?.quickReplies }));
    }).catch((error) => { console.error(error.message); process.exit(1); });`
  ], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: { ...process.env, XSTORYPHONE_SCENARIO_DIR: scenarioDir }
  });
}

test("/inputの4 actionを同じparserで解釈する", () => {
  assert.deepEqual(parseTalkOutputSteps([
    "/input hide",
    "/input disable",
    "reply",
    "/input show",
    "/input enable"
  ]), {
    steps: [
      { kind: "input", action: "hide" },
      { kind: "input", action: "disable" },
      { kind: "block", blockKey: "reply" },
      { kind: "input", action: "show" },
      { kind: "input", action: "enable" }
    ],
    errors: []
  });
});

test("talk入力初期値とQuick Replyをscenarioへ正規化する", () => {
  const target = copiedScenario();
  try {
    const result = validateScenario(target);
    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.equal(output.guide.inputVisible, true);
    assert.equal(output.guide.inputEnabled, true);
    assert.equal(output.search.inputVisible, true);
    assert.equal(output.search.inputEnabled, true);
    assert.deepEqual(output.quickReplies, ["古いメモ", "ヒント", "機能テスト", "ヘルプ"]);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test("Quick Replyは14件以上かつ20文字超でも500文字以内なら許可する", () => {
  const target = copiedScenario();
  try {
    const replies = Array.from({ length: 14 }, (_item, index) => (
      index === 0
        ? "これは二十文字を超えても利用できる選択肢のサンプルです"
        : `選択肢${index + 1}`
    ));
    const file = path.join(target, "authoring/talk_blocks.tsv");
    const source = fs.readFileSync(file, "utf8");
    const originalReplies = '"古いメモ\nヒント\n機能テスト\nヘルプ"';
    assert.ok(source.includes(originalReplies));
    fs.writeFileSync(file, source.replace(originalReplies, `"${replies.join("\n")}"`));

    const result = validateScenario(target);
    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.deepEqual(output.quickReplies, replies);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test("Quick Replyの表示文分離と明示空、区切り文字のescapeを読み分ける", () => {
  const target = copiedScenario();
  try {
    const file = path.join(target, "authoring/talk_blocks.tsv");
    const source = fs.readFileSync(file, "utf8");
    const original = '"古いメモ\nヒント\n機能テスト\nヘルプ"';
    assert.ok(source.includes(original));
    const replies = [
      "従来の候補",
      " はい => はい、お願いします ",
      "続きを読む =>",
      "{{os_date}} => {{os_time_label}}",
      String.raw`矢印\=>付き => 発言\=>は文字のまま => 続き`,
      String.raw`文字として\=>表示`,
      `${"長".repeat(500)} => ${"文".repeat(500)}`
    ];
    fs.writeFileSync(file, source.replace(original, `"${replies.join("\n")}"`));
    const result = validateScenario(target);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout).quickReplies, [
      "従来の候補",
      { label: "はい", text: "はい、お願いします" },
      { label: "続きを読む", text: "" },
      { label: "{{os_date}}", text: "{{os_time_label}}" },
      { label: "矢印=>付き", text: "発言=>は文字のまま => 続き" },
      "文字として=>表示",
      { label: "長".repeat(500), text: "文".repeat(500) }
    ]);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test("Quick Replyの表示文にもtemplateと500文字の検証をかけ、空labelと重複labelを拒否する", () => {
  const cases = [
    ["=> 発言だけ", /空の選択肢/u],
    ["同じ => 発言1\n同じ => 発言2", /重複/u],
    ["同じ\n同じ => 発言2", /重複/u],
    [[String.raw`矢印\=>付き`, String.raw`矢印\=>付き => 発言`].join("\n"), /重複/u],
    ["候補 => {{unknown_reply_text}}", /未定義template/u],
    ["候補 => {{invalid", /template構文が不正/u],
    [`${"長".repeat(501)} => 発言`, /500文字以内/u],
    [`候補 => ${"長".repeat(501)}`, /500文字以内/u]
  ];
  for (const [replies, expected] of cases) {
    const target = copiedScenario();
    try {
      const file = path.join(target, "authoring/talk_blocks.tsv");
      const source = fs.readFileSync(file, "utf8");
      fs.writeFileSync(file, source.replace('"古いメモ\nヒント\n機能テスト\nヘルプ"', `"${replies}"`));
      const result = validateScenario(target);
      assert.notEqual(result.status, 0, replies);
      assert.match(result.stderr, expected);
    } finally {
      fs.rmSync(target, { recursive: true, force: true });
    }
  }
});

test("Quick Replyだけの本文なし行は引き続き拒否する", () => {
  for (const blockId of ["search_agent::intro", "guide::message_reply"]) {
    const target = copiedScenario();
    try {
      const file = path.join(target, "authoring/talk_blocks.tsv");
      const source = fs.readFileSync(file, "utf8");
      const body = workerScenario.talkBlocks.find((block) => block.id === blockId).messages.at(-1).body;
      assert.ok(source.includes(body));
      fs.writeFileSync(file, source.replace(body, ""));
      const result = validateScenario(target);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /body または attachment が必要/u);
    } finally {
      fs.rmSync(target, { recursive: true, force: true });
    }
  }
});

test("初期Quick Replyの発言だけで参照する変数も、開始時のpart取得を検査する", () => {
  const worker = structuredClone(workerScenario);
  worker.parts = [...new Set([...(worker.parts ?? ["base"]), "reply_later"])];
  worker.stateVariables.reply_later_text = "取得後の発言";
  worker.stateVariableDefinitions.reply_later_text = { type: "string" };
  worker.stateVariableParts.reply_later_text = "reply_later";
  const block = worker.talkBlocks.find((item) => item.id === "search_agent::intro");
  assert.ok(block);
  block.messages.at(-1).quickReplies = [{ label: "候補", text: "{{reply_later_text}}" }];
  assert.throws(() => validateScenarioParts(worker), /初期履歴envに必要な変数が開始時に未取得です: reply_later_text/u);
  worker.stateVariableParts.reply_later_text = "base";
  assert.doesNotThrow(() => validateScenarioParts(worker));
});

test("talk sourceのfalseと通常talkの/inputを維持する", () => {
  const target = copiedScenario();
  try {
    const sourcePath = path.join(target, "scenario.fixture.json");
    const source = readScenarioFixture(sourcePath);
    const guide = source.talks.find((talk) => talk.id === "guide");
    guide.inputVisible = false;
    guide.inputEnabled = false;
    fs.writeFileSync(sourcePath, `${JSON.stringify(source, null, 2)}\n`);

    const flowPath = path.join(target, "authoring/talk_flow.tsv");
    const flow = fs.readFileSync(flowPath, "utf8");
    assert.ok(flow.includes("message_reply\tstay"));
    fs.writeFileSync(flowPath, flow.replace("message_reply\tstay", "/input disable\tstay"));

    const result = validateScenario(target);
    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.equal(output.guide.inputVisible, false);
    assert.equal(output.guide.inputEnabled, false);
    const inputRule = output.guide.rules.find((rule) => rule.outputSteps.some((step) => step.kind === "input"));
    assert.deepEqual(inputRule.outputSteps, [{ kind: "input", action: "disable" }]);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test("通常talkの検索commandと入力状態の反復を拒否する", () => {
  const searchTarget = copiedScenario();
  try {
    const flowPath = path.join(searchTarget, "authoring/talk_flow.tsv");
    const flow = fs.readFileSync(flowPath, "utf8");
    assert.ok(flow.includes("message_reply\tstay"));
    fs.writeFileSync(flowPath, flow.replace("message_reply\tstay", "/search test\tstay"));
    const result = validateScenario(searchTarget);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /\/search と \/if はsearch_agent/u);
  } finally {
    fs.rmSync(searchTarget, { recursive: true, force: true });
  }

  const blinkTarget = copiedScenario();
  try {
    const sourcePath = path.join(blinkTarget, "scenario.fixture.json");
    const source = readScenarioFixture(sourcePath);
    source.talks.find((talk) => talk.id === "search_agent").startSteps = ["/input hide", "/input show", "intro"];
    fs.writeFileSync(sourcePath, `${JSON.stringify(source, null, 2)}\n`);
    const result = validateScenario(blinkTarget);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /間には表示step/u);
  } finally {
    fs.rmSync(blinkTarget, { recursive: true, force: true });
  }

  const gameOverTarget = copiedScenario();
  try {
    const flowPath = path.join(gameOverTarget, "authoring/talk_flow.tsv");
    const flow = fs.readFileSync(flowPath, "utf8");
    assert.ok(flow.includes("message_reply\tstay"));
    fs.writeFileSync(flowPath, flow.replace("message_reply\tstay", '"message_reply\n/input hide"\tgame_over'));
    const result = validateScenario(gameOverTarget);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /mode=game_overでは\/inputを使用できません/u);
  } finally {
    fs.rmSync(gameOverTarget, { recursive: true, force: true });
  }
});

test("Quick Replyの空・重複・owner・途中message・未定義templateを拒否する", () => {
  const invalidCases = [
    { from: "\thuman\t別ルームへ送る", to: "\thuman\t\"はい\n \nいいえ\"", expected: /空の選択肢/u },
    { from: "\thuman\t別ルームへ送る", to: "\thuman\t\"はい\nはい\"", expected: /重複/u },
    { from: "\thuman\t別ルームへ送る", to: "\thuman\t{{unknown_quick_reply}}", expected: /未定義template/u },
    { from: "\thuman\t別ルームへ送る", to: "\thuman\t" + "長".repeat(501), expected: /500文字以内/u }
  ];

  for (const [index, item] of invalidCases.entries()) {
    const target = copiedScenario();
    try {
      const file = path.join(target, "authoring/talk_blocks.tsv");
      const source = fs.readFileSync(file, "utf8");
      assert.ok(source.includes(item.from), `fixture ${index + 1}`);
      fs.writeFileSync(file, source.replace(item.from, item.to));
      const result = validateScenario(target);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, item.expected);
    } finally {
      fs.rmSync(target, { recursive: true, force: true });
    }
  }

  const ownerTarget = copiedScenario();
  try {
    const file = path.join(ownerTarget, "authoring/talk_blocks.tsv");
    const source = fs.readFileSync(file, "utf8");
    const ownerRow = "\towner\tblock内の複数メッセージもまとめて復元されます。\t\t2026-08-11T19:11:00+09:00\t\t\t2026-08-12\thuman";
    fs.writeFileSync(file, source.replace(ownerRow, `${ownerRow}\t返信`));
    const result = validateScenario(ownerTarget);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /NPCメッセージだけ/u);
  } finally {
    fs.rmSync(ownerTarget, { recursive: true, force: true });
  }

  const middleTarget = copiedScenario();
  try {
    const file = path.join(middleTarget, "authoring/talk_blocks.tsv");
    const source = fs.readFileSync(file, "utf8");
    const middleRow = "\tguide\t灯りが写った画像を、メッセージ添付として届けます。\trainy_window_image\t\t700\t\t2026-08-12\thuman";
    fs.writeFileSync(file, source.replace(middleRow, `${middleRow}\t次へ`));
    const result = validateScenario(middleTarget);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /block最後のメッセージだけ/u);
  } finally {
    fs.rmSync(middleTarget, { recursive: true, force: true });
  }
});
