import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { loadAndValidateScenario } from "./scenario-lib.mjs";
import {
  buildTalkFlowLlmChatCompletionBody,
  buildTalkFlowLlmMessages,
  selectTalkFlowRuleFromLlmDecision,
  talkFlowLlmResponseSchema
} from "../src/worker/product/talkFlowLlmSelection.ts";
import { evaluateConditionExpression } from "../src/shared/conditionExpression.ts";
import { renderTalkRuleCriteria } from "../src/worker/services/talkResolver.ts";
import { talkTestContext } from "./lib/talk-test-context.mjs";
import { selectDeterministicRule } from "../src/shared/talkCriteria.ts";

const loadedScenario = loadAndValidateScenario().worker;
const scenario = {
  ...loadedScenario,
  talkBlocks: loadedScenario.talkBlocks.map((block) => ({ ...block, block: block.id })),
  talks: loadedScenario.talks.map((talk) => {
    const fromIds = [...new Set(talk.rules.filter((rule) => rule.from !== "*").map((rule) => rule.from))];
    return {
      ...talk,
      initial: talk.initialFrom,
      commonRules: talk.rules.filter((rule) => rule.from === "*"),
      nodes: fromIds.map((id) => ({ id, rules: talk.rules.filter((rule) => rule.from === id) }))
    };
  })
};

const productionLlmRetryDelaysMs = [250];

function tokenUsageFromPayload(payload) {
  const usage = payload && typeof payload === "object" ? payload.usage : null;
  if (!usage || typeof usage !== "object") return null;
  return {
    promptTokens: Number(usage.prompt_tokens ?? 0),
    completionTokens: Number(usage.completion_tokens ?? 0),
    totalTokens: Number(usage.total_tokens ?? 0),
    cachedTokens: Number(usage.prompt_tokens_details?.cached_tokens ?? 0)
  };
}

async function fetchLlmJsonPayloadAttempt(url, init, timeoutMs) {
  try {
    const response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      return {
        ok: false,
        retriable: response.status === 408 || response.status === 429 || response.status >= 500,
        failure: { reason: "http_error", errorCode: "provider_error", httpStatus: response.status },
        httpStatus: response.status,
        payload
      };
    }
    return { ok: true, value: { response, payload }, httpStatus: response.status, payload };
  } catch (error) {
    return {
      ok: false,
      retriable: true,
      failure: { reason: "network_error", errorCode: "provider_error", errorName: error?.name, errorMessage: error?.message }
    };
  }
}

async function runLlmWithRetry(runAttempt, options = {}) {
  const delays = options.retryDelaysMs ?? [];
  let attempts = 0;
  let result;
  while (attempts <= delays.length) {
    attempts += 1;
    result = await runAttempt();
    if (result.ok || !result.retriable || attempts > delays.length) break;
    const waitMs = delays[attempts - 1];
    options.onRetry?.({ retry: attempts, waitMs, ...result.failure });
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }
  return { result, attempts, retries: Math.max(0, attempts - 1) };
}

const rootDir = process.cwd();
const args = new Map();
const flags = new Set();
for (const arg of process.argv.slice(2)) {
  if (arg.startsWith("--") && arg.includes("=")) {
    const [key, value] = arg.slice(2).split(/=(.*)/s, 2);
    args.set(key, value);
  } else if (arg.startsWith("--")) {
    flags.add(arg.slice(2));
  }
}

const live = flags.has("live");
const paidApiConfirmationFlag = "i-understand-this-test-calls-a-paid-llm-api-and-requires-user-confirmation";
const limit = Number(args.get("limit") ?? 0);
const retryCountArg = Number(args.get("retries") ?? productionLlmRetryDelaysMs.length);
const retries = Number.isFinite(retryCountArg)
  ? Math.max(0, Math.min(productionLlmRetryDelaysMs.length, Math.trunc(retryCountArg)))
  : productionLlmRetryDelaysMs.length;
const onlyCase = args.get("case") ?? "";
const onlyTalk = args.get("talk") ?? "";
const onlyFrom = args.get("from") ?? "";
const reportPath = args.get("report") ?? "";
const showPrompt = flags.has("show-prompt");
const verbose = flags.has("verbose");
const dryRun = flags.has("dry-run");
const failFast = flags.has("fail-fast");
const condStatePatternLimit = 16;
const blockKeyByCanonicalId = new Map(scenario.talkBlocks.map((block) => [block.block, block.blockKey ?? block.block]));

if (live && !dryRun && !flags.has(paidApiConfirmationFlag)) {
  console.error(
    [
      "実 API を呼び出す LLM テストは課金が発生する可能性があるため、明示的な確認フラグが必要です。",
      "このテストは talk_flow.example を網羅するため、通常の固定ケースより呼び出し回数が多くなります。",
      "ユーザー確認を取ったうえで、次の長い引数を追加してください:",
      `  --${paidApiConfirmationFlag}`
    ].join("\n")
  );
  process.exit(1);
}

