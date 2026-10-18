import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout } from "node:timers/promises";
import test from "node:test";
import { unzipSync } from "fflate";
import { buildAwsApi } from "../scripts/build-aws-api.mjs";

async function vacantPort() {
  const socket = net.createServer();
  socket.listen(0, "127.0.0.1");
  await once(socket, "listening");
  const port = socket.address().port;
  await new Promise((resolve, reject) => socket.close(error => error ? reject(error) : resolve()));
  return port;
}

test("AWS APIは依存同梱の1ファイルだけを再現可能な非公開ZIPへ格納する", async t => {
  const temporary = await mkdtemp(path.join(tmpdir(), "xstoryphone-api-package-"));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const originalSecret = process.env.ADMIN_REVIEW_SECRET;
  process.env.ADMIN_REVIEW_SECRET = "bundleへ焼き込まない検証用の秘密値";
  t.after(() => {
    if (originalSecret === undefined) delete process.env.ADMIN_REVIEW_SECRET;
    else process.env.ADMIN_REVIEW_SECRET = originalSecret;
  });
  const first = path.join(temporary, "first");
  const second = path.join(temporary, "second");
  const manifest = await buildAwsApi(first);
  assert.deepEqual(await buildAwsApi(second), manifest, "出力先が変わってもZIP hashは同じ");
  assert.deepEqual((await readdir(first)).sort(), ["api.zip", "index.cjs", "manifest.json"]);
  const archive = await readFile(path.join(first, "api.zip"));
  assert.equal(manifest.sha256, createHash("sha256").update(archive).digest("hex"));
  assert.deepEqual(JSON.parse(await readFile(path.join(first, "manifest.json"), "utf8")), manifest);
  assert.deepEqual(await readFile(path.join(second, "api.zip")), archive);
  const files = unzipSync(archive);
  assert.deepEqual(Object.keys(files), ["index.cjs"]);
  const code = Buffer.from(files["index.cjs"]);
  assert.deepEqual(await readFile(path.join(first, "index.cjs")), code);
  assert.ok(!code.includes(Buffer.from(process.env.ADMIN_REVIEW_SECRET)), "環境変数の値をbundleへ埋め込まない");
  assert.ok(!code.includes(Buffer.from("sourceMappingURL")), "source mapを生成しない");
});

test("展開したAPIはnode_modulesやリポジトリcwdなしで起動し、外部通信なしにhealthを返す", async t => {
  const temporary = await mkdtemp(path.join(tmpdir(), "xstoryphone-api-isolated-"));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const output = path.join(temporary, "package");
  await buildAwsApi(output);
  const files = unzipSync(await readFile(path.join(output, "api.zip")));
  const isolated = path.join(temporary, "isolated");
  await mkdir(isolated);
  await writeFile(path.join(isolated, "index.cjs"), files["index.cjs"]);
  assert.deepEqual(await readdir(isolated), ["index.cjs"]);
  const guard = path.join(temporary, "no-external.cjs");
  await writeFile(guard, `
const Module = require("node:module");
const originalLoad = Module._load;
Module._load = function (specifier, parent, isMain) {
  if (!isMain && !Module.isBuiltin(specifier)) throw new Error("未同梱の依存を読み込めません: " + specifier);
  return originalLoad.apply(this, arguments);
};
const deny = () => { throw new Error("検証中の外部通信は禁止です。"); };
require("node:http").request = require("node:http").get = deny;
require("node:https").request = require("node:https").get = deny;
globalThis.fetch = deny;
`);
  const port = await vacantPort();
  const child = spawn(process.execPath, ["--require", guard, "index.cjs"], {
    cwd: isolated, stdio: ["ignore", "ignore", "pipe"], env: {
      ...process.env, AWS_LAMBDA_HTTP_ENDPOINT: `127.0.0.1:${port}`, TABLE_NAME: "fixture", APP_ENV: "prod",
      AWS_REGION: "ap-northeast-1", AWS_ACCESS_KEY_ID: "fixture", AWS_SECRET_ACCESS_KEY: "fixture", AWS_EC2_METADATA_DISABLED: "true"
    }
  });
  let stderr = "";
  child.stderr.on("data", chunk => { stderr += chunk; });
  const closed = once(child, "close");
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
    await closed;
  });
  let response;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (child.exitCode !== null || child.signalCode !== null) assert.fail(`展開APIの起動に失敗しました: ${stderr}`);
    try { response = await fetch(`http://127.0.0.1:${port}/api/health`); break; }
    catch { await setTimeout(25); }
  }
  assert.ok(response, `展開APIが起動しませんでした: ${stderr}`);
  assert.equal(response.status, 200);
  const health = await response.json();
  assert.equal(health.ok, true);
  assert.equal(typeof health.clientRevision, "string");
  child.kill("SIGTERM");
  const [exitCode, signal] = await closed;
  assert.equal(exitCode, 0, stderr);
  assert.equal(signal, null);
});
