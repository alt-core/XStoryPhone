import type { ConditionStateDefinition } from "./conditionExpression.ts";
import { readQuotedString } from "./quotedString.ts";

export type SetOperator = "=" | "+=" | "-=";

export type SetStatement = {
  stateId: string;
  operator: SetOperator;
  value: boolean | number | string;
  extractId?: string;
};

export type SetValueContext = {
  match?: Record<string, string | undefined>;
};

type ParsedSetStatements = {
  statements: SetStatement[];
  errors: string[];
};

export function splitSetStatements(input: string | readonly string[]) {
  const source = Array.isArray(input) ? input.join("\n") : input;
  const lines: string[] = [];
  let line = "", quote = "";
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      line += char;
      if (char === "\\" && index + 1 < source.length) line += source[++index];
      else if (char === quote) quote = "";
    } else if ((char === '"' || char === "'") && /=\s*$/u.test(line)) {
      quote = char;
      line += char;
    } else if (char === ";" || char === "\n" || char === "\r") {
      if (line.trim()) lines.push(line.trim());
      line = "";
    } else line += char;
  }
  if (line.trim()) lines.push(line.trim());
  return lines;
}

function parseSetValue(rawValue: string): boolean | number | string {
  const trimmed = rawValue.trim();
  if ((trimmed.startsWith("\"") && trimmed.endsWith("\"")) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return readQuotedString(trimmed, 0).value;
  }
  if (trimmed === "true") {
    return true;
  }
  if (trimmed === "false") {
    return false;
  }
  if (/^-?\d+$/.test(trimmed)) {
    return Number.parseInt(trimmed, 10);
  }
  return trimmed;
}

export function setExtractionIds(input: readonly string[]) {
  return parseSetStatements(input).statements.flatMap(statement => statement.extractId ? [statement.extractId] : []);
}

export function parseSetStatements(input: string | readonly string[]): ParsedSetStatements {
  const statements: SetStatement[] = [];
  const errors: string[] = [];

  for (const line of splitSetStatements(input)) {
    const match = line.match(/^([a-zA-Z_][a-zA-Z0-9_:-]*)\s*(\+=|-=|=)\s*([\s\S]+)$/u);
    if (!match) {
      errors.push(`set の形式が不正です: ${line}`);
      continue;
    }

    const [, stateId, operator, rawValue] = match;
    const trimmedValue = rawValue.trim();
    if (/^\$[a-zA-Z_][a-zA-Z0-9_]*\./u.test(trimmedValue) && !/^\$extract\.[a-zA-Z_][a-zA-Z0-9_]*$/u.test(trimmedValue)) {
      errors.push(`set の抽出参照は $extract.id の形式にしてください: ${stateId}`);
      continue;
    }
    if (trimmedValue.startsWith('"') || trimmedValue.startsWith("'")) {
      const literal = readQuotedString(trimmedValue, 0);
      if (!literal.closed || literal.endIndex !== trimmedValue.length) {
        errors.push(literal.closed ? `set の文字列の後に余分な値があります: ${line}` : `set の文字列が閉じていません: ${line}`);
        continue;
      }
    }
    const value = parseSetValue(rawValue);
    if (typeof value === "number" && !Number.isSafeInteger(value)) {
      errors.push(`set の整数が安全な範囲を超えています: ${stateId}`);
      continue;
    }
    statements.push({
      stateId,
      operator: operator as SetOperator,
      value,
      ...(/^\$extract\.([a-zA-Z_][a-zA-Z0-9_]*)$/u.test(trimmedValue) ? { extractId: trimmedValue.slice(9) } : {})
    });
  }

  return { statements, errors };
}

function validateSetStatement(statement: SetStatement, states: ReadonlyMap<string, ConditionStateDefinition>) {
  const errors: string[] = [];
  const state = states.get(statement.stateId);

  if (!state) {
    return [`set の状態変数が未定義です: ${statement.stateId}`];
  }

  if (statement.operator !== "=" && state.type !== "integer") {
    errors.push(`+= / -= はinteger stateだけに使えます: ${statement.stateId}`);
  }
  if (statement.operator !== "=" && (typeof statement.value !== "number" || !Number.isSafeInteger(statement.value))) {
    errors.push(`+= / -= の右辺は安全な整数literalにしてください: ${statement.stateId}`);
  }

  if (state.type === "boolean" && typeof statement.value !== "boolean") {
    errors.push(`boolean set は true / false にしてください: ${statement.stateId}`);
  }

  if (state.type === "integer" && (typeof statement.value !== "number" || !Number.isInteger(statement.value))) {
    errors.push(`integer set の値が不正です: ${statement.stateId}`);
  }

  if (state.type === "enum" && !state.values?.includes(String(statement.value))) {
    errors.push(`enum set の値が values にありません: ${statement.stateId}`);
  }

  if (state.type === "string" && typeof statement.value !== "string") {
    errors.push(`string set の値は文字列にしてください: ${statement.stateId}`);
  }

  if (statement.extractId && state.type !== "string") {
    errors.push(`$extract 参照は string set だけに使えます: ${statement.stateId}`);
  }

  return errors;
}

export function validateSetStatements(input: string | readonly string[], states: ReadonlyMap<string, ConditionStateDefinition>) {
  const { statements, errors } = parseSetStatements(input);

  for (const statement of statements) {
    errors.push(...validateSetStatement(statement, states));
  }

  return errors;
}

export function applySetStatements(
  input: string | readonly string[],
  states: ReadonlyMap<string, ConditionStateDefinition>,
  currentValues: Record<string, unknown>,
  context?: SetValueContext
) {
  const { statements, errors } = parseSetStatements(input);
  const nextValues = { ...currentValues };

  for (const statement of statements) {
    const resolvedStatement = { ...statement, value: statement.extractId ? context?.match?.[statement.extractId] ?? "" : statement.value };
    const statementErrors = validateSetStatement(resolvedStatement, states);
    if (statementErrors.length > 0) {
      errors.push(...statementErrors);
      continue;
    }

    if (resolvedStatement.operator === "=") {
      nextValues[statement.stateId] =
        states.get(statement.stateId)?.type === "enum" ? String(resolvedStatement.value) : resolvedStatement.value;
      continue;
    }
    const current = nextValues[statement.stateId];
    const delta = resolvedStatement.operator === "+=" ? resolvedStatement.value : -resolvedStatement.value;
    const next = typeof current === "number" && typeof delta === "number" ? current + delta : Number.NaN;
    if (!Number.isSafeInteger(next)) {
      errors.push(`+= / -= の結果が安全な整数範囲を超えています: ${statement.stateId}`);
      continue;
    }
    nextValues[statement.stateId] = next;
  }

  return { stateValues: nextValues, errors };
}
