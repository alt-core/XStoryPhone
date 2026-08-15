import { applyStateAssignments } from "../shared/condition.ts";

export type StateValue = string | number | boolean;
export type StateValues = Record<string, StateValue>;

export function effectiveStateValues(defaults: StateValues, overrides: StateValues): StateValues {
  return { ...defaults, ...overrides };
}

export function compactStateValues(defaults: StateValues, values: StateValues): StateValues {
  return Object.fromEntries(
    Object.entries(values).filter(([id, value]) => id in defaults && !Object.is(defaults[id], value))
  );
}

export function stateValue(defaults: StateValues, overrides: StateValues, id: string) {
  return Object.prototype.hasOwnProperty.call(overrides, id) ? overrides[id] : defaults[id];
}

export function setStateValue(defaults: StateValues, overrides: StateValues, id: string, value: StateValue) {
  if (!(id in defaults)) {
    throw new Error(`未定義のstate variableです: ${id}`);
  }
  if (typeof defaults[id] !== typeof value) {
    throw new Error(`state variableの型が一致しません: ${id}`);
  }
  const next = { ...overrides };
  if (Object.is(defaults[id], value)) {
    delete next[id];
  } else {
    next[id] = value;
  }
  return next;
}

export function applyCompactStateAssignments(
  defaults: StateValues,
  overrides: StateValues,
  assignments: readonly string[],
  variables: Record<string, string> = {}
) {
  const assigned = applyStateAssignments(effectiveStateValues(defaults, overrides), assignments, variables);
  for (const [id, value] of Object.entries(assigned)) {
    if (id in defaults && typeof defaults[id] !== typeof value) {
      throw new Error(`state variableの型が一致しません: ${id}`);
    }
  }
  return compactStateValues(defaults, assigned);
}
