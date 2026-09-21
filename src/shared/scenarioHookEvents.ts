export type ScenarioHookTargetKind =
  | "none"
  | "blocked_app"
  | "content_open"
  | "content"
  | "audio_cue"
  | "incoming_call"
  | "message_action"
  | "talk"
  | "form"
  | "schedule"
  | "part";

export type ScenarioHookEventMetadata = {
  targetKind: ScenarioHookTargetKind;
  targetRequired?: boolean;
  completion?: boolean;
  clientCallable?: boolean;
};

export const CORE_SCENARIO_HOOK_EVENTS = {
  part_loaded: { targetKind: "part", targetRequired: true },
  session_started: { targetKind: "none" },
  blocked_content_link_opened: {
    targetKind: "blocked_app",
    targetRequired: true,
    clientCallable: true
  },
  content_repaired: { targetKind: "content_open" },
  content_opened: { targetKind: "content_open" },
  content_unlocked: { targetKind: "content" },
  audio_playback_completed: {
    targetKind: "content",
    completion: true,
    clientCallable: true
  },
  audio_cue_reached: {
    targetKind: "audio_cue",
    completion: true,
    clientCallable: true
  },
  incoming_call_completed: {
    targetKind: "incoming_call",
    completion: true,
    clientCallable: true
  },
  message_link_opened: { targetKind: "message_action", targetRequired: true },
  talk_turn_completed: { targetKind: "talk" },
  form_submitted: { targetKind: "form", targetRequired: true },
  scheduled_event: { targetKind: "schedule", targetRequired: true }
} as const satisfies Record<string, ScenarioHookEventMetadata>;

export type CoreScenarioHookEventId = keyof typeof CORE_SCENARIO_HOOK_EVENTS;

export function coreScenarioHookEventMetadata(eventId: string): ScenarioHookEventMetadata | undefined {
  return CORE_SCENARIO_HOOK_EVENTS[eventId as CoreScenarioHookEventId];
}

export function isCompletionScenarioEvent(eventId: string) {
  return coreScenarioHookEventMetadata(eventId)?.completion === true;
}

export function isCoreClientScenarioEvent(eventId: string) {
  return coreScenarioHookEventMetadata(eventId)?.clientCallable === true;
}
