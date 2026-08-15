import type { GeneratedAudioProvider } from "../worker/providers/generatedAudio";

// 外部で音声を生成する作品固有providerは、コアを変更せずここへ登録する。
export const projectGeneratedAudioProviders: readonly GeneratedAudioProvider[] = [];
