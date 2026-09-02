export type ConditionStateType = "boolean" | "enum" | "integer" | "string";

export type ConditionStateDefinition = {
  type: ConditionStateType;
  values?: readonly string[];
};

type Token =
  | { type: "identifier"; value: string }
  | { type: "integer"; value: string }
  | { type: "string"; value: string }
  | { type: "regex"; value: RegexLiteralValue }
  | { type: "boolean"; value: "true" | "false" }
  | { type: "operator"; value: Operator };

type Operator = "!" | "(" | ")" | "&&" | "||" | "==" | "!=" | ">" | ">=" | "<" | "<=" | "=~" | "!~";
type BinaryOperator = Exclude<Operator, "!" | "(" | ")">;
type RegexLiteralValue = { source: string; flags: string; regex: RegExp };

type ExpressionNode =
  | { kind: "literal"; value: boolean | number | string | RegexLiteralValue; valueType: "boolean" | "integer" | "string" | "regex" }
  | { kind: "identifier"; id: string }
  | { kind: "not"; value: ExpressionNode }
  | { kind: "binary"; operator: BinaryOperator; left: ExpressionNode; right: ExpressionNode };

type ParsedConditionExpression = {
  ast: ExpressionNode | null;
  errors: string[];
};

type InferredType =
  | { type: "boolean" }
  | { type: "integer" }
  | { type: "string"; value?: string }
  | { type: "enum"; id: string; values: readonly string[] }
  | { type: "regex" }
  | { type: "unknown"; id: string }
  | { type: "invalid" };

const comparisonOperators = new Set<BinaryOperator>(["==", "!=", ">", ">=", "<", "<=", "=~", "!~"]);

function findRegexLiteralEnd(source: string, startIndex: number) {
  let escaped = false;
  let inCharClass = false;
  for (let index = startIndex + 1; index < source.length; index += 1) {
    const char = source[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === "[" && !inCharClass) {
      inCharClass = true;
      continue;
    }
    if (char === "]" && inCharClass) {
      inCharClass = false;
      continue;
    }
    if (char === "/" && !inCharClass) {
      return index;
    }
  }
  return -1;
}

