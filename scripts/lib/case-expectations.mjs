// 正規表現は文字列だけに適用し、g/yのlastIndexをfixtureへ持ち越さない。
export function matchesExpectedValue(actual, expected) {
  return expected instanceof RegExp
    ? typeof actual === "string" && new RegExp(expected.source, expected.flags).test(actual)
    : Object.is(actual, expected);
}

export function expectedValuesForReport(values) {
  if (values === undefined) return undefined;
  return Object.fromEntries(Object.entries(values).map(([key, value]) => [key, value instanceof RegExp ? value.toString() : value]));
}
