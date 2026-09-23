import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { compile } from "svelte/compiler";

// 型・コメント・作品コードの語句を、公開済みのengine語彙と取り違えない。
export function engineRuntimeLiterals(root, files) {
  const values = new Set();
  for (const file of files) {
    const relative = path.relative(root, file).split(path.sep).join("/");
    if (!/^src\/(client|shared)\//u.test(relative) || relative.includes("/generated/")
      || relative === "src/client/scenario-runtime/demoQaDisplayState.ts" || !/\.(ts|js|svelte)$/u.test(file)) continue;
    let source = fs.readFileSync(file, "utf8");
    if (file.endsWith(".svelte")) source = compile(source, { filename: file, generate: "client", dev: false }).js.code;
    else if (file.endsWith(".ts")) {
      const result = ts.transpileModule(source, { reportDiagnostics: true, compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext } });
      if (result.diagnostics?.some(item => item.category === ts.DiagnosticCategory.Error)) throw new Error(`engineの構文を解析できません: ${relative}`);
      source = result.outputText;
    }
    const parsed = ts.createSourceFile(file + ".js", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    if (parsed.parseDiagnostics.length) throw new Error(`engineの文字列を解析できません: ${relative}`);
    const visit = node => {
      if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) values.add(node.text);
      ts.forEachChild(node, visit);
    };
    visit(parsed);
  }
  return values;
}

// 構造値と素材URLだけが免除候補。本文・答えや、未知の作品recordは免除しない。
const structuralFields = new Set(["id", "publicId", "contentId", "talkId", "appId", "attachmentId", "genAudioId", "kind", "type", "mediaKind", "eventId", "imageUrl", "audioUrl", "videoUrl", "posterUrl", "thumbnailUrl", "assetUrl"]);
export function privateTextLeaves(value, key = "") {
  if (typeof value === "string") return structuralFields.has(key) ? [] : [value];
  if (Array.isArray(value)) return value.flatMap(item => privateTextLeaves(item, key));
  return value && typeof value === "object" ? Object.entries(value).flatMap(([field, child]) => privateTextLeaves(child, field)) : [];
}
