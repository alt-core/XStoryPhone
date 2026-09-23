import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { engineRuntimeLiterals, privateTextLeaves } from "../scripts/lib/engine-runtime-literals.mjs";

test("engineの公開語彙は実行時literalのみで、型・コメント・作品・QAを含めない", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xstoryphone-literals-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const sources = {
    "src/client/view.ts": 'type Hidden = "type-only-secret"; // "comment-secret"\nexport const inFlightContentOpenKeys = "still_video"; export const image = "/system/audio-only-video-thumbnail.png";',
    "src/client/View.svelte": '<script lang="ts">let visible: boolean = true;</script>{#if visible}<p>{"incoming_call"}</p>{/if}',
    "src/client/generated/secret.ts": 'export const x = "generated-secret";',
    "src/project/app.ts": 'export const x = "project-secret";',
    "src/client/scenario-runtime/demoQaDisplayState.ts": 'export const x = "qa-secret";'
  };
  const files = Object.entries(sources).map(([relative, source]) => {
    const file = path.join(root, relative); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, source); return file;
  });
  const values = engineRuntimeLiterals(root, files);
  for (const value of ["still_video", "incoming_call", "/system/audio-only-video-thumbnail.png"]) assert.ok(values.has(value), value);
  for (const value of ["type-only-secret", "comment-secret", "inFlightContentOpenKeys", "generated-secret", "project-secret", "qa-secret"]) assert.equal(values.has(value), false, value);
  fs.writeFileSync(files[0], 'export const x = "');
  assert.throws(() => engineRuntimeLiterals(root, files), /解析できません/u);
});

test("構造値の重複があっても本文・答え・字幕に書かれた値は保護を維持する", () => {
  assert.deepEqual(privateTextLeaves({ mediaKind: "still_video", imageUrl: "/system/audio-only-video-thumbnail.png", cues: [{ eventId: "incoming_call" }] }), []);
  assert.deepEqual(privateTextLeaves({ body: "still_video", answers: ["incoming_call"], transcript: [{ text: "字幕" }], pin: "1234" }), ["still_video", "incoming_call", "字幕", "1234"]);
});