function loadDevVars() {
  const filePath = path.join(rootDir, ".dev.vars");
  if (!fs.existsSync(filePath)) {
    return;
  }
  const text = fs.readFileSync(filePath, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) {
      continue;
    }
    const [key, ...valueParts] = trimmed.split("=");
    if (process.env[key]) {
      continue;
    }
    const rawValue = valueParts.join("=").trim();
    process.env[key] = rawValue.replace(/^['"]|['"]$/g, "");
  }
}

function usageFromPayload(payload) {
  const usage = tokenUsageFromPayload(payload);
  return usage
    ? {
        inputTokens: usage.promptTokens,
        outputTokens: usage.completionTokens,
        totalTokens: usage.totalTokens,
        cachedTokens: usage.cachedTokens
      }
    : null;
}

function average(values) {
  const numbers = values.filter((value) => typeof value === "number");
  if (numbers.length === 0) {
    return null;
  }
  return numbers.reduce((sum, value) => sum + value, 0) / numbers.length;
}

function summarizeUsage(results) {
  const inputAverage = average(results.map((result) => result.inputTokens));
  const outputAverage = average(results.map((result) => result.outputTokens));
  const totalAverage = average(results.map((result) => result.totalTokens));
  const cachedAverage = average(results.map((result) => result.cachedTokens));
  const cachedTotal = results.reduce(
    (sum, result) => sum + (typeof result.cachedTokens === "number" ? result.cachedTokens : 0),
    0
  );
  return {
    calls: results.length,
    inputTokensAvg: inputAverage === null ? null : Math.round(inputAverage * 10) / 10,
    outputTokensAvg: outputAverage === null ? null : Math.round(outputAverage * 10) / 10,
    totalTokensAvg: totalAverage === null ? null : Math.round(totalAverage * 10) / 10,
    cachedTokensAvg: cachedAverage === null ? null : Math.round(cachedAverage * 10) / 10,
    cachedTokensTotal: cachedTotal
  };
}

function summarizeResults(results) {
  const summary = {
    passed: results.length,
    gameOver: 0,
    stay: 0,
    advance: 0
  };
  for (const result of results) {
    if (result.mode === "game_over") {
      summary.gameOver += 1;
    } else if (result.mode === "stay") {
      summary.stay += 1;
    } else {
      summary.advance += 1;
    }
  }
  return summary;
}

function summarizeRun(planned, results, failures) {
  return {
    planned,
    attempted: results.length + failures.length,
    passed: results.length,
    failed: failures.length,
    ...summarizeResults(results)
  };
}

function liveTimeoutMs() {
  const value = Number(process.env.LLM_TIMEOUT_MS ?? 5000);
  return Number.isFinite(value) && value > 0 ? Math.round(value) : 5000;
}

function liveRetryDelaysMs() {
  return productionLlmRetryDelaysMs.slice(0, retries);
}

function llmFailureMessage(failure) {
  return [
    failure.reason,
    failure.httpStatus ? `http=${failure.httpStatus}` : "",
    failure.errorCode ? `code=${failure.errorCode}` : "",
    failure.errorName ? `name=${failure.errorName}` : "",
    failure.errorMessage ? `message=${failure.errorMessage}` : ""
  ].filter(Boolean).join(" ");
}

function shouldAbortRun(error) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    failFast ||
    message.includes("LLM_API_KEY") ||
    message.includes("PERMISSION_DENIED") ||
    message.includes("http=401") ||
    message.includes("http=403")
  );
}

