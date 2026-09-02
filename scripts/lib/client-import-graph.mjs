import fs from "node:fs";
import path from "node:path";

const extensions = ["", ".ts", ".js", ".svelte", ".css"];
const importPatterns = [
  /(?:from\s+|import\s*\()\s*["']([^"']+)["']/gu,
  /import\s+["']([^"']+)["']/gu
];
const globPattern = /import\.meta\.glob\(\s*["']([^"']+)["']/gu;

function resolveSingleWildcardGlob(fromFile, specifier) {
  if (!specifier.startsWith(".") || (specifier.match(/\*/gu) ?? []).length !== 1) return [];
  const absolute = path.resolve(path.dirname(fromFile), specifier);
  const [prefix, suffix] = absolute.split("*");
  if (!fs.existsSync(prefix) || !fs.statSync(prefix).isDirectory()) return [];
  return fs.readdirSync(prefix, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => `${prefix}${entry.name}${suffix}`)
    .filter((file) => fs.existsSync(file) && fs.statSync(file).isFile());
}

function resolveImport(fromFile, specifier) {
  if (!specifier.startsWith(".")) return null;
  const base = path.resolve(path.dirname(fromFile), specifier);
  for (const suffix of extensions) {
    const candidate = `${base}${suffix}`;
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  for (const suffix of extensions.slice(1)) {
    const candidate = path.join(base, `index${suffix}`);
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return null;
}

export function collectClientImportGraph(root, entry = path.join(root, "src/client/main.ts")) {
  const reachable = new Set();
  const pending = [entry];
  const unresolved = [];
  while (pending.length) {
    const file = pending.pop();
    if (!file || reachable.has(file)) continue;
    reachable.add(file);
    const source = fs.readFileSync(file, "utf8");
    for (const pattern of importPatterns) {
      for (const match of source.matchAll(pattern)) {
        if (!match[1].startsWith(".")) continue;
        const resolved = resolveImport(file, match[1]);
        if (resolved) pending.push(resolved);
        else unresolved.push(`${path.relative(root, file)} -> ${match[1]}`);
      }
    }
    for (const match of source.matchAll(globPattern)) {
      for (const resolved of resolveSingleWildcardGlob(file, match[1])) pending.push(resolved);
    }
  }
  return {
    files: [...reachable].sort((left, right) => left.localeCompare(right)),
    unresolved: [...new Set(unresolved)].sort((left, right) => left.localeCompare(right))
  };
}
