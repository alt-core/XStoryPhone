import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

// 大きな親componentでは、対象の実関数と定数だけを抽出して通信順を制御する。
export function componentFunctionHarness(fileUrl, names, globals = {}) {
  const source = readFileSync(fileUrl, "utf8").match(/<script[^>]*>([\s\S]*?)<\/script>/)?.[1];
  const parsed = ts.createSourceFile("component.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const selected = parsed.statements.filter((statement) =>
    ts.isFunctionDeclaration(statement) ? names.includes(statement.name?.text)
      : ts.isVariableStatement(statement) && statement.declarationList.declarations.some((item) => names.includes(item.name.getText(parsed))));
  if (selected.length !== names.length) throw new Error("検証対象の関数／定数が見つかりません");
  vm.createContext(globals);
  vm.runInContext(ts.transpileModule(selected.map((statement) => statement.getText(parsed)).join("\n"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None }
  }).outputText, globals);
  return globals;
}

// DOMを模倣せず、実componentのscriptにある初期化・リアクティブ文・関数を検証する。
// リアクティブ文は明示的に再評価するため、DOMの更新順序は別途ブラウザで確認する。
export function componentScriptHarness(fileUrl, props = {}, globals = {}) {
  const source = readFileSync(fileUrl, "utf8").match(/<script[^>]*>([\s\S]*?)<\/script>/)?.[1];
  if (!source) throw new Error("componentのscriptが見つかりません");
  const parsed = ts.createSourceFile("component.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const initializers = [];
  const reactions = [];
  const derivedNames = new Set();
  const declaredNames = new Set();
  const propNames = new Set();
  for (const statement of parsed.statements) {
    if (ts.isImportDeclaration(statement)) continue;
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) declaredNames.add(declaration.name.text);
      }
    }
    if (ts.isLabeledStatement(statement) && statement.label.text === "$") {
      reactions.push(statement.statement.getText(parsed));
      const expression = ts.isExpressionStatement(statement.statement) ? statement.statement.expression : undefined;
      if (expression && ts.isBinaryExpression(expression) && ts.isIdentifier(expression.left)) {
        derivedNames.add(expression.left.text);
      }
    } else if (ts.isVariableStatement(statement) && statement.modifiers?.some((item) => item.kind === ts.SyntaxKind.ExportKeyword)) {
      for (const declaration of statement.declarationList.declarations) {
        const name = declaration.name.getText(parsed);
        propNames.add(name);
        initializers.push(`let ${name} = ${JSON.stringify(name)} in __props ? __props[${JSON.stringify(name)}] : (${declaration.initializer?.getText(parsed) ?? "undefined"});`);
      }
    } else {
      initializers.push(statement.getText(parsed));
    }
  }
  const destroyCallbacks = [];
  const sandbox = {
    ...globals,
    __props: props,
    onDestroy(callback) { destroyCallbacks.push(callback); }
  };
  vm.createContext(sandbox);
  const evaluate = (code) => vm.runInContext(ts.transpileModule(code, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None }
  }).outputText, sandbox);
  const implicitDerivedNames = [...derivedNames].filter((name) => !declaredNames.has(name));
  evaluate(`${implicitDerivedNames.length ? `let ${implicitDerivedNames.join(",")};` : ""}\n${initializers.join("\n")}`);
  const flush = () => evaluate(reactions.join("\n"));
  flush();
  return {
    evaluate,
    flush,
    update(nextProps) {
      sandbox.__nextProps = nextProps;
      for (const name of Object.keys(nextProps)) {
        if (!propNames.has(name)) throw new Error(`未定義のprop: ${name}`);
        evaluate(`${name} = __nextProps[${JSON.stringify(name)}];`);
      }
      flush();
    },
    destroy() { destroyCallbacks.forEach((callback) => callback()); }
  };
}
