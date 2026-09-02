// scenario:build により生成されます。直接編集しないでください.
import type { ScenarioHookContext } from "../shared/hooks";

export type ScenarioHookStateValues = {
  "image_color_reported": boolean;
  "clue_attachments_pending": boolean;
  "old_note_opened": boolean;
  "rainy_window_opened": boolean;
  "chat_auth_link_sent": boolean;
  "chat_auth_verified": boolean;
  "demo_completed": boolean;
  "demo_completion_announced": boolean;
  "demo_call_completed": boolean;
  "demo_chat_cross_received": boolean;
  "demo_chat_message_received": boolean;
  "session_started": boolean;
  "demo_delayed_message_received": boolean;
  "demo_image_received": boolean;
  "demo_sms_cross_received": boolean;
  "demo_sms_message_received": boolean;
  "sealed_note_unlocked": boolean;
  "radio_playback_completed": boolean;
  "os_date": string;
  "os_time_label": string;
};
export type ScenarioAppId = "phone" | "messages" | "mail" | "notes" | "photos" | "calendar" | "radio" | "browser" | "chat";
export type ScenarioContentId = "demo_call_history" | "missed_call" | "demo_voicemail" | "dummy_call_1" | "dummy_call_2" | "dummy_call_3" | "dummy_call_4" | "dummy_call_5" | "dummy_call_6" | "mail_guide" | "guide_history_archive_a" | "guide_history_archive_b" | "lobby_history_archive" | "damaged_mail" | "dummy_mail_1" | "dummy_mail_2" | "dummy_mail_3" | "dummy_mail_4" | "welcome_note" | "feature_test_guide" | "old_note" | "dummy_note_1" | "dummy_note_2" | "dummy_note_3" | "dummy_note_4" | "dummy_note_5" | "dummy_note_6" | "sealed_note" | "evening_platform" | "rainy_window" | "coffee_table" | "demo_video" | "demo_received_image" | "dummy_photo_1" | "dummy_photo_2" | "dummy_photo_3" | "dummy_photo_4" | "dummy_photo_5" | "dummy_photo_6" | "owner_schedule" | "dummy_schedule_1" | "dummy_schedule_2" | "dummy_schedule_3" | "dummy_schedule_4" | "dummy_schedule_5" | "dummy_schedule_6" | "dummy_schedule_7" | "dummy_schedule_8" | "browser_guide" | "dummy_browser_1" | "dummy_browser_2" | "dummy_browser_3" | "dummy_browser_4" | "dummy_browser_5" | "dummy_browser_6" | "browser_archive" | "sample_radio" | "dummy_radio_1" | "dummy_radio_2" | "dummy_radio_3" | "dummy_radio_4" | "dummy_radio_5";
export type ScenarioIncomingCallId = "demo_call";
export type ScenarioTalkId = "guide" | "sms_receiver" | "sms_media_receiver" | "dummy_sms_1" | "dummy_sms_2" | "dummy_sms_3" | "dummy_sms_4" | "dummy_sms_5" | "dummy_sms_6" | "lobby" | "chat_receiver" | "dummy_chat_1" | "dummy_chat_2" | "dummy_chat_3" | "dummy_chat_4" | "dummy_chat_5" | "dummy_chat_6" | "search_agent";
export const SCENARIO_HOOK_TALK_BLOCKS = {"guide":["history_archive_a","history_archive_b","intro","message_reply","message_test_ack","clue_attachments","chat_auth_link","call_history_guide","chat_auth_required"],"sms_receiver":["start","receiver_reply","received_from_sms","received_from_chat","received_delayed"],"sms_media_receiver":["start","receiver_reply","received_image"],"dummy_sms_1":["start","dummy_reply"],"dummy_sms_2":["start","dummy_reply"],"dummy_sms_3":["start","dummy_reply"],"dummy_sms_4":["start","dummy_reply"],"dummy_sms_5":["start","dummy_reply"],"dummy_sms_6":["start","dummy_reply"],"lobby":["history_archive","start","chat_test_ack","lobby_reply","lobby_done"],"chat_receiver":["start","receiver_reply","received_from_sms","received_from_chat"],"dummy_chat_1":["start","dummy_reply"],"dummy_chat_2":["start","dummy_reply"],"dummy_chat_3":["start","dummy_reply"],"dummy_chat_4":["start","dummy_reply"],"dummy_chat_5":["start","dummy_reply"],"dummy_chat_6":["start","dummy_reply"],"search_agent":["intro","common_help","stage_photo","stage_report","color_reported","stage_chat","stage_auth","stage_contact","stage_done","call_completed","hint_first","hint_photo","hint_report","hint_unlock","hint_chat","hint_auth","hint_contact","hint_done","test_menu","demo_test_already_done","found","not_found"]} as const;
export type ScenarioTalkBlocksByTalk = {
  [TalkId in keyof typeof SCENARIO_HOOK_TALK_BLOCKS]: (typeof SCENARIO_HOOK_TALK_BLOCKS)[TalkId][number];
};
export type ScenarioTodoId = "find_old_note" | "find_rainy_window" | "report_clue" | "unlock_recovery_note" | "restore_chat" | "authenticate_chat" | "contact_owner";
export type ScenarioGenAudioId = "demo_voice";
export type ProjectScenarioHookContext = ScenarioHookContext<
  ScenarioHookStateValues,
  ScenarioAppId,
  ScenarioContentId,
  ScenarioIncomingCallId,
  ScenarioTalkId,
  ScenarioTalkBlocksByTalk,
  ScenarioTodoId,
  ScenarioGenAudioId
>;
