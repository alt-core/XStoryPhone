import { defaultScenarioRuntime } from "../scenario.ts";
import { createGeneratedAudioRuntime } from "./generatedAudioRuntime.ts";
export const { prepareGeneratedAudio, createGeneratedAudioIntent, dispatchGeneratedAudioIntent, reconcileGeneratedAudio, publicGeneratedAudioStates, requestHash, retryGeneratedAudio } = createGeneratedAudioRuntime(defaultScenarioRuntime);
