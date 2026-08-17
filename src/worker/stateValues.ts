import { applyStateAssignments, type ConditionStateDefinition } from "../shared/condition.ts";
import { parseStoryDate } from "../shared/storyDate.ts";

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

export function setStateValue(
  defaults: StateValues,
  overrides: StateValues,
  id: string,
  value: StateValue,
  definitions?: Record<string, ConditionStateDefinition>
) {
  if (!(id in defaults)) {
    throw new Error(`未定義のstate variableです: ${id}`);
  }
  if (typeof defaults[id] !== typeof value) {
    throw new Error(`state variableの型が一致しません: ${id}`);
  }
  if (definitions?.[id]?.type === "integer" && !Number.isInteger(value)) {
    throw new Error(`state variableは整数にしてください: ${id}`);
  }
  if (definitions?.[id]?.type === "enum" && !definitions[id].values?.includes(String(value))) {
    throw new Error(`state variableがenumのvaluesにありません: ${id}`);
  }
  validateSystemStateValue(id, value);
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
  variables: Record<string, string> = {},
  definitions?: Record<string, ConditionStateDefinition>
) {
  const assigned = applyStateAssignments(
    effectiveStateValues(defaults, overrides),
    assignments,
    variables,
    definitions ? new Map(Object.entries(definitions)) : undefined
  );
  for (const [id, value] of Object.entries(assigned)) {
    if (id in defaults && typeof defaults[id] !== typeof value) {
      throw new Error(`state variableの型が一致しません: ${id}`);
    }
    if (id in defaults) {
      validateSystemStateValue(id, value);
    }
  }
  return compactStateValues(defaults, assigned);
}

function validateSystemStateValue(id: string, value: StateValue) {
  if (id === "os_date" && (typeof value !== "string" || !parseStoryDate(value))) {
    throw new Error("os_dateは YYYY-MM-DD 形式の実在する日付にしてください。");
  }
  if (id === "os_time_label" && (typeof value !== "string" || !value.trim())) {
    throw new Error("os_time_labelを空にはできません。");
  }
}
