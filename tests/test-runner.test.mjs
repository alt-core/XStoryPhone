import assert from "node:assert/strict";
import fs from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { restoreGeneratedFiles, signalExitCode, snapshotGeneratedFiles } from "../scripts/test.mjs";

test("test runnerは生成物の変更・追加・削除を元へ戻す", () => {
  const temporaryRoot = fs.mkdtempSync(path.join(tmpdir(), "xstoryphone-test-generated-"));
  try {
    const sharedDir = path.join(temporaryRoot, "src/generated");
    const clientDir = path.join(temporaryRoot, "src/client/generated");
    fs.mkdirSync(sharedDir, { recursive: true });
    fs.mkdirSync(clientDir, { recursive: true });
    const changed = path.join(sharedDir, "changed.ts");
    const deleted = path.join(clientDir, "deleted.ts");
    const added = path.join(sharedDir, "added.ts");
    fs.writeFileSync(changed, "変更前\n");
    fs.writeFileSync(deleted, "削除前\n");

    const snapshot = snapshotGeneratedFiles(temporaryRoot);
    fs.writeFileSync(changed, "変更後\n");
    fs.rmSync(deleted);
    fs.writeFileSync(added, "追加\n");
    restoreGeneratedFiles(snapshot);

    assert.equal(fs.readFileSync(changed, "utf8"), "変更前\n");
    assert.equal(fs.readFileSync(deleted, "utf8"), "削除前\n");
    assert.equal(fs.existsSync(added), false);
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test("test runnerはassets:buildの生成物も変更・追加・削除を元へ戻す", () => {
  const temporaryRoot = fs.mkdtempSync(path.join(tmpdir(), "xstoryphone-test-assets-"));
  try {
    const asset = "public/search-agent/search-agent-spritesheet.svg";
    const addedAsset = "public/system/incoming-call-bell.wav";
    const assetPath = path.join(temporaryRoot, asset);
    fs.mkdirSync(path.dirname(assetPath), { recursive: true });
    fs.writeFileSync(assetPath, "変更前\n");

    const snapshot = snapshotGeneratedFiles(temporaryRoot, [], [asset, addedAsset]);
    fs.writeFileSync(assetPath, "変更後\n");
    const addedAssetPath = path.join(temporaryRoot, addedAsset);
    fs.mkdirSync(path.dirname(addedAssetPath), { recursive: true });
    fs.writeFileSync(addedAssetPath, "追加\n");
    restoreGeneratedFiles(snapshot);

    assert.equal(fs.readFileSync(assetPath, "utf8"), "変更前\n");
    assert.equal(fs.existsSync(addedAssetPath), false);
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test("test runnerは終了シグナルをPOSIXの終了コードへ変換する", () => {
  assert.equal(signalExitCode("SIGHUP"), 129);
  assert.equal(signalExitCode("SIGINT"), 130);
  assert.equal(signalExitCode("SIGTERM"), 143);
  assert.equal(signalExitCode("SIG_UNKNOWN"), 128);
});
