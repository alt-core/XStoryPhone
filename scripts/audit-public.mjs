import fs from "node:fs";
import path from "node:path";

const rootDir = process.cwd();
const ignoredDirectories = new Set([".aws-sam", ".git", ".projects", ".wrangler", "dist", "node_modules"]);
const requiredLegalFiles = ["LICENSE", "THIRD_PARTY_NOTICES.md", "ASSET_CREDITS.md"];
const textExtensions = new Set([
  "",
  ".css",
  ".html",
  ".js",
  ".json",
  ".jsonc",
  ".md",
  ".mjs",
  ".sql",
  ".svelte",
  ".ts",
  ".tsv",
  ".yaml",
  ".yml",
  ".toml",
  ".example"
]);

const forbidden = [
  { label: "個人環境の絶対パス", pattern: /\/Users\/[^/]+\//u },
  { label: "秘密鍵", pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/u },
  { label: "API keyらしい値", pattern: /\b(?:sk|key|token)[_-][A-Za-z0-9_-]{20,}\b/u }
];

function filesIn(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (ignoredDirectories.has(entry.name)) {
      return [];
    }
    const filePath = path.join(directory, entry.name);
    return entry.isDirectory() ? filesIn(filePath) : [filePath];
  });
}

const failures = [];
for (const relativePath of requiredLegalFiles) {
  if (!fs.existsSync(path.join(rootDir, relativePath))) {
    failures.push(`${relativePath}: 公開時に必要な権利情報ファイルがありません。`);
  }
}

const packageJson = JSON.parse(fs.readFileSync(path.join(rootDir, "package.json"), "utf8"));
if (packageJson.license !== "MIT") {
  failures.push("package.json: license はルートのLICENSEに合わせて MIT を指定してください。");
}
const thirdPartyNoticesPath = path.join(rootDir, "THIRD_PARTY_NOTICES.md");
if (fs.existsSync(thirdPartyNoticesPath)) {
  const notices = fs.readFileSync(thirdPartyNoticesPath, "utf8");
  const directDependencies = {
    ...(packageJson.dependencies ?? {}),
    ...(packageJson.devDependencies ?? {})
  };
  for (const dependency of Object.keys(directDependencies)) {
    if (!notices.includes(`\`${dependency}\``)) {
      failures.push(`THIRD_PARTY_NOTICES.md: 直接依存 ${dependency} の記録がありません。`);
    }
  }
}

for (const filePath of filesIn(rootDir)) {
  if (!textExtensions.has(path.extname(filePath).toLowerCase())) {
    continue;
  }
  const relativePath = path.relative(rootDir, filePath);
  const source = fs.readFileSync(filePath, "utf8");
  const lines = source.split(/\r?\n/u);
  for (let index = 0; index < lines.length; index += 1) {
    for (const rule of forbidden) {
      if (rule.pattern.test(lines[index])) {
        failures.push(`${relativePath}:${index + 1}: ${rule.label}`);
      }
    }
  }
}

if (failures.length > 0) {
  console.error("公開禁止情報の候補が見つかりました。");
  console.error(failures.map((failure) => `- ${failure}`).join("\n"));
  process.exitCode = 1;
} else {
  console.log("公開境界監査OK");
}
