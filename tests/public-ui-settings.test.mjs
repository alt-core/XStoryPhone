import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { noticeTextSegments } from "../src/client/system/noticeText.ts";

test("告知は対応した強調だけを分割し、HTMLや未閉鎖記号を文字列のまま保つ", () => {
  assert.deepEqual(noticeTextSegments("前 **強調** 後 **未閉鎖"), [
    { text: "前 ", strong: false }, { text: "強調", strong: true }, { text: " 後 **未閉鎖", strong: false }
  ]);
  assert.deepEqual(noticeTextSegments("<img onerror=alert(1)>"), [{ text: "<img onerror=alert(1)>", strong: false }]);
  assert.deepEqual(noticeTextSegments(""), []);
  assert.deepEqual(noticeTextSegments("**一****二**").map(item => item.text), ["一", "二"]);
});

test("素材生成は同じバイト列のmtimeと別パスの作品素材を変更しない", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xstoryphone-assets-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const generator = path.resolve("scripts/generate-search-agent-sprites.mjs");
  const generate = () => execFileSync(process.execPath, [generator], { cwd: root, stdio: "pipe" });
  generate();
  const files = ["search-agent/search-agent-spritesheet.svg", "system/incoming-call-bell.wav", "system/call-caption-sample.wav", "system/radio-caption-sample.wav"].map(file => path.join(root, "public", file));
  for (const file of files) fs.utimesSync(file, new Date(0), new Date(0));
  const before = files.map(file => fs.readFileSync(file));
  const custom = path.join(root, "public", "custom-sprite.svg");
  fs.writeFileSync(custom, "作品用の素材");
  generate();
  files.forEach((file, index) => {
    assert.equal(fs.statSync(file).mtimeMs, 0);
    assert.deepEqual(fs.readFileSync(file), before[index]);
  });
  assert.equal(fs.readFileSync(custom, "utf8"), "作品用の素材");
});
