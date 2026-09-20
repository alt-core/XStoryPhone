import { createHash } from "node:crypto";

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  return value;
}

// 位置や制作メモではなく分岐定義を識別する。同じ本文を参照する別判定を併合しない。
export function assignRuleIds(rules, digest = (value) => createHash("sha256").update(value).digest("hex").slice(0, 16)) {
  const counts = new Map();
  const inputs = new Map();
  return rules.map((rule) => {
    const definition = JSON.stringify(canonical({
      talk: rule.talkId, from: rule.from, isDefault: rule.isDefault,
      cond: rule.cond, intent: rule.intent, criteria: rule.criteria,
      match: rule.match ? JSON.parse(rule.match) : null,
      outputSteps: rule.outputSteps, mode: rule.mode, set: rule.set
    }));
    const occurrence = counts.get(definition) ?? 0;
    counts.set(definition, occurrence + 1);
    const input = JSON.stringify([definition, occurrence]);
    const id = `rule_${digest(input)}`;
    if (inputs.has(id) && inputs.get(id) !== input) throw new Error(`分岐IDが衝突しました: ${id}`);
    inputs.set(id, input);
    return { ...rule, id };
  });
}
