import {
  parseTalkFlowMatchOutput,
  parseTalkFlowMatchSpec,
  selectTalkFlowMatchGroupsFromAttempts,
  type TalkFlowMatchItem,
  type TalkFlowMatchOutput,
  type TalkFlowMatchSpec
} from "../worker/product/talkFlowMatchExtraction.ts";

export type TalkMatchItem = TalkFlowMatchItem;
export type TalkMatchSpec = TalkFlowMatchSpec;
export type TalkMatchOutput = TalkFlowMatchOutput;

export function parseTalkMatchSpec(raw: string) {
  return parseTalkFlowMatchSpec(raw);
}

export function parseTalkMatchOutput(raw: unknown, spec: TalkMatchSpec) {
  const result = parseTalkFlowMatchOutput(raw, spec);
  return result.ok ? result.output : null;
}

export function selectTalkMatch(
  spec: TalkMatchSpec,
  outputs: readonly TalkMatchOutput[],
  assignments: readonly string[],
  acceptPartial = false
) {
  const result = selectTalkFlowMatchGroupsFromAttempts(spec, outputs, assignments, { acceptPartial });
  return result.ok
    ? { ok: true as const, values: result.values, matchGroups: result.matchGroups }
    : { ok: false as const };
}
