import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { validateHookReferences } from "../scripts/lib/scenario-hooks.mjs";

const source = {
  stateVariables: {},
  apps: [],
  todos: [],
  incomingCalls: [],
  contents: [],
  talks: [
    { id: "search_agent", kind: "search_agent" },
    { id: "guide", kind: "sms" },
    { id: "lobby", kind: "chat" }
  ],
  generatedAudio: [],
  hooks: []
};

test("hook参照検証は両方の書式で検索AIの履歴リセットを受け付ける", () => {
  for (const receiver of ["context.talk", "talk"]) {
    assert.doesNotThrow(() => validateHookReferences({
      reset: `${receiver}.resetHistory("search_agent");`
    }, source, []));
  }
});

test("hook参照検証は定義済みのSMS・チャットを含め検索AI以外の履歴リセットを拒否する", () => {
  for (const receiver of ["context.talk", "talk"]) {
    for (const talkId of ["guide", "lobby", "unknown", ""]) {
      assert.throws(() => validateHookReferences({
        reset: `${receiver}.resetHistory(${JSON.stringify(talkId)});`
      }, source, []), /hooks\.reset: talk\.resetHistoryのIDが未定義です:/u);
    }
  }
});

test("実際のhook型は検索AIの履歴リセットだけを許可する", () => {
  const fixturePath = fileURLToPath(new URL("./search-agent-reset-types.fixture.ts", import.meta.url));
  const fixture = `
import type { ScenarioHookContext } from "../src/shared/hooks.ts";
declare const context: ScenarioHookContext;
const { talk } = context;
context.talk.resetHistory("search_agent");
talk.resetHistory("search_agent");
// SMSは対象外です。
// @ts-expect-error
context.talk.resetHistory("guide");
// チャットは対象外です。
// @ts-expect-error
talk.resetHistory("lobby");
// 対象を確認できない文字列も受け付けません。
declare const arbitraryTalkId: string;
// @ts-expect-error
talk.resetHistory(arbitraryTalkId);
// 対象の省略はできません。
// @ts-expect-error
talk.resetHistory();
`;
  const options = {
    noEmit: true,
    strict: true,
    skipLibCheck: true,
    types: [],
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    allowImportingTsExtensions: true
  };
  const host = ts.createCompilerHost(options);
  const readSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (fileName, languageVersion, onError, shouldCreateNewSourceFile) => fileName === fixturePath
    ? ts.createSourceFile(fileName, fixture, languageVersion, true, ts.ScriptKind.TS)
    : readSourceFile(fileName, languageVersion, onError, shouldCreateNewSourceFile);
  const program = ts.createProgram([fixturePath], options, host);
  const diagnostics = ts.getPreEmitDiagnostics(program);
  assert.equal(diagnostics.length, 0, diagnostics.map(diagnostic =>
    ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")
  ).join("\n"));
});
