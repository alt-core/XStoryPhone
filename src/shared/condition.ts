type Token =
  | { kind: "identifier"; value: string }
  | { kind: "literal"; value: string | number | boolean | null }
  | { kind: "operator"; value: "&&" | "||" | "!" | "==" | "!=" }
  | { kind: "paren"; value: "(" | ")" };

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let cursor = 0;

  while (cursor < source.length) {
    const rest = source.slice(cursor);
    const whitespace = /^\s+/u.exec(rest);
    if (whitespace) {
      cursor += whitespace[0].length;
      continue;
    }

    const operator = /^(?:&&|\|\||==|!=|!)/u.exec(rest);
    if (operator) {
      tokens.push({
        kind: "operator",
        value: operator[0] as Extract<Token, { kind: "operator" }>["value"]
      });
      cursor += operator[0].length;
      continue;
    }

    if (rest[0] === "(" || rest[0] === ")") {
      tokens.push({ kind: "paren", value: rest[0] });
      cursor += 1;
      continue;
    }

    const stringLiteral = /^(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')/u.exec(rest);
    if (stringLiteral) {
      const raw = stringLiteral[0];
      const value = raw.startsWith('"')
        ? JSON.parse(raw)
        : raw.slice(1, -1).replace(/\\'/gu, "'").replace(/\\\\/gu, "\\");
      tokens.push({ kind: "literal", value });
      cursor += raw.length;
      continue;
    }

    const numberLiteral = /^-?(?:\d+(?:\.\d+)?|\.\d+)/u.exec(rest);
    if (numberLiteral) {
      tokens.push({ kind: "literal", value: Number(numberLiteral[0]) });
      cursor += numberLiteral[0].length;
      continue;
    }

    const word = /^[A-Za-z_][A-Za-z0-9_.-]*/u.exec(rest);
    if (word) {
      const value = word[0];
      if (value === "true" || value === "false" || value === "null") {
        tokens.push({
          kind: "literal",
          value: value === "true" ? true : value === "false" ? false : null
        });
      } else {
        tokens.push({ kind: "identifier", value });
      }
      cursor += value.length;
      continue;
    }

    throw new Error(`条件式を解釈できません: ${rest.slice(0, 20)}`);
  }

  return tokens;
}

class ConditionParser {
  #cursor = 0;
  private readonly tokens: Token[];
  private readonly state: Record<string, unknown>;

  constructor(tokens: Token[], state: Record<string, unknown>) {
    this.tokens = tokens;
    this.state = state;
  }

  parse() {
    const value = this.parseOr();
    if (this.#cursor !== this.tokens.length) {
      throw new Error("条件式の末尾に余分な記述があります。");
    }
    return Boolean(value);
  }

  private current() {
    return this.tokens[this.#cursor];
  }

  private consume() {
    return this.tokens[this.#cursor++];
  }

  private parseOr(): unknown {
    let value = this.parseAnd();
    while (this.current()?.kind === "operator" && this.current()?.value === "||") {
      this.consume();
      const right = this.parseAnd();
      value = Boolean(value) || Boolean(right);
    }
    return value;
  }

  private parseAnd(): unknown {
    let value = this.parseEquality();
    while (this.current()?.kind === "operator" && this.current()?.value === "&&") {
      this.consume();
      const right = this.parseEquality();
      value = Boolean(value) && Boolean(right);
    }
    return value;
  }

  private parseEquality(): unknown {
    let value = this.parseUnary();
    const token = this.current();
    if (token?.kind === "operator" && (token.value === "==" || token.value === "!=")) {
      this.consume();
      const right = this.parseUnary();
      value = token.value === "==" ? value === right : value !== right;
    }
    return value;
  }

  private parseUnary(): unknown {
    const token = this.current();
    if (token?.kind === "operator" && token.value === "!") {
      this.consume();
      return !Boolean(this.parseUnary());
    }
    return this.parsePrimary();
  }

  private parsePrimary(): unknown {
    const token = this.consume();
    if (!token) {
      throw new Error("条件式が途中で終わっています。");
    }
    if (token.kind === "literal") {
      return token.value;
    }
    if (token.kind === "identifier") {
      return this.state[token.value];
    }
    if (token.kind === "paren" && token.value === "(") {
      const value = this.parseOr();
      const closing = this.consume();
      if (closing?.kind !== "paren" || closing.value !== ")") {
        throw new Error("条件式の閉じ括弧がありません。");
      }
      return value;
    }
    throw new Error("条件式の値が必要です。");
  }
}

export function evaluateCondition(expression: string, state: Record<string, unknown>) {
  const source = expression.trim();
  if (!source) {
    return true;
  }
  return new ConditionParser(tokenize(source), state).parse();
}

function assignmentValue(raw: string): string | number | boolean {
  const value = raw.trim();
  if (value === "true" || value === "false") {
    return value === "true";
  }
  if (/^-?(?:\d+(?:\.\d+)?|\.\d+)$/u.test(value)) {
    return Number(value);
  }
  if (value.startsWith('"')) {
    return JSON.parse(value);
  }
  return value;
}

export function applyStateAssignments(
  state: Record<string, string | number | boolean>,
  assignments: readonly string[],
  variables: Record<string, string> = {}
) {
  const next = { ...state };
  for (const assignment of assignments) {
    const rendered = renderTemplate(assignment, variables);
    const match = /^([A-Za-z_][A-Za-z0-9_.-]*)\s*=\s*(.+)$/u.exec(rendered.trim());
    if (!match) {
      throw new Error(`状態更新を解釈できません: ${assignment}`);
    }
    next[match[1]] = assignmentValue(match[2]);
  }
  return next;
}

export function renderTemplate(value: string, variables: Record<string, string>) {
  return value.replace(/\{\{([A-Za-z_][A-Za-z0-9_]*)\}\}/gu, (token, id) => variables[id] ?? token);
}
