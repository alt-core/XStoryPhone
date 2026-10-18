import type { GeneratedAudioDefinition } from "../../shared/scenario.ts";
import { projectGeneratedAudioProviders } from "../../project/generatedAudioProviders.ts";

export type GeneratedAudioJob = {
  id: string;
  audioId: string;
  externalJobId: string | null;
  outputKey: string | null;
  status: "queued" | "running" | "ready" | "failed";
  createdAt: string;
};

export type GeneratedAudioProviderResult = {
  status: "queued" | "running" | "ready" | "failed";
  externalJobId?: string;
  outputKey?: string;
  errorCode?: string;
};

export type GeneratedAudioRequestBudget = {
  // 通信上限・再試行待機をこの絶対期限以内に収め、signalによる中断も尊重する。
  deadlineMs: number;
  signal: AbortSignal;
};

// 受付不明の依頼は再投入せず、次の状態取得でproviderの照合・期限判定へ渡す。
export const GENERATED_AUDIO_ACCEPTANCE_UNKNOWN_ERROR_CODE = "request_acceptance_unknown";

export class GeneratedAudioRequestDeferredError extends Error {
  // 送信前の見送りと、送信後に受付結果を確認できない中断を区別する。
  readonly reason: "not_sent" | "acceptance_unknown";
  constructor(reason: "not_sent" | "acceptance_unknown") {
    super(`generated_audio_request_deferred:${reason}`);
    this.name = "GeneratedAudioRequestDeferredError";
    this.reason = reason;
  }
}

export type GeneratedAudioProvider = {
  id: string;
  // 通信を始めるために必要な残り時間。通信上限と再試行待機の管理はproviderが担う。
  minimumRequestBudgetMs?: { enqueue?: number; reconcile?: number };
  enqueue(input: {
    definition: GeneratedAudioDefinition;
    inputText: string;
    jobId: string;
    createdAt: string;
    requestBudget?: GeneratedAudioRequestBudget;
  }): Promise<GeneratedAudioProviderResult>;
  reconcile(input: {
    definition: GeneratedAudioDefinition;
    // 受付不明では外部IDがnullのまま渡る。新規投入せず、job.idで照合するか失敗を返す。
    job: GeneratedAudioJob;
    requestBudget?: GeneratedAudioRequestBudget;
  }): Promise<GeneratedAudioProviderResult>;
};

const staticProvider: GeneratedAudioProvider = {
  id: "static",
  async enqueue({ definition }) {
    return { status: "ready", outputKey: definition.staticUrl };
  },
  async reconcile({ definition }) {
    return { status: "ready", outputKey: definition.staticUrl };
  }
};

export function generatedAudioProvider(id: string) {
  return [staticProvider, ...projectGeneratedAudioProviders].find((provider) => provider.id === id) ?? null;
}
