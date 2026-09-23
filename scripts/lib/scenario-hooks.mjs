import ts from "typescript";
import { hookLlmResponseSchema } from "../../src/worker/services/hookLlm.ts";

// spread・計算key等は評価せず、確定できるliteralだけをruntimeと同じ検査へ渡す。
function literalProperties(node) {
  if (!node || !ts.isObjectLiteralExpression(node)) return null;
  const entries = [];
  for (const property of node.properties) {
    if (!ts.isPropertyAssignment(property) || ts.isComputedPropertyName(property.name)) return null;
    const name = property.name.text;
    if (typeof name !== "string" || name === "__proto__") return null;
    entries.push([name, property.initializer]);
  }
  return Object.fromEntries(entries);
}

function validateLiteralHookSchema(api, options) {
  if (api !== "llm.extract" && api !== "llm.screen") return;
  const properties = literalProperties(options);
  const schema = properties && literalProperties(properties.schema);
  if (!schema || Object.values(schema).some((node) => !ts.isStringLiteralLike(node))) return;
  hookLlmResponseSchema(Object.fromEntries(Object.entries(schema).map(([key, node]) => [key, node.text])));
}

// hooks.scriptのセル本文を同期handlerの中へそのまま埋め込む。
export function buildScenarioHooksModule(scripts) {
  const handlers = Object.entries(scripts).map(([id, script]) => {
    const body = String(script).split("\n").map((line) => `    ${line}`).join("\n");
    return `  ${JSON.stringify(id)}: (context, event) => {\n    const { state, incoming, app, content, talk, todo, schedule, form, genAudio, llm, effect, effectSequence } = context;\n${body}\n  }`;
  }).join(",\n");
  const source = `// scenario:build によりhooks.tsvから生成。直接編集しないでください。\nimport type { ScenarioHookHandlerRegistry } from "../shared/hooks";\nimport type { ScenarioHookId } from "./hookIds.generated";\nimport type { ProjectScenarioHookContext } from "./hookContext.generated";\n\nexport const scenarioHookHandlers: ScenarioHookHandlerRegistry<ScenarioHookId, ProjectScenarioHookContext> = {\n${handlers}\n};\n`;
  const parsed = ts.createSourceFile("scenarioHooks.generated.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  if (parsed.parseDiagnostics.length) throw new Error(`hooks.scriptの構文が不正です: ${ts.flattenDiagnosticMessageText(parsed.parseDiagnostics[0].messageText, " ")}`);
  function inspect(node) {
    if (ts.isAwaitExpression(node) || ts.isWithStatement(node) || node.kind === ts.SyntaxKind.AsyncKeyword
      || (ts.isIdentifier(node) && node.text === "Promise")
      || (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === "fetch")))) {
      throw new Error("hookは同期scriptです。await/async/Promise/with/import/fetchは使用できません。");
    }
    ts.forEachChild(node, inspect);
  }
  inspect(parsed);
  return source;
}

// 静的なID指定はbuild前に検査する。計算される値は生成型・runtimeの検査に委ねる。
export function validateHookReferences(scripts, source, blocks) {
  const stateIds = new Set([...Object.keys(source.stateVariables ?? {}), "os_date", "os_time_label"]);
  const ids = {
    "state.get": stateIds, "state.set": stateIds,
    "app.repair": new Set(source.apps.map(item => item.id)),
    "todo.add": new Set(source.todos.map(item => item.id)), "todo.remove": new Set(source.todos.map(item => item.id)),
    "incoming.start": new Set(source.incomingCalls.map(item => item.id)), "incoming.markCompleted": new Set(source.incomingCalls.map(item => item.id)),
    "content.setState": new Set([...source.contents.map(item => item.id), ...source.talks.map(item => item.id)]),
    "genAudio.prepare": new Set(source.generatedAudio.map(item => item.id)),
    "talk.addBlock": new Set(source.talks.map(item => item.id)),
    "schedule.after": new Set(source.hooks.filter(item => item.event === "scheduled_event").map(item => item.target))
  };
  for (const [id, script] of Object.entries(scripts)) {
    const parsed = ts.createSourceFile("hook.ts", `function hook(){${script}\n}`, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    function visit(node) {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
        const api = node.expression.getText(parsed).replace(/^context\./u, "");
        try {
          validateLiteralHookSchema(api, node.arguments[1]);
        } catch (error) {
          throw new Error(`hooks.${id}: ${api}: ${error.message}`);
        }
        const arg = node.arguments[0];
        if (ids[api] && arg && ts.isStringLiteralLike(arg) && !ids[api].has(arg.text)) throw new Error(`hooks.${id}: ${api}のIDが未定義です: ${arg.text}`);
        const block = node.arguments[1];
        if (api === "talk.addBlock" && arg && block && ts.isStringLiteralLike(arg) && ts.isStringLiteralLike(block)
          && !blocks.some(candidate => candidate.talkId === arg.text && candidate.blockKey === block.text && !candidate.repeatOf)) {
          throw new Error(`hooks.${id}: talk.addBlockのblockが未定義です: ${arg.text}/${block.text}`);
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(parsed);
  }
}
