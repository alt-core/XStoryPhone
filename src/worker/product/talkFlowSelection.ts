export type SelectableTalkFlowRule = {
  id: string;
  order: number;
  from: string;
  isDefault: boolean;
  cond: string;
  match?: string;
};

export function orderedTalkFlowRules<T extends SelectableTalkFlowRule>(
  commonRules: readonly T[],
  nodeRules: readonly T[]
) {
  return [...commonRules, ...nodeRules].sort((a, b) => a.order - b.order);
}
