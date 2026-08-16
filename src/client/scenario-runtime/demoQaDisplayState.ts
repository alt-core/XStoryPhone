import { demoDeviceStateGenerated as deviceState } from "../generated/demoDeviceState.generated";
import type { PlayerState } from "../system/playerApi";
import type { DeviceState, IncomingCallItem } from "./types";

type QaPlayerStateOptions = {
  generatedAudioReady?: boolean;
  radioPlaybackBlocked?: boolean;
  radioFormDisabled?: boolean;
  stressContent?: boolean;
};

const qaSmsId = "qa-sms";
const qaChatId = "qa-chat";
const qaRadioId = "qa-radio";

function createQaDeviceState(options: QaPlayerStateOptions): DeviceState {
  const generatedAudioReady = options.generatedAudioReady !== false;
  const stressContent = options.stressContent === true;
  const extraSmsThreads = stressContent
    ? Array.from({ length: 9 }, (_, index) => ({
        id: `qa-sms-extra-${index + 1}`,
        contentId: `qa-sms-extra-${index + 1}`,
        contactName: index === 8 ? "とても長い名前の表示確認用連絡先" : `確認相手 ${index + 1}`,
        messages: [],
        unread: index % 3 === 0
      }))
    : [];
  const extraChatThreads = stressContent
    ? Array.from({ length: 9 }, (_, index) => ({
        id: `qa-chat-extra-${index + 1}`,
        contentId: `qa-chat-extra-${index + 1}`,
        roomName: index === 8 ? "長いルーム名が省略されることを確認する部屋" : `確認ルーム ${index + 1}`,
        messages: []
      }))
    : [];
  const extraPhotos = stressContent
    ? Array.from({ length: 10 }, (_, index) => ({
        id: `qa-photo-extra-${index + 1}`,
        contentId: `qa-photo-extra-${index + 1}`,
        title: index === 9 ? "非常に長いタイトルを持つ表示確認用の画像" : `確認用画像 ${index + 1}`,
        imageUrl: [
          "/demo/album/coffee-table.webp",
          "/demo/album/evening-platform.webp",
          "/demo/album/rainy-window.webp"
        ][index % 3],
        tags: index === 9 ? ["表示確認", "長いタグ名の横スクロール", "追加情報", "分類", "手がかり"] : [],
        initialState: "normal" as const
      }))
    : [];
  const extraNotes = stressContent
    ? Array.from({ length: 8 }, (_, index) => ({
        id: `qa-note-extra-${index + 1}`,
        contentId: `qa-note-extra-${index + 1}`,
        title: index === 7 ? "一覧で省略されることを確認するための非常に長いメモタイトル" : `確認用メモ ${index + 1}`,
        body: index === 0
          ? "長文のスクロールを確認するための文章です。".repeat(48)
          : `これは${index + 1}件目のQA表示専用メモです。`,
        tags: index === 0 ? ["長文", "スクロール", "表示確認"] : [],
        initialState: "normal" as const
      }))
    : [];
  const extraCalendarEvents = stressContent
    ? Array.from({ length: 6 }, (_, index) => ({
        id: `qa-calendar-extra-${index + 1}`,
        contentId: `qa-calendar-extra-${index + 1}`,
        title: index === 5 ? "長い予定名がカード内で折り返されることを確認" : `表示確認 ${index + 1}`,
        date: "6/5",
        time: `${String(9 + index).padStart(2, "0")}:30`,
        place: index === 5 ? "表示領域を超える可能性のある長いテスト会場名" : "テスト会場",
        memo: "予定一覧の縦スクロールを確認します。",
        initialState: "normal" as const
      }))
    : [];
  const extraCallLogs = stressContent
    ? Array.from({ length: 15 }, (_, index) => ({
        id: `qa-call-extra-${index + 1}`,
        contentId: `qa-call-extra-${index + 1}`,
        name: index === 14 ? "非常に長い名前の表示確認用発信者" : `確認通話 ${index + 1}`,
        kind: index % 2 === 0 ? "incoming" as const : "outgoing" as const,
        at: `${String(8 + (index % 12)).padStart(2, "0")}:${index % 2 === 0 ? "10" : "40"}`,
        durationLabel: `${index + 1}分`,
        initialState: "normal" as const
      }))
    : [];
  const extraRadioItems = stressContent
    ? Array.from({ length: 5 }, (_, index) => ({
        id: `qa-radio-extra-${index + 1}`,
        contentId: `qa-radio-extra-${index + 1}`,
        programTitle: index === 4 ? "一覧で省略されることを確認する非常に長い番組タイトル" : `表示確認放送 ${index + 1}`,
        audioUrl: "/system/incoming-call-bell.wav",
        initialState: "normal" as const
      }))
    : [];
  const extraNotifications = stressContent
    ? Array.from({ length: 11 }, (_, index) => ({
        id: `qa-notification-extra-${index + 1}`,
        appId: "messages" as const,
        targetContentId: qaSmsId,
        title: `表示確認通知 ${index + 1}`,
        body: index === 10 ? "通知本文が長い場合に省略表示され、一覧全体は縦へスクロールできることを確認します。" : "通知一覧のスクロール確認です。"
      }))
    : [];
  const extraTodos = stressContent
    ? Array.from({ length: 11 }, (_, index) => ({
        id: `qa-todo-extra-${index + 1}`,
        text: index === 10 ? "長いToDo本文が複数行になっても一覧を最後まで確認できる" : `追加の確認項目 ${index + 1}`
      }))
    : [];
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
    messages: [{ id: qaSmsId, contentId: qaSmsId, contactName: "案内役", messages: [], unread: true }, ...extraSmsThreads],
    chatThreads: [{ id: qaChatId, contentId: qaChatId, roomName: "テストルーム", messages: [] }, ...extraChatThreads],
    photos: [{
      id: "qa-photo",
      contentId: "qa-photo",
      title: "確認用画像",
      imageUrl: "/demo/album/evening-platform.webp",
      tags: ["表示確認", "静止画", "横スクロール確認用の長いタグ", "手がかり"],
      initialState: "normal"
    }, {
      id: "qa-video",
      contentId: "qa-video",
      title: "確認用動画",
      mediaKind: "still_video",
      imageUrl: "/demo/album/rainy-window.webp",
      audioUrl: "/system/incoming-call-bell.wav",
      tags: ["表示確認", "動画", "再生UIの上"],
      initialState: "normal"
    }, ...extraPhotos],
    notes: [
      {
        id: "qa-note",
        contentId: "qa-note",
        title: "表示確認用メモ",
        body: "これはQA表示専用の文章です。実シナリオの未到達本文は含みません。",
        tags: ["表示確認", "メモ", "横スクロール確認用の長いタグ", "補助情報"],
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
      },
      ...extraNotes
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
    }, ...extraCalendarEvents],
    callLogs: [{
      id: "qa-call",
      contentId: "qa-call",
      name: "非通知",
      kind: "missed",
      at: "20:02",
      durationLabel: "応答なし",
      initialState: "normal"
    }, ...extraCallLogs],
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
    }, ...extraRadioItems],
    notifications: [{
      id: "qa-notification",
      appId: "messages",
      targetContentId: qaSmsId,
      title: "案内役",
      body: "表示確認用の新着通知です。"
    }, ...extraNotifications],
    todos: [{ id: "qa-todo", text: "各アプリの表示を確認する" }, ...extraTodos]
  };
}

