import type { ScenarioHookHandlerRegistry } from "../shared/hooks";
import type { ScenarioHookId } from "../generated/hookIds.generated";

export const scenarioHookHandlers: ScenarioHookHandlerRegistry<ScenarioHookId> = {
  mark_session_started(context) {
    context.state.set("session_started", true);
    context.todo.add("find_old_note");
  },
  mark_old_note_opened(context) {
    context.state.set("old_note_opened", true);
    context.todo.remove("find_old_note");
    context.todo.add("find_rainy_window");
  },
  mark_rainy_window_opened(context) {
    context.state.set("rainy_window_opened", true);
    context.todo.remove("find_rainy_window");
    context.todo.add("report_clue");
  },
  activate_unlock_todo(context) {
    context.todo.remove("report_clue");
    context.todo.add("unlock_recovery_note");
  },
  handle_demo_test_command(context, event) {
    const command = event.playerInput?.normalize("NFKC").trim() ?? "";
    if (command === "着信テスト") {
      context.schedule.after("manual_demo_call", 1_500, "show_demo_call");
    } else if (command === "遅延メッセージ") {
      context.schedule.after("manual_delayed_message", 3_000, "deliver_demo_delayed_message");
    } else if (command === "メッセージ連携" && context.state.get("demo_sms_message_received") !== true) {
      context.talk.addBlock("sms_receiver", "received_from_sms");
      context.state.set("demo_sms_message_received", true);
    } else if (command === "画像受信テスト" && context.state.get("demo_image_received") !== true) {
      context.talk.addBlock("sms_media_receiver", "received_image");
      context.state.set("demo_image_received", true);
    } else if (command === "チャットへ送る") {
      if (context.state.get("chat_auth_verified") === true && context.state.get("demo_chat_cross_received") !== true) {
        context.talk.addBlock("chat_receiver", "received_from_sms");
        context.state.set("demo_chat_cross_received", true);
      } else if (context.state.get("chat_auth_verified") !== true) {
        context.talk.append("guide", "このテストは、チャットの再認証を完了してから実行してください。");
      }
    }
  },
  mark_sealed_note_unlocked(context) {
    context.state.set("sealed_note_unlocked", true);
    context.todo.remove("unlock_recovery_note");
    context.todo.add("restore_chat");
    context.talk.addBlock("guide", "sealed_note_opened");
  },
  schedule_demo_call(context) {
    context.schedule.after("demo_call_once", 1_000, "show_demo_call");
  },
  show_demo_call(context) {
    context.incomingCall.show("demo_call");
  },
  deliver_demo_delayed_message(context) {
    if (context.state.get("demo_delayed_message_received") === true) return;
    context.talk.addBlock("sms_receiver", "received_delayed");
    context.state.set("demo_delayed_message_received", true);
  },
  mark_demo_call_completed(context) {
    context.state.set("demo_call_completed", true);
    context.talk.addBlock("guide", "call_history_guide");
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
    context.todo.remove("restore_chat");
    context.todo.add("authenticate_chat");
    context.talk.addBlock("guide", "chat_auth_link");
  },
  verify_chat_auth(context, event) {
    if (event.fields?.actionId === "chat_auth_link_opened") {
      context.state.set("chat_auth_verified", true);
      context.todo.remove("authenticate_chat");
      context.todo.add("contact_owner");
    }
  },
  complete_demo_todo(context) {
    context.todo.remove("contact_owner");
  },
  handle_demo_chat_test_command(context, event) {
    const command = event.playerInput?.normalize("NFKC").trim() ?? "";
    if (command === "チャット連携" && context.state.get("demo_chat_message_received") !== true) {
      context.talk.addBlock("chat_receiver", "received_from_chat");
      context.state.set("demo_chat_message_received", true);
    } else if (command === "メッセージへ送る" && context.state.get("demo_sms_cross_received") !== true) {
      context.talk.addBlock("sms_receiver", "received_from_chat");
      context.state.set("demo_sms_cross_received", true);
    }
  },
  mark_radio_playback_completed(context, event) {
    if (event.fields?.contentId === "sample_radio") {
      context.state.set("radio_playback_completed", true);
    }
  }
};
