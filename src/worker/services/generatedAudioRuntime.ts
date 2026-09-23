import type { PublicGeneratedAudioState } from "../../shared/scenario.ts";
import type { AppStore, GeneratedAudioJob } from "../../server/store.ts";
import { generatedAudioProvider, type GeneratedAudioProviderResult } from "../providers/generatedAudio.ts";
import type { ScenarioRuntime } from "../scenarioRuntime.ts";
// 定義はこの実行単位に閉じ込め、別プレイヤーの処理と共有変更しない。
export function createGeneratedAudioRuntime(runtime: Pick<ScenarioRuntime,"workerScenario">) {
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
    const result = await provider.enqueue({ definition, inputText: job.inputText, jobId: job.id, createdAt: job.createdAt });
    const next = applyProviderResult(job, result);
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
      let result;
      try {
        result = row.status === "queued" && !row.externalJobId && !row.outputKey && row.inputText
          ? await provider.enqueue({ definition, inputText: row.inputText, jobId: row.id, createdAt: row.createdAt })
          : await provider.reconcile({
            definition,
            job: {
              id: row.id,
              audioId: row.audioId,
              externalJobId: row.externalJobId,
              outputKey: row.outputKey,
              status: row.status,
              createdAt: row.createdAt
            }
          });
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
      const next = applyProviderResult(row, result);
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
