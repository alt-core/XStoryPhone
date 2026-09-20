import process from "node:process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { loadLocalTalkAuthoring } from "./lib/local-talk-authoring.mjs";
import { auditTalkCriteria } from "./lib/talk-criteria-audit.mjs";

export function main(argv = process.argv.slice(2)) {
  const allowed = new Set(["--json", "--strict"]);
  const invalid = argv.find((arg) => !allowed.has(arg) && !/^--limit=\\d+$/u.test(arg));
  if (invalid) throw new Error(`未対応の引数です: ${invalid}`);
  const limit = Number(argv.find((arg) => arg.startsWith("--limit="))?.slice("--limit=".length) ?? 30);
  const result = auditTalkCriteria(loadLocalTalkAuthoring().flowRows);
  if (argv.includes("--json")) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.table([result.summary]);
    const shown = limit > 0 ? result.findings.slice(0, limit) : result.findings;
    if (shown.length) console.table(shown.map(({ severity, code, row, talk, from, intent, message, suggestion }) => ({
      severity, code, row, target: `${talk}/${from}/${intent}`, message, suggestion
    })));
    if (result.findings.length > shown.length) console.log(`... ${result.findings.length - shown.length} 件省略。--limit=0 ですべて表示できます。`);
  }
  if (argv.includes("--strict") && result.findings.some((item) => item.severity === "error" || item.severity === "warn")) process.exitCode = 1;
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