function stripAnsi(value) {
  return String(value).replace(/\x1B\[[0-9;]*m/g, "");
}

function failureMessage(error) {
  const message = stripAnsi(error instanceof Error ? error.message : String(error));
  if (error && typeof error === "object" && "actual" in error && "expected" in error) {
    return `${message.split("\n")[0]} actual=${JSON.stringify(error.actual)} expected=${JSON.stringify(error.expected)}`;
  }
  return message;
}

function failureRow(testCase, error) {
  const message = failureMessage(error);
  return {
    id: testCase.id,
    row: testCase.row,
    talk: testCase.talkId,
    from: testCase.fromId,
    expected: testCase.expectedLabel,
    actual: error && typeof error === "object" && "actualLabel" in error ? error.actualLabel : undefined,
    error: message.length > 240 ? `${message.slice(0, 237)}...` : message
  };
}

function fullFailureRow(testCase, error) {
  const promptInput = buildPromptInput(testCase);
  return {
    id: testCase.id,
    row: testCase.row,
    talk: testCase.talkId,
    from: testCase.fromId,
    fromKey: testCase.fromKey,
    sourceFrom: testCase.sourceFrom,
    stateValues: testCase.stateValues ?? {},
    input: testCase.input,
    expected: {
      ruleId: testCase.expectedRuleId,
      label: testCase.expectedLabel,
      mode: testCase.expectedMode
    },
    actual:
      error && typeof error === "object" && "actualRuleId" in error
        ? {
            ruleId: error.actualRuleId,
            label: error.actualLabel ?? null,
            afterGuardRuleId: error.afterGuardRuleId ?? null,
            afterGuardLabel: error.afterGuardLabel ?? null,
            decision: error.rawDecision ?? null
          }
        : null,
    error: failureMessage(error),
    promptInput
  };
}

function writeReportFile({ status, selectedCases, results, failures, detailedFailures, runtimeError }) {
  if (!reportPath) {
    return;
  }
  const report = {
    status,
    generatedAt: new Date().toISOString(),
    mode: dryRun ? "dry-run" : live ? "live" : "mock",
    filters: {
      case: onlyCase || null,
      talk: onlyTalk || null,
      from: onlyFrom || null,
      limit: limit > 0 ? limit : null,
      retries
    },
    summary: summarizeRun(selectedCases.length, results, failures),
    usage: live && !dryRun ? summarizeUsage(results) : null,
    results,
    failures: detailedFailures,
    runtimeError: runtimeError ? failureMessage(runtimeError) : null
  };
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`LLM talk_flow example report written: ${reportPath}`);
}

function cleanCasePart(value) {
  return String(value || "default")
    .replace(/[^a-zA-Z0-9_\u3040-\u30ff\u3400-\u9fff-]+/gu, "_")
    .slice(0, 48);
}

function ruleLabel(rule) {
  return rule.intent || "default";
}

function stableJson(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return JSON.stringify(value);
  }
  const sorted = {};
  for (const key of Object.keys(value).sort()) {
    sorted[key] = value[key];
  }
  return JSON.stringify(sorted);
}

function dedupeStateValues(values) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    const key = stableJson(value);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(value);
  }
  return result;
}

function mergeStateValues(left, right) {
  const merged = { ...left };
  for (const [key, value] of Object.entries(right)) {
    if (Object.prototype.hasOwnProperty.call(merged, key) && merged[key] !== value) {
      return null;
    }
    merged[key] = value;
  }
  return merged;
}

function combineStateValueSets(leftValues, rightValues) {
  const combined = [];
  for (const left of leftValues) {
    for (const right of rightValues) {
      const merged = mergeStateValues(left, right);
      if (merged) {
        combined.push(merged);
      }
    }
  }
  return dedupeStateValues(combined);
}

function findRegexLiteralEnd(source, startIndex) {
  let escaped = false;
  let inCharClass = false;
  for (let index = startIndex + 1; index < source.length; index += 1) {
    const char = source[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === "[" && !inCharClass) {
      inCharClass = true;
      continue;
    }
    if (char === "]" && inCharClass) {
      inCharClass = false;
      continue;
    }
    if (char === "/" && !inCharClass) {
      return index;
    }
  }
  return -1;
}

function parseRegexLiteralForWitness(input, startIndex) {
  const endIndex = findRegexLiteralEnd(input, startIndex);
  if (endIndex < 0) {
    throw new Error(`cond の正規表現リテラルが閉じていません: ${input}`);
  }
  const flags = input.slice(endIndex + 1).match(/^[a-z]*/iu)?.[0] ?? "";
  if (!/^[dgimsuvy]*$/u.test(flags)) {
    throw new Error(`cond の正規表現 flags が不正です: ${flags}: ${input}`);
  }
  const source = input.slice(startIndex + 1, endIndex);
  return {
    token: { type: "literal", value: { source, flags, regex: new RegExp(source, flags) } },
    endIndex: endIndex + 1 + flags.length
  };
}

function tokenizeCondForWitness(input) {
  const tokens = [];
  let index = 0;
  while (index < input.length) {
    const char = input[index] ?? "";
    const pair = input.slice(index, index + 2);
    if (/\s/u.test(char)) {
      index += 1;
      continue;
    }
    if (["&&", "||", "==", "!=", "=~", "!~"].includes(pair)) {
      tokens.push({ type: "operator", value: pair });
      index += 2;
      continue;
    }
    if (["!", "(", ")"].includes(char)) {
      tokens.push({ type: "operator", value: char });
      index += 1;
      continue;
    }
    if (char === "/") {
      const parsed = parseRegexLiteralForWitness(input, index);
      tokens.push(parsed.token);
      index = parsed.endIndex;
      continue;
    }
    if (char === "\"" || char === "'") {
      const quote = char;
      let value = "";
      index += 1;
      while (index < input.length && input[index] !== quote) {
        if (input[index] === "\\" && index + 1 < input.length) {
          value += input[index + 1];
          index += 2;
          continue;
        }
        value += input[index];
        index += 1;
      }
      if (input[index] !== quote) {
        throw new Error(`cond の文字列リテラルが閉じていません: ${input}`);
      }
      tokens.push({ type: "string", value });
      index += 1;
      continue;
    }
    const integerMatch = input.slice(index).match(/^-?\d+/u);
    if (integerMatch) {
      tokens.push({ type: "literal", value: Number.parseInt(integerMatch[0], 10) });
      index += integerMatch[0].length;
      continue;
    }
    const identifierMatch = input.slice(index).match(/^[a-zA-Z_][a-zA-Z0-9_:-]*/u);
    if (identifierMatch) {
      const value = identifierMatch[0];
      tokens.push(
        value === "true" || value === "false"
          ? { type: "literal", value: value === "true" }
          : { type: "identifier", value }
      );
      index += value.length;
      continue;
    }
    throw new Error(`cond の解釈できない文字です: ${char}: ${input}`);
  }
  return tokens;
}

