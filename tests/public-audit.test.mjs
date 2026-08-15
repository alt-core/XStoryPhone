import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const auditScript = fileURLToPath(new URL("../scripts/audit-public.mjs", import.meta.url));

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
