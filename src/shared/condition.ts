import {
  evaluateConditionExpression,
  validateConditionExpression as validateCanonicalConditionExpression,
  type ConditionStateDefinition
} from "./conditionExpression.ts";
import { applySetStatements, parseSetStatements, validateSetStatements } from "./setExpression.ts";

export type { ConditionStateDefinition, ConditionStateType } from "./conditionExpression.ts";

export function evaluateCondition(expression: string, state: Record<string, unknown>) {
  return evaluateConditionExpression(expression, state);
}

export function validateConditionExpression(expression: string, states: ReadonlyMap<string, ConditionStateDefinition>) {
  return validateCanonicalConditionExpression(expression, states);
}

export function applyStateAssignments(
  state: Record<string, string | number | boolean>,
  assignments: readonly string[],
  variables: Record<string, string> = {},
  definitions?: ReadonlyMap<string, ConditionStateDefinition>
) {
  const states = definitions ?? new Map(Object.entries(state).map(([id, value]) => [id, {
    type: typeof value === "boolean" ? "boolean" : typeof value === "number" ? "integer" : "string"
  } as ConditionStateDefinition]));
  const result = applySetStatements(assignments, states, state, { match: variables });
  if (result.errors.length) throw new Error(result.errors[0]);
  return result.stateValues as Record<string, string | number | boolean>;
}

export function validateStateAssignments(
  assignments: readonly string[],
  definitions: ReadonlyMap<string, ConditionStateDefinition>,
  matchIds: ReadonlySet<string> = new Set()
) {
  const errors = validateSetStatements(assignments, definitions);
  const parsed = parseSetStatements(assignments);
  for (const statement of parsed.statements) {
    if (typeof statement.value !== "string") continue;
    const reference = /^\$match\.([A-Za-z_][A-Za-z0-9_]*)$/u.exec(statement.value)?.[1];
    if (reference && !matchIds.has(reference)) {
      errors.push(`setが未定義のmatch値を参照しています: ${reference}`);
    }
  }
  return errors;
}

export function renderTemplate(template: string, formatEnv: Record<string, string>) {
  return template.replace(/\{\{([a-zA-Z0-9_]+)\}\}/g, (_, key: string) => formatEnv[key] ?? "");
}
