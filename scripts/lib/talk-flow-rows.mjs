// Sheetsの新列から内部表現を一度だけ作る。旧headerを受理する互換処理ではない。
export function talkFlowRows(rows, fail = message => { throw new Error(message); }) {
  rows = rows.map(row => ({ ...row, type: String(row.type ?? "").trim() }));
  const contexts = new Map();
  for (const row of rows.filter(row => row.type === "context")) {
    const key = `${row.talk}\0${row.from}`;
    if (contexts.has(key)) fail(`talk_flow.tsv:${row.__rowNumber}: 同じtalk/fromのcontextは一行にしてください。`);
    if (!String(row.text ?? "").trim()) fail(`talk_flow.tsv:${row.__rowNumber}: contextのtextが必要です。`);
    for (const column of ["cond", "intent", "example", "next", "set", "mode", "extract"]) {
      if (String(row[column] ?? "").trim()) fail(`talk_flow.tsv:${row.__rowNumber}: contextに${column}は指定できません。`);
    }
    contexts.set(key, row);
  }
  const rules = rows.filter(row => row.type !== "context").map(row => ({
    ...row,
    criteria: row.type === "default" ? contexts.get(`${row.talk}\0${row.from}`)?.text ?? "" : row.text,
    match: row.extract
  }));
  return { contexts, rules };
}
