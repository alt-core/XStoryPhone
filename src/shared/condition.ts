export type ConditionStateType = "boolean" | "enum" | "integer" | "string";

export type ConditionStateDefinition = {
  type: ConditionStateType;
  values?: readonly string[];
};

type RegexLiteral = { source: string; flags: string; regex: RegExp };
type Operator = "!" | "(" | ")" | "&&" | "||" | "==" | "!=" | ">" | ">=" | "<" | "<=" | "=~" | "!~";
type BinaryOperator = Exclude<Operator, "!" | "(" | ")">;
type Token =
  | { kind: "identifier"; value: string }
  | { kind: "literal"; value: string | number | boolean | RegexLiteral; valueType: "string" | "integer" | "boolean" | "regex" }
  | { kind: "operator"; value: Operator };
type Node =
  | { kind: "identifier"; id: string }
  | { kind: "literal"; value: string | number | boolean | RegexLiteral; valueType: "string" | "integer" | "boolean" | "regex" }
  | { kind: "not"; value: Node }
  | { kind: "binary"; operator: BinaryOperator; left: Node; right: Node };
type InferredType =
  | { type: "boolean" | "integer" | "regex" }
  | { type: "string"; value?: string }
  | { type: "enum"; id: string; values: readonly string[] }
  | { type: "unknown"; id: string }
  | { type: "invalid" };

const comparisonOperators = new Set<BinaryOperator>(["==", "!=", ">", ">=", "<", "<=", "=~", "!~"]);

function regexLiteralAt(input: string, start: number) {
  let escaped = false;
  let inClass = false;
  let end = -1;
  for (let index = start + 1; index < input.length; index += 1) {
    const char = input[index];
    if (escaped) escaped = false;
    else if (char === "\\") escaped = true;
    else if (char === "[") inClass = true;
    else if (char === "]") inClass = false;
    else if (char === "/" && !inClass) {
      end = index;
      break;
    }
  }
  if (end < 0) throw new Error("正規表現リテラルの閉じる / がありません。");
  const flags = /^[a-z]*/iu.exec(input.slice(end + 1))?.[0] ?? "";
  if (!/^[dgimsuvy]*$/u.test(flags)) throw new Error("正規表現flagsが不正です。");
  const source = input.slice(start + 1, end);
  return {
    literal: { source, flags, regex: new RegExp(source, flags) },
    cursor: end + 1 + flags.length
  };
}

