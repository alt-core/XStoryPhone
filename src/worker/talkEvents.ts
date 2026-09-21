import { defaultScenarioRuntime } from "./scenario.ts";
export type { ResolvedTalkMessage, ResolvedSearchAgentTimelineItem } from "./talkEventsRuntime.ts";
export const {
  renderedQuickReplies,
  resolveTalkEvents,
  formatEnvForMessageBlockFromState,
  formatEnvForMessageBlock,
  resolveSingleTalkEvent,
  resolveSearchAgentEvent,
  resolveSearchAgentEvents,
  searchAgentBlockEvents,
  searchAgentPlayerMessageEvent,
  searchAgentResultEvent,
} = defaultScenarioRuntime.talkEvents;