export function createQaPlayerState(options: QaPlayerStateOptions = {}): PlayerState {
  const visibleDeviceState = createQaDeviceState(options);
  const stressContent = options.stressContent === true;
  const smsMessages = stressContent
    ? Array.from({ length: 32 }, (_, index) => ({
        seq: index + 1,
        id: `qa-sms-${index + 1}`,
        talkId: qaSmsId,
        sender: index % 3 === 0 ? "owner" as const : "other" as const,
        body: index === 30
          ? "長いメッセージ本文が複数行に折り返されても、入力欄を隠さず履歴を最後までスクロールできることを確認します。"
          : `メッセージ履歴の表示確認 ${index + 1}`,
        attachment: null,
        sentAt: `2026-08-12T${String(8 + Math.floor(index / 6)).padStart(2, "0")}:${String((index * 7) % 60).padStart(2, "0")}:00.000Z`
      }))
    : [
        { seq: 1, id: "qa-sms-1", talkId: qaSmsId, sender: "other" as const, body: "端末の表示を確認してください。", attachment: null, sentAt: new Date().toISOString() },
        { seq: 2, id: "qa-sms-2", talkId: qaSmsId, sender: "owner" as const, body: "確認します。", attachment: null, sentAt: new Date().toISOString() }
      ];
  const chatMessages = stressContent
    ? Array.from({ length: 28 }, (_, index) => ({
        seq: index + 1,
        id: `qa-chat-${index + 1}`,
        talkId: qaChatId,
        sender: index % 4 === 0 ? "owner" as const : "other" as const,
        senderName: index % 4 === 0 ? null : `参加者${(index % 3) + 1}`,
        body: index === 26
          ? "複数人の長いチャット本文が折り返されても、送信操作と履歴スクロールが両立することを確認します。"
          : `チャット履歴の表示確認 ${index + 1}`,
        attachment: null,
        sentAt: `2026-08-12T${String(12 + Math.floor(index / 7)).padStart(2, "0")}:${String((index * 5) % 60).padStart(2, "0")}:00.000Z`
      }))
    : [{
        seq: 1,
        id: "qa-chat-1",
        talkId: qaChatId,
        sender: "other" as const,
        senderName: "参加者",
        body: "チャットUIの表示確認です。",
        attachment: null,
        sentAt: new Date().toISOString()
      }];
  const extraTalks = stressContent
    ? [
        ...visibleDeviceState.messages.slice(1).map((thread) => ({
          talkId: thread.id,
          kind: "sms" as const,
          canPost: true,
          turnKey: `${thread.id}-turn`,
          transcriptKey: `${thread.id}-key`,
          lastMessageSeq: 0
        })),
        ...visibleDeviceState.chatThreads.slice(1).map((thread) => ({
          talkId: thread.id,
          kind: "chat" as const,
          canPost: true,
          turnKey: `${thread.id}-turn`,
          transcriptKey: `${thread.id}-key`,
          lastMessageSeq: 0
        }))
      ]
    : [];
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
      { talkId: qaSmsId, kind: "sms", canPost: true, turnKey: "qa-sms-turn", transcriptKey: "qa-sms-key", lastMessageSeq: smsMessages.length },
      { talkId: qaChatId, kind: "chat", canPost: true, turnKey: "qa-chat-turn", transcriptKey: "qa-chat-key", lastMessageSeq: chatMessages.length },
      ...extraTalks
    ],
    searchTranscript: { transcriptKey: "qa-search", lastMessageSeq: 1 },
    transcriptDeltas: [],
    smsMessages,
    chatMessages,
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
