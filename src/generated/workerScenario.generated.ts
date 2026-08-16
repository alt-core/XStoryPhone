// scenario:build により生成されます。直接編集しないでください。
import type { WorkerScenario } from "../shared/scenario";

export const workerScenario: WorkerScenario = {
  "revision": "84a05034d116baa5",
  "playerMode": "browser",
  "project": {
    "id": "demo",
    "name": "XStoryPhone Demo",
    "osName": "StoryOS",
    "assistantName": "ナビ",
    "accentColor": "#8fd2ff",
    "lockScreen": {
      "method": "none"
    },
    "date": "2026-08-12",
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
      "cond": "sealed_note_unlocked",
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
    "image_color_reported": false,
    "old_note_opened": false,
    "rainy_window_opened": false,
    "chat_auth_link_sent": false,
    "chat_auth_verified": false,
    "demo_completed": false,
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
        "操作",
        "案内",
        "ヒント"
      ],
      "record": {
        "title": "操作ガイド",
        "body": "ナビ検索とコンテンツ修復を順に試します。右下のナビで「古いメモ」と検索してください。",
        "tags": [
          "案内",
          "操作"
        ]
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
        "手がかり"
      ],
      "record": {
        "title": "古いメモ",
        "body": "次は画像の修復です。ナビで「雨」と検索して画像を開き、表示されたタグから灯りの色を確認してください。色が分かったら、メッセージでナビにその色を伝えてください。",
        "tags": [
          "操作",
          "画像"
        ]
      },
      "cond": "",
      "publicId": "c_32c01e364751"
    },
    {
      "id": "sealed_note",
      "appId": "notes",
      "initialState": "hidden",
      "cond": "image_color_reported",
      "search": [
        "鍵付き",
        "添付",
        "パスワード"
      ],
      "record": {
        "title": "鍵付きメモ",
        "body": "鍵付き添付とコンテンツ解錠の確認は完了です。次はチャットを修復してください。",
        "unlockCode": "0420"
      },
      "publicId": "c_bdffc57fcb5c"
    },
    {
      "id": "evening_platform",
      "appId": "photos",
      "initialState": "normal",
      "search": [
        "駅",
        "ホーム",
        "夕方",
        "写真"
      ],
      "record": {
        "title": "夕方のホーム",
        "imageUrl": "/demo/album/evening-platform.webp",
        "tags": [
          "駅",
          "夕方"
        ]
      },
      "cond": "",
      "publicId": "c_5a463a5eb50a"
    },
    {
      "id": "rainy_window",
      "appId": "photos",
      "initialState": "repairable",
      "repairLabel": "暗▚▞▐化された画像",
      "search": [
        "雨",
        "窓",
        "夜",
        "写真"
      ],
      "record": {
        "title": "雨の日の窓",
        "imageUrl": "/demo/album/rainy-window.webp",
        "tags": [
          "雨",
          "窓",
          "黄色い灯り"
        ]
      },
      "cond": "",
      "publicId": "c_394e3752c02b"
    },
    {
      "id": "coffee_table",
      "appId": "photos",
      "initialState": "normal",
      "search": [
        "コーヒー",
        "ノート",
        "机",
        "写真"
      ],
      "record": {
        "title": "休憩中",
        "imageUrl": "/demo/album/coffee-table.webp",
        "tags": [
          "休憩"
        ]
      },
      "cond": "",
      "publicId": "c_64fd68903e0a"
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
        "title": "端末の写真を整理",
        "date": "2026-08-12",
        "time": "20:30",
        "place": "自宅",
        "memo": "「雨の日の窓」の写真を確認する。"
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
          "id": "rule_4597eda2ac22",
          "order": 3,
          "from": "guide::intro",
          "isDefault": false,
          "cond": "rainy_window_opened",
          "intent": "灯りの色を報告",
          "criteria": "/(?:黄色?|きいろ|オレンジ(?:色)?|橙色)/u",
          "match": "",
          "nextBlocks": [
            "guide::found_lead",
            "guide::found_done"
          ],
          "set": [
            "image_color_reported=true"
          ],
          "mode": "",
          "notes": "正規表現だけで選択するデモ",
          "example": "黄色です"
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
      "label": "サンプルルーム",
      "cond": "sealed_note_unlocked",
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
          "set": [
            "demo_completed=true"
          ],
          "mode": "",
          "notes": "",
          "example": ""
        },
        {
          "id": "rule_aea39ca1e449",
          "order": 8,
          "from": "lobby::lobby_reply",
          "isDefault": true,
          "cond": "",
          "intent": "",
          "criteria": "",
          "match": "",
          "nextBlocks": [
            "lobby::lobby_done"
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
      "name": "デモ参加者",
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
          "body": "XStoryPhoneの基本操作を順に試します。まず右下のナビで「古いメモ」と検索してください。",
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
          "body": "今することはホームのToDoに表示しているよ。分からなければ、ナビで「ヒント」と検索してみて。",
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
          "body": "検索、修復、会話、添付解錠、チャット再認証を順番に確認できます。",
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
          "body": "ホームのToDoを確認してみて。分からなければ、ナビで「ヒント」と検索すると次の手順を確認できるよ。",
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
          "body": "「黄色」ですね。画像の修復と、正規表現による入力判定を確認できました。",
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
          "body": "修復した画像を、メッセージの添付として表示する例です。",
          "attachmentId": "rainy_window_image",
          "sentAt": "",
          "delayMs": 700,
          "notes": "",
          "updatedAt": "2026-08-12",
          "source": "human"
        },
        {
          "id": "guide::found_done_2",
          "sender": "guide",
          "body": "次は鍵付き添付です。パスワード「0420」で開いてください。最初の操作ガイドもここから読み返せます。",
          "segments": [
            {
              "kind": "text",
              "text": "次は鍵付き添付です。パスワード「0420」で開いてください。最初の"
            },
            {
              "kind": "link",
              "text": "操作ガイド",
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
          "body": "鍵付きメモを開いたら、次はナビで「チャット」と検索してください。",
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
          "body": "次の手順はホームのToDoでも確認できるよ。",
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
      "id": "guide::sealed_note_opened",
      "talkId": "guide",
      "blockKey": "sealed_note_opened",
      "messages": [
        {
          "id": "guide::sealed_note_opened_1",
          "sender": "guide",
          "body": "鍵付き添付を開封できました。ホームに壊れたチャットが現れたので、ナビで「チャット」と検索して開いてください。",
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
          "body": "チャットUIとdefault分岐の確認です。何かメッセージを送ってください。",
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
          "body": "検索・修復・会話・添付解錠・チャット再認証のデモは完了です。",
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
      "id": "lobby::lobby_done",
      "talkId": "lobby",
      "blockKey": "lobby_done",
      "messages": [
        {
          "id": "lobby::lobby_done_1",
          "sender": "visitor",
          "body": "追加のメッセージも受け取りました。",
          "attachmentId": "",
          "sentAt": "",
          "delayMs": 400,
          "notes": "",
          "updatedAt": "2026-08-12",
          "source": "human"
        }
      ]
    }
  ],
  "attachments": [
    {
      "id": "rainy_window_image",
      "type": "image",
      "asset": "/demo/album/rainy-window.webp",
      "content": "rainy_window"
    },
    {
      "id": "sealed_note_file",
      "type": "image",
      "asset": "/demo/sealed-note.svg",
      "content": "sealed_note",
      "lock": "password",
      "title": "鍵付きのメモ",
      "body": "鍵付き添付を開封できました。"
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
      "name": "着信テスト"
    }
  ],
  "initialSchedules": [],
  "todos": [
    {
      "id": "find_old_note",
      "text": "ナビで「古いメモ」を検索する",
      "cond": "!old_note_opened"
    },
    {
      "id": "find_rainy_window",
      "text": "ナビで「雨」と検索し、写真の灯りの色を確かめる",
      "cond": "old_note_opened && !rainy_window_opened"
    },
    {
      "id": "report_clue",
      "text": "メッセージでナビに灯りの色を伝える",
      "cond": "rainy_window_opened && !image_color_reported"
    },
    {
      "id": "unlock_recovery_note",
      "text": "パスワード「0420」で鍵付きメモを開く",
      "cond": "image_color_reported && !sealed_note_unlocked"
    },
    {
      "id": "restore_chat",
      "text": "「チャット」を検索して開き、再認証リンクを発行する",
      "cond": "sealed_note_unlocked && !chat_auth_link_sent"
    },
    {
      "id": "authenticate_chat",
      "text": "メッセージに届いたリンクからチャットを開く",
      "cond": "chat_auth_link_sent && !chat_auth_verified"
    },
    {
      "id": "contact_owner",
      "text": "サンプルルームでメッセージを送る",
      "cond": "chat_auth_verified && !demo_completed"
    }
  ],
  "notifications": [
    {
      "id": "welcome",
      "appId": "messages",
      "targetTalkId": "guide",
      "title": "ナビ",
      "body": "ナビ検索とコンテンツ修復を試してみよう。",
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
      "body": "ナビで壊れたデータを検索し、修復してみよう。",
      "weight": 1,
      "agentAction": "hi",
      "cond": "!old_note_opened"
    },
    {
      "id": "photo_hint",
      "surface": "home",
      "body": "古いメモに書かれた写真を探して、灯りの色を確かめよう。",
      "weight": 1,
      "agentAction": "hi",
      "cond": "old_note_opened && !rainy_window_opened"
    },
    {
      "id": "report_hint",
      "surface": "home",
      "body": "写真で一番大きく見える灯りの色を、メッセージで教えて。",
      "weight": 1,
      "agentAction": "hi",
      "cond": "rainy_window_opened && !image_color_reported"
    },
    {
      "id": "sealed_note_opened",
      "surface": "home",
      "body": "「チャット」を検索して開き、再認証リンクを発行しよう。",
      "weight": 1,
      "agentAction": "hi",
      "cond": "sealed_note_unlocked && !chat_auth_link_sent"
    },
    {
      "id": "contact_owner",
      "surface": "home",
      "body": "再認証したチャットで、メッセージを送ってみよう。",
      "weight": 1,
      "agentAction": "hi",
      "cond": "chat_auth_verified && !demo_completed"
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
      "body": "まずは「古いメモ」と検索して、コンテンツ修復を試してみて。",
      "cond": "!old_note_opened",
      "suppressResults": true
    },
    {
      "id": "hint_photo",
      "when": "",
      "search": [
        "ヒント"
      ],
      "body": "「雨」と検索して写真を開き、一番大きく見える灯りの色を確かめて。",
      "cond": "old_note_opened && !rainy_window_opened",
      "suppressResults": true
    },
    {
      "id": "hint_report",
      "when": "",
      "search": [
        "ヒント"
      ],
      "body": "メッセージでナビに、写真で一番大きく見えた灯りの色を送って。",
      "cond": "rainy_window_opened && !image_color_reported",
      "suppressResults": true
    },
    {
      "id": "hint_unlock",
      "when": "",
      "search": [
        "ヒント"
      ],
      "body": "メッセージに届いた鍵付きメモを、パスワード「0420」で開いて。",
      "cond": "image_color_reported && !sealed_note_unlocked",
      "suppressResults": true
    },
    {
      "id": "hint_chat",
      "when": "",
      "search": [
        "ヒント"
      ],
      "body": "「チャット」を検索して開き、再認証リンクを発行して。",
      "cond": "sealed_note_unlocked && !chat_auth_link_sent",
      "suppressResults": true
    },
    {
      "id": "hint_auth",
      "when": "",
      "search": [
        "ヒント"
      ],
      "body": "メッセージに届いた再認証リンクから、チャットを開いて。",
      "cond": "chat_auth_link_sent && !chat_auth_verified",
      "suppressResults": true
    },
    {
      "id": "hint_contact",
      "when": "",
      "search": [
        "ヒント"
      ],
      "body": "再認証したチャットを開いて、サンプルルームでメッセージを送ってみて。",
      "cond": "chat_auth_verified && !demo_completed",
      "suppressResults": true
    },
    {
      "id": "hint_done",
      "when": "",
      "search": [
        "ヒント"
      ],
      "body": "検索・修復・会話・添付解錠・再認証のデモは完了しています。",
      "cond": "demo_completed",
      "suppressResults": true
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
    "cond": "sealed_note_unlocked && !chat_auth_verified",
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
      "event": "content_repaired",
      "target": "rainy_window",
      "handler": "mark_rainy_window_opened",
      "cond": "!rainy_window_opened",
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
      "cond": "sealed_note_unlocked && !chat_auth_link_sent && !chat_auth_verified",
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
      "evening_platform": "c_5a463a5eb50a",
      "rainy_window": "c_394e3752c02b",
      "coffee_table": "c_64fd68903e0a",
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
