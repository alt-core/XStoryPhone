import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { parseTalkOutputSteps } from "../scripts/lib/talk-output-steps.mjs";
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
