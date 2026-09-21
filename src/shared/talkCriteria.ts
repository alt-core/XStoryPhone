import { parseTalkFlowRegexCriteria } from "../worker/product/talkFlowLlmSelection.ts";
import { parseTalkMatchSpec } from "./talkMatch.ts";

export type AnswerCandidate = { value: string; exact: boolean };

// 表示用の原文は変えず、語句一覧の照合だけに使用する。
export function normalizeAnswer(value: string) {
  return value.normalize("NFKC").trim().toLowerCase();
}

export function answerCandidates(text: string, secret = false): AnswerCandidate[] {
  const result: AnswerCandidate[] = [];
  const seen = new Set<string>();
  for (const raw of text.split(/\r?\n/u)) {
    const line = raw.trim();
    if (!line) continue;
    const exact = line.startsWith('"');
    if (secret && !exact) throw new Error("secret/passwordの候補は二重引用符付きの文字列にしてください。");
    if (line.startsWith("/")) throw new Error("候補一覧に正規表現を混在させないでください。");
    let value = line;
    if (exact) {
      try { value = JSON.parse(line); } catch { throw new Error("候補の二重引用符または文字列が不正です。"); }
      if (typeof value !== "string") throw new Error("候補は文字列にしてください。");
    } else if (line.includes('"')) {
      throw new Error("二重引用符を含む候補はJSON文字列として囲ってください。");
    }
    value = normalizeAnswer(value);
    if (!value) throw new Error("空の候補は指定できません。");
    const key = JSON.stringify([exact, value]);
    if (!seen.has(key)) result.push({ value, exact });
    seen.add(key);
  }
  if (!result.length) throw new Error("一つ以上の候補が必要です。");
  return result;
}

export function parseMatchCriteria(text: string, secret = false) {
  if (!secret && text.trim().startsWith("/")) {
    const parsed = parseTalkFlowRegexCriteria(text);
    if (parsed.kind !== "ready") throw new Error(parsed.kind === "invalid" ? parsed.error : "正規表現が不正です。");
    return { kind: "regex" as const, regex: parsed.regex };
  }
  return { kind: "candidates" as const, candidates: answerCandidates(text, secret) };
}

export function criteriaMatches(text: string, input: string, secret = false) {
  const parsed = parseMatchCriteria(text, secret);
  if (parsed.kind === "regex") {
    parsed.regex.lastIndex = 0;
    return parsed.regex.test(input.normalize("NFC").trim());
  }
  const normalized = normalizeAnswer(input);
  return parsed.candidates.some(candidate => candidate.exact
    ? normalized === candidate.value
    : normalized.includes(candidate.value));
}

export function selectDeterministicRule<T extends { type: string; criteria: string }>(rules: readonly T[], input: string) {
  return rules.find(rule => (rule.type === "match" || rule.type === "secret") && criteriaMatches(rule.criteria, input, rule.type === "secret"));
}

function captureNames(source: string) {
  const names = new Set<string>();
  let characterClass = false;
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === "\\") { index += 1; continue; }
    if (source[index] === "[") characterClass = true;
    else if (source[index] === "]") characterClass = false;
    if (characterClass || !source.startsWith("(?<", index)) continue;
    if (source[index + 3] === "=" || source[index + 3] === "!") continue;
    const name = source.slice(index + 3, source.indexOf(">", index + 3));
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/u.test(name)) throw new Error("抽出capture名は英字または_で始まる英数字と_にしてください。");
    names.add(name);
  }
  return [...names];
}

export function parseTalkExtraction(text: string) {
  if (!text.trim()) return { kind: "none" as const, ids: [] as string[] };
  if (text.trim().startsWith("/")) {
    const parsed = parseTalkFlowRegexCriteria(text);
    if (parsed.kind !== "ready") throw new Error(parsed.kind === "invalid" ? parsed.error : "抽出の正規表現が不正です。");
    if (text.includes("{{")) throw new Error("抽出の正規表現にtemplateは使用できません。");
    const ids = captureNames(parsed.regex.source);
    if (!ids.length) throw new Error("抽出の正規表現には名前付きcaptureが必要です。");
    return { kind: "regex" as const, regex: parsed.regex, ids };
  }
  const parsed = parseTalkMatchSpec(text);
  if (!parsed.ok) throw new Error(parsed.error);
  return { kind: "ai" as const, spec: parsed.spec, ids: parsed.spec.items.map(item => item.id) };
}

export function regexExtract(text: string, input: string) {
  const parsed = parseTalkExtraction(text);
  if (parsed.kind !== "regex") throw new Error("正規表現抽出の指定ではありません。");
  parsed.regex.lastIndex = 0;
  const match = parsed.regex.exec(input.normalize("NFC").trim());
  if (!match) return null;
  return Object.fromEntries(parsed.ids.flatMap(id => {
    const value = match.groups?.[id];
    return typeof value === "string" && value.length ? [[id, value]] : [];
  }));
}
