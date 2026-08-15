import { demoDeviceStateGenerated as deviceState } from "../generated/demoDeviceState.generated";
import type { PlayerState } from "../system/playerApi";
import type { DeviceState, IncomingCallItem } from "./types";

type QaPlayerStateOptions = {
  generatedAudioReady?: boolean;
  radioPlaybackBlocked?: boolean;
  radioFormDisabled?: boolean;
};

const qaSmsId = "qa-sms";
const qaChatId = "qa-chat";
const qaRadioId = "qa-radio";

function createQaDeviceState(options: QaPlayerStateOptions): DeviceState {
  const generatedAudioReady = options.generatedAudioReady !== false;
  return {
    ...deviceState,
    apps: [
      ...deviceState.apps,
      {
        id: "chat",
        label: "チャット",
        icon: "message_square_text",
        accent: "#7ee093",
        available: true
      }
    ],
    messages: [{ id: qaSmsId, contentId: qaSmsId, contactName: "案内役", messages: [], unread: true }],
    chatThreads: [{ id: qaChatId, contentId: qaChatId, roomName: "テストルーム", messages: [] }],
    photos: [{
      id: "qa-photo",
      contentId: "qa-photo",
      title: "確認用画像",
      imageUrl: "/demo/orange-mark.svg",
      initialState: "normal"
    }],
    notes: [
      {
        id: "qa-note",
        contentId: "qa-note",
        title: "表示確認用メモ",
        body: "これはQA表示専用の文章です。実シナリオの未到達本文は含みません。",
        initialState: "normal"
      },
      {
        id: "qa-corrupted-note",
        contentId: "qa-corrupted-note",
        title: "破損したメモ",
        body: "<ERROR コンテンツへのリンクが破損しています>",
        initialState: "repairable",
        repairLabel: "メ▚▐▀▜モ",
        corrupted: true
      }
    ],
    calendarEvents: [{
      id: "qa-calendar",
      contentId: "qa-calendar",
      title: "表示確認",
      date: "6/5",
      time: "20:30",
      place: "テスト会場",
      memo: "QA表示専用の予定です。",
      initialState: "normal"
    }],
    callLogs: [{
      id: "qa-call",
      contentId: "qa-call",
      name: "非通知",
      kind: "missed",
      at: "20:02",
      durationLabel: "応答なし",
      initialState: "normal"
    }],
    radioItems: [{
      id: qaRadioId,
      contentId: qaRadioId,
      programTitle: "表示確認放送",
      audioUrl: "/system/incoming-call-bell.wav",
      initialState: "normal",
      ...(options.radioPlaybackBlocked ? { playbackDisabledLabel: "現在は再生できません" } : {}),
      form: {
        kind: "html",
        id: "qa-form",
        label: "確認フォーム",
        url: "/privacy-policy.html",
        ...(options.radioFormDisabled ? { disabled: true } : {})
      },
      generatedAudio: {
        id: "qa-generated-audio",
        status: generatedAudioReady ? "ready" : "running",
        requestedAt: new Date().toISOString(),
        completedAt: generatedAudioReady ? new Date().toISOString() : null,
        publicAudioUrl: generatedAudioReady ? "/system/incoming-call-bell.wav" : null,
        fallbackAudioUrl: "/system/incoming-call-bell.wav"
      }
    }],
    notifications: [{
      id: "qa-notification",
      appId: "messages",
      targetContentId: qaSmsId,
      title: "案内役",
      body: "表示確認用の新着通知です。"
    }],
    todos: [{ id: "qa-todo", text: "各アプリの表示を確認する" }]
  };
}

export function createQaPlayerState(options: QaPlayerStateOptions = {}): PlayerState {
  const visibleDeviceState = createQaDeviceState(options);
  return {
    clientRevision: "",
    revision: deviceState.revision,
    stateVersion: 1,
    serialCounter: "qa",
    nextScenarioWakeAt: null,
    scenarioTime: {
      dateLabel: deviceState.currentDateLabel,
      timeLabel: deviceState.currentTimeLabel
    },
    projectState: {},
    visibleDeviceState,
    todos: visibleDeviceState.todos,
    assistantMessages: [{
      id: "qa-assistant",
      surface: "home",
      body: "検索エージェントの表示確認です。",
      weight: 1,
      agentAction: "hi"
    }],
    contentStates: [],
    unlockedAttachments: [{
      contentId: "qa-unlocked-attachment",
      title: "開封済み添付",
      body: "添付内容の表示確認です。"
    }],
    talks: [
      { talkId: qaSmsId, kind: "sms", canPost: true, turnKey: "qa-sms-turn", transcriptKey: "qa-sms-key", lastMessageSeq: 2 },
      { talkId: qaChatId, kind: "chat", canPost: true, turnKey: "qa-chat-turn", transcriptKey: "qa-chat-key", lastMessageSeq: 1 }
    ],
    searchTranscript: { transcriptKey: "qa-search", lastMessageSeq: 1 },
    transcriptDeltas: [],
    smsMessages: [
      { seq: 1, id: "qa-sms-1", talkId: qaSmsId, sender: "other", body: "端末の表示を確認してください。", attachment: null, sentAt: new Date().toISOString() },
      { seq: 2, id: "qa-sms-2", talkId: qaSmsId, sender: "owner", body: "確認します。", attachment: null, sentAt: new Date().toISOString() }
    ],
    chatMessages: [{
      seq: 1,
      id: "qa-chat-1",
      talkId: qaChatId,
      sender: "other",
      senderName: "参加者",
      body: "チャットUIの表示確認です。",
      attachment: null,
      sentAt: new Date().toISOString()
    }],
    searchAgentMessages: [{
      seq: 1,
      id: "qa-search-1",
      requestId: "qa-search",
      role: "assistant",
      body: "検索結果の表示確認です。",
      sentAt: new Date().toISOString(),
      results: []
    }]
  };
}

export function createQaIncomingCall(): IncomingCallItem {
  return {
    id: "qa-incoming-call",
    name: "非通知",
    audioUrl: "/system/incoming-call-bell.wav"
  };
}
