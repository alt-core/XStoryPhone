export type ScenarioHookEvent = {
  event: "session_started" | "content_repaired" | "content_opened" | "content_unlocked" | "talk_sent" | "scenario_event";
  target: string;
  fields?: Record<string, string>;
  playerInput?: string;
  ruleId?: string;
};

export type ScenarioHookContext = {
  state: {
    get(id: string): string | number | boolean | undefined;
    set(id: string, value: string | number | boolean): void;
  };
  content: {
    repair(id: string): void;
    setState(id: string, state: "repaired" | "unlocked"): void;
  };
  app: {
    repair(id: string): void;
  };
  talk: {
    append(talkId: string, body: string, nextFrom?: string): void;
    addBlock(talkId: string, blockId: string): void;
  };
  todo: {
    add(id: string): void;
    remove(id: string): void;
  };
  incomingCall: {
    show(id: string): void;
    dismiss(): void;
  };
  schedule: {
    after(id: string, delayMs: number, eventId: string, fields?: Record<string, string>): void;
    cancel(id: string): void;
  };
  outcome: {
    gameOver(reasonMessage?: string): void;
    allClear(appId: string, contentId: string, autoplay?: boolean): void;
  };
  form: {
    reject(error?: string): void;
    gameOver(reasonMessage?: string): void;
  };
  genAudio: {
    prepare(id: string, options: { inputText: string }): void;
  };
  llm: {
    completeJson(request: {
      taskId: string;
      instructions: string;
      input: Record<string, unknown>;
      schema: Record<string, unknown>;
      maxTokens?: number;
    }): Promise<Record<string, unknown>>;
  };
};

export type ScenarioHookHandler = (
  context: ScenarioHookContext,
  event: ScenarioHookEvent
) => void | Promise<void>;

export type ScenarioHookHandlerRegistry<Id extends string = string> = Record<Id, ScenarioHookHandler>;
