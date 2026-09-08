import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import test from "node:test";
import { deviceViewFor } from "../src/client/system/deviceView.ts";

test("ProjectStage contextは進行revisionが変わらない画面操作も反映する", () => {
  const source = readFileSync(new URL("../src/client/App.svelte", import.meta.url), "utf8").match(/<script[^>]*>([\s\S]*?)<\/script>/u)[1];
  const parsed = ts.createSourceFile("App.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const reactions = ["deviceView", "projectStageContext"].map((name) => {
    const statement = parsed.statements.find((item) => ts.isLabeledStatement(item)
      && item.label.text === "$" && ts.isExpressionStatement(item.statement)
      && ts.isBinaryExpression(item.statement.expression) && item.statement.expression.left.getText(parsed) === name);
    assert.ok(statement, `${name}の実際のreactive文を検証する`);
    return statement.statement.getText(parsed);
  });
  const state = { revision: "same", projectState: { waiting: true } };
  const context = {
    uiState: { sessionToken: "session", locked: false }, playerState: state,
    deviceView: undefined, projectStageContext: undefined,
    activeApp: null, activeIncomingCall: undefined, searchAgentOpen: false, shadeOpen: false,
    pendingPresentationCount: 0, noiseVisible: false, presentationEffectActive: false,
    gameOverVisible: false, gameOverReturning: false, allClearVisible: false, allClearReturning: false,
    deviceViewFor, dispatchProjectScenarioEvent() {}
  };
  vm.createContext(context);
  const code = ts.transpileModule(reactions.join("\n"), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const flush = () => { vm.runInContext(code, context); return context.projectStageContext.deviceView; };
  assert.deepEqual(flush(), { screen: "home", appId: null });
  context.activeApp = { id: "mail" };
  assert.deepEqual(flush(), { screen: "app", appId: "mail" });
  context.activeApp = null;
  context.searchAgentOpen = true;
  assert.equal(flush().screen, "search_agent");
  context.shadeOpen = true;
  context.searchAgentOpen = false;
  assert.equal(flush().screen, "notification_shade");
  context.activeIncomingCall = { id: "call" };
  assert.equal(flush().screen, "incoming_call");
  context.activeIncomingCall = undefined;
  context.shadeOpen = false;
  assert.equal(flush().screen, "home");
  for (const flag of ["pendingPresentationCount", "noiseVisible", "presentationEffectActive", "gameOverVisible", "gameOverReturning", "allClearVisible", "allClearReturning"]) {
    context[flag] = flag === "pendingPresentationCount" ? 1 : true;
    assert.equal(flush().screen, "effect", `${flag}をホームと誤報告しない`);
    context[flag] = flag === "pendingPresentationCount" ? 0 : false;
  }
  assert.equal(context.projectStageContext.playerState, state, "表示だけで進行を変更しない");
  assert.equal(state.revision, "same");
  assert.equal(context.projectStageContext.dispatchScenarioEvent, context.dispatchProjectScenarioEvent);
});
