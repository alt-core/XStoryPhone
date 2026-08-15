// scenario:build により生成されます。直接編集しないでください。
import type { WorkerScenario } from "../shared/scenario";

export const workerScenario: WorkerScenario = {
  "revision": "e8ec17fa1ed44e1e",
  "playerMode": "server",
  "project": {
    "id": "demo",
    "name": "XStoryPhone Demo",
    "osName": "StoryOS",
    "assistantName": "ナビ",
    "accentColor": "#8fd2ff",
    "dateLabel": "8月12日（水）",
    "timeLabel": "20:14",
    "batteryLevel": 72,
    "signalLabel": "4G",
    "wallpaperUrl": "/demo/wallpaper.svg"
  },
  "apps": [
    {
      "id": "phone",
      "label": "電話",
      "icon": "phone",
      "accent": "#67d78e",
      "initialState": "normal",
      "search": [
        "電話",
        "着信"
      ],
      "cond": ""
    },
    {
      "id": "messages",
      "label": "メッセージ",
      "icon": "message_circle",
      "accent": "#5cc8a7",
      "initialState": "normal",
      "search": [
        "メッセージ",
        "ナビ"
      ],
      "cond": ""
    },
    {
      "id": "notes",
      "label": "メモ",
      "icon": "notebook_pen",
      "accent": "#8fd2ff",
      "initialState": "normal",
      "search": [
        "メモ",
        "ノート"
      ],
      "cond": ""
    },
    {
      "id": "photos",
      "label": "アルバム",
      "icon": "album",
      "accent": "#f0b35d",
      "initialState": "normal",
      "search": [
        "アルバム",
        "写真"
      ],
      "cond": ""
    },
    {
      "id": "calendar",
      "label": "スケジュール",
      "icon": "calendar_days",
      "accent": "#f07178",
      "initialState": "normal",
      "search": [
        "予定",
        "スケジュール"
      ],
      "cond": ""
    },
    {
      "id": "radio",
      "label": "ラジオ",
      "icon": "radio",
      "accent": "#f4c86a",
      "initialState": "normal",
      "search": [
        "ラジオ",
        "放送"
      ],
      "cond": ""
    },
    {
      "id": "chat",
      "label": "チャット",
      "repairLabel": "チャ▗▛▞▐▀",
      "icon": "message_square_text",
      "accent": "#7ee093",
      "initialState": "repairable",
      "cond": "clue_reported",
      "search": [
        "チャット",
        "ロビー",
        "掲示板"
      ]
    }
  ],
  "features": {
    "llm": false
  },
  "stateVariables": {
    "clue_reported": false,
    "old_note_opened": false,
    "chat_auth_link_sent": false,
    "chat_auth_verified": false,
    "session_started": false,
    "sealed_note_unlocked": false,
    "radio_playback_completed": false
  },
  "publicStateVariables": [],
  "contents": [
    {
      "id": "missed_call",
      "appId": "phone",
      "initialState": "normal",
      "search": [
        "電話",
        "着信",
        "非通知"
      ],
      "record": {
        "name": "非通知",
        "kind": "missed",
        "at": "20:02",
        "durationLabel": "応答なし"
      },
      "cond": "",
      "publicId": "c_0376fabddf4f"
    },
    {
      "id": "welcome_note",
      "appId": "notes",
      "initialState": "normal",
      "search": [
        "端末",
        "持ち主",
        "手がかり",
        "ヒント"
      ],
      "record": {
        "title": "拾った端末について",
        "body": "この端末には、まだ開けない断片が残っている。右下のナビで「古いメモ」と検索してみよう。"
      },
      "cond": "",
      "publicId": "c_fbeb27e60040"
    },
    {
      "id": "old_note",
      "appId": "notes",
      "initialState": "repairable",
      "repairLabel": "古▚▐▀▜メモ",
      "search": [
        "古いメモ",
        "ふるいメモ",
        "鍵",
        "手がかり"
      ],
      "record": {
        "title": "古いメモ",
        "body": "オレンジ色の印を見つけたら、メッセージで「見つけた」と伝える。"
      },
      "cond": "",
      "publicId": "c_32c01e364751"
    },
    {
      "id": "sealed_note",
      "appId": "notes",
      "initialState": "hidden",
      "cond": "clue_reported",
      "search": [
        "鍵付き",
        "添付",
        "パスワード"
      ],
      "record": {
        "title": "鍵付き添付の中身",
        "body": "パスワード付き添付を開封すると、対応するコンテンツも利用可能になります。",
        "unlockCode": "0420"
      },
      "publicId": "c_bdffc57fcb5c"
    },
    {
      "id": "orange_mark",
      "appId": "photos",
      "initialState": "hidden",
      "search": [
        "オレンジ",
        "印",
        "写真"
      ],
      "record": {
        "title": "オレンジ色の印",
        "imageUrl": "/demo/orange-mark.svg"
      },
      "cond": "",
      "publicId": "c_1c9fa608e356"
    },
    {
      "id": "owner_schedule",
      "appId": "calendar",
      "initialState": "normal",
      "search": [
        "予定",
        "8月12日",
        "20時30分"
      ],
      "record": {
        "title": "端末の持ち主を探す",
        "date": "8/12",
        "time": "20:30",
        "place": "駅前",
        "memo": "オレンジ色の印が目印。"
      },
      "cond": "",
      "publicId": "c_5ad6b8c27c5f"
    },
    {
      "id": "sample_radio",
      "appId": "radio",
      "initialState": "normal",
      "search": [
        "ラジオ",
        "放送",
        "音声"
      ],
      "record": {
        "programTitle": "接続テスト放送",
        "genAudioId": "demo_voice"
      },
      "cond": "",
      "publicId": "c_513e68175e27"
    }
  ],
  "talks": [
    {
      "id": "guide",
      "kind": "sms",
      "appId": "messages",
      "label": "ナビ",
      "startBlocks": [
        "guide::intro"
      ],
      "cond": "",
      "publicId": "t_17f5f84e4690",
      "initialFrom": "guide::intro",
      "rules": [
        {
          "id": "rule_f7d1b77b1649",
          "order": 2,
          "from": "*",
          "isDefault": false,
          "cond": "",
          "intent": "ヘルプ",
          "criteria": "/^(?:help|ヘルプ)$/i",
          "match": "",
          "nextBlocks": [
            "guide::common_help"
          ],
          "set": [],
          "mode": "stay",
          "notes": "どの状態からでも利用できる共通分岐",
          "example": "ヘルプ"
        },
        {
          "id": "rule_1b8c4826049d",
          "order": 3,
          "from": "guide::intro",
          "isDefault": false,
          "cond": "",
          "intent": "手がかり発見",
          "criteria": "/^(?:見つけた|みつけた|発見した)[！!。.]?$/i",
          "match": "",
          "nextBlocks": [
            "guide::found_lead",
            "guide::found_done"
          ],
          "set": [
            "clue_reported=true"
          ],
          "mode": "",
          "notes": "正規表現だけで選択するデモ",
          "example": "見つけた"
        },
        {
          "id": "rule_7877f9272516",
          "order": 4,
          "from": "guide::intro",
          "isDefault": true,
          "cond": "",
          "intent": "",
          "criteria": "",
          "match": "",
          "nextBlocks": [
            "guide::intro_prompt"
          ],
          "set": [],
          "mode": "stay",
          "notes": "",
          "example": ""
        },
        {
          "id": "rule_a32502c81504",
          "order": 5,
          "from": "guide::found_done",
          "isDefault": false,
          "cond": "",
          "intent": "ゲームオーバー確認",
          "criteria": "/^終了$/u",
          "match": "",
          "nextBlocks": [
            "guide::game_over_reply"
          ],
          "set": [],
          "mode": "game_over",
          "notes": "ゲームオーバーUIのデモ",
          "example": "終了"
        },
        {
          "id": "rule_b4f5779413a1",
          "order": 6,
          "from": "guide::found_done",
          "isDefault": true,
          "cond": "",
          "intent": "",
          "criteria": "",
          "match": "",
          "nextBlocks": [
            "guide::done_repeat"
          ],
          "set": [],
          "mode": "stay",
          "notes": "",
          "example": ""
        }
      ]
    },
    {
      "id": "lobby",
      "kind": "chat",
      "appId": "chat",
      "label": "公開ロビー",
      "cond": "clue_reported",
      "startBlocks": [
        "lobby::start"
      ],
      "publicId": "t_384f82df1ef6",
      "initialFrom": "lobby::start",
      "rules": [
        {
          "id": "rule_a418e8a42f65",
          "order": 7,
          "from": "lobby::start",
          "isDefault": true,
          "cond": "",
          "intent": "",
          "criteria": "",
          "match": "",
          "nextBlocks": [
            "lobby::lobby_reply"
          ],
          "set": [],
          "mode": "stay",
          "notes": "",
          "example": ""
        }
      ]
    }
  ],
  "talkPeople": [
    {
      "id": "owner",
      "name": "あなた",
      "role": "owner"
    },
    {
      "id": "guide",
      "name": "ナビ",
      "role": "npc"
    },
    {
      "id": "visitor",
      "name": "通りすがり",
      "role": "npc"
    }
  ],
  "talkBlocks": [
    {
      "id": "guide::intro",
      "talkId": "guide",
      "blockKey": "intro",
      "messages": [
        {
          "id": "guide::intro_1",
          "sender": "guide",
          "body": "端末の中に壊れたメモがあるみたい。右下のナビを開いて「古いメモ」と検索してみて。",
          "attachmentId": "",
          "sentAt": "20:14",
          "notes": "",
          "updatedAt": "2026-08-12",
          "source": "human"
        }
      ]
    },
    {
      "id": "guide::intro_prompt",
      "talkId": "guide",
      "blockKey": "intro_prompt",
      "messages": [
        {
          "id": "guide::intro_prompt_1",
          "sender": "guide",
          "body": "「見つけた」と送ってくれれば、次へ進めるよ。",
          "attachmentId": "",
          "sentAt": "",
          "delayMs": 650,
          "notes": "",
          "updatedAt": "2026-08-12",
          "source": "human"
        }
      ]
    },
    {
      "id": "guide::intro_prompt@2",
      "talkId": "guide",
      "blockKey": "intro_prompt@2",
      "repeatOf": "guide::intro_prompt",
      "repeatIndex": 2,
      "messages": [
        {
          "id": "guide::intro_prompt@2_1",
          "sender": "guide",
          "body": "古いメモを開いて、書かれていた合図を送ってみて。",
          "attachmentId": "",
          "sentAt": "",
          "delayMs": 650,
          "notes": "",
          "updatedAt": "2026-08-12",
          "source": "human"
        }
      ]
    },
    {
      "id": "guide::common_help",
      "talkId": "guide",
      "blockKey": "common_help",
      "messages": [
        {
          "id": "guide::common_help_1",
          "sender": "guide",
          "body": "右下のナビで「古いメモ」を検索し、見つかったメモの指示を試してみて。",
          "attachmentId": "",
          "sentAt": "",
          "delayMs": 500,
          "notes": "",
          "updatedAt": "2026-08-12",
          "source": "human"
        }
      ]
    },
    {
      "id": "guide::found_lead",
      "talkId": "guide",
      "blockKey": "found_lead",
      "messages": [
        {
          "id": "guide::found_lead_1",
          "sender": "guide",
          "body": "見つけてくれたんだね。",
          "attachmentId": "",
          "sentAt": "",
          "delayMs": 450,
          "notes": "",
          "updatedAt": "2026-08-12",
          "source": "human"
        }
      ]
    },
    {
      "id": "guide::found_done",
      "talkId": "guide",
      "blockKey": "found_done",
      "messages": [
        {
          "id": "guide::found_done_1",
          "sender": "guide",
          "body": "手がかりを確認できました。次は、ホームに現れた壊れた「チャット」をナビで検索してみてください。",
          "attachmentId": "orange_mark_image",
          "sentAt": "",
          "delayMs": 700,
          "notes": "",
          "updatedAt": "2026-08-12",
          "source": "human"
        },
        {
          "id": "guide::found_done_2",
          "sender": "guide",
          "body": "鍵付き添付の例です。パスワードは「0420」。最初のメモもここから読み返せます。",
          "segments": [
            {
              "kind": "text",
              "text": "鍵付き添付の例です。パスワードは「0420」。最初の"
            },
            {
              "kind": "link",
              "text": "メモ",
              "appId": "notes",
              "contentId": "welcome_note"
            },
            {
              "kind": "text",
              "text": "もここから読み返せます。"
            }
          ],
          "attachmentId": "sealed_note_file",
          "sentAt": "",
          "delayMs": 700,
          "notes": "",
          "updatedAt": "2026-08-12",
          "source": "human"
        }
      ]
    },
    {
      "id": "guide::done_repeat",
      "talkId": "guide",
      "blockKey": "done_repeat",
      "messages": [
        {
          "id": "guide::done_repeat_1",
          "sender": "guide",
          "body": "ここまでが最小デモです。シナリオを書き換えて、あなたの物語を始めてください。",
          "attachmentId": "",
          "sentAt": "",
          "delayMs": 700,
          "notes": "",
          "updatedAt": "2026-08-12",
          "source": "human"
        }
      ]
    },
    {
      "id": "guide::done_repeat@2",
      "talkId": "guide",
      "blockKey": "done_repeat@2",
      "repeatOf": "guide::done_repeat",
      "repeatIndex": 2,
      "messages": [
        {
          "id": "guide::done_repeat@2_1",
          "sender": "guide",
          "body": "別の分岐やメッセージブロックも追加できます。",
          "attachmentId": "",
          "sentAt": "",
          "delayMs": 550,
          "notes": "",
          "updatedAt": "2026-08-12",
          "source": "human"
        }
      ]
    },
    {
      "id": "guide::game_over_reply",
      "talkId": "guide",
      "blockKey": "game_over_reply",
      "messages": [
        {
          "id": "guide::game_over_reply_1",
          "sender": "guide",
          "body": "この入力はゲームオーバー演出のデモです。",
          "attachmentId": "",
          "sentAt": "",
          "delayMs": 500,
          "notes": "",
          "updatedAt": "2026-08-12",
          "source": "human"
        }
      ]
    },
    {
      "id": "guide::chat_auth_link",
      "talkId": "guide",
      "blockKey": "chat_auth_link",
      "messages": [
        {
          "id": "guide::chat_auth_link_1",
          "sender": "guide",
          "body": "チャットの再認証リンクを発行しました。チャットを開く",
          "segments": [
            {
              "kind": "text",
              "text": "チャットの再認証リンクを発行しました。"
            },
            {
              "kind": "link",
              "text": "チャットを開く",
              "appId": "chat",
              "contentId": "lobby",
              "actionId": "chat_auth_link_opened"
            }
          ],
          "attachmentId": "",
          "sentAt": "",
          "delayMs": 500,
          "notes": "",
          "updatedAt": "2026-08-12",
          "source": "human"
        }
      ]
    },
    {
      "id": "lobby::start",
      "talkId": "lobby",
      "blockKey": "start",
      "messages": [
        {
          "id": "lobby::start_1",
          "sender": "visitor",
          "body": "ここはチャットUIのデモです。何か送るとdefault ruleが応答します。",
          "attachmentId": "",
          "sentAt": "20:14",
          "notes": "",
          "updatedAt": "2026-08-12",
          "source": "human"
        }
      ]
    },
    {
      "id": "lobby::lobby_reply",
      "talkId": "lobby",
      "blockKey": "lobby_reply",
      "messages": [
        {
          "id": "lobby::lobby_reply_1",
          "sender": "visitor",
          "body": "メッセージを受け取りました。",
          "attachmentId": "",
          "sentAt": "",
          "delayMs": 400,
          "notes": "",
          "updatedAt": "2026-08-12",
          "source": "human"
        },
        {
          "id": "lobby::lobby_reply_2",
          "sender": "guide",
          "body": "チャットにも同じ会話エンジンを利用できます。",
          "attachmentId": "",
          "sentAt": "",
          "delayMs": 650,
          "notes": "",
          "updatedAt": "2026-08-12",
          "source": "human"
        }
      ]
    }
  ],
  "attachments": [
    {
      "id": "orange_mark_image",
      "type": "image",
      "asset": "/demo/orange-mark.svg",
      "content": "orange_mark"
    },
    {
      "id": "sealed_note_file",
      "type": "image",
      "asset": "/demo/orange-mark.svg",
      "content": "sealed_note",
      "lock": "password",
      "title": "鍵付きのメモ",
      "body": "開封できました。物語では、ここへ次の手がかりを記述できます。"
    }
  ],
  "repeatTalkBlocks": {
    "guide::intro_prompt": [
      "guide::intro_prompt@2"
    ],
    "guide::done_repeat": [
      "guide::done_repeat@2"
    ]
  },
  "incomingCalls": [
    {
      "id": "demo_call",
      "name": "持ち主候補"
    }
  ],
  "initialSchedules": [],
  "todos": [
    {
      "id": "find_old_note",
      "text": "ナビで「古いメモ」を検索する",
      "cond": "!old_note_opened"
    }
  ],
  "notifications": [
    {
      "id": "welcome",
      "appId": "messages",
      "targetTalkId": "guide",
      "title": "ナビ",
      "body": "端末の中を調べてみよう。",
      "cond": "!old_note_opened"
    },
    {
      "id": "chat_auth",
      "appId": "messages",
      "targetTalkId": "guide",
      "title": "チャット認証",
      "body": "再認証用のリンクを発行しました。",
      "cond": "chat_auth_link_sent && !chat_auth_verified"
    }
  ],
  "assistantMessages": [
    {
      "id": "home_hint",
      "surface": "home",
      "body": "端末内の気になる言葉を検索できます。",
      "weight": 1,
      "agentAction": "hi",
      "cond": "!clue_reported"
    },
    {
      "id": "sealed_note_opened",
      "surface": "messages",
      "body": "鍵付き添付を開封できました。",
      "weight": 1,
      "agentAction": "hi",
      "cond": "sealed_note_unlocked"
    },
    {
      "id": "radio_completed",
      "surface": "radio",
      "body": "音声の再生完了イベントを受け取りました。",
      "weight": 1,
      "cond": "radio_playback_completed"
    }
  ],
  "searchResponses": [
    {
      "id": "hint",
      "when": "",
      "search": [
        "ヒント"
      ],
      "body": "まずは「古いメモ」と検索してみて。",
      "suppressResults": true,
      "cond": ""
    },
    {
      "id": "found",
      "when": "found",
      "body": "見つかったよ。",
      "search": [],
      "cond": "",
      "suppressResults": false
    },
    {
      "id": "not_found",
      "when": "not_found",
      "body": "該当するデータは見つかりませんでした。",
      "suppressResults": true,
      "search": [],
      "cond": ""
    }
  ],
  "chatAuthGate": {
    "cond": "clue_reported && !chat_auth_verified",
    "linkSentCond": "chat_auth_link_sent"
  },
  "clientCallableEvents": [
    "chat_auth_link_requested"
  ],
  "generatedAudio": [
    {
      "id": "demo_voice",
      "title": "生成音声デモ",
      "provider": "static",
      "publicId": "g_aedd90a2a532",
      "staticUrl": "/api/generated-audio/static/g_aedd90a2a532"
    }
  ],
  "hooks": [
    {
      "event": "session_started",
      "handler": "mark_session_started",
      "cond": "!session_started",
      "target": "",
      "llm": false
    },
    {
      "event": "content_repaired",
      "target": "old_note",
      "handler": "mark_old_note_opened",
      "cond": "!old_note_opened",
      "llm": false
    },
    {
      "event": "content_unlocked",
      "target": "sealed_note",
      "handler": "mark_sealed_note_unlocked",
      "cond": "!sealed_note_unlocked",
      "llm": false
    },
    {
      "event": "scenario_event",
      "target": "schedule_demo_call",
      "handler": "schedule_demo_call",
      "cond": "",
      "llm": false
    },
    {
      "event": "scenario_event",
      "target": "show_demo_call",
      "handler": "show_demo_call",
      "cond": "",
      "llm": false
    },
    {
      "event": "scenario_event",
      "target": "demo_form",
      "handler": "demo_form_game_over",
      "cond": "",
      "llm": false
    },
    {
      "event": "scenario_event",
      "target": "demo_all_clear",
      "handler": "demo_all_clear",
      "cond": "",
      "llm": false
    },
    {
      "event": "scenario_event",
      "target": "demo_form_reject",
      "handler": "demo_form_reject",
      "cond": "",
      "llm": false
    },
    {
      "event": "scenario_event",
      "target": "chat_auth_link_requested",
      "handler": "send_chat_auth_link",
      "cond": "clue_reported && !chat_auth_link_sent && !chat_auth_verified",
      "llm": false
    },
    {
      "event": "scenario_event",
      "target": "message_link_opened",
      "handler": "verify_chat_auth",
      "cond": "chat_auth_link_sent && !chat_auth_verified",
      "llm": false
    },
    {
      "event": "scenario_event",
      "target": "audio_playback_completed",
      "handler": "mark_radio_playback_completed",
      "cond": "!radio_playback_completed",
      "llm": false
    }
  ],
  "publicIds": {
    "content": {
      "missed_call": "c_0376fabddf4f",
      "welcome_note": "c_fbeb27e60040",
      "old_note": "c_32c01e364751",
      "sealed_note": "c_bdffc57fcb5c",
      "orange_mark": "c_1c9fa608e356",
      "owner_schedule": "c_5ad6b8c27c5f",
      "sample_radio": "c_513e68175e27"
    },
    "talk": {
      "guide": "t_17f5f84e4690",
      "lobby": "t_384f82df1ef6"
    },
    "generatedAudio": {
      "demo_voice": "g_aedd90a2a532"
    },
    "scenarioEvent": {
      "schedule_demo_call": "e_94e1dde96cea",
      "show_demo_call": "e_15f1b15ac2d7",
      "demo_form": "e_e681caadd11a",
      "demo_all_clear": "e_a518caaa7a2d",
      "demo_form_reject": "e_26e72f12991e",
      "chat_auth_link_requested": "e_0d203bfe05d8",
      "message_link_opened": "e_f1dc8312dd96",
      "audio_playback_completed": "e_27d23d55cdc7"
    }
  }
};
