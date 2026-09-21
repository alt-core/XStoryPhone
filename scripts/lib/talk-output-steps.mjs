function outputLines(value) {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => {
      if (typeof item !== "string") return [{ value: "", index, invalidType: true }];
      if (/\r|\n/u.test(item)) return [{ value: item, index, embeddedNewline: true }];
      return [{ value: item, index }];
    });
  }
  return String(value ?? "").split(/\r?\n/u).map((item, index) => ({ value: item, index }));
}

function closingConditionParenthesis(value) {
  let depth = 0;
  let quote = "";
  let regex = false;
  let regexCharClass = false;
  let escaped = false;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (char === quote) quote = "";
      continue;
    }
    if (regex) {
      if (char === "[" && !regexCharClass) regexCharClass = true;
      else if (char === "]" && regexCharClass) regexCharClass = false;
      else if (char === "/" && !regexCharClass) regex = false;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === "/") {
      regex = true;
      continue;
    }
    if (char === "(") depth += 1;
    if (char !== ")") continue;
    depth -= 1;
    if (depth === 0) return index;
    if (depth < 0) return -1;
  }
  return -1;
}

export function parseTalkOutputSteps(value) {
  const steps = [];
  const errors = [];
  for (const item of outputLines(value)) {
    const lineNumber = item.index + 1;
    const line = item.value.trim();
    if (item.invalidType) {
      errors.push(`step ${lineNumber} は文字列にしてください。`);
      continue;
    }
    if (item.embeddedNewline) {
      errors.push(`step ${lineNumber} の文字列内に改行を入れず、配列要素を分けてください。`);
      continue;
    }
    if (!line) continue;
    if (!line.startsWith("/")) {
      steps.push({ kind: "block", blockKey: line });
      continue;
    }
    if (/^\/load(?:\s|$)/u.test(line)) {
      const partId = line.slice("/load".length).trim();
      if (!/^[a-z][a-z0-9_-]*$/u.test(partId)) errors.push(`step ${lineNumber} の /load はpart名を一つ指定してください。`);
      else if (steps.some(step => step.kind !== "load")) errors.push(`step ${lineNumber} の /load はnextの先頭へまとめてください。`);
      else steps.push({ kind: "load", partId });
      continue;
    }
    if (/^\/search(?:\s|$)/u.test(line)) {
      const queryTemplate = line.slice("/search".length).trim();
      if (!queryTemplate) errors.push(`step ${lineNumber} の /search query が空です。`);
      else steps.push({ kind: "search", queryTemplate });
      continue;
    }
    if (/^\/input(?:\s|$)/u.test(line)) {
      const action = line.slice("/input".length).trim();
      if (!new Set(["show", "hide", "enable", "disable"]).has(action)) {
        errors.push(`step ${lineNumber} の /input は show、hide、enable、disable のいずれかにしてください。`);
      } else {
        steps.push({ kind: "input", action });
      }
      continue;
    }
    if (/^\/if(?:\s|$)/u.test(line)) {
      const expression = line.slice("/if".length).trim();
      const closingIndex = expression.startsWith("(") ? closingConditionParenthesis(expression) : -1;
      const cond = closingIndex > 0 ? expression.slice(1, closingIndex).trim() : "";
      const remainder = closingIndex > 0 ? expression.slice(closingIndex + 1) : "";
      const blockKey = /^\s+\S/u.test(remainder) ? remainder.trim() : "";
      if (!cond || !blockKey || blockKey.startsWith("=>") || blockKey.startsWith("->")) {
        errors.push(`step ${lineNumber} の /if は /if (<condition>) <block_id> の形式にしてください。`);
      } else {
        steps.push({ kind: "if", cond, blockKey });
      }
      continue;
    }
    errors.push(`step ${lineNumber} のcommandが未定義です: ${line.split(/\s/u, 1)[0]}`);
  }
  return { steps, errors };
}

export function outputStepBlockKeys(steps) {
  return steps.flatMap((step) => step.kind === "block" || step.kind === "if" ? [step.blockKey] : []);
}

export function outputStepNextFromKey(steps) {
  return [...steps].reverse().find((step) => step.kind === "block")?.blockKey ?? "";
}

export function formatTalkOutputStep(step) {
  if (step.kind === "load") return `/load ${step.partId}`;
  if (step.kind === "block") return step.blockKey;
  if (step.kind === "search") return `/search ${step.queryTemplate}`;
  if (step.kind === "input") return `/input ${step.action}`;
  return `/if (${step.cond}) ${step.blockKey}`;
}