function parseCondForWitness(input) {
  const tokens = tokenizeCondForWitness(input);
  let cursor = 0;
  const peek = (value) => {
    const token = tokens[cursor];
    if (!token) {
      return null;
    }
    return value ? token.type === "operator" && token.value === value : token;
  };
  const consume = (value) => {
    const token = peek(value);
    if (!token) {
      return null;
    }
    cursor += 1;
    return token;
  };

  function parsePrimary() {
    if (consume("(")) {
      const value = parseOr();
      if (!consume(")")) {
        throw new Error(`cond の括弧が閉じていません: ${input}`);
      }
      return value;
    }

    const token = tokens[cursor];
    if (!token) {
      throw new Error(`cond が途中で終わっています: ${input}`);
    }
    cursor += 1;
    if (token.type === "identifier") {
      return { kind: "identifier", id: token.value };
    }
    if (token.type === "string" || token.type === "literal") {
      return { kind: "literal", value: token.value };
    }
    throw new Error(`cond の値として使えない token です: ${token.value}: ${input}`);
  }

  function parseUnary() {
    if (consume("!")) {
      return { kind: "not", value: parseUnary() };
    }
    return parsePrimary();
  }

  function parseCompare() {
    let left = parseUnary();
    while (peek("==") || peek("!=") || peek("=~") || peek("!~")) {
      const operator = tokens[cursor].value;
      cursor += 1;
      left = { kind: "binary", operator, left, right: parseUnary() };
    }
    return left;
  }

  function parseAnd() {
    let left = parseCompare();
    while (consume("&&")) {
      left = { kind: "binary", operator: "&&", left, right: parseCompare() };
    }
    return left;
  }

  function parseOr() {
    let left = parseAnd();
    while (consume("||")) {
      left = { kind: "binary", operator: "||", left, right: parseAnd() };
    }
    return left;
  }

  const ast = parseOr();
  if (cursor !== tokens.length) {
    throw new Error(`cond の解釈できない token が残っています: ${tokens[cursor]?.value ?? ""}: ${input}`);
  }
  return ast;
}

function alternateValueForNotEqual(value) {
  if (typeof value === "boolean") {
    return !value;
  }
  if (typeof value === "number") {
    return value === 1 ? 2 : 1;
  }
  if (value === "未確認") {
    return "テスト太郎";
  }
  return `${String(value)}_以外`;
}

function witnessStatesForAst(node) {
  if (node.kind === "identifier") {
    return [{ [node.id]: true }];
  }
  if (node.kind === "literal") {
    return node.value ? [{}] : [];
  }
  if (node.kind === "not") {
    if (node.value.kind === "identifier") {
      return [{ [node.value.id]: false }];
    }
    throw new Error("複合条件への ! は witness 展開未対応です。");
  }

  if (node.operator === "&&") {
    return combineStateValueSets(witnessStatesForAst(node.left), witnessStatesForAst(node.right));
  }
  if (node.operator === "||") {
    return dedupeStateValues([...witnessStatesForAst(node.left), ...witnessStatesForAst(node.right)]);
  }
  if (node.operator === "=~" || node.operator === "!~") {
    return [{}];
  }

  const left = node.left;
  const right = node.right;
  if (left.kind === "identifier" && right.kind === "literal") {
    return [{ [left.id]: node.operator === "==" ? right.value : alternateValueForNotEqual(right.value) }];
  }
  if (left.kind === "literal" && right.kind === "identifier") {
    return [{ [right.id]: node.operator === "==" ? left.value : alternateValueForNotEqual(left.value) }];
  }
  throw new Error("identifier と literal の比較以外は witness 展開未対応です。");
}

function condWitnessStates(cond, playerInput = "") {
  const trimmed = String(cond ?? "").trim();
  if (!trimmed) {
    return [{}];
  }
  const states = witnessStatesForAst(parseCondForWitness(trimmed)).filter((stateValues) =>
    evaluateConditionExpression(trimmed, { ...stateValues, player_input: playerInput })
  );
  assert.ok(states.length > 0, `cond を満たす witness state を作れません: ${trimmed}`);
  return dedupeStateValues(states);
}

