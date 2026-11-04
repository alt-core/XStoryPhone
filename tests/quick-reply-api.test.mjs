import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

test("talk APIは明示的な空displayと候補のseqを保持し、通常送信には追加しない", async () => {
  const requests = [];
  const source = ts.createSourceFile("playerApi.ts", readFileSync(new URL("../src/client/system/playerApi.ts", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true);
  const send = source.statements.find(statement => ts.isFunctionDeclaration(statement) && statement.name?.text === "sendTalkMessage");
  assert.ok(send);
  const context = {
    playerRequest(_route, _token, init) {
      requests.push(JSON.parse(init.body));
      return Promise.resolve({ ok: false });
    }
  };
  vm.createContext(context);
  vm.runInContext(ts.transpileModule(send.getText(source).replace(/^export /u, ""), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None }
  }).outputText, context);
  const { sendTalkMessage } = context;
  await sendTalkMessage("test-token", "talk", "turn", "続きを読む", [], [], { display: "", quickReplySeq: 7 });
  await sendTalkMessage("test-token", "talk", "turn", "はい", [], [], { display: "はい、お願いします", quickReplySeq: 7 });
  await sendTalkMessage("test-token", "talk", "turn", "従来の入力");
  assert.deepEqual(requests, [
    { talkId: "talk", turnKey: "turn", message: "続きを読む", display: "", quickReplySeq: 7 },
    { talkId: "talk", turnKey: "turn", message: "はい", display: "はい、お願いします", quickReplySeq: 7 },
    { talkId: "talk", turnKey: "turn", message: "従来の入力" }
  ]);
});
