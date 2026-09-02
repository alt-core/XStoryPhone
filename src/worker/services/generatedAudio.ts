import type { PublicGeneratedAudioState } from "../../shared/scenario.ts";
import type { AppStore, GeneratedAudioJob } from "../../server/store.ts";
import { generatedAudioProvider } from "../providers/generatedAudio.ts";
import { workerScenario } from "../scenario.ts";

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function definitionById(audioId: string) {
  return workerScenario.generatedAudio.find((definition) => definition.id === audioId);
}

export async function prepareGeneratedAudio(
  store: AppStore,
  playerId: string,
  audioId: string,
  inputText: string
) {
  const intent = await createGeneratedAudioIntent(store, playerId, audioId, inputText);
  if (!intent) return await store.generatedAudioJob(playerId, audioId);
  await store.saveGeneratedAudioJob(playerId, intent);
  return dispatchGeneratedAudioIntent(store, playerId, intent);
}

export async function createGeneratedAudioIntent(
  store: AppStore,
  playerId: string,
  audioId: string,
  inputText: string
) {
  const definition = definitionById(audioId);
  const provider = definition ? generatedAudioProvider(definition.provider) : null;
  if (!definition || !provider || !inputText.trim()) {
    throw new Error(`生成音声の指定が不正です: ${audioId}`);
  }

  const inputHash = await sha256(inputText.normalize("NFC").trim());
  const current = await store.generatedAudioJob(playerId, audioId);
  if (
    current?.provider === provider.id
    && current.inputHash === inputHash
    && (current.status === "queued" || current.status === "running" || current.status === "ready")
  ) {
    return null;
  }
  const normalizedInput = inputText.normalize("NFC").trim();
  const now = new Date().toISOString();
  return {
    id: current?.id ?? crypto.randomUUID(),
    audioId,
    provider: provider.id,
    externalJobId: null,
    inputHash,
    inputText: normalizedInput,
    outputKey: null,
    status: "queued",
    errorCode: null,
    createdAt: current?.createdAt ?? now,
    completedAt: null
  } satisfies GeneratedAudioJob;
}

export async function dispatchGeneratedAudioIntent(store: AppStore, playerId: string, job: GeneratedAudioJob) {
  if (!job.inputText) return job;
  const definition = definitionById(job.audioId);
  const provider = definition ? generatedAudioProvider(job.provider) : null;
  if (!definition || !provider) return job;
  const result = await provider.enqueue({ definition, inputText: job.inputText });
  const now = new Date().toISOString();
  const next: GeneratedAudioJob = {
    ...job,
    inputText: null,
    externalJobId: result.externalJobId ?? null,
    outputKey: result.outputKey ?? null,
    status: result.status,
    errorCode: result.errorCode ?? null,
    completedAt: result.status === "ready" ? now : null
  };
  await store.saveGeneratedAudioJob(playerId, next);
  return next;
}

export async function reconcileGeneratedAudio(
  store: AppStore,
  playerId: string,
  existingJobs?: readonly GeneratedAudioJob[]
) {
  const rows = [...(existingJobs ?? await store.generatedAudioJobs(playerId))];
  const now = new Date().toISOString();
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    if (row.status !== "queued" && row.status !== "running") continue;
    const definition = definitionById(row.audioId);
    const provider = definition ? generatedAudioProvider(row.provider) : null;
    if (!definition || !provider) {
      continue;
    }
    let result;
    try {
      result = row.status === "queued" && !row.externalJobId && !row.outputKey && row.inputText
        ? await provider.enqueue({ definition, inputText: row.inputText })
        : await provider.reconcile({
        definition,
        job: {
          id: row.id,
          audioId: row.audioId,
          externalJobId: row.externalJobId,
          outputKey: row.outputKey,
          status: row.status
        }
        });
    } catch (error) {
      // 作品固有providerの一時障害で、端末全体の状態取得を止めない。
      console.error("[generated_audio:reconcile]", {
        audioId: row.audioId,
        provider: row.provider,
        error: error instanceof Error ? error.name : "unknown"
      });
      continue;
    }
    const next = {
      ...row,
      inputText: null,
      externalJobId: result.externalJobId ?? row.externalJobId,
      outputKey: result.outputKey ?? row.outputKey,
      status: result.status,
      errorCode: result.errorCode ?? null,
      completedAt: result.status === "ready" ? now : row.completedAt
    } satisfies GeneratedAudioJob;
    await store.saveGeneratedAudioJob(playerId, next);
    rows[index] = next;
  }
  return rows;
}

export async function publicGeneratedAudioStates(
  store: AppStore,
  playerId: string
): Promise<PublicGeneratedAudioState[]> {
  if (!workerScenario.generatedAudio.length) return [];
  const jobs = await store.generatedAudioJobs(playerId);
  const reconciledJobs = await reconcileGeneratedAudio(store, playerId, jobs);
  const jobById = new Map(reconciledJobs.map((row) => [row.audioId, row]));
  return workerScenario.generatedAudio.map((definition) => {
    const job = jobById.get(definition.id);
    return {
      id: definition.publicId,
      status: job?.status ?? "idle",
      requestedAt: job?.createdAt ?? null,
      completedAt: job?.completedAt ?? null,
      publicAudioUrl: job?.status === "ready" ? job.outputKey : null,
      fallbackAudioUrl: definition.staticUrl
    };
  });
}