function booleanStateIdsInCond(cond) {
  return [...new Set(String(cond ?? "").match(/[a-zA-Z_][a-zA-Z0-9_:-]*/gu) ?? [])]
    .filter((id) => loadedScenario.stateVariableDefinitions[id]?.type === "boolean");
}

function selectableRegexWitnessState(talk, node, rule, initialState) {
  const rules = [...talk.commonRules, ...node.rules].sort((left, right) => left.order - right.order);
  const pending = [initialState];
  const seen = new Set();
  while (pending.length) {
    const stateValues = pending.shift();
    const key = stableJson(stateValues);
    if (seen.has(key)) continue;
    seen.add(key);
    const effectiveState = { ...loadedScenario.stateVariables, ...stateValues };
    if (!evaluateConditionExpression(rule.cond, { ...effectiveState, player_input: rule.example })) continue;
    const activeRules = renderTalkRuleCriteria(rules, effectiveState).filter((candidate) =>
      evaluateConditionExpression(candidate.cond, { ...effectiveState, player_input: rule.example })
    );
    const selected = selectDeterministicRule(activeRules, rule.example);
    if (selected?.id === rule.id) return stateValues;
    if (!selected) continue;
    for (const id of booleanStateIdsInCond(selected.cond)) {
      pending.push({ ...stateValues, [id]: !Boolean(stateValues[id]) });
    }
  }
  throw new Error(`正規表現 rule を選択できるcond状態を作れません: ${talk.id}/${node.id}/${rule.id}`);
}

function exampleStateVariants(talk, node, rule) {
  const states = condWitnessStates(rule.cond, rule.example);
  if (rule.type !== "match" && rule.type !== "secret") return states;
  return dedupeStateValues(states.map((state) => selectableRegexWitnessState(talk, node, rule, state)));
}

function stateCaseLabel(stateValues, index) {
  const keys = Object.keys(stateValues).sort();
  if (keys.length === 0) {
    return "";
  }
  const body = keys.map((key) => `${key}=${String(stateValues[key])}`).join("_");
  return cleanCasePart(`cond${index + 1}_${body}`);
}

function statePatternsForRules(talk, node) {
  const rules = [...talk.commonRules, ...node.rules];
  return dedupeStateValues([
    {},
    ...rules.flatMap((rule) => condWitnessStates(rule.cond, rule.example))
  ]);
}

function assertCondStatePatternLimit(talk, node) {
  const patterns = statePatternsForRules(talk, node);
  assert.ok(
    patterns.length <= condStatePatternLimit,
    [
      `talk_flow cond 状態パターンが ${condStatePatternLimit} を超えています: ${talk.id}/${node.id}`,
      `patterns=${patterns.length}`,
      ...patterns.map((pattern, index) => `${index + 1}: ${stableJson(pattern)}`)
    ].join("\n")
  );
}

function comparableRuleOutcome(rule) {
  if (!rule) {
    return null;
  }
  return {
    mode: rule.mode || "advance",
    outputSteps: Array.isArray(rule.outputSteps) ? rule.outputSteps : [],
    set: Array.isArray(rule.set) ? rule.set : []
  };
}

function sameRuleOutcome(left, right) {
  return JSON.stringify(comparableRuleOutcome(left)) === JSON.stringify(comparableRuleOutcome(right));
}

assert.equal(
  sameRuleOutcome(
    { mode: "stay", outputSteps: [{ kind: "input", action: "hide" }], set: [] },
    { mode: "stay", outputSteps: [{ kind: "input", action: "disable" }], set: [] }
  ),
  false,
  "入力actionが異なるruleを同じ応答として扱わない"
);

function talkById(talkId) {
  const talk = scenario.talks.find((item) => item.id === talkId);
  assert.ok(talk, `talk が見つかりません: ${talkId}`);
  return talk;
}

function nodeById(talk, fromId) {
  const node = talk.nodes.find((item) => item.id === fromId);
  assert.ok(node, `talk node が見つかりません: ${talk.id}/${fromId}`);
  return node;
}

function buildPromptInput(testCase) {
  const { context } = talkTestContext(loadedScenario, {
    talkId: testCase.talkId,
    from: testCase.fromId,
    input: testCase.input,
    stateValues: testCase.stateValues
  });
  assert.ok(context, `LLM 入力 context が作れません: ${testCase.id}`);
  if (testCase.regexCriteria) {
    assert.equal(
      selectDeterministicRule(context.activeRules, testCase.input)?.id,
      testCase.expectedRuleId,
      `正規表現 criteria が期待 rule を選びません: ${testCase.id}`
    );
    assert.equal(
      context.input.rules.some((rule) => rule.id === testCase.expectedRuleId),
      false,
      `正規表現 criteria の rule が LLM 候補に残っています: ${testCase.id}`
    );
  } else {
    assert.ok(context.input.rules.some((rule) => rule.id === testCase.expectedRuleId), `期待 rule が候補にありません: ${testCase.id}`);
  }
  return context.input;
}

