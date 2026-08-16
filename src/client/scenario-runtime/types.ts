export type AppId =
  | "phone"
  | "messages"
  | "photos"
  | "chat"
  | "notes"
  | "calendar"
  | "radio";

export type ContentInitialState = "normal" | "repairable" | "hidden";
export type ContentStateValue = "repaired" | "unlocked";
export type AssistantMessageSurface =
  | "home"
  | "phone"
  | "messages"
  | "photos"
  | "chat"
  | "notes"
  | "calendar"
  | "radio";
export type SearchAgentAction = "idle" | "hi";

export type AssistantMessage = {
  id: string;
  surface: AssistantMessageSurface;
  body: string;
  weight: number;
  agentAction?: SearchAgentAction;
};

export type AppCatalogEntry = {
  id: AppId;
  label: string;
  icon: string;
  accent: string;
  available: boolean;
  initialState?: ContentInitialState;
  corrupted?: boolean;
  repairLabel?: string;
};

export type ScenarioContentMeta = {
  contentId?: string;
  initialState?: ContentInitialState;
  corrupted?: boolean;
  repairLabel?: string;
};

export type MessageSender = "owner" | "other";

export type MessageSegment =
  | {
      kind: "text";
      text: string;
    }
  | {
      kind: "link";
      text: string;
      appId: AppId;
      contentId: string;
      linkId?: string;
    }
  | {
      kind: "link";
      text: string;
      externalUrl: string;
    };

export type LockedAttachment = {
  kind?: "locked";
  contentId: string;
  locked: boolean;
  title?: string;
  unlockedTitle?: string;
  unlockedBody?: string;
  unlockedImageUrl?: string;
};

export type MediaAttachment = {
  kind: "image" | "audio";
  attachmentId?: string;
  contentId?: string;
  imageUrl?: string;
  audioUrl?: string;
};

export type SharedContentAttachment = {
  kind: "share";
  appId: AppId;
  contentId: string;
  title: string;
};

export type TalkShareTarget = {
  kind: "sms" | "chat";
  talkId: string;
  label: string;
  appLabel: string;
};

export type PendingShareDraft = {
  requestId: number;
  kind: "sms" | "chat";
  talkId: string;
  appId: AppId;
  contentId: string;
  title: string;
};

export type MessageAttachment = LockedAttachment | MediaAttachment | SharedContentAttachment;

export type Message = {
  id: string;
  sender: MessageSender;
  body: string;
  avatarUrl?: string;
  segments?: MessageSegment[];
  sentAt: string;
  delayMs?: number;
  delayOnFirstDisplay?: boolean;
  attachment?: MessageAttachment;
};

export type MessageThread = {
  id: string;
  contactName: string;
  avatarUrl?: string;
  messages: Message[];
  unread?: boolean;
} & ScenarioContentMeta;

export type PhotoItem = {
  id: string;
  title?: string;
  tags?: string[];
  mediaKind?: "still_video";
  attachmentId?: string;
  imageUrl?: string;
  audioUrl?: string;
} & ScenarioContentMeta;

export type NoteItem = {
  id: string;
  title: string;
  body: string;
  tags?: string[];
} & ScenarioContentMeta;

export type CalendarEvent = {
  id: string;
  title: string;
  date: string;
  time: string;
  place: string;
  memo: string;
} & ScenarioContentMeta;

export type GeneratedAudioState = {
  id: string;
  status: string;
  requestedAt: string | null;
  completedAt: string | null;
  publicAudioUrl: string | null;
  fallbackAudioUrl: string | null;
};

export type RadioAudioSegment =
  | {
      kind: "audio";
      audioUrl: string;
    }
  | {
      kind: "generated";
      genAudioId: string;
      audioUrl?: string;
      generatedAudio?: GeneratedAudioState;
    };

export type CallLogItem = {
  id: string;
  name: string;
  kind: "incoming" | "missed" | "outgoing";
  at: string;
  durationLabel: string;
  audioUrl?: string;
  genAudioId?: string;
  generatedAudio?: GeneratedAudioState;
} & ScenarioContentMeta;

export type IncomingCallItem = {
  id: string;
  name: string;
  audioUrl?: string;
};

export type RadioEpisodeItem = {
  id: string;
  programTitle: string;
  audioUrl?: string;
  audioSegments?: RadioAudioSegment[];
  genAudioId?: string;
  generatedAudio?: GeneratedAudioState;
  playbackDisabledLabel?: string;
  audioCues?: {
    index: number;
    atMs: number;
  }[];
  form?: {
    kind: "html";
    id: string;
    label: string;
    url: string;
    disabled?: boolean;
  };
} & ScenarioContentMeta;

export type ChatAppMessage = {
  id: string;
  sender: MessageSender;
  senderName: string;
  body: string;
  avatarUrl?: string;
  segments?: MessageSegment[];
  sentAt: string;
  delayMs?: number;
  delayOnFirstDisplay?: boolean;
  attachment?: MessageAttachment;
};

export type ChatAppThread = {
  id: string;
  roomName: string;
  avatarUrl?: string;
  messages: ChatAppMessage[];
  unread?: boolean;
} & ScenarioContentMeta;

export type ChatAuthGate = {
  status: "session_expired";
  linkSent: boolean;
};

export type NotificationItem = {
  id: string;
  appId: AppId;
  targetContentId: string;
  title: string;
  body: string;
};

export type TodoItem = {
  id: string;
  text: string;
};

export type ScenarioTime = {
  date: string;
  timeLabel: string;
};

export type SearchAgentSearchResult = {
  contentId: string;
  appId: AppId;
  targetKind?: "app" | "content";
  title?: string;
  thumbnailUrl?: string;
  repairable?: boolean;
};

export type SearchAgentMessage = {
  seq?: number;
  id: string;
  requestId?: string;
  role: "user" | "assistant";
  body: string;
  results?: SearchAgentSearchResult[];
  sentAt: string;
};

export type SearchAgentSearchResponse = {
  ok: boolean;
  matched: boolean;
  body: string;
  results: SearchAgentSearchResult[];
};

export type DeviceState = {
  revision: string;
  batteryLevel: number;
  signalLabel: string;
  currentDate: string;
  currentTimeLabel: string;
  wallpaperUrl?: string;
  apps: AppCatalogEntry[];
  messages: MessageThread[];
  photos: PhotoItem[];
  notes: NoteItem[];
  calendarEvents: CalendarEvent[];
  callLogs: CallLogItem[];
  incomingCall?: IncomingCallItem;
  radioItems: RadioEpisodeItem[];
  chatThreads: ChatAppThread[];
  chatAuthGate?: ChatAuthGate;
  notifications: NotificationItem[];
  todos: TodoItem[];
};
