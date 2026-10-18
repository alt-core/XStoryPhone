import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { isBuiltin } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { zipSync } from "fflate";

const root = fileURLToPath(new URL("../", import.meta.url));

export async function buildAwsApi(outputDirectory = path.join(root, ".aws-sam/web-api")) {
  const bundled = await build({
    absWorkingDir: root,
    entryPoints: ["src/platform/aws/server.ts"],
    outfile: path.join(outputDirectory, "index.cjs"),
    bundle: true,
    platform: "node",
    target: "node24",
    format: "cjs",
    minify: true,
    sourcemap: false,
    write: false,
    metafile: true,
    logLevel: "silent"
  });
  // 配備先のnode_modulesや、ランタイム同梱SDKへ暗黙に依存しない。
  const external = Object.values(bundled.metafile.outputs).flatMap(output => output.imports)
    .filter(item => item.external && !isBuiltin(item.path));
  if (external.length) throw new Error(`AWS APIに未同梱の依存があります: ${[...new Set(external.map(item => item.path))].join(", ")}`);
  if (bundled.outputFiles.length !== 1) throw new Error("AWS APIのbundleはindex.cjsの1ファイルに限定します。");
  const code = bundled.outputFiles[0].contents;
  // 直接渡す1ファイルだけを格納し、ZIP日時も固定する。周辺の.envや内部資料を走査しない。
  const archive = zipSync({ "index.cjs": code }, { level: 6, mtime: new Date(2000, 0, 1) });
  const manifest = { sha256: createHash("sha256").update(archive).digest("hex") };
  await mkdir(outputDirectory, { recursive: true });
  await Promise.all([
    writeFile(path.join(outputDirectory, "index.cjs"), code),
    writeFile(path.join(outputDirectory, "api.zip"), archive),
    writeFile(path.join(outputDirectory, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`)
  ]);
  return manifest;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length > 2) throw new Error("AWS APIビルドは追加引数を受け付けません。");
    const manifest = await buildAwsApi();
    console.log(`AWS APIの非公開ZIPを作成しました: ${manifest.sha256}`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