function activeRuntimeRuleById(testCase, ruleId) {
  const talk = talkById(testCase.talkId);
  const node = nodeById(talk, testCase.fromId);
  const stateValues = { ...loadedScenario.stateVariables, ...testCase.stateValues };
  const activeRules = [...talk.commonRules, ...node.rules]
    .sort((a, b) => a.order - b.order)
    .filter((rule) => evaluateConditionExpression(rule.cond, { ...stateValues, player_input: testCase.input }));
  return activeRules.find((rule) => rule.id === ruleId) ?? null;
}

function isEquivalentExpectedOutcome(testCase, actualRuleId) {
  if (actualRuleId === testCase.expectedRuleId) {
    return true;
  }
  const expectedRule = activeRuntimeRuleById(testCase, testCase.expectedRuleId);
  const actualRule = activeRuntimeRuleById(testCase, actualRuleId);
  return Boolean(expectedRule && actualRule && sameRuleOutcome(expectedRule, actualRule));
}

function assertPromptDoesNotLeakImplementationDetails(input, requireContext = true) {
  const messages = buildTalkFlowLlmMessages(input);
  const joined = messages.map((message) => message.content).join("\n");
  const userMessage = messages.find((message) => message.role === "user");
  assert.ok(userMessage, "user prompt が必要です");
  assert.equal(userMessage.content.includes("\n"), false, "LLM prompt の JSON payload は compact にする");
  const userPayload = JSON.parse(userMessage.content);
  assert.equal(typeof userPayload.current_context, "string", "default criteria は current_context として渡す");
  if (requireContext) assert.ok(userPayload.current_context, "current_context は空にしない");
  assert.ok(Array.isArray(userPayload.recent_messages), "recent_messages は配列で渡す");
  assert.ok(userPayload.recent_messages.length <= 4, "recent_messages は from 末尾2件と表示済み会話末尾2件までにする");
  assert.equal("talk_id" in userPayload, false, "LLM prompt に内部 talk_id は渡さない");
  assert.equal("kind" in userPayload, false, "LLM prompt に内部 kind は渡さない");
  assert.equal("current_from_id" in userPayload, false, "LLM prompt に内部 from ID は渡さない");
  assert.equal("default_rule_id" in userPayload, false, "default rule は候補内の default flag だけで示す");
  assert.deepEqual(
    Object.keys(userPayload),
    ["task", "current_context", "candidate_rules", "recent_messages", "player_input"],
    "固定に近い候補情報を先、ターン固有の入力を後に置く"
  );
  const defaultCandidate = userPayload.candidate_rules.find((rule) => rule.default === true);
  assert.ok(defaultCandidate, "default rule は候補に含める");
  assert.ok(
    defaultCandidate.criteria.includes("current_context"),
    "default candidate criteria は current_context 参照に留める"
  );
  for (const rule of userPayload.candidate_rules) {
    assert.equal("from" in rule, false, "candidate rule の from は LLM prompt に渡さない");
    assert.equal("mode" in rule, false, "candidate rule の mode は LLM prompt に渡さない");
  }
  assert.equal(joined.includes("\"match\""), false, "match JSON は rule 選択 prompt に渡さない");
  assert.equal(joined.includes("\"next\""), false, "next block ID は LLM prompt に渡さない");
  assert.equal(joined.includes("\"example\""), false, "test 用 example は LLM prompt に渡さない");
  assert.equal(joined.includes("talk_blocks"), false, "talk_blocks 本文は LLM prompt に渡さない");
}

