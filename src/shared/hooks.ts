export type ScenarioEventPayload = {
  eventId: string;
  scheduleId?: string;
  scheduleInstanceId?: string;
  contentId?: string;
  callId?: string;
  talkId?: string;
  attachmentId?: string;
  actionId?: string;
  formId?: string;
  cueId?: string;
  cueTarget?: string;
  cueIndex?: number;
  playerInput?: string;
  ruleId?: string;
  fields?: Record<string, string>;
};

export type HookContentState = "repaired" | "unlocked";
export type HookLlmResult = Record<string, string | number | boolean | null>;
export type HookLlmSchema = Record<string, string>;
export type HookLlmMatchResult = Record<string, string | null>;
export type HookLlmProfile = "fast" | "super" | "ultra";
export type HookLlmMatchMode = "stable" | "once";
export type HookLlmMatchItem = string | {
  rule: string;
  pick?: "same" | "best";
  null?: "no" | "ok" | "weak";
};
export type HookLlmMatchSpec = Record<string, HookLlmMatchItem>;
export type HookLlmTaskOptions<Result extends HookLlmResult> = {
  input?: string;
  source?: string;
  instructions: string;
  schema: HookLlmSchema;
  maxTokens?: number;
  fallback?: Result;
};
export type HookLlmMatchTaskOptions<Result extends HookLlmMatchResult> = {
  input?: string;
  source?: string;
  profile?: HookLlmProfile;
  mode?: HookLlmMatchMode;
  match: HookLlmMatchSpec | string;
  fallback?: Result;
};
export type HookTalkBlockOptions = { mode?: "advance" | "stay" };
export type HookPresentationEffectOptions = {
  fadeInMs?: number;
  holdMs?: number;
  fadeOutMs?: number;
  intensity?: number;
};
export type HookFlashEffectOptions = HookPresentationEffectOptions & {
  color?: string;
};

type HookTalkBlockArguments<TalkBlocksByTalk extends Record<string, string>> = {
  [TalkId in keyof TalkBlocksByTalk & string]: [
    talkId: TalkId,
    blockId: TalkBlocksByTalk[TalkId],
    options?: HookTalkBlockOptions
  ];
}[keyof TalkBlocksByTalk & string];

type StateValueLiteral<Value> = Value extends boolean
  ? "true" | "false"
  : Value extends number
    ? `${number}`
    : Value extends string
      ? Value
      : never;
type StateAssignment<Key extends string, Value> = `${Key}=${StateValueLiteral<Value>}` | `${Key} = ${StateValueLiteral<Value>}`;
type IntegerAdjustment<Key extends string> = `${Key} += ${number}` | `${Key} -= ${number}`;
export type ScenarioHookStateAssignment<StateValues extends Record<string, unknown>> = {
  [Key in keyof StateValues & string]:
    | StateAssignment<Key, StateValues[Key]>
    | (StateValues[Key] extends number ? IntegerAdjustment<Key> : never);
}[keyof StateValues & string];

export type ScenarioHookContext<
  StateValues extends Record<string, unknown> = Record<string, string | number | boolean>,
  AppId extends string = string,
  ContentId extends string = string,
  IncomingCallId extends string = string,
  TalkId extends string = string,
  TalkBlocksByTalk extends Record<TalkId, string> = Record<TalkId, string>,
  TodoId extends string = string,
  GenAudioId extends string = string
> = {
  state: {
    get<Key extends keyof StateValues & string>(id: Key): StateValues[Key];
    set<Key extends keyof StateValues & string>(id: Key, value: StateValues[Key]): void;
    apply(updates: readonly ScenarioHookStateAssignment<StateValues>[]): void;
  };
  incoming: {
    start(id: IncomingCallId): void;
    markCompleted(id: IncomingCallId): void;
    clearActive(): void;
  };
  content: {
    setState(id: ContentId, state: HookContentState, appId?: AppId): void;
  };
  app: {
    repair(id: AppId): void;
  };
  talk: {
    addBlock(...args: HookTalkBlockArguments<TalkBlocksByTalk>): void;
    search(talkId: "search_agent", query: string): void;
    showInput(talkId: TalkId): void;
    hideInput(talkId: TalkId): void;
    enableInput(talkId: TalkId): void;
    disableInput(talkId: TalkId): void;
  };
  todo: {
    add(id: TodoId): void;
    remove(id: TodoId): void;
  };
  schedule: {
    after(scheduleId: string, delayMs: number, fields?: Record<string, string>, instanceId?: string): void;
    cancel(instanceId: string): void;
  };
  form: {
    deny(error: string): never;
  };
  genAudio: {
    prepare(id: GenAudioId, options: { inputText: string }): void;
    reject(error: string): never;
  };
  llm: {
    extract<Result extends HookLlmResult>(taskId: string, options: HookLlmTaskOptions<Result>): Result;
    screen<Result extends HookLlmResult>(taskId: string, options: HookLlmTaskOptions<Result>): Result;
    match<Result extends HookLlmMatchResult>(taskId: string, options: HookLlmMatchTaskOptions<Result>): Result;
  };
  effect: {
    noise(durationMs?: number): void;
    flash(options?: HookFlashEffectOptions): void;
    blackout(options?: HookPresentationEffectOptions): void;
  };
  effectSequence: {
    gameOver(reasonMessage?: string): never;
    allClear(appId: string, contentId: string, autoplay?: boolean): never;
  };
};

export type ScenarioHookHandler<Context extends ScenarioHookContext = ScenarioHookContext> = (context: Context, event: ScenarioEventPayload) => void;
export type ScenarioHookHandlerRegistry<Id extends string = string, Context extends ScenarioHookContext = ScenarioHookContext> = Record<Id, ScenarioHookHandler<Context>>;
