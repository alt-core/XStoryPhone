import type { ConditionStateDefinition } from "./condition";

export type ContentInitialState = "normal" | "repairable" | "hidden";
export type StaticAnswerIndex = { id: string; prefixes: readonly string[] };

export type PartOwned = {
  part?: string;
  order?: number;
  unavailable?: boolean;
};

export type DeviceLockSettings =
  | { method: "player-passcode" }
  | { method: "fixed-pin"; pin: string; loadParts?: readonly string[]; answerIndex?: StaticAnswerIndex }
  | { method: "none" };

export type ProjectSettings = {
  id: string;
  name: string;
  osName: string;
  assistantName: string;
  accentColor: string;
  lockScreen: DeviceLockSettings;
  talkClock: "real" | "scenario";
  repairParentApp: boolean;
  date: string;
  timeLabel: string;
  batteryLevel: number;
  signalLabel: string;
  wallpaperUrl: string;
};

export type ScenarioApp = PartOwned & {
  id: string;
  label: string;
  repairLabel?: string;
  icon: string;
  accent: string;
  initialState: ContentInitialState;
  search: readonly (string | readonly string[])[];
  cond: string;
  badgeCond: string;
};

export type ScenarioContent = PartOwned & {
  id: string;
  publicId: string;
  appId: string;
  initialState: ContentInitialState;
  repairLabel?: string;
  search: readonly (string | readonly string[])[];
  cond: string;
  record: Record<string, unknown>;
};

export type TalkOutputStep =
  | { kind: "block"; blockId: string }
  | { kind: "search"; queryTemplate: string }
  | { kind: "input"; action: "show" | "hide" | "enable" | "disable" }
  | { kind: "if"; cond: string; blockId: string };

export type TalkRule = PartOwned & {
  answerIndex?: StaticAnswerIndex;
  type: "match" | "secret" | "ai" | "default";
  contextPart?: string;
  loadParts?: readonly string[];
  id: string;
  order: number;
  from: string;
  isDefault: boolean;
  cond: string;
  intent: string;
  criteria: string;
  match: string;
  outputSteps: readonly TalkOutputStep[];
  nextBlocks: readonly string[];
  nextFromId: string;
  set: readonly string[];
  mode: "" | "stay" | "game_over";
  notes: string;
  example: string;
};

export type ScenarioDeviceTalk = PartOwned & {
  id: string;
  publicId: string;
  kind: "sms" | "chat";
  appId: "messages" | "chat";
  label: string;
  avatarUrl?: string;
  initialState: ContentInitialState;
  repairLabel?: string;
  search: readonly (string | readonly string[])[];
  cond: string;
  inputVisible: boolean;
  inputEnabled: boolean;
  startBlocks: readonly string[];
  initialFrom: string;
  rules: readonly TalkRule[];
};

export type ScenarioSearchAgentTalk = PartOwned & {
  id: "search_agent";
  publicId: string;
  kind: "search_agent";
  label: string;
  inputVisible: boolean;
  inputEnabled: boolean;
  startSteps: readonly TalkOutputStep[];
  initialFrom: string;
  rules: readonly TalkRule[];
};

export type ScenarioTalk = ScenarioDeviceTalk | ScenarioSearchAgentTalk;

export type ScenarioTalkPerson = PartOwned & {
  id: string;
  name: string;
  role: "owner" | "npc" | "system";
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
  initialRole?: "owner" | "npc";
  initialTemplateKeys?: readonly string[];
  id: string;
  sender: string;
  body: string;
  segments?: readonly ScenarioMessageSegment[];
  attachmentId: string;
  sentAt: string;
  delayMs?: number;
  quickReplies?: readonly string[];
  notes: string;
  updatedAt: string;
  source: string;
};

export type ScenarioTalkBlock = PartOwned & {
  acceptsInput?: boolean;
  id: string;
  talkId: string;
  blockKey: string;
  repeatOf?: string;
  repeatIndex?: number;
  messages: readonly ScenarioTalkBlockMessage[];
};

export type ScenarioAttachmentDefinition = PartOwned & {
  id: string;
  type: "image" | "audio" | "video" | "document";
  asset?: string;
  content?: string;
  lock?: "password";
  title?: string;
  body?: string;
  poster?: string;
  search?: readonly (string | readonly string[])[];
  searchApp?: "messages" | "chat";
  cond?: string;
};

export type ScenarioIncomingCall = PartOwned & {
  id: string;
  publicId: string;
  name: string;
  cond: string;
  audioUrl?: string;
  audioAttachmentId?: string;
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

export type ScenarioNotification = PartOwned & {
  id: string;
  appId: string;
  targetTalkId?: string;
  targetContentId?: string;
  title: string;
  body: string;
  cond: string;
};

export type ScenarioAssistantMessage = PartOwned & {
  id: string;
  surface: string;
  body: string;
  weight: number;
  agentAction?: "idle" | "hi";
  cond: string;
};

export type ScenarioChatAuthGate = {
  cond: string;
  linkSentCond: string;
};

export type ClientScenario = {
  revision: string;
  playerMode: "server" | "browser" | "static";
  project: ProjectSettings;
  apps: readonly ScenarioApp[];
};

export type WorkerScenario = ClientScenario & {
  parts?: readonly string[];
  stateVariableParts?: Readonly<Record<string, string>>;
  hookTalkBlocks?: Readonly<Record<string, readonly string[]>>;
  projectConstants: Readonly<Record<string, string>>;
  clientRevision: string;
  transcriptRevision: string;
  projectAppIds: readonly string[];
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
  todos: readonly (PartOwned & { id: string; text: string; cond: string })[];
  notifications: readonly ScenarioNotification[];
  assistantMessages: readonly ScenarioAssistantMessage[];
  chatAuthGate: ScenarioChatAuthGate | null;
  clientCallableEvents: readonly string[];
  hooks: readonly ScenarioHookDefinition[];
  generatedAudio: readonly GeneratedAudioDefinition[];
  albumMediaAttachmentLinks: readonly { attachmentId: string; photoId: string }[];
  lockedContentPasswords: readonly (PartOwned & { contentId: string; target: "attachment" | "content"; answers: readonly string[]; loadParts: readonly string[]; answerIndex?: StaticAnswerIndex })[];
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

export type GeneratedAudioDefinition = PartOwned & {
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

export type ScenarioHookDefinition = PartOwned & {
  event: string;
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
  quickReplies?: readonly string[];
  attachment: ScenarioMessageAttachment | null;
  sentAt: string;
  // 作中日時の表示だけに使う。記録順序・既読判定はsentAtとseqを維持する。
  displayTime?: string;
  scenarioBlockId?: string;
  historyRepairId?: string;
};