function parseRegexLiteral(input: string, startIndex: number): { token?: Token; endIndex?: number; error?: string } {
  const endIndex = findRegexLiteralEnd(input, startIndex);
  if (endIndex < 0) {
    return { error: "正規表現リテラルの閉じる / がありません" };
  }

  const flagsMatch = input.slice(endIndex + 1).match(/^[a-z]*/iu);
  const flags = flagsMatch?.[0] ?? "";
  if (!/^[dgimsuvy]*$/u.test(flags)) {
    return { error: "正規表現 flags は d/g/i/m/s/u/v/y だけを使ってください" };
  }

  const source = input.slice(startIndex + 1, endIndex);
  try {
    return {
      token: { type: "regex", value: { source, flags, regex: new RegExp(source, flags) } },
      endIndex: endIndex + 1 + flags.length
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { error: `正規表現が不正です: ${message}` };
  }
}

function tokenizeConditionExpression(input: string): { tokens: Token[]; errors: string[] } {
  const tokens: Token[] = [];
  const errors: string[] = [];
  let index = 0;

  while (index < input.length) {
    const char = input[index] ?? "";
    const pair = input.slice(index, index + 2);

    if (/\s/u.test(char)) {
      index += 1;
      continue;
    }

    if (["&&", "||", "==", "!=", ">=", "<=", "=~", "!~"].includes(pair)) {
      tokens.push({ type: "operator", value: pair as Operator });
      index += 2;
      continue;
    }

    if (["!", "(", ")", ">", "<"].includes(char)) {
      tokens.push({ type: "operator", value: char as Operator });
      index += 1;
      continue;
    }

    if (char === "\"" || char === "'") {
      const quote = char;
      let value = "";
      index += 1;
      while (index < input.length && input[index] !== quote) {
        if (input[index] === "\\" && index + 1 < input.length) {
          value += input[index + 1];
          index += 2;
          continue;
        }
        value += input[index];
        index += 1;
      }

      if (input[index] !== quote) {
        errors.push("文字列リテラルが閉じていません");
        return { tokens, errors };
      }

      tokens.push({ type: "string", value });
      index += 1;
      continue;
    }

    if (char === "/") {
      const parsed = parseRegexLiteral(input, index);
      if (parsed.error || !parsed.token || typeof parsed.endIndex !== "number") {
        errors.push(parsed.error ?? "正規表現リテラルが不正です");
        return { tokens, errors };
      }
      tokens.push(parsed.token);
      index = parsed.endIndex;
      continue;
    }

    const integerMatch = input.slice(index).match(/^-?\d+/u);
    if (integerMatch) {
      if (!Number.isSafeInteger(Number(integerMatch[0]))) {
        errors.push(`整数が安全な範囲を超えています: ${integerMatch[0]}`);
        return { tokens, errors };
      }
      tokens.push({ type: "integer", value: integerMatch[0] });
      index += integerMatch[0].length;
      continue;
    }

    const identifierMatch = input.slice(index).match(/^[a-zA-Z_][a-zA-Z0-9_:-]*/u);
    if (identifierMatch) {
      const value = identifierMatch[0];
      if (value === "true" || value === "false") {
        tokens.push({ type: "boolean", value });
      } else {
        tokens.push({ type: "identifier", value });
      }
      index += value.length;
      continue;
    }

    errors.push(`解釈できない文字があります: ${char}`);
    return { tokens, errors };
  }

  return { tokens, errors };
}

function parseConditionExpression(input: string): ParsedConditionExpression {
  const trimmed = input.trim();
  if (!trimmed) {
    return { ast: { kind: "literal", value: true, valueType: "boolean" }, errors: [] };
  }

  const { tokens, errors } = tokenizeConditionExpression(trimmed);
  if (errors.length > 0) {
    return { ast: null, errors };
  }

  let cursor = 0;

  function peek(value?: Operator) {
    const token = tokens[cursor];
    if (!token) {
      return null;
    }
    return value ? token.type === "operator" && token.value === value : token;
  }

  function consume(value: Operator) {
    const token = peek(value);
    if (!token) {
      return null;
    }
    cursor += 1;
    return token;
  }

  function parsePrimary(): ExpressionNode | null {
    const token = tokens[cursor];
    if (!token) {
      errors.push("式が途中で終わっています");
      return null;
    }

    if (consume("(")) {
      const value = parseOr();
      if (!consume(")")) {
        errors.push("括弧が閉じていません");
      }
      return value;
    }

    cursor += 1;
    if (token.type === "boolean") {
      return { kind: "literal", value: token.value === "true", valueType: "boolean" };
    }
    if (token.type === "integer") {
      return { kind: "literal", value: Number.parseInt(token.value, 10), valueType: "integer" };
    }
    if (token.type === "string") {
      return { kind: "literal", value: token.value, valueType: "string" };
    }
    if (token.type === "regex") {
      return { kind: "literal", value: token.value, valueType: "regex" };
    }
    if (token.type === "identifier") {
      return { kind: "identifier", id: token.value };
    }

    errors.push(`値として使えない token です: ${token.value}`);
    return null;
  }

  function parseUnary(): ExpressionNode | null {
    if (consume("!")) {
      const value = parseUnary();
      return value ? { kind: "not", value } : null;
    }
    return parsePrimary();
  }

  function parseCompare(): ExpressionNode | null {
    let left = parseUnary();
    while (left && comparisonOperators.has(tokens[cursor]?.value as BinaryOperator)) {
      const operator = tokens[cursor]?.value as BinaryOperator;
      cursor += 1;
      const right = parseUnary();
      if (!right) {
        return left;
      }
      left = { kind: "binary", operator, left, right };
    }
    return left;
  }

  function parseAnd(): ExpressionNode | null {
    let left = parseCompare();
    while (left && consume("&&")) {
      const right = parseCompare();
      if (!right) {
        return left;
      }
      left = { kind: "binary", operator: "&&", left, right };
    }
    return left;
  }

  function parseOr(): ExpressionNode | null {
    let left = parseAnd();
    while (left && consume("||")) {
      const right = parseAnd();
      if (!right) {
        return left;
      }
      left = { kind: "binary", operator: "||", left, right };
    }
    return left;
  }

  const ast = parseOr();
  if (cursor !== tokens.length) {
    errors.push(`解釈できない token が残っています: ${tokens[cursor]?.value ?? ""}`);
  }

  return { ast, errors };
}

function isBooleanType(value: InferredType) {
  return value.type === "boolean";
}

function typeForIdentifier(id: string, states: ReadonlyMap<string, ConditionStateDefinition>): InferredType {
  if (id === "player_input") {
    return { type: "string" };
  }
  const state = states.get(id);
  if (!state) {
    return { type: "unknown", id };
  }
  if (state.type === "enum") {
    return { type: "enum", id, values: state.values ?? [] };
  }
  return { type: state.type };
}

function inferExpressionType(node: ExpressionNode, states: ReadonlyMap<string, ConditionStateDefinition>, errors: string[]): InferredType {
  if (node.kind === "literal") {
    return node.valueType === "string" ? { type: "string", value: String(node.value) } : { type: node.valueType };
  }

  if (node.kind === "identifier") {
    const value = typeForIdentifier(node.id, states);
    if (value.type === "unknown") {
      errors.push(`状態変数が未定義です: ${value.id}`);
    }
    return value;
  }

  if (node.kind === "not") {
    const value = inferExpressionType(node.value, states, errors);
    if (!isBooleanType(value)) {
      errors.push("! は boolean 条件だけに使えます");
    }
    return { type: "boolean" };
  }

  const left = inferExpressionType(node.left, states, errors);
  const right = inferExpressionType(node.right, states, errors);

  if (node.operator === "&&" || node.operator === "||") {
    if (!isBooleanType(left)) {
      errors.push(`${node.operator} の左辺は boolean 条件にしてください`);
    }
    if (!isBooleanType(right)) {
      errors.push(`${node.operator} の右辺は boolean 条件にしてください`);
    }
    return { type: "boolean" };
  }

  if (!isComparablePair(left, node.operator, right)) {
    errors.push(`比較の型が不正です: ${node.operator}`);
  }
  return { type: "boolean" };
}

function isComparablePair(left: InferredType, operator: BinaryOperator, right: InferredType) {
  if (left.type === "unknown" || right.type === "unknown" || left.type === "invalid" || right.type === "invalid") {
    return false;
  }

  if (operator === "=~" || operator === "!~") {
    return (left.type === "string" || left.type === "enum") && right.type === "regex";
  }

  if (left.type === "boolean" || right.type === "boolean") {
    return ["==", "!="].includes(operator) && left.type === "boolean" && right.type === "boolean";
  }

  if (left.type === "integer" || right.type === "integer") {
    return left.type === "integer" && right.type === "integer";
  }

  if (left.type === "enum" && right.type === "string") {
    return ["==", "!="].includes(operator) && typeof right.value === "string" && left.values.includes(right.value);
  }

  if (left.type === "string" && right.type === "enum") {
    return ["==", "!="].includes(operator) && typeof left.value === "string" && right.values.includes(left.value);
  }

  if (left.type === "enum" && right.type === "enum") {
    return ["==", "!="].includes(operator);
  }

  return left.type === "string" && right.type === "string" && ["==", "!="].includes(operator);
}

export function validateConditionExpression(input: string, states: ReadonlyMap<string, ConditionStateDefinition>) {
  const { ast, errors } = parseConditionExpression(input);
  if (!ast) {
    return errors;
  }

  const type = inferExpressionType(ast, states, errors);
  if (!isBooleanType(type)) {
    errors.push("cond 全体は boolean 条件にしてください");
  }
  return errors;
}

function truthy(value: unknown) {
  return value === true || (typeof value === "number" && value !== 0) || (typeof value === "string" && value.length > 0);
}

function compareValues(left: unknown, operator: BinaryOperator, right: unknown) {
  if (operator === "=~" || operator === "!~") {
    const regex = typeof right === "object" && right && "regex" in right && right.regex instanceof RegExp ? right.regex : null;
    if (!regex) {
      return false;
    }
    regex.lastIndex = 0;
    const matched = regex.test(String(left ?? ""));
    return operator === "=~" ? matched : !matched;
  }

  if (operator === "==") {
    return left === right;
  }
  if (operator === "!=") {
    return left !== right;
  }

  if (typeof left !== "number" || typeof right !== "number" || !Number.isFinite(left) || !Number.isFinite(right)) {
    return false;
  }

  if (operator === ">") {
    return left > right;
  }
  if (operator === ">=") {
    return left >= right;
  }
  if (operator === "<") {
    return left < right;
  }
  return left <= right;
}

function evaluateNode(node: ExpressionNode, stateValues: Record<string, unknown>): unknown {
  if (node.kind === "literal") {
    return node.value;
  }

  if (node.kind === "identifier") {
    if (node.id === "player_input" && !Object.prototype.hasOwnProperty.call(stateValues, node.id)) {
      return "";
    }
    return Object.prototype.hasOwnProperty.call(stateValues, node.id) ? stateValues[node.id] : false;
  }

  if (node.kind === "not") {
    return !truthy(evaluateNode(node.value, stateValues));
  }

  if (node.operator === "&&") {
    return truthy(evaluateNode(node.left, stateValues)) && truthy(evaluateNode(node.right, stateValues));
  }
  if (node.operator === "||") {
    return truthy(evaluateNode(node.left, stateValues)) || truthy(evaluateNode(node.right, stateValues));
  }

  return compareValues(evaluateNode(node.left, stateValues), node.operator, evaluateNode(node.right, stateValues));
}

export function evaluateConditionExpression(input: string, stateValues: Record<string, unknown> = {}) {
  const { ast, errors } = parseConditionExpression(input);
  if (!ast || errors.length > 0) {
    return false;
  }
  return truthy(evaluateNode(ast, stateValues));
}
