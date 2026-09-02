type ReviewRule = {
  id: string;
  from: string;
  outputSteps: readonly unknown[];
  nextBlocks: readonly string[];
};

type ReviewTalk = {
  rules: readonly ReviewRule[];
};

type ReviewEvent = {
  ruleId?: string | null;
  responseSnapshot?: Record<string, unknown>;
};

function sameList(left: readonly string[], right: readonly string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function sameOutputSteps(left: unknown, right: readonly unknown[]) {
  return Array.isArray(left)
    && left.length === right.length
    && left.every((step, index) => JSON.stringify(step) === JSON.stringify(right[index]));
}

export function currentRuleIdForReviewEvent(talk: ReviewTalk, fromId: string, event: ReviewEvent) {
  const available = (rule: ReviewRule) => rule.from === "*" || rule.from === fromId;
  const current = talk.rules.find((rule) => rule.id === event.ruleId && available(rule));
  if (current) return current.id;

  const outputSteps = event.responseSnapshot?.outputSteps;
  if (Array.isArray(outputSteps) && outputSteps.length) {
    const candidates = talk.rules.filter((rule) => available(rule) && sameOutputSteps(outputSteps, rule.outputSteps));
    if (candidates.length === 1) return candidates[0].id;
  }

  const nextBlocks = Array.isArray(event.responseSnapshot?.nextBlocks)
    ? event.responseSnapshot.nextBlocks.filter((value): value is string => typeof value === "string")
    : [];
  if (!nextBlocks.length) return "";
  const candidates = talk.rules.filter((rule) => available(rule) && sameList(rule.nextBlocks, nextBlocks));
  return candidates.length === 1 ? candidates[0].id : "";
}