function tokenize(input: string) {
  const tokens: Token[] = [];
  let cursor = 0;
  while (cursor < input.length) {
    const rest = input.slice(cursor);
    const whitespace = /^\s+/u.exec(rest);
    if (whitespace) {
      cursor += whitespace[0].length;
      continue;
    }
    const pair = rest.slice(0, 2);
    if (["&&", "||", "==", "!=", ">=", "<=", "=~", "!~"].includes(pair)) {
      tokens.push({ kind: "operator", value: pair as Operator });
      cursor += 2;
      continue;
    }
    if (["!", "(", ")", ">", "<"].includes(rest[0])) {
      tokens.push({ kind: "operator", value: rest[0] as Operator });
      cursor += 1;
      continue;
    }
    if (rest[0] === "/") {
      const parsed = regexLiteralAt(input, cursor);
      tokens.push({ kind: "literal", value: parsed.literal, valueType: "regex" });
      cursor = parsed.cursor;
      continue;
    }
    const stringLiteral = /^(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')/u.exec(rest);
    if (stringLiteral) {
      const raw = stringLiteral[0];
      const value = raw.startsWith('"')
        ? JSON.parse(raw)
        : raw.slice(1, -1).replace(/\\'/gu, "'").replace(/\\\\/gu, "\\");
      tokens.push({ kind: "literal", value, valueType: "string" });
      cursor += raw.length;
      continue;
    }
    const integer = /^-?\d+/u.exec(rest);
    if (integer) {
      tokens.push({ kind: "literal", value: Number.parseInt(integer[0], 10), valueType: "integer" });
      cursor += integer[0].length;
      continue;
    }
    const word = /^[A-Za-z_][A-Za-z0-9_.:-]*/u.exec(rest);
    if (word) {
      if (word[0] === "true" || word[0] === "false") {
        tokens.push({ kind: "literal", value: word[0] === "true", valueType: "boolean" });
      } else {
        tokens.push({ kind: "identifier", value: word[0] });
      }
      cursor += word[0].length;
      continue;
    }
    throw new Error(`条件式を解釈できません: ${rest.slice(0, 20)}`);
  }
  return tokens;
}

function parseExpression(input: string): Node {
  const tokens = tokenize(input.trim());
  let cursor = 0;
  const current = () => tokens[cursor];
  const consume = () => tokens[cursor++];
  const consumeOperator = (operator: Operator) => {
    if (current()?.kind !== "operator" || current()?.value !== operator) return false;
    cursor += 1;
    return true;
  };

  function primary(): Node {
    if (consumeOperator("(")) {
      const value = or();
      if (!consumeOperator(")")) throw new Error("条件式の閉じ括弧がありません。");
      return value;
    }
    const token = consume();
    if (!token) throw new Error("条件式が途中で終わっています。");
    if (token.kind === "literal") return token;
    if (token.kind === "identifier") return { kind: "identifier", id: token.value };
    throw new Error("条件式の値が必要です。");
  }
  function unary(): Node {
    return consumeOperator("!") ? { kind: "not", value: unary() } : primary();
  }
  function compare(): Node {
    let left = unary();
    while (current()?.kind === "operator" && comparisonOperators.has(current().value as BinaryOperator)) {
      const operator = consume().value as BinaryOperator;
      left = { kind: "binary", operator, left, right: unary() };
    }
    return left;
  }
  function and(): Node {
    let left = compare();
    while (consumeOperator("&&")) left = { kind: "binary", operator: "&&", left, right: compare() };
    return left;
  }
  function or(): Node {
    let left = and();
    while (consumeOperator("||")) left = { kind: "binary", operator: "||", left, right: and() };
    return left;
  }

  if (!tokens.length) return { kind: "literal", value: true, valueType: "boolean" };
  const ast = or();
  if (cursor !== tokens.length) throw new Error(`条件式の末尾に余分な記述があります: ${String(current()?.value ?? "")}`);
  return ast;
}

function truthy(value: unknown) {
  return value === true || (typeof value === "number" && value !== 0) || (typeof value === "string" && value.length > 0);
}

function compareValues(left: unknown, operator: BinaryOperator, right: unknown) {
  if (operator === "=~" || operator === "!~") {
    const regex = typeof right === "object" && right && "regex" in right && right.regex instanceof RegExp ? right.regex : null;
    if (!regex) return false;
    regex.lastIndex = 0;
    const matched = regex.test(String(left ?? ""));
    return operator === "=~" ? matched : !matched;
  }
  if (operator === "==") return left === right;
  if (operator === "!=") return left !== right;
  if (typeof left !== "number" || typeof right !== "number") return false;
  if (operator === ">") return left > right;
  if (operator === ">=") return left >= right;
  if (operator === "<") return left < right;
  return left <= right;
}

function evaluateNode(node: Node, state: Record<string, unknown>): unknown {
  if (node.kind === "literal") return node.value;
  if (node.kind === "identifier") {
    const exists = Object.prototype.hasOwnProperty.call(state, node.id);
    if (node.id === "player_input" && !exists) return "";
    return exists ? state[node.id] : false;
  }
  if (node.kind === "not") return !truthy(evaluateNode(node.value, state));
  if (node.operator === "&&") return truthy(evaluateNode(node.left, state)) && truthy(evaluateNode(node.right, state));
  if (node.operator === "||") return truthy(evaluateNode(node.left, state)) || truthy(evaluateNode(node.right, state));
  return compareValues(evaluateNode(node.left, state), node.operator, evaluateNode(node.right, state));
}

export function evaluateCondition(expression: string, state: Record<string, unknown>) {
  return truthy(evaluateNode(parseExpression(expression), state));
}

function definitionType(node: Node, states: ReadonlyMap<string, ConditionStateDefinition>, errors: string[]): InferredType {
  if (node.kind === "literal") {
    return node.valueType === "string" ? { type: "string", value: String(node.value) } : { type: node.valueType };
  }
  if (node.kind === "identifier") {
    if (node.id === "player_input") return { type: "string" };
    const definition = states.get(node.id);
    if (!definition) {
      errors.push(`未定義の状態変数です: ${node.id}`);
      return { type: "unknown", id: node.id };
    }
    return definition.type === "enum"
      ? { type: "enum", id: node.id, values: definition.values ?? [] }
      : { type: definition.type };
  }
  if (node.kind === "not") {
    const value = definitionType(node.value, states, errors);
    if (value.type !== "boolean") errors.push("! はboolean条件だけに使えます。");
    return { type: "boolean" };
  }
  const left = definitionType(node.left, states, errors);
  const right = definitionType(node.right, states, errors);
  if (node.operator === "&&" || node.operator === "||") {
    if (left.type !== "boolean") errors.push(`${node.operator} の左辺はboolean条件にしてください。`);
    if (right.type !== "boolean") errors.push(`${node.operator} の右辺はboolean条件にしてください。`);
  } else if (!comparable(left, node.operator, right)) {
    errors.push(`比較の型が不正です: ${node.operator}`);
  }
  return { type: "boolean" };
}

function comparable(left: InferredType, operator: BinaryOperator, right: InferredType) {
  if ([left.type, right.type].some((type) => type === "unknown" || type === "invalid")) return false;
  if (operator === "=~" || operator === "!~") return ["string", "enum"].includes(left.type) && right.type === "regex";
  if (left.type === "boolean" || right.type === "boolean") return ["==", "!="].includes(operator) && left.type === right.type;
  if (left.type === "integer" || right.type === "integer") return left.type === "integer" && right.type === "integer";
  if (left.type === "enum" && right.type === "string") return ["==", "!="].includes(operator) && right.value !== undefined && left.values.includes(right.value);
  if (left.type === "string" && right.type === "enum") return ["==", "!="].includes(operator) && left.value !== undefined && right.values.includes(left.value);
  if (left.type === "enum" && right.type === "enum") return ["==", "!="].includes(operator);
  return left.type === "string" && right.type === "string" && ["==", "!="].includes(operator);
}

export function validateConditionExpression(expression: string, states: ReadonlyMap<string, ConditionStateDefinition>) {
  const errors: string[] = [];
  try {
    const result = definitionType(parseExpression(expression), states, errors);
    if (result.type !== "boolean") errors.push("cond全体はboolean条件にしてください。");
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }
  return errors;
}

function assignmentValue(raw: string): string | number | boolean {
  const value = raw.trim();
  if (value === "true" || value === "false") return value === "true";
  if (/^-?\d+$/u.test(value)) return Number.parseInt(value, 10);
  if (value.startsWith('"')) return JSON.parse(value);
  if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1);
  return value;
}

function matchReferenceKey(value: unknown) {
  if (typeof value !== "string") return null;
  return /^\$match\.([A-Za-z_][A-Za-z0-9_]*)$/u.exec(value)?.[1] ?? null;
}

export function applyStateAssignments(
  state: Record<string, string | number | boolean>,
  assignments: readonly string[],
  variables: Record<string, string> = {},
  definitions?: ReadonlyMap<string, ConditionStateDefinition>
) {
  const next = { ...state };
  for (const assignment of assignments) {
    const match = /^([A-Za-z_][A-Za-z0-9_.:-]*)\s*=\s*(.+)$/u.exec(assignment.trim());
    if (!match) throw new Error(`状態更新を解釈できません: ${assignment}`);
    const parsed = assignmentValue(match[2]);
    const reference = matchReferenceKey(parsed);
    const value = reference ? (variables[reference] ?? "") : parsed;
    const definition = definitions?.get(match[1]);
    if (definitions && !definition) {
      throw new Error(`setの状態変数が未定義です: ${match[1]}`);
    }
    if (definition) {
      const error = validateAssignmentValue(match[1], value, definition, Boolean(reference));
      if (error) throw new Error(error);
    }
    next[match[1]] = value;
  }
  return next;
}

function validateAssignmentValue(id: string, value: unknown, definition: ConditionStateDefinition, fromMatch: boolean) {
  if (fromMatch && definition.type !== "string") return `$match参照はstringの状態変数だけに使えます: ${id}`;
  if (definition.type === "boolean" && typeof value !== "boolean") return `boolean setはtrue / falseにしてください: ${id}`;
  if (definition.type === "integer" && (!Number.isInteger(value) || typeof value !== "number")) return `integer setの値が不正です: ${id}`;
  if (definition.type === "string" && typeof value !== "string") return `string setの値は文字列にしてください: ${id}`;
  if (definition.type === "enum" && !definition.values?.includes(String(value))) return `enum setの値がvaluesにありません: ${id}`;
  return null;
}

export function validateStateAssignments(
  assignments: readonly string[],
  definitions: ReadonlyMap<string, ConditionStateDefinition>,
  matchIds: ReadonlySet<string> = new Set()
) {
  const errors: string[] = [];
  for (const assignment of assignments) {
    const match = /^([A-Za-z_][A-Za-z0-9_.:-]*)\s*=\s*(.+)$/u.exec(assignment.trim());
    if (!match) {
      errors.push(`setの形式が不正です: ${assignment}`);
      continue;
    }
    const definition = definitions.get(match[1]);
    if (!definition) {
      errors.push(`setの状態変数が未定義です: ${match[1]}`);
      continue;
    }
    try {
      const value = assignmentValue(match[2]);
      const reference = matchReferenceKey(value);
      if (reference && !matchIds.has(reference)) errors.push(`setが未定義のmatch値を参照しています: ${reference}`);
      const error = validateAssignmentValue(match[1], value, definition, Boolean(reference));
      if (error) errors.push(error);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  return errors;
}

export function renderTemplate(value: string, variables: Record<string, string>) {
  return value.replace(/\{\{([A-Za-z_][A-Za-z0-9_]*)\}\}/gu, (_token, id) => variables[id] ?? "");
}
