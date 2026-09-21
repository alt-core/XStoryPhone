import { defaultScenarioRuntime } from "../scenario.ts";
import { createTalkContextRuntime } from "./talkContextRuntime.ts";
export type { TalkRecentMessage } from "./talkContextRuntime.ts";
export const { talkFlowRecentMessages } = createTalkContextRuntime(defaultScenarioRuntime);