function allExampleCases() {
  const cases = [];

  for (const talk of scenario.talks) {
    for (const rule of talk.commonRules) {
      if (!rule.example) {
        continue;
      }
      for (const node of talk.nodes) {
        assertCondStatePatternLimit(talk, node);
        const regexCriteria = rule.type === "match" || rule.type === "secret";
        const baseId = `${talk.id}:${node.id}:row${rule.order}:${cleanCasePart(ruleLabel(rule))}`;
        const stateVariants = exampleStateVariants(talk, node, rule);
        stateVariants.forEach((stateValues, index) => {
          const stateLabel = stateVariants.length > 1 ? stateCaseLabel(stateValues, index) : "";
          cases.push({
            id: stateLabel ? `${baseId}:${stateLabel}` : baseId,
            baseId,
            talkId: talk.id,
            fromId: node.id,
            input: rule.example,
            expectedRuleId: rule.id,
            expectedLabel: ruleLabel(rule),
            expectedMode: rule.mode || "advance",
            sourceFrom: rule.from,
            fromKey: blockKeyByCanonicalId.get(node.id) ?? node.id,
            row: rule.order,
            regexCriteria,
            stateValues
          });
        });
      }
    }

    for (const node of talk.nodes) {
      assertCondStatePatternLimit(talk, node);
      for (const rule of node.rules) {
        if (!rule.example) {
          continue;
        }
        const regexCriteria = rule.type === "match" || rule.type === "secret";
        const baseId = `${talk.id}:${node.id}:row${rule.order}:${cleanCasePart(ruleLabel(rule))}`;
        const stateVariants = exampleStateVariants(talk, node, rule);
        stateVariants.forEach((stateValues, index) => {
          const stateLabel = stateVariants.length > 1 ? stateCaseLabel(stateValues, index) : "";
          cases.push({
            id: stateLabel ? `${baseId}:${stateLabel}` : baseId,
            baseId,
            talkId: talk.id,
            fromId: node.id,
            input: rule.example,
            expectedRuleId: rule.id,
            expectedLabel: ruleLabel(rule),
            expectedMode: rule.mode || "advance",
            sourceFrom: rule.from,
            fromKey: blockKeyByCanonicalId.get(node.id) ?? node.id,
            row: rule.order,
            regexCriteria,
            stateValues
          });
        });
      }
    }
  }

  return cases;
}

function mockDecisionFor(testCase) {
  return {
    rule_id: testCase.expectedRuleId,
    confidence: testCase.expectedMode === "game_over" ? 0.98 : 0.86,
    reason_code:
      testCase.expectedLabel === "default"
        ? "default_unclear"
        : "matched_intent"
  };
}

async function callLiveLlm(input, testCase) {
  loadDevVars();
  const apiKey = process.env.LLM_API_KEY;
  const baseUrl = (process.env.LLM_BASE_URL ?? "https://generativelanguage.googleapis.com/v1beta/openai").replace(/\/$/, "");
  const model = process.env.LLM_MODEL ?? "gemini-3.1-flash-lite";
  assert.ok(apiKey, "LLM_API_KEY がありません。.dev.vars または環境変数に設定してください。");

  const endpoint = `${baseUrl}/chat/completions`;
  const requestInit = {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json"
    },
    body: JSON.stringify(buildTalkFlowLlmChatCompletionBody(model, input))
  };

  const llmResult = await runLlmWithRetry(
    async () => {
      const fetched = await fetchLlmJsonPayloadAttempt(endpoint, requestInit, liveTimeoutMs());
      if (!fetched.ok) {
        return fetched;
      }

      const payload = fetched.value.payload;
      const content =
        payload && typeof payload === "object"
          ? payload.choices?.[0]?.message?.content
          : undefined;
      if (typeof content !== "string") {
        return {
          ok: false,
          retriable: true,
          failure: {
            reason: "invalid_provider_response",
            errorCode: "invalid_provider_response",
            httpStatus: fetched.httpStatus
          },
          httpStatus: fetched.httpStatus,
          payload
        };
      }

      let decision;
      try {
        decision = JSON.parse(content);
      } catch {
        return {
          ok: false,
          retriable: true,
          failure: {
            reason: "invalid_json",
            errorCode: "invalid_json",
            httpStatus: fetched.httpStatus
          },
          httpStatus: fetched.httpStatus,
          payload
        };
      }

      return {
        ok: true,
        value: {
          decision,
          usage: usageFromPayload(payload)
        },
        httpStatus: fetched.httpStatus,
        payload
      };
    },
    {
      retryDelaysMs: liveRetryDelaysMs(),
      onRetry: (event) => {
        const message = event.errorMessage ?? event.errorCode ?? event.reason;
        console.warn(`${testCase.id}: transient LLM error, retry ${event.retry}/${retries} after ${event.waitMs}ms: ${message}`);
      }
    }
  );

  const result = llmResult.result;
  if (!result.ok) {
    throw new Error(`${testCase.id}: LLM API error after ${llmResult.attempts} attempt(s): ${llmFailureMessage(result.failure)}`);
  }

  return result.value;
}

