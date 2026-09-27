// cond/setの文字列は同じescape規則で読む。JSON/JavaScriptの式は評価しない。
export function readQuotedString(input: string, start: number) {
  const quote = input[start];
  let value = "";
  let index = start + 1;
  while (index < input.length && input[index] !== quote) {
    if (input[index] === "\\" && index + 1 < input.length) index += 1;
    value += input[index++];
  }
  return { value, endIndex: index + 1, closed: input[index] === quote };
}
