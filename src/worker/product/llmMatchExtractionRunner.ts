import {
  selectTalkFlowMatchGroupsFromAttempts,
  type TalkFlowMatchOutput,
  type TalkFlowMatchSelectionMode,
  type TalkFlowMatchSpec
} from "./talkFlowMatchExtraction.ts";

export type LlmMatchExtractionSampleResult =
  | { status: "ready"; output: TalkFlowMatchOutput }
  | { status: "provider_error" }
  | { status: "invalid_response" };

export type LlmMatchExtractionRunResult =
  | {
      ok: true;
      values: TalkFlowMatchOutput;
      matchGroups: Record<string, string>;
      score: number;
      maxScore: number;
      outputs: TalkFlowMatchOutput[];
      sampleCount: number;
    }
  | {
      ok: false;
      reason: "provider_error" | "invalid_response" | "no_match";
      outputs: TalkFlowMatchOutput[];
      sampleCount: number;
    };

// 標本取得順と合意時点を固定し、通信方法だけを呼出側へ委ねる。
export async function runTalkFlowMatchExtractionSamples(
  spec: TalkFlowMatchSpec,
  stateUpdates: readonly string[],
  sample: (sampleIndex: number) => Promise<LlmMatchExtractionSampleResult>,
  options: { maxSamples?: number; selectionMode?: TalkFlowMatchSelectionMode } = {}
): Promise<LlmMatchExtractionRunResult> {
  const selectionMode = options.selectionMode ?? "stable";
  const minSamples = selectionMode === "once" ? 1 : 2;
  const requestedMaxSamples = Number.isFinite(options.maxSamples) ? Math.round(options.maxSamples ?? 5) : 5;
  const maxSamples = Math.max(minSamples, Math.min(5, requestedMaxSamples));
  const outputs: TalkFlowMatchOutput[] = [];
  let invalidResponses = 0;
  let sampleIndex = 0;

  while (sampleIndex < maxSamples) {
    const batchSize = selectionMode === "stable" && sampleIndex === 0 ? 2 : 1;
    const batch = Array.from({ length: Math.min(batchSize, maxSamples - sampleIndex) }, (_, index) => (
      sample(sampleIndex + index + 1)
    ));
    sampleIndex += batch.length;

    const results = await Promise.all(batch);
    for (const result of results) {
      if (result.status === "provider_error") {
        return { ok: false, reason: "provider_error", outputs, sampleCount: sampleIndex };
      }
      if (result.status === "invalid_response") {
        invalidResponses += 1;
      } else {
        outputs.push(result.output);
      }
    }

    const selected = selectTalkFlowMatchGroupsFromAttempts(spec, outputs, stateUpdates, {
      acceptPartial: selectionMode === "stable" && sampleIndex >= maxSamples,
      mode: selectionMode
    });
    if (selected.ok) {
      return {
        ok: true,
        values: selected.values,
        matchGroups: selected.matchGroups,
        score: selected.score,
        maxScore: selected.maxScore,
        outputs,
        sampleCount: sampleIndex
      };
    }
  }

  return outputs.length === 0 && invalidResponses > 0
    ? { ok: false, reason: "invalid_response", outputs, sampleCount: sampleIndex }
    : { ok: false, reason: "no_match", outputs, sampleCount: sampleIndex };
}
