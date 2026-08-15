import { evaluateCondition } from "../../shared/condition.ts";
import type { ScenarioHookContext, ScenarioHookEvent } from "../../shared/hooks.ts";
import type { StoredTalkMessage } from "../../shared/scenario.ts";
import { scenarioHookHandlers } from "../../project/hooks.ts";
import { copyStoredPlayerState, type StoredPlayerState } from "../../server/store.ts";
import type { StructuredOutputProvider } from "../providers/structuredOutput.ts";
import {
  initializeTalkState,
  messagesForTalkBlocks,
  revealTalkMessages,
  talkAvailable,
  workerScenario
} from "../scenario.ts";
import { effectiveStateValues, setStateValue, stateValue } from "../stateValues.ts";

export type ScenarioHookOutcome =
  | { kind: "game_over"; reasonMessage: string }
  | { kind: "all_clear"; appId: string; contentId: string; autoplay: boolean }
  | { kind: "form_error"; error: string }
  | null;

type ScenarioHookResult = {
  state: StoredPlayerState;
  generatedAudioEffects: Array<{ id: string; inputText: string }>;
  scheduleEffects: Array<
    | { type: "queue"; id: string; delayMs: number; eventId: string; fields: Record<string, string> }
    | { type: "cancel"; id: string }
  >;
  transcriptAppends: Array<{ streamId: string; transcriptKey: string; messages: StoredTalkMessage[] }>;
  outcome: ScenarioHookOutcome;
};

function appendUnique(items: string[], id: string) {
  return items.includes(id) ? items : [...items, id];
}

