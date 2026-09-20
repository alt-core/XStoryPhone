import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { loadAndValidateScenario } from "../scripts/scenario-lib.mjs";

const auditScript = fileURLToPath(new URL("../scripts/audit-public.mjs", import.meta.url));
const clientAuditScript = fileURLToPath(new URL("../scripts/audit-client-boundary.mjs", import.meta.url));

test("クライアント境界監査はsource mapを成果物から拒否する", () => {
  const buildDir = mkdtempSync(join(tmpdir(), "xstoryphone-source-map-audit-"));
  try {
    writeFileSync(join(buildDir, "client.js"), "export const visible = true;\n");
    writeFileSync(join(buildDir, "client.js.map"), JSON.stringify({
      version: 3, sources: ["private.ts"], names: [], mappings: "",
      sourcesContent: ["const unreached = '架空の未到達本文';"]
    }));
    const result = spawnSync(process.execPath, [clientAuditScript, buildDir], {
      cwd: process.cwd(), encoding: "utf8"
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /公開成果物へsource mapを含めない/u);
    assert.match(result.stderr, /client\.js\.map/u);
  } finally {
    rmSync(buildDir, { recursive: true, force: true });
  }
});

test("公開監査はデプロイ・CI・環境変数例のテキストも検査する", () => {
  for (const relativePath of ["infra/test.yaml", ".github/test.yml", "infra/test.toml", ".env.example"]) {
    const root = mkdtempSync(join(tmpdir(), "xstoryphone-audit-"));
    try {
      writeFileSync(join(root, "package.json"), JSON.stringify({ license: "MIT" }));
      writeFileSync(join(root, "LICENSE"), "MIT");
      writeFileSync(join(root, "THIRD_PARTY_NOTICES.md"), "なし");
      writeFileSync(join(root, "ASSET_CREDITS.md"), "なし");
      const target = join(root, relativePath);
      mkdirSync(join(target, ".."), { recursive: true });
      writeFileSync(target, ["/Us", "ers/reviewer/private"].join(""));

      const result = spawnSync(process.execPath, [auditScript], { cwd: root, encoding: "utf8" });
      assert.equal(result.status, 1, `${relativePath} が監査対象になっていません。`);
      assert.match(result.stderr, /個人環境の絶対パス/u);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test("クライアント境界監査は会話ruleの未到達値もbuildから検出する", () => {
  const scenario = loadAndValidateScenario();
  const protectedValue = scenario.worker.talks
    .flatMap((talk) => talk.rules)
    .map((rule) => rule.notes)
    .find((value) => value.length >= 10);
  assert.ok(protectedValue);

  const buildDir = mkdtempSync(join(tmpdir(), "xstoryphone-client-audit-"));
  try {
    writeFileSync(join(buildDir, "leak.js"), JSON.stringify(protectedValue));
    const result = spawnSync(process.execPath, [clientAuditScript, buildDir], {
      cwd: process.cwd(),
      encoding: "utf8"
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /未到達シナリオ値がclient buildへ混入/u);
  } finally {
    rmSync(buildDir, { recursive: true, force: true });
  }
});

test("公開呼出しevent名と非公開制作定数を混同しない", () => {
  const scenario = loadAndValidateScenario();
  const buildDir = mkdtempSync(join(tmpdir(), "xstoryphone-constant-audit-"));
  try {
    const output = join(buildDir, "fixture.js");
    writeFileSync(output, JSON.stringify(scenario.worker.clientCallableEvents));
    const publicResult = spawnSync(process.execPath, [clientAuditScript, buildDir], { encoding: "utf8" });
    assert.equal(publicResult.status, 0, publicResult.stderr);
    const secret = scenario.worker.projectConstants["chat_auth.cond"];
    assert.ok(secret && secret.length >= 10);
    writeFileSync(output, JSON.stringify(secret));
    const privateResult = spawnSync(process.execPath, [clientAuditScript, buildDir], { encoding: "utf8" });
    assert.equal(privateResult.status, 1);
    assert.match(privateResult.stderr, /未到達シナリオ値/u);
  } finally { rmSync(buildDir, { recursive: true, force: true }); }
});
