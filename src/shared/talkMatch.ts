export type TalkMatchItem = {
  id: string;
  rule: string;
  pick: "same" | "best";
  nullMode: "no" | "ok" | "weak";
};

export type TalkMatchSpec = { items: TalkMatchItem[] };
export type TalkMatchOutput = Record<string, string | null>;

export function parseTalkMatchSpec(raw: string): { ok: true; spec: TalkMatchSpec } | { ok: false; error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: "matchはJSON objectにしてください。" };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, error: "matchはJSON objectにしてください。" };
  }
  const items: TalkMatchItem[] = [];
  for (const [id, value] of Object.entries(parsed)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(id)) return { ok: false, error: `matchのIDが不正です: ${id}` };
    if (typeof value === "string") {
      if (!value.trim() || value.length > 1_000) return { ok: false, error: `match.${id}のruleは1〜1000文字にしてください。` };
      items.push({ id, rule: value.trim(), pick: "same", nullMode: "no" });
      continue;
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return { ok: false, error: `match.${id}は文字列またはobjectにしてください。` };
    }
    const record = value as Record<string, unknown>;
    if (Object.keys(record).some((key) => !["rule", "pick", "null"].includes(key))) {
      return { ok: false, error: `match.${id}に未対応のkeyがあります。` };
    }
    const rule = typeof record.rule === "string" ? record.rule.trim() : "";
    const pick = record.pick === undefined || record.pick === "same" ? "same" : record.pick === "best" ? "best" : null;
    const nullMode = record.null === undefined || record.null === "no" ? "no"
      : record.null === "ok" ? "ok" : record.null === "weak" ? "weak" : null;
    if (!rule || rule.length > 1_000 || !pick || !nullMode) return { ok: false, error: `match.${id}の指定が不正です。` };
    items.push({ id, rule, pick, nullMode });
  }
  return items.length ? { ok: true, spec: { items } } : { ok: false, error: "matchには1項目以上必要です。" };
}

export function parseTalkMatchOutput(raw: unknown, spec: TalkMatchSpec) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const output: TalkMatchOutput = {};
  for (const item of spec.items) {
    const value = record[item.id];
    if (value === null) output[item.id] = null;
    else if (typeof value === "string" && value.length <= 240) output[item.id] = value.normalize("NFC").trim() || null;
    else return null;
  }
  return output;
}

function canonical(value: unknown) {
  return JSON.stringify(value);
}

function matchGroupsFor(output: TalkMatchOutput, assignments: readonly string[]) {
  const groups = Object.fromEntries(Object.entries(output).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
  for (const assignment of assignments) {
    const references = [
      ...String(assignment).matchAll(/\$match\.([A-Za-z_][A-Za-z0-9_]*)/gu),
      ...String(assignment).matchAll(/\{\{([A-Za-z_][A-Za-z0-9_]*)\}\}/gu)
    ];
    if (references.some((reference) => typeof groups[reference[1]] !== "string")) return null;
  }
  return groups;
}

export function selectTalkMatch(
  spec: TalkMatchSpec,
  outputs: readonly TalkMatchOutput[],
  assignments: readonly string[],
  acceptPartial = false
): { ok: true; values: TalkMatchOutput; matchGroups: Record<string, string> } | { ok: false } {
  const eligible = outputs.filter((output) => spec.items.every((item) => output[item.id] !== null || item.nullMode !== "no"));
  const sameItems = spec.items.filter((item) => item.pick === "same");
  const tuple = (output: TalkMatchOutput) => canonical(sameItems.map((item) => output[item.id] ?? null));
  const counts = new Map<string, number>();
  for (const output of eligible) counts.set(tuple(output), (counts.get(tuple(output)) ?? 0) + 1);
  const candidates = eligible.filter((output) => (counts.get(tuple(output)) ?? 0) >= 2);
  if (!candidates.length) return { ok: false };

  const bestItems = spec.items.filter((item) => item.pick === "best");
  const score = (candidate: TalkMatchOutput) => bestItems.reduce((total, item) => {
    const value = candidate[item.id] ?? null;
    if (value === null && item.nullMode === "weak") return total - 1;
    return total + (candidates.some((other) => other !== candidate && canonical(other[item.id] ?? null) === canonical(value)) ? 1 : 0);
  }, 0);
  const selected = candidates.reduce((best, candidate) => score(candidate) > score(best) ? candidate : best);
  if (!acceptPartial && score(selected) < bestItems.length) return { ok: false };
  const matchGroups = matchGroupsFor(selected, assignments);
  return matchGroups ? { ok: true, values: selected, matchGroups } : { ok: false };
}
