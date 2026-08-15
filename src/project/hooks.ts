import type { ScenarioHookHandlerRegistry } from "../shared/hooks";
import type { ScenarioHookId } from "../generated/hookIds.generated";

export const scenarioHookHandlers: ScenarioHookHandlerRegistry<ScenarioHookId> = {
  mark_session_started(context) {
    context.state.set("session_started", true);
  },
  mark_old_note_opened(context) {
    context.state.set("old_note_opened", true);
    context.todo.remove("find_old_note");
  },
  mark_sealed_note_unlocked(context) {
    context.state.set("sealed_note_unlocked", true);
  },
  schedule_demo_call(context) {
    context.schedule.after("demo_call_once", 1_000, "show_demo_call");
  },
  show_demo_call(context) {
    context.incomingCall.show("demo_call");
  },
  demo_form_game_over(context) {
    context.form.gameOver("フォーム送信によるゲームオーバーのデモです。");
  },
  demo_all_clear(context) {
    context.outcome.allClear("radio", "sample_radio", true);
  },
  demo_form_reject(context) {
    context.form.reject("message_rejected");
  },
  send_chat_auth_link(context) {
    context.state.set("chat_auth_link_sent", true);
    context.talk.addBlock("guide", "chat_auth_link");
  },
  verify_chat_auth(context, event) {
    if (event.fields?.actionId === "chat_auth_link_opened") {
      context.state.set("chat_auth_verified", true);
    }
  },
  mark_radio_playback_completed(context, event) {
    if (event.fields?.contentId === "sample_radio") {
      context.state.set("radio_playback_completed", true);
    }
  }
};
