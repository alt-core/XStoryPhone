import type { PublicGeneratedAudioState } from "../../shared/scenario.ts";
import type { AppStore, GeneratedAudioJob } from "../../server/store.ts";
import {
  GENERATED_AUDIO_ACCEPTANCE_UNKNOWN_ERROR_CODE, GeneratedAudioRequestDeferredError,
  generatedAudioProvider, type GeneratedAudioProvider, type GeneratedAudioProviderResult, type GeneratedAudioRequestBudget
} from "../providers/generatedAudio.ts";
import type { ScenarioRuntime } from "../scenarioRuntime.ts";
// 定義はこの実行単位に閉じ込め、別プレイヤーの処理と共有変更しない。
export function createGeneratedAudioRuntime(runtime: Pick<ScenarioRuntime,"workerScenario">, options: { requestDeadlineMs?: number } = {}) {
  const requestDeadlineMs = Number.isFinite(options.requestDeadlineMs) ? options.requestDeadlineMs : undefined;
  const deferredJobs = new Set<string>();
  type ProviderOutcome = { kind: "result"; result: GeneratedAudioProviderResult }
    | { kind: "deferred"; reason?: "not_sent" | "acceptance_unknown" };

  async function callProvider(provider: GeneratedAudioProvider, operation: "enqueue" | "reconcile", playerId: string, job: GeneratedAudioJob,
    call: (requestBudget?: GeneratedAudioRequestBudget) => Promise<GeneratedAudioProviderResult>): Promise<ProviderOutcome> {
    const key = `${playerId}\0${job.id}`;
    if (deferredJobs.has(key) || (operation === "enqueue" && job.errorCode === GENERATED_AUDIO_ACCEPTANCE_UNKNOWN_ERROR_CODE)) {
      return { kind: "deferred" };
    }
    // 固定音声は外部通信をしないため、要求期限にかかわらず即座に利用可能にする。
    const deadlineMs = provider.id === "static" ? undefined : requestDeadlineMs;
    const startedAt = Date.now();
    const remainingMs = deadlineMs === undefined ? undefined : deadlineMs - startedAt;
    const declaredMinimum = provider.minimumRequestBudgetMs?.[operation];
    const minimumMs = typeof declaredMinimum === "number" && Number.isFinite(declaredMinimum) ? Math.max(0, declaredMinimum) : 0;
    if (remainingMs !== undefined && (remainingMs <= 0 || remainingMs < minimumMs)) {
      deferredJobs.add(key);
      console.log("[generated_audio:deferred]", { audioId: job.audioId, provider: provider.id, operation, reason: "insufficient_budget", remainingMs });
      return { kind: "deferred", reason: "not_sent" };
    }
    const controller = deadlineMs === undefined ? undefined : new AbortController();
    const timer = controller && remainingMs !== undefined
      ? setTimeout(() => controller.abort(new DOMException("生成音声の要求期限を超過しました。", "TimeoutError")), remainingMs) : undefined;
    try {
      const result = await call(controller && deadlineMs !== undefined ? { deadlineMs, signal: controller.signal } : undefined);
      return { kind: "result", result };
    }
    catch (error) {
      const budgetExpired = deadlineMs !== undefined && (controller?.signal.aborted || Date.now() >= deadlineMs);
      const reason = error instanceof GeneratedAudioRequestDeferredError ? error.reason
        : budgetExpired
          ? operation === "enqueue" ? "acceptance_unknown" : "not_sent" : undefined;
      if (!reason) throw error;
      if (deadlineMs !== undefined) deferredJobs.add(key);
      console.log("[generated_audio:deferred]", { audioId: job.audioId, provider: provider.id, operation, reason, elapsedMs: Date.now() - startedAt });
      return { kind: "deferred", reason };
    }
    finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }
  function deferredJob(job: GeneratedAudioJob, operation: "enqueue" | "reconcile", outcome: Extract<ProviderOutcome, { kind: "deferred" }>) {
    return operation === "enqueue" && outcome.reason === "acceptance_unknown" && !job.externalJobId && !job.outputKey
      ? { ...job, errorCode: GENERATED_AUDIO_ACCEPTANCE_UNKNOWN_ERROR_CODE } : job;
  }
  async function sha256(value: string) {
    const bytes = new TextEncoder().encode(value);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  function definitionById(audioId: string) {
    return runtime.workerScenario.generatedAudio.find((definition) => definition.id === audioId);
  }
  function applyProviderResult(job: GeneratedAudioJob, result: GeneratedAudioProviderResult) {
    const next: GeneratedAudioJob = { ...job, externalJobId: result.externalJobId ?? job.externalJobId,
      outputKey: result.outputKey ?? job.outputKey, status: result.status, errorCode: result.errorCode ?? null };
    if (!["queued", "running", "ready", "failed"].includes(next.status)
      || (next.status === "ready" && !next.outputKey)
      || (["queued", "running"].includes(next.status) && !next.externalJobId && !next.outputKey)) {
      next.status = "failed";
      next.errorCode = "provider_result_invalid";
    }
    if (next.status === "ready" || next.status === "failed") next.completedAt = new Date().toISOString();
    return next;
  }
  async function requestHash(playerId: string, job: GeneratedAudioJob, secret = "") {
    const text = JSON.stringify(["generated-audio-input", runtime.workerScenario.project.id, playerId, job.audioId, job.provider, job.inputHash]);
    if (!secret) return sha256(text);
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const bytes = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(text)));
    return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
  }
  async function prepareGeneratedAudio(store: AppStore, playerId: string, audioId: string, inputText: string) {
    const intent = await createGeneratedAudioIntent(store, playerId, audioId, inputText);
    if (!intent)
      return await store.generatedAudioJob(playerId, audioId);
    await store.saveGeneratedAudioJob(playerId, intent);
    return dispatchGeneratedAudioIntent(store, playerId, intent);
  }
  async function createGeneratedAudioIntent(store: AppStore, playerId: string, audioId: string, inputText: string) {
    const definition = definitionById(audioId);
    const provider = definition ? generatedAudioProvider(definition.provider) : null;
    if (!definition || !provider || !inputText.trim()) {
      throw new Error(`生成音声の指定が不正です: ${audioId}`);
    }
    const inputHash = await sha256(inputText.normalize("NFC").trim());
    const current = await store.generatedAudioJob(playerId, audioId);
    if (current?.provider === provider.id
      && current.inputHash === inputHash
      && (current.status === "queued" || current.status === "running" || current.status === "ready")) {
      return null;
    }
    const normalizedInput = inputText.normalize("NFC").trim();
    const now = new Date().toISOString();
    return {
      id: crypto.randomUUID(),
      audioId,
      provider: provider.id,
      externalJobId: null,
      inputHash,
      inputText: normalizedInput,
      outputKey: null,
      status: "queued",
      errorCode: null,
      createdAt: now,
      completedAt: null
    } satisfies GeneratedAudioJob;
  }
  async function dispatchGeneratedAudioIntent(store: AppStore, playerId: string, job: GeneratedAudioJob) {
    if (!job.inputText)
      return job;
    const definition = definitionById(job.audioId);
    const provider = definition ? generatedAudioProvider(job.provider) : null;
    if (!definition || !provider)
      return job;
    const outcome = await callProvider(provider, "enqueue", playerId, job, (requestBudget) => provider.enqueue({
      definition, inputText: job.inputText!, jobId: job.id, createdAt: job.createdAt, ...(requestBudget ? { requestBudget } : {})
    }));
    const next = outcome.kind === "result" ? applyProviderResult(job, outcome.result) : deferredJob(job, "enqueue", outcome);
    if (JSON.stringify(next) === JSON.stringify(job)) return await store.generatedAudioJob(playerId, job.audioId) ?? job;
    return await store.updateGeneratedAudioJob(playerId, next) ? next : await store.generatedAudioJob(playerId, job.audioId);
  }
  async function retryGeneratedAudio(store: AppStore, playerId: string, audioId: string, expectedId: string) {
    const current = await store.generatedAudioJob(playerId, audioId);
    if (!current || current.id !== expectedId || current.status === "ready" || !current.inputText) return null;
    if (!definitionById(audioId) || !generatedAudioProvider(current.provider)) throw new Error("generated_audio_provider_unavailable");
    const next: GeneratedAudioJob = { ...current, id: crypto.randomUUID(), createdAt: new Date().toISOString(), completedAt: null,
      externalJobId: null, outputKey: null, status: "queued", errorCode: null };
    if (!await store.replaceGeneratedAudioJob(playerId, expectedId, next)) return null;
    return dispatchGeneratedAudioIntent(store, playerId, next);
  }
  async function reconcileGeneratedAudio(store: AppStore, playerId: string, existingJobs?: readonly GeneratedAudioJob[]) {
    const rows = [...(existingJobs ?? await store.generatedAudioJobs(playerId))];
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index];
      if (row.status !== "queued" && row.status !== "running")
        continue;
      const definition = definitionById(row.audioId);
      const provider = definition ? generatedAudioProvider(row.provider) : null;
      if (!definition || !provider) {
        continue;
      }
      // 受付不明の依頼は再投入せず、providerの安全な照合・期限判定へ渡す。
      const operation = row.status === "queued" && !row.externalJobId && !row.outputKey && row.inputText
        && row.errorCode !== GENERATED_AUDIO_ACCEPTANCE_UNKNOWN_ERROR_CODE ? "enqueue" : "reconcile";
      let outcome: ProviderOutcome;
      try {
        outcome = await callProvider(provider, operation, playerId, row, (requestBudget) => operation === "enqueue"
          ? provider.enqueue({ definition, inputText: row.inputText!, jobId: row.id, createdAt: row.createdAt, ...(requestBudget ? { requestBudget } : {}) })
          : provider.reconcile({
            definition,
            job: {
              id: row.id,
              audioId: row.audioId,
              externalJobId: row.externalJobId,
              outputKey: row.outputKey,
              status: row.status,
              createdAt: row.createdAt
            },
            ...(requestBudget ? { requestBudget } : {})
          }));
      }
      catch (error) {
        // 作品固有providerの一時障害で、端末全体の状態取得を止めない。
        console.error("[generated_audio:reconcile]", {
          audioId: row.audioId,
          provider: row.provider,
          error: error instanceof Error ? error.name : "unknown"
        });
        continue;
      }
      const next = outcome.kind === "result" ? applyProviderResult(row, outcome.result) : deferredJob(row, operation, outcome);
      if (JSON.stringify(next) === JSON.stringify(row)) {
        // 照会中に別requestが完了していた場合も、古いpendingを画面へ戻さない。
        rows[index] = await store.generatedAudioJob(playerId, row.audioId) ?? row;
        continue;
      }
      if (!await store.updateGeneratedAudioJob(playerId, next)) {
        const latest = await store.generatedAudioJob(playerId, row.audioId);
        if (latest) rows[index] = latest;
        else { rows.splice(index, 1); index -= 1; }
        continue;
      }
      rows[index] = next;
    }
    return rows;
  }
  function fallbackUrl(definition: (typeof runtime.workerScenario.generatedAudio)[number], scenario = runtime.workerScenario) {
    if (!definition.fallbackAttachmentId) return null;
    return scenario.attachments.find(item => item.id === definition.fallbackAttachmentId && item.type === "audio")?.asset ?? null;
  }
  async function publicGeneratedAudioStates(store: AppStore, playerId: string, requests: Record<string, string>, secret = "", scenario = runtime.workerScenario): Promise<PublicGeneratedAudioState[]> {
    const definitions = scenario.generatedAudio;
    const expectedIds = new Set(definitions.filter(item => requests[item.publicId]).map(item => item.id));
    const jobs = expectedIds.size ? (await store.generatedAudioJobs(playerId)).filter(job => expectedIds.has(job.audioId)) : [];
    // 古いtokenが示す別入力のjobを照合・再送しない。現在の依頼だけを処理する。
    const matching = [];
    for (const job of jobs) {
      const definition = definitionById(job.audioId)!;
      if (requests[definition.publicId] === await requestHash(playerId, job, secret)) matching.push(job);
    }
    const reconciledJobs = await reconcileGeneratedAudio(store, playerId, matching);
    const jobById = new Map(reconciledJobs.map((row) => [row.audioId, row]));
    return Promise.all(definitions.map(async (definition) => {
      let job = jobById.get(definition.id);
      if (job && requests[definition.publicId] !== await requestHash(playerId, job, secret)) job = undefined;
      const status = job?.status ?? (requests[definition.publicId] ? "failed" : "idle");
      // 固定音声はジョブ固有の成果物ではないので、保存時のURLでなく現行定義を使う。
      const outputUrl = job?.provider === "static" && definition.provider === "static" ? definition.staticUrl : job?.outputKey;
      return {
        id: definition.publicId,
        status,
        requestedAt: job?.createdAt ?? null,
        completedAt: job?.completedAt ?? null,
        publicAudioUrl: job?.status === "ready" ? outputUrl ?? null : null,
        fallbackAudioUrl: definition.provider === "static" ? definition.staticUrl : status === "failed" ? fallbackUrl(definition, scenario) : null
      };
    }));
  }
  return {
    prepareGeneratedAudio,
    createGeneratedAudioIntent,
    dispatchGeneratedAudioIntent,
    reconcileGeneratedAudio,
    publicGeneratedAudioStates,
    requestHash,
    retryGeneratedAudio,
  };
}
export type GeneratedAudioRuntime = ReturnType<typeof createGeneratedAudioRuntime>;
