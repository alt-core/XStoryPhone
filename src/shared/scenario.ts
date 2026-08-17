import type { ConditionStateDefinition } from "./condition";

export type ContentInitialState = "normal" | "repairable" | "hidden";

export type DeviceLockSettings =
  | { method: "player-passcode" }
  | { method: "fixed-pin"; pin: string }
  | { method: "none" };

export type ProjectSettings = {
  id: string;
  name: string;
  osName: string;
  assistantName: string;
  accentColor: string;
  lockScreen: DeviceLockSettings;
  date: string;
  timeLabel: string;
  batteryLevel: number;
  signalLabel: string;
  wallpaperUrl: string;
};

export type ScenarioApp = {
  id: string;
  label: string;
  repairLabel?: string;
  icon: string;
  accent: string;
  initialState: ContentInitialState;
  search: readonly (string | readonly string[])[];
  cond: string;
};

export type ScenarioContent = {
  id: string;
  publicId: string;
  appId: string;
  initialState: ContentInitialState;
  repairLabel?: string;
  search: readonly (string | readonly string[])[];
  cond: string;
  record: Record<string, unknown>;
};

export type TalkRule = {
  id: string;
  order: number;
  from: string;
  isDefault: boolean;
  cond: string;
  intent: string;
  criteria: string;
  match: string;
  nextBlocks: readonly string[];
  set: readonly string[];
  mode: "" | "stay" | "game_over";
  notes: string;
  example: string;
};

export type ScenarioTalk = {
  id: string;
  publicId: string;
  kind: "sms" | "chat";
  appId: "messages" | "chat";
  label: string;
  cond: string;
  startBlocks: readonly string[];
  initialFrom: string;
  rules: readonly TalkRule[];
};

export type ScenarioTalkPerson = {
  id: string;
  name: string;
  role: "owner" | "npc";
  avatar?: string;
};

export type ScenarioMessageSegment =
  | { kind: "text"; text: string }
  | { kind: "link"; text: string; appId: string; contentId: string; actionId?: string; linkId?: string }
  | { kind: "link"; text: string; externalUrl: string };

export type ScenarioMessageAttachment =
  | { kind: "locked"; contentId: string; locked: true; title?: string }
  | { kind: "image" | "audio" | "video"; attachmentId: string; contentId?: string; imageUrl?: string; audioUrl?: string; videoUrl?: string };

export type ScenarioTalkBlockMessage = {
  id: string;
  sender: string;
  body: string;
  segments?: readonly ScenarioMessageSegment[];
  attachmentId: string;
  sentAt: string;
  delayMs?: number;
  notes: string;
  updatedAt: string;
  source: string;
};

export type ScenarioTalkBlock = {
  id: string;
  talkId: string;
  blockKey: string;
  repeatOf?: string;
  repeatIndex?: number;
  messages: readonly ScenarioTalkBlockMessage[];
};

export type ScenarioAttachmentDefinition = {
  id: string;
  type: "image" | "audio" | "video";
  asset: string;
  content?: string;
  lock?: "password";
  title?: string;
  body?: string;
  poster?: string;
};

export type ScenarioIncomingCall = {
  id: string;
  publicId: string;
  name: string;
  audioUrl?: string;
  transcript?: readonly {
    atMs: number;
    text: string;
  }[];
};

export type ScenarioScheduleDefinition = {
  id: string;
  delayMs: number;
  eventId: string;
  fields: Record<string, string>;
};

export type ScenarioNotification = {
  id: string;
  appId: string;
  targetTalkId?: string;
  targetContentId?: string;
  title: string;
  body: string;
  cond: string;
};

export type ScenarioAssistantMessage = {
  id: string;
  surface: string;
  body: string;
  weight: number;
  agentAction?: "idle" | "hi";
  cond: string;
};

export type ScenarioSearchResponse = {
  id: string;
  when: "" | "found" | "not_found";
  search: readonly (string | readonly string[])[];
  cond: string;
  body: string;
  suppressResults: boolean;
};

export type ScenarioChatAuthGate = {
  cond: string;
  linkSentCond: string;
};

export type ClientScenario = {
  revision: string;
  playerMode: "server" | "browser";
  project: ProjectSettings;
  apps: readonly ScenarioApp[];
};

export type WorkerScenario = ClientScenario & {
  features: {
    llm: boolean;
  };
  stateVariables: Record<string, string | number | boolean>;
  stateVariableDefinitions: Record<string, ConditionStateDefinition>;
  publicStateVariables: readonly string[];
  photoDescriptions: Record<string, string>;
  contents: readonly ScenarioContent[];
  talks: readonly ScenarioTalk[];
  talkPeople: readonly ScenarioTalkPerson[];
  talkBlocks: readonly ScenarioTalkBlock[];
  attachments: readonly ScenarioAttachmentDefinition[];
  repeatTalkBlocks: Record<string, readonly string[]>;
  incomingCalls: readonly ScenarioIncomingCall[];
  initialSchedules: readonly ScenarioScheduleDefinition[];
  todos: readonly { id: string; text: string; cond: string }[];
  notifications: readonly ScenarioNotification[];
  assistantMessages: readonly ScenarioAssistantMessage[];
  searchResponses: readonly ScenarioSearchResponse[];
  chatAuthGate: ScenarioChatAuthGate | null;
  clientCallableEvents: readonly string[];
  hooks: readonly ScenarioHookDefinition[];
  generatedAudio: readonly GeneratedAudioDefinition[];
  albumMediaAttachmentLinks: readonly { attachmentId: string; photoId: string }[];
  lockedContentPasswords: readonly { contentId: string; passwordHash: string }[];
  publicIds: {
    content: Record<string, string>;
    talk: Record<string, string>;
    attachment: Record<string, string>;
    incomingCall: Record<string, string>;
    form: Record<string, string>;
    notification: Record<string, string>;
    generatedAudio: Record<string, string>;
    scenarioEvent: Record<string, string>;
  };
};

export type GeneratedAudioDefinition = {
  id: string;
  publicId: string;
  title: string;
  provider: string;
  staticUrl: string;
};

export type PublicGeneratedAudioState = {
  id: string;
  status: "idle" | "queued" | "running" | "ready" | "failed";
  requestedAt: string | null;
  completedAt: string | null;
  publicAudioUrl: string | null;
  fallbackAudioUrl: string | null;
};

export type ScenarioHookDefinition = {
  event: "session_started" | "content_repaired" | "content_opened" | "content_unlocked" | "talk_sent" | "scenario_event";
  target: string;
  handler: string;
  cond: string;
  llm: boolean;
};

export type StoredTalkMessage = {
  seq: number;
  id: string;
  talkId: string;
  sender: "owner" | "other";
  body: string;
  senderName?: string | null;
  avatarUrl?: string;
  segments?: readonly ScenarioMessageSegment[];
  delayMs?: number;
  delayOnFirstDisplay?: boolean;
  attachment: ScenarioMessageAttachment | null;
  sentAt: string;
  scenarioBlockId?: string;
  historyRepairId?: string;
};