async function runCase(testCase) {
  const input = buildPromptInput(testCase);
  assertPromptDoesNotLeakImplementationDetails(input, !testCase.regexCriteria);

  if (testCase.regexCriteria) {
    return {
      id: testCase.id,
      row: testCase.row,
      talk: testCase.talkId,
      from: testCase.fromId,
      expected: testCase.expectedLabel,
      mode: testCase.expectedMode,
      confidence: null,
      regex: true
    };
  }

  const schema = talkFlowLlmResponseSchema(input.rules.map((rule) => rule.id));
  assert.deepEqual(schema.properties.rule_id.enum, input.rules.map((rule) => rule.id));
  assert.equal(schema.additionalProperties, false);

  if (showPrompt) {
    console.log(`\n--- ${testCase.id} prompt ---`);
    console.log(JSON.stringify(buildTalkFlowLlmChatCompletionBody("<model>", input), null, 2));
  }

  const expectedRule = input.rules.find((rule) => rule.id === testCase.expectedRuleId);
  assert.ok(expectedRule, `期待 rule が候補に存在しません: ${testCase.id}`);

  if (dryRun) {
    return {
      id: testCase.id,
      row: testCase.row,
      talk: testCase.talkId,
      from: testCase.fromId,
      expected: testCase.expectedLabel,
      mode: expectedRule.mode || "advance",
      confidence: null,
      dryRun: true
    };
  }

  const liveResult = live ? await callLiveLlm(input, testCase) : null;
  const rawDecision = liveResult?.decision ?? mockDecisionFor(testCase);
  if (!isEquivalentExpectedOutcome(testCase, rawDecision.rule_id)) {
    const actualRule = input.rules.find((rule) => rule.id === rawDecision.rule_id);
    const error = new Error(`${testCase.id}: LLM が期待 rule_id を選びませんでした`);
    error.actualRuleId = rawDecision.rule_id;
    error.actualLabel = actualRule ? ruleLabel(actualRule) : null;
    error.rawDecision = rawDecision;
    throw error;
  }

  const selected = selectTalkFlowRuleFromLlmDecision(rawDecision, input);
  if (!isEquivalentExpectedOutcome(testCase, selected.ruleId)) {
    const actualRule = input.rules.find((rule) => rule.id === rawDecision.rule_id);
    const afterGuardRule = input.rules.find((rule) => rule.id === selected.ruleId);
    const error = new Error(`${testCase.id}: confidence / schema guard 後の選択が期待と違います`);
    error.actualRuleId = rawDecision.rule_id;
    error.actualLabel = actualRule ? ruleLabel(actualRule) : null;
    error.afterGuardRuleId = selected.ruleId;
    error.afterGuardLabel = afterGuardRule ? ruleLabel(afterGuardRule) : null;
    error.rawDecision = rawDecision;
    throw error;
  }
  const selectedRule = input.rules.find((rule) => rule.id === selected.ruleId);
  assert.ok(selectedRule, `選択 rule が候補に存在しません: ${testCase.id}`);

  return {
    id: testCase.id,
    row: testCase.row,
    talk: testCase.talkId,
    from: testCase.fromId,
    expected: testCase.expectedLabel,
    mode: selectedRule.mode || "advance",
    confidence: rawDecision.confidence,
    ...(liveResult?.usage
      ? {
          inputTokens: liveResult.usage.inputTokens,
          outputTokens: liveResult.usage.outputTokens,
          totalTokens: liveResult.usage.totalTokens,
          cachedTokens: liveResult.usage.cachedTokens
        }
      : {})
  };
}

const selectedCases = allExampleCases()
  .filter((testCase) => !onlyCase || testCase.id === onlyCase || testCase.baseId === onlyCase)
  .filter((testCase) => !onlyTalk || testCase.talkId === onlyTalk)
  .filter((testCase) => !onlyFrom || testCase.fromId === onlyFrom || testCase.sourceFrom === onlyFrom || testCase.fromKey === onlyFrom)
  .slice(0, limit > 0 ? limit : undefined);

assert.ok(selectedCases.length > 0, "実行対象の test case がありません。");

const results = [];
const failures = [];
const detailedFailures = [];
try {
  for (const testCase of selectedCases) {
    try {
      results.push(await runCase(testCase));
    } catch (error) {
      failures.push(failureRow(testCase, error));
      detailedFailures.push(fullFailureRow(testCase, error));
      if (shouldAbortRun(error)) {
        break;
      }
    }
  }

  if (verbose) {
    console.table(results);
  }
  console.table([summarizeRun(selectedCases.length, results, failures)]);
  if (failures.length > 0) {
    console.table(failures);
  }
  if (live && !dryRun) {
    console.table([summarizeUsage(results)]);
  }
  writeReportFile({
    status: failures.length > 0 ? "failed" : "passed",
    selectedCases,
    results,
    failures,
    detailedFailures
  });

  if (failures.length > 0) {
    console.error(`LLM talk_flow example ${dryRun ? "dry run" : live ? "live" : "mock"} tests completed with failures`);
    process.exit(1);
  }

  console.log(
    dryRun
      ? `LLM talk_flow example dry run passed (${results.length} planned calls)`
      : live
        ? `LLM talk_flow example live tests passed (${results.length} calls)`
        : "LLM talk_flow example mock tests passed"
  );
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`LLM talk_flow example ${dryRun ? "dry run" : live ? "live" : "mock"} test failed: ${message}`);
  writeReportFile({
    status: "error",
    selectedCases,
    results,
    failures,
    detailedFailures,
    runtimeError: error
  });
  if (live && message.includes("PERMISSION_DENIED")) {
    console.error("Gemini API key、AI Studio の paid plan / billing、API key restriction、または project access を確認してください。");
  }
  process.exit(1);
}