export async function runScenarioHooks(
  state: StoredPlayerState,
  event: ScenarioHookEvent,
  services: { llmProvider?: StructuredOutputProvider } = {}
): Promise<ScenarioHookResult> {
  const nextState = copyStoredPlayerState(state);
  const generatedAudioEffects: Array<{ id: string; inputText: string }> = [];
  const scheduleEffects: Array<
    | { type: "queue"; id: string; delayMs: number; eventId: string; fields: Record<string, string> }
    | { type: "cancel"; id: string }
  > = [];
  const transcriptAppends: Array<{ streamId: string; transcriptKey: string; messages: StoredTalkMessage[] }> = [];
  let outcome: ScenarioHookOutcome = null;

  function appendTranscript(talkId: string, transcriptKey: string, messages: StoredTalkMessage[]) {
    if (!messages.length) return;
    const current = transcriptAppends.find((item) => item.streamId === `talk:${talkId}` && item.transcriptKey === transcriptKey);
    if (current) current.messages.push(...messages);
    else transcriptAppends.push({ streamId: `talk:${talkId}`, transcriptKey, messages: [...messages] });
  }

  function ensureTalk(talkId: string) {
    const talkDefinition = workerScenario.talks.find((talk) => talk.id === talkId);
    if (!talkDefinition || !talkAvailable(talkDefinition, nextState)) return null;
    if (!nextState.talks[talkId]) {
      const initial = initializeTalkState(
        talkDefinition,
        effectiveStateValues(workerScenario.stateVariables, nextState.stateValues)
      );
      nextState.talks[talkId] = initial.state;
      const revealed = revealTalkMessages(nextState, talkId, initial.messages);
      nextState.revealedAttachmentContentIds = revealed.revealedAttachmentContentIds;
      nextState.revealedMessageLinks = revealed.revealedMessageLinks;
      appendTranscript(talkId, initial.state.transcriptKey, initial.messages);
    }
    return { definition: talkDefinition, state: nextState.talks[talkId] };
  }

  function applyTalkMessages(talkId: string, messages: StoredTalkMessage[]) {
    const talk = nextState.talks[talkId];
    if (!talk || !messages.length) return;
    talk.lastMessageSeq = Math.max(talk.lastMessageSeq, ...messages.map((message) => message.seq));
    talk.lastOtherMessageSeq = Math.max(
      talk.lastOtherMessageSeq,
      ...messages.filter((message) => message.sender === "other").map((message) => message.seq)
    );
    const revealed = revealTalkMessages(nextState, talkId, messages);
    nextState.revealedAttachmentContentIds = revealed.revealedAttachmentContentIds;
    nextState.revealedMessageLinks = revealed.revealedMessageLinks;
    appendTranscript(talkId, talk.transcriptKey, messages);
  }

  const context: ScenarioHookContext = {
    state: {
      get(id) {
        return stateValue(workerScenario.stateVariables, nextState.stateValues, id);
      },
      set(id, value) {
        nextState.stateValues = setStateValue(workerScenario.stateVariables, nextState.stateValues, id, value);
      }
    },
    content: {
      repair(id) {
        if (!workerScenario.contents.some((content) => content.id === id)) throw new Error(`未定義のcontentです: ${id}`);
        nextState.repairedContentIds = appendUnique(nextState.repairedContentIds, id);
      },
      setState(id, stateValue) {
        if (!workerScenario.contents.some((content) => content.id === id)) throw new Error(`未定義のcontentです: ${id}`);
        if (stateValue === "unlocked") {
          nextState.unlockedContentIds = appendUnique(nextState.unlockedContentIds, id);
        } else {
          nextState.repairedContentIds = appendUnique(nextState.repairedContentIds, id);
        }
      }
    },
    app: {
      repair(id) {
        if (!workerScenario.apps.some((app) => app.id === id)) throw new Error(`未定義のappです: ${id}`);
        nextState.repairedAppIds = appendUnique(nextState.repairedAppIds, id);
      }
    },
    talk: {
      append(talkId, body, nextFrom) {
        const current = ensureTalk(talkId);
        if (!current || !body.trim()) throw new Error(`talk.appendの指定が不正です: ${talkId}`);
        const message: StoredTalkMessage = {
          seq: current.state.lastMessageSeq + 1,
          id: crypto.randomUUID(),
          talkId: current.definition.publicId,
          sender: "other",
          body: body.trim(),
          ...(current.definition.kind === "chat" ? { senderName: current.definition.label } : {}),
          attachment: null,
          sentAt: new Date().toISOString()
        };
        if (nextFrom) current.state.from = nextFrom;
        current.state.turnKey = crypto.randomUUID();
        applyTalkMessages(talkId, [message]);
      },
      addBlock(talkId, blockId) {
        const current = ensureTalk(talkId);
        const block = workerScenario.talkBlocks.find((item) => item.talkId === talkId && item.blockKey === blockId && !item.repeatOf);
        if (!current || !block) throw new Error(`talk.addBlockの指定が不正です: ${talkId}/${blockId}`);
        const rendered = messagesForTalkBlocks({
          talk: current.definition,
          blockIds: [block.id],
          previousCounts: current.state.blockDisplayCounts,
          formatEnv: effectiveStateValues(workerScenario.stateVariables, nextState.stateValues),
          baseSentAt: new Date().toISOString(),
          idPrefix: `${current.definition.publicId}_hook_${crypto.randomUUID()}`,
          startSeq: current.state.lastMessageSeq
        });
        current.state.blockDisplayCounts = rendered.blockDisplayCounts;
        current.state.turnKey = crypto.randomUUID();
        applyTalkMessages(talkId, rendered.messages);
      }
    },
    todo: {
      add(id) {
        if (!workerScenario.todos.some((todo) => todo.id === id)) throw new Error(`未定義のtodoです: ${id}`);
        nextState.clearedTodoIds = nextState.clearedTodoIds.filter((todoId) => todoId !== id);
      },
      remove(id) {
        if (!workerScenario.todos.some((todo) => todo.id === id)) throw new Error(`未定義のtodoです: ${id}`);
        nextState.clearedTodoIds = appendUnique(nextState.clearedTodoIds, id);
      }
    },
    incomingCall: {
      show(id) {
        if (!workerScenario.incomingCalls.some((call) => call.id === id)) throw new Error(`未定義のincomingCallです: ${id}`);
        nextState.incomingCallId = id;
      },
      dismiss() {
        nextState.incomingCallId = null;
      }
    },
    schedule: {
      after(id, delayMs, eventId, fields = {}) {
        if (!id.trim() || !eventId.trim() || !Number.isFinite(delayMs) || delayMs < 0) {
          throw new Error("schedule.afterの指定が不正です。");
        }
        if (!workerScenario.hooks.some((hook) => hook.event === "scenario_event" && hook.target === eventId.trim())) {
          throw new Error(`schedule.afterのeventが未定義です: ${eventId}`);
        }
        scheduleEffects.push({
          type: "queue",
          id: id.trim(),
          delayMs: Math.min(Math.round(delayMs), 365 * 24 * 60 * 60 * 1_000),
          eventId: eventId.trim(),
          fields: Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, String(value)]))
        });
      },
      cancel(id) {
        if (!id.trim()) throw new Error("schedule.cancelの指定が不正です。");
        scheduleEffects.push({ type: "cancel", id: id.trim() });
      }
    },
    outcome: {
      gameOver(reasonMessage = "") {
        outcome = { kind: "game_over", reasonMessage: reasonMessage.trim().slice(0, 500) };
      },
      allClear(appId, contentId, autoplay = true) {
        if (!workerScenario.apps.some((app) => app.id === appId) || !workerScenario.contents.some((content) => content.id === contentId && content.appId === appId)) {
          throw new Error("outcome.allClearの対象が不正です。");
        }
        outcome = { kind: "all_clear", appId, contentId, autoplay };
      }
    },
    form: {
      reject(error = "message_rejected") {
        outcome = { kind: "form_error", error: error.trim().slice(0, 80) || "message_rejected" };
      },
      gameOver(reasonMessage = "") {
        outcome = { kind: "game_over", reasonMessage: reasonMessage.trim().slice(0, 500) };
      }
    },
    genAudio: {
      prepare(id, options) {
        if (!workerScenario.generatedAudio.some((definition) => definition.id === id) || !options.inputText.trim()) {
          throw new Error(`genAudio.prepareの指定が不正です: ${id}`);
        }
        generatedAudioEffects.push({ id, inputText: options.inputText });
      }
    },
    llm: {
      async completeJson(request) {
        if (!services.llmProvider) throw new Error("LLM providerが設定されていません。");
        const result = await services.llmProvider.completeJson(request);
        if (!result.ok) throw new Error(`LLM処理に失敗しました: ${result.error}`);
        return result.value;
      }
    }
  };

  for (const hook of workerScenario.hooks) {
    if (hook.event !== event.event || (hook.target && hook.target !== "*" && hook.target !== event.target)) continue;
    if (!evaluateCondition(hook.cond, effectiveStateValues(workerScenario.stateVariables, nextState.stateValues))) continue;
    if (hook.llm && !services.llmProvider) throw new Error(`LLM必須hookを実行できません: ${hook.handler}`);
    const handler = scenarioHookHandlers[hook.handler as keyof typeof scenarioHookHandlers];
    if (!handler) throw new Error(`hook handlerが登録されていません: ${hook.handler}`);
    await handler(context, event);
  }
  return { state: nextState, generatedAudioEffects, scheduleEffects, transcriptAppends, outcome };
}
