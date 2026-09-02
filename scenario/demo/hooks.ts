import type { ScenarioHookHandlerRegistry } from "../../src/shared/hooks";
import type { ScenarioHookId } from "../../src/generated/hookIds.generated";
import type { ProjectScenarioHookContext } from "../../src/generated/hookContext.generated";

export const scenarioHookHandlers: ScenarioHookHandlerRegistry<ScenarioHookId, ProjectScenarioHookContext> = {
  mark_session_started(context) {
    context.state.set("session_started", true);
    context.todo.add("find_old_note");
  },
  mark_old_note_opened(context) {
    context.state.set("old_note_opened", true);
    context.todo.remove("find_old_note");
    context.todo.add("find_rainy_window");
    context.talk.addBlock("search_agent", "stage_photo", { mode: "stay" });
  },
  mark_rainy_window_opened(context) {
    context.state.set("rainy_window_opened", true);
    context.todo.remove("find_rainy_window");
    if (context.state.get("image_color_reported") !== true) {
      context.todo.add("report_clue");
      context.talk.addBlock("search_agent", "stage_report", { mode: "stay" });
    }
  },
  deliver_clue_attachments(context) {
    if (context.state.get("clue_attachments_pending") !== true) return;
    context.state.set("clue_attachments_pending", false);
    context.todo.remove("find_rainy_window");
    context.todo.remove("report_clue");
    context.todo.add("unlock_recovery_note");
    context.talk.addBlock("guide", "clue_attachments", { mode: "stay" });
  },
  handle_demo_nav_test_command(context, event) {
    const command = event.playerInput?.normalize("NFKC").trim() ?? "";
    if (command === "ゲームオーバー演出") {
      context.effectSequence.gameOver("hookから開始したゲームオーバー演出です。");
    } else if (command === "オールクリア演出") {
      context.effectSequence.allClear("radio", "sample_radio", false);
    } else if (command === "ノイズ演出") {
      context.effect.noise(500);
    } else if (command === "フラッシュ演出") {
      context.effect.flash();
    } else if (command === "暗転演出") {
      context.effect.blackout();
    } else if (command === "着信テスト") {
      if (context.state.get("demo_call_completed") !== true) {
        context.schedule.after("show_demo_call", 1_500, {}, "manual_demo_call");
      }
    } else if (command === "遅延メッセージ") {
      if (context.state.get("demo_delayed_message_received") !== true) {
        context.schedule.after("deliver_demo_delayed_message", 3_000, {}, "manual_delayed_message");
      }
    } else if (command === "画像受信テスト") {
      if (context.state.get("demo_image_received") !== true) {
        context.talk.addBlock("sms_media_receiver", "received_image");
        context.state.set("demo_image_received", true);
      }
    }
  },
  handle_demo_message_test_command(context, event) {
    const command = event.playerInput?.normalize("NFKC").trim() ?? "";
    if ((command === "別ルームへ送る" || command === "メッセージ連携") && context.state.get("demo_sms_message_received") !== true) {
      context.talk.addBlock("sms_receiver", "received_from_sms");
      context.state.set("demo_sms_message_received", true);
    } else if (command === "チャットへ送る") {
      if (context.state.get("chat_auth_verified") === true && context.state.get("demo_chat_cross_received") !== true) {
        context.talk.addBlock("chat_receiver", "received_from_sms");
        context.state.set("demo_chat_cross_received", true);
      }
    }
  },
  mark_sealed_note_unlocked(context) {
    context.state.set("sealed_note_unlocked", true);
    context.todo.remove("unlock_recovery_note");
    context.todo.add("restore_chat");
    context.talk.addBlock("search_agent", "stage_chat", { mode: "stay" });
  },
  schedule_demo_call(context) {
    context.schedule.after("show_demo_call", 1_000, {}, "demo_call_once");
  },
  show_demo_call(context) {
    context.incoming.start("demo_call");
  },
  deliver_demo_delayed_message(context) {
    if (context.state.get("demo_delayed_message_received") === true) return;
    context.talk.addBlock("sms_receiver", "received_delayed");
    context.state.set("demo_delayed_message_received", true);
  },
  mark_demo_call_completed(context) {
    context.state.set("demo_call_completed", true);
    context.talk.addBlock("guide", "call_history_guide", { mode: "stay" });
    context.talk.addBlock("search_agent", "call_completed", { mode: "stay" });
  },
  demo_form_game_over(context) {
    context.effectSequence.gameOver("フォーム送信によるゲームオーバーのデモです。");
  },
  demo_all_clear(context) {
    context.effectSequence.allClear("radio", "sample_radio", true);
  },
  demo_form_reject(context) {
    context.form.deny("message_rejected");
  },
  send_chat_auth_link(context) {
    context.state.set("chat_auth_link_sent", true);
    context.todo.remove("restore_chat");
    context.todo.add("authenticate_chat");
    context.talk.addBlock("guide", "chat_auth_link", { mode: "stay" });
    context.talk.addBlock("search_agent", "stage_auth", { mode: "stay" });
  },
  verify_chat_auth(context, event) {
    if (event.actionId === "chat_auth_link_opened") {
      context.state.set("chat_auth_verified", true);
      context.todo.remove("authenticate_chat");
      context.todo.add("contact_owner");
      context.talk.addBlock("search_agent", "stage_contact", { mode: "stay" });
    }
  },
  complete_demo_todo(context) {
    context.todo.remove("contact_owner");
    context.state.set("demo_completion_announced", true);
    context.talk.addBlock("search_agent", "stage_done", { mode: "stay" });
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
    if (event.contentId === "sample_radio") {
      context.state.set("radio_playback_completed", true);
    }
  }
};
