import type { GeneratedAudioDefinition } from "../../shared/scenario.ts";
import { projectGeneratedAudioProviders } from "../../project/generatedAudioProviders.ts";

export type GeneratedAudioJob = {
  id: string;
  audioId: string;
  externalJobId: string | null;
  outputKey: string | null;
  status: "queued" | "running" | "ready" | "failed";
};

export type GeneratedAudioProviderResult = {
  status: "queued" | "running" | "ready" | "failed";
  externalJobId?: string;
  outputKey?: string;
  errorCode?: string;
};

export type GeneratedAudioProvider = {
  id: string;
  enqueue(input: {
    definition: GeneratedAudioDefinition;
    inputText: string;
  }): Promise<GeneratedAudioProviderResult>;
  reconcile(input: {
    definition: GeneratedAudioDefinition;
    job: GeneratedAudioJob;
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
