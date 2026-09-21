import { defaultScenarioRuntime } from "../scenario.ts";
import { createTalkCommandRuntime } from "./talkCommandRuntime.ts";
export const { talkCommand, internalizeTalkCommand, talkCommandAvailable, semanticInputForTalkCommand } = createTalkCommandRuntime(defaultScenarioRuntime);
