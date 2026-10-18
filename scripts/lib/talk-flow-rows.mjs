import { MAX_GAME_OVER_REASON_LENGTH } from "../../src/shared/presentation.ts";

function parseMode(value) {
  const mode = String(value ?? "").replace(/\r\n?/gu, "\n").trim();
  if (["", "stay", "game_over"].includes(mode)) return { mode, gameOverReason: "" };
  const call = /^game_over\s*\(([\s\S]*)\)$/u.exec(mode);
  if (!call) throw new Error('modeが不正です。空欄、stay、game_over、game_over("理由")を指定してください。');
  const argument = call[1].trim();
  let reason = "";
  if (argument) {
    try {
      // セル内の実改行も許可するが、改行直前の不完全なescapeは受け付けない。
      reason = JSON.parse(argument.replace(/(\\*)\n/gu, (_match, slashes) => {
        if (slashes.length % 2) throw new Error("不完全なescapeです。");
        return `${slashes}\\n`;
      }));
    } catch {
      throw new Error('game_overの引数は二重引用符で囲んだ理由を1つ指定してください。');
    }
    if (typeof reason !== "string") throw new Error('game_overの引数は二重引用符で囲んだ理由を1つ指定してください。');
    reason = reason.replace(/\r\n?/gu, "\n").trim();
  }
  if (reason.length > MAX_GAME_OVER_REASON_LENGTH) throw new Error(`game_overの理由は${MAX_GAME_OVER_REASON_LENGTH}文字以内にしてください。`);
  if (reason.includes("{{")) throw new Error("game_overの理由にはtemplateを指定できません。");
  return { mode: "game_over", gameOverReason: reason };
}

// Sheetsのtype・text・extractから、場面説明と会話分岐の内部表現を一度だけ作る。
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
  const rules = rows.filter(row => row.type !== "context").map(row => {
    let parsedMode = { mode: "", gameOverReason: "" };
    try { parsedMode = parseMode(row.mode); }
    catch (error) { fail(`talk_flow.tsv:${row.__rowNumber}: ${error.message}`); }
    return {
      ...row,
      ...parsedMode,
      criteria: row.type === "default" ? contexts.get(`${row.talk}\0${row.from}`)?.text ?? "" : row.text,
      match: row.extract
    };
  });
  return { contexts, rules };
}
