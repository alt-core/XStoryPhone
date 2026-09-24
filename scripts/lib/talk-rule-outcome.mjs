import { isDeepStrictEqual } from "node:util";

// criteriaとintentは受け付け方の違い。抽出と、nextから分離された/loadも結果の比較に含める。
export function comparableRuleOutcome(rule) {
  if (!rule) return null;
  const match = rule.match?.trim() ?? "";
  return {
    mode: rule.mode || "advance",
    outputSteps: rule.outputSteps ?? [],
    nextFromId: rule.nextFromId ?? "",
    loadParts: rule.loadParts ?? [],
    set: rule.set ?? [],
    extract: !match || match.startsWith("/") ? match : JSON.parse(match)
  };
}

export function sameRuleOutcome(left, right) {
  return Boolean(left && right && isDeepStrictEqual(comparableRuleOutcome(left), comparableRuleOutcome(right)));
}
