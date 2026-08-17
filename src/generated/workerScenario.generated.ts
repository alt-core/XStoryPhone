// scenario:build により生成されます。直接編集しないでください。
import type { WorkerScenario } from "../shared/scenario";

export const workerScenario: WorkerScenario = {
  "revision": "0b05d677351862db",
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
        "デモ進行係"
      ],
      "cond": ""
    },
    {
      "id": "mail",
      "label": "メール",
      "icon": "mail",
      "accent": "#aebcff",
      "initialState": "normal",
      "search": [
        "メール",
        "電子メール"
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
      "id": "browser",
      "label": "ブラウザ",
      "icon": "globe_2",
      "accent": "#79b9ff",
      "initialState": "normal",
      "search": [
        "ブラウザ",
        "タブ",
        "Web"
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
    "demo_call_completed": false,
    "demo_chat_cross_received": false,
    "demo_chat_message_received": false,
    "session_started": false,
    "demo_delayed_message_received": false,
    "demo_image_received": false,
    "demo_sms_cross_received": false,
    "demo_sms_message_received": false,
    "sealed_note_unlocked": false,
    "radio_playback_completed": false,
    "os_date": "2026-08-12",
    "os_time_label": "20:14"
  },
  "stateVariableDefinitions": {
    "image_color_reported": {
      "type": "boolean"
    },
    "old_note_opened": {
      "type": "boolean"
    },
    "rainy_window_opened": {
      "type": "boolean"
    },
    "chat_auth_link_sent": {
      "type": "boolean"
    },
    "chat_auth_verified": {
      "type": "boolean"
    },
    "demo_completed": {
      "type": "boolean"
    },
    "demo_call_completed": {
      "type": "boolean"
    },
    "demo_chat_cross_received": {
      "type": "boolean"
    },
    "demo_chat_message_received": {
      "type": "boolean"
    },
    "session_started": {
      "type": "boolean"
    },
    "demo_delayed_message_received": {
      "type": "boolean"
    },
    "demo_image_received": {
      "type": "boolean"
    },
    "demo_sms_cross_received": {
      "type": "boolean"
    },
    "demo_sms_message_received": {
      "type": "boolean"
    },
    "sealed_note_unlocked": {
      "type": "boolean"
    },
    "radio_playback_completed": {
      "type": "boolean"
    },
    "os_date": {
      "type": "string"
    },
    "os_time_label": {
      "type": "string"
    }
  },
  "publicStateVariables": [],
  "photoDescriptions": {
    "evening_platform": "夕暮れの駅のホーム。黄色い点字ブロックと遠くの列車が写っている。",
    "rainy_window": "雨粒の付いた窓越しに夜景が見え、中央付近の黄色い灯りが最も大きく写っている。",
    "coffee_table": "コーヒーカップと開いたノートが木製の机に置かれている。",
    "demo_received_image": "メッセージ受信からアルバムへ自動登録されることを確認するダミー画像。",
    "demo_video": "プログラムで生成したカラーバーが動くデモ動画。"
  },
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
      "id": "dummy_call_1",
      "appId": "phone",
      "initialState": "normal",
      "search": [
        "ダミーデータ"
      ],
      "record": {
        "name": "ダミーデータ",
        "kind": "missed",
        "at": "00:00",
        "durationLabel": "応答なし"
      },
      "cond": "",
      "publicId": "c_2026bc4fe74f"
    },
    {
      "id": "dummy_call_2",
      "appId": "phone",
      "initialState": "normal",
      "search": [
        "ダミーデータ"
      ],
      "record": {
        "name": "ダミーデータ",
        "kind": "missed",
        "at": "00:00",
        "durationLabel": "応答なし"
      },
      "cond": "",
      "publicId": "c_f70177071c48"
    },
    {
      "id": "dummy_call_3",
      "appId": "phone",
      "initialState": "normal",
      "search": [
        "ダミーデータ"
      ],
      "record": {
        "name": "ダミーデータ",
        "kind": "missed",
        "at": "00:00",
        "durationLabel": "応答なし"
      },
      "cond": "",
      "publicId": "c_e73677fd9822"
    },
    {
      "id": "dummy_call_4",
      "appId": "phone",
      "initialState": "normal",
      "search": [
        "ダミーデータ"
      ],
      "record": {
        "name": "ダミーデータ",
        "kind": "missed",
        "at": "00:00",
        "durationLabel": "応答なし"
      },
      "cond": "",
      "publicId": "c_8f794be1736f"
    },
    {
      "id": "dummy_call_5",
      "appId": "phone",
      "initialState": "normal",
      "search": [
        "ダミーデータ"
      ],
      "record": {
        "name": "ダミーデータ",
        "kind": "missed",
        "at": "00:00",
        "durationLabel": "応答なし"
      },
      "cond": "",
      "publicId": "c_7c4385c5b673"
    },
    {
      "id": "dummy_call_6",
      "appId": "phone",
      "initialState": "normal",
      "search": [
        "ダミーデータ"
      ],
      "record": {
        "name": "ダミーデータ",
        "kind": "missed",
        "at": "00:00",
        "durationLabel": "応答なし"
      },
      "cond": "",
      "publicId": "c_07c948744931"
    },
    {
      "id": "demo_call_history",
      "appId": "phone",
      "initialState": "normal",
      "cond": "demo_call_completed",
      "search": [
        "電話",
        "着信",
        "書き起こし"
      ],
      "record": {
        "name": "着信テスト",
        "kind": "incoming",
        "at": "20:16",
        "durationLabel": "6秒",
        "audioUrl": "/system/call-caption-sample.wav",
        "transcript": [
          {
            "atMs": 0,
            "text": "［低い確認音］"
          },
          {
            "atMs": 2000,
            "text": "［中くらいの確認音］"
          },
          {
            "atMs": 4000,
            "text": "［高い確認音］"
          }
        ]
      },
      "publicId": "c_8a5f7f91ea5b"
    },
    {
      "id": "mail_guide",
      "appId": "mail",
      "initialState": "normal",
      "search": [
        "メール",
        "メール機能"
      ],
      "record": {
        "from": "デモ運営",
        "to": "プレイヤー",
        "subject": "メール機能の確認",
        "date": "2026年8月12日 18:30",
        "body": "メールは、件名と日付の一覧から選んで内容を確認できます。ナビで「未整理メール」と検索すると、破損したメールの修復も試せます。"
      },
      "cond": "",
      "publicId": "c_271fc8c96870"
    },
    {
      "id": "guide_history_archive_a",
      "appId": "messages",
      "initialState": "repairable",
      "repairLabel": "破損した履歴",
      "search": [
        "消えた連絡記録",
        "履歴修復A"
      ],
      "record": {
        "talk": "guide",
        "block": "guide::history_archive_a"
      },
      "cond": "",
      "publicId": "c_f452f3bfd9c3"
    },
    {
      "id": "guide_history_archive_b",
      "appId": "messages",
      "initialState": "repairable",
      "repairLabel": "破損した履歴",
      "search": [
        "連続破損の記録",
        "履歴修復B"
      ],
      "record": {
        "talk": "guide",
        "block": "guide::history_archive_b"
      },
      "cond": "",
      "publicId": "c_d2fb1ed4cac6"
    },
    {
      "id": "lobby_history_archive",
      "appId": "chat",
      "initialState": "repairable",
      "repairLabel": "破損した履歴",
      "cond": "sealed_note_unlocked",
      "search": [
        "消えた談話記録",
        "チャット履歴修復"
      ],
      "record": {
        "talk": "lobby",
        "block": "lobby::history_archive"
      },
      "publicId": "c_ee422a2fa57f"
    },
    {
      "id": "damaged_mail",
      "appId": "mail",
      "initialState": "repairable",
      "repairLabel": "未▚▐▀▜メール",
      "search": [
        "未整理メール",
        "破損メール",
        "メール修復"
      ],
      "record": {
        "from": "確認担当",
        "to": "プレイヤー",
        "cc": "デモ運営",
        "subject": "修復されたメール",
        "date": "2026年8月12日 18:45",
        "body": "メール単位の修復が完了しました。Ccが設定された場合は、宛先情報の中に表示されます。"
      },
      "cond": "",
      "publicId": "c_4a00ef29e36b"
    },
    {
      "id": "dummy_mail_1",
      "appId": "mail",
      "initialState": "normal",
      "search": [
        "ダミーデータ"
      ],
      "record": {
        "from": "ダミーデータ",
        "to": "プレイヤー",
        "subject": "ダミーデータ",
        "date": "2026年8月12日 12:00",
        "body": "一覧スクロール確認用のダミーデータです。"
      },
      "cond": "",
      "publicId": "c_451b9414a8da"
    },
    {
      "id": "dummy_mail_2",
      "appId": "mail",
      "initialState": "normal",
      "search": [
        "ダミーデータ"
      ],
      "record": {
        "from": "ダミーデータ",
        "to": "プレイヤー",
        "subject": "ダミーデータ",
        "date": "2026年8月12日 12:00",
        "body": "一覧スクロール確認用のダミーデータです。"
      },
      "cond": "",
      "publicId": "c_eb5be853c25d"
    },
    {
      "id": "dummy_mail_3",
      "appId": "mail",
      "initialState": "normal",
      "search": [
        "ダミーデータ"
      ],
      "record": {
        "from": "ダミーデータ",
        "to": "プレイヤー",
        "subject": "ダミーデータ",
        "date": "2026年8月12日 12:00",
        "body": "一覧スクロール確認用のダミーデータです。"
      },
      "cond": "",
      "publicId": "c_79ba43a616d2"
    },
    {
      "id": "dummy_mail_4",
      "appId": "mail",
      "initialState": "normal",
      "search": [
        "ダミーデータ"
      ],
      "record": {
        "from": "ダミーデータ",
        "to": "プレイヤー",
        "subject": "ダミーデータ",
        "date": "2026年8月12日 12:00",
        "body": "一覧スクロール確認用のダミーデータです。"
      },
      "cond": "",
      "publicId": "c_74bbb653f3aa"
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
      "id": "feature_test_guide",
      "appId": "notes",
      "initialState": "normal",
      "search": [
        "機能テスト",
        "試し方",
        "着信テスト",
        "遅延メッセージ"
      ],
      "record": {
        "title": "機能テスト一覧",
        "body": "ナビで「消えた連絡記録」と検索すると、メッセージ内の破損した初期履歴を修復できます。\n\nメッセージの「デモ進行係」へ、次の語を1つずつ送信できます。\n\n・着信テスト：数秒後に電話が着信します。\n・遅延メッセージ：数秒後に別ルームへ届き、通知が出ます。\n・メッセージ連携：別のメッセージルームへ届きます。\n・画像受信テスト：別ルームに画像が届き、開くとアルバムへ自動登録されます。\n・チャットへ送る：チャット復旧後、チャットの別ルームへ届きます。\n\nチャット復旧後は、ナビで「消えた談話記録」と検索するとチャット内の破損履歴を修復できます。\n\nチャットの「サンプルルーム」では、\n・チャット連携：別のチャットルームへ届きます。\n・メッセージへ送る：メッセージの受信箱へ届きます。\n\n各受信では通知も表示されます。繰り返す場合は通知シェードのテスト用リセットを使ってください。",
        "tags": [
          "案内",
          "機能テスト"
        ]
      },
      "cond": "",
      "publicId": "c_cefa574e8306"
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
        "body": "次は画像の修復です。ナビで「雨」と検索して画像を開き、表示されたタグから灯りの色を確認してください。色が分かったら、メッセージでデモ進行係にその色を伝えてください。",
        "tags": [
          "操作",
          "画像"
        ]
      },
      "cond": "",
      "publicId": "c_32c01e364751"
    },
    {
      "id": "dummy_note_1",
      "appId": "notes",
      "initialState": "normal",
      "search": [
        "ダミーデータ"
      ],
      "record": {
        "title": "ダミーデータ",
        "body": "一覧スクロール確認用のダミーデータです。",
        "tags": [
          "ダミーデータ"
        ]
      },
      "cond": "",
      "publicId": "c_9963319fe24e"
    },
    {
      "id": "dummy_note_2",
      "appId": "notes",
      "initialState": "normal",
      "search": [
        "ダミーデータ"
      ],
      "record": {
        "title": "ダミーデータ",
        "body": "一覧スクロール確認用のダミーデータです。",
        "tags": [
          "ダミーデータ"
        ]
      },
      "cond": "",
      "publicId": "c_2d05b2ffd3ce"
    },
    {
      "id": "dummy_note_3",
      "appId": "notes",
      "initialState": "normal",
      "search": [
        "ダミーデータ"
      ],
      "record": {
        "title": "ダミーデータ",
        "body": "一覧スクロール確認用のダミーデータです。",
        "tags": [
          "ダミーデータ"
        ]
      },
      "cond": "",
      "publicId": "c_e9de14c38b65"
    },
    {
      "id": "dummy_note_4",
      "appId": "notes",
      "initialState": "normal",
      "search": [
        "ダミーデータ"
      ],
      "record": {
        "title": "ダミーデータ",
        "body": "一覧スクロール確認用のダミーデータです。",
        "tags": [
          "ダミーデータ"
        ]
      },
      "cond": "",
      "publicId": "c_a59b078ce15f"
    },
    {
      "id": "dummy_note_5",
      "appId": "notes",
      "initialState": "normal",
      "search": [
        "ダミーデータ"
      ],
      "record": {
        "title": "ダミーデータ",
        "body": "一覧スクロール確認用のダミーデータです。",
        "tags": [
          "ダミーデータ"
        ]
      },
      "cond": "",
      "publicId": "c_d5126f33366a"
    },
    {
      "id": "dummy_note_6",
      "appId": "notes",
      "initialState": "normal",
      "search": [
        "ダミーデータ"
      ],
      "record": {
        "title": "ダミーデータ",
        "body": "一覧スクロール確認用のダミーデータです。",
        "tags": [
          "ダミーデータ"
        ]
      },
      "cond": "",
      "publicId": "c_b6d1a7ef235b"
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
        "body": "鍵付き添付とコンテンツ解錠の確認は完了です。次はチャットを修復してください。"
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
      "id": "demo_video",
      "appId": "photos",
      "initialState": "normal",
      "search": [
        "動画",
        "デモ動画",
        "カラーバー"
      ],
      "record": {
        "title": "デモ動画",
        "mediaKind": "video",
        "imageUrl": "/demo/dummy-data.svg",
        "videoUrl": "/demo/demo-video.mp4",
        "tags": [
          "動画",
          "動作確認"
        ]
      },
      "cond": "",
      "publicId": "c_5d1be1170cf1"
    },
    {
      "id": "demo_received_image",
      "appId": "photos",
      "initialState": "hidden",
      "cond": "demo_image_received",
      "search": [
        "受信画像",
        "画像受信テスト"
      ],
      "record": {
        "title": "受信したダミー画像",
        "imageUrl": "/demo/dummy-data.svg",
        "tags": [
          "受信",
          "ダミーデータ"
        ]
      },
      "publicId": "c_1aaf7fdd7a82"
    },
    {
      "id": "dummy_photo_1",
      "appId": "photos",
      "initialState": "normal",
      "search": [
        "ダミーデータ"
      ],
      "record": {
        "title": "ダミーデータ",
        "imageUrl": "/demo/dummy-data.svg",
        "tags": [
          "ダミーデータ"
        ]
      },
      "cond": "",
      "publicId": "c_7229adc1604d"
    },
    {
      "id": "dummy_photo_2",
      "appId": "photos",
      "initialState": "normal",
      "search": [
        "ダミーデータ"
      ],
      "record": {
        "title": "ダミーデータ",
        "imageUrl": "/demo/dummy-data.svg",
        "tags": [
          "ダミーデータ"
        ]
      },
      "cond": "",
      "publicId": "c_fb58b8d23060"
    },
    {
      "id": "dummy_photo_3",
      "appId": "photos",
      "initialState": "normal",
      "search": [
        "ダミーデータ"
      ],
      "record": {
        "title": "ダミーデータ",
        "imageUrl": "/demo/dummy-data.svg",
        "tags": [
          "ダミーデータ"
        ]
      },
      "cond": "",
      "publicId": "c_358b3bcd1b50"
    },
    {
      "id": "dummy_photo_4",
      "appId": "photos",
      "initialState": "normal",
      "search": [
        "ダミーデータ"
      ],
      "record": {
        "title": "ダミーデータ",
        "imageUrl": "/demo/dummy-data.svg",
        "tags": [
          "ダミーデータ"
        ]
      },
      "cond": "",
      "publicId": "c_3a6375761b45"
    },
    {
      "id": "dummy_photo_5",
      "appId": "photos",
      "initialState": "normal",
      "search": [
        "ダミーデータ"
      ],
      "record": {
        "title": "ダミーデータ",
        "imageUrl": "/demo/dummy-data.svg",
        "tags": [
          "ダミーデータ"
        ]
      },
      "cond": "",
      "publicId": "c_a2e7fdc5f793"
    },
    {
      "id": "dummy_photo_6",
      "appId": "photos",
      "initialState": "normal",
      "search": [
        "ダミーデータ"
      ],
      "record": {
        "title": "ダミーデータ",
        "imageUrl": "/demo/dummy-data.svg",
        "tags": [
          "ダミーデータ"
        ]
      },
      "cond": "",
      "publicId": "c_ec168fb41748"
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
      "id": "dummy_schedule_1",
      "appId": "calendar",
      "initialState": "normal",
      "search": [
        "ダミーデータ"
      ],
      "record": {
        "title": "ダミーデータ",
        "date": "2026-08-12",
        "time": "12:00",
        "place": "ダミーデータ",
        "memo": "一覧スクロール確認用のダミーデータです。"
      },
      "cond": "",
      "publicId": "c_a37ddcb9ffde"
    },
    {
      "id": "dummy_schedule_2",
      "appId": "calendar",
      "initialState": "normal",
      "search": [
        "ダミーデータ"
      ],
      "record": {
        "title": "ダミーデータ",
        "date": "2026-08-12",
        "time": "12:00",
        "place": "ダミーデータ",
        "memo": "一覧スクロール確認用のダミーデータです。"
      },
      "cond": "",
      "publicId": "c_9a7365886b8a"
    },
    {
      "id": "dummy_schedule_3",
      "appId": "calendar",
      "initialState": "normal",
      "search": [
        "ダミーデータ"
      ],
      "record": {
        "title": "ダミーデータ",
        "date": "2026-08-12",
        "time": "12:00",
        "place": "ダミーデータ",
        "memo": "一覧スクロール確認用のダミーデータです。"
      },
      "cond": "",
      "publicId": "c_17cc0b436b41"
    },
    {
      "id": "dummy_schedule_4",
      "appId": "calendar",
      "initialState": "normal",
      "search": [
        "ダミーデータ"
      ],
      "record": {
        "title": "ダミーデータ",
        "date": "2026-08-12",
        "time": "12:00",
        "place": "ダミーデータ",
        "memo": "一覧スクロール確認用のダミーデータです。"
      },
      "cond": "",
      "publicId": "c_ad8b983cd8fc"
    },
    {
      "id": "dummy_schedule_5",
      "appId": "calendar",
      "initialState": "normal",
      "search": [
        "ダミーデータ"
      ],
      "record": {
        "title": "ダミーデータ",
        "date": "2026-08-12",
        "time": "12:00",
        "place": "ダミーデータ",
        "memo": "一覧スクロール確認用のダミーデータです。"
      },
      "cond": "",
      "publicId": "c_cd7b2c42cb24"
    },
    {
      "id": "dummy_schedule_6",
      "appId": "calendar",
      "initialState": "normal",
      "search": [
        "ダミーデータ"
      ],
      "record": {
        "title": "ダミーデータ",
        "date": "2026-08-12",
        "time": "12:00",
        "place": "ダミーデータ",
        "memo": "一覧スクロール確認用のダミーデータです。"
      },
      "cond": "",
      "publicId": "c_2e9e5b44006e"
    },
    {
      "id": "dummy_schedule_7",
      "appId": "calendar",
      "initialState": "normal",
      "search": [
        "ダミーデータ"
      ],
      "record": {
        "title": "ダミーデータ",
        "date": "2026-08-12",
        "time": "12:00",
        "place": "ダミーデータ",
        "memo": "一覧スクロール確認用のダミーデータです。"
      },
      "cond": "",
      "publicId": "c_3418c04e0c56"
    },
    {
      "id": "dummy_schedule_8",
      "appId": "calendar",
      "initialState": "normal",
      "search": [
        "ダミーデータ"
      ],
      "record": {
        "title": "ダミーデータ",
        "date": "2026-08-12",
        "time": "12:00",
        "place": "ダミーデータ",
        "memo": "一覧スクロール確認用のダミーデータです。"
      },
      "cond": "",
      "publicId": "c_a0ec894adce6"
    },
    {
      "id": "browser_guide",
      "appId": "browser",
      "initialState": "normal",
      "search": [
        "ブラウザ",
        "タブ",
        "Web",
        "案内"
      ],
      "record": {
        "title": "ブラウザ操作ガイド",
        "url": "/demo/browser/start.html",
        "allowedUrls": [
          "/demo/browser/details.html"
        ]
      },
      "cond": "",
      "publicId": "c_a0cec9e1ac30"
    },
    {
      "id": "dummy_browser_1",
      "appId": "browser",
      "initialState": "normal",
      "search": [
        "ダミーデータ"
      ],
      "record": {
        "title": "ダミーデータ",
        "url": "/demo/browser/dummy.html"
      },
      "cond": "",
      "publicId": "c_be720b110439"
    },
    {
      "id": "dummy_browser_2",
      "appId": "browser",
      "initialState": "normal",
      "search": [
        "ダミーデータ"
      ],
      "record": {
        "title": "ダミーデータ",
        "url": "/demo/browser/dummy.html"
      },
      "cond": "",
      "publicId": "c_fd4144354636"
    },
    {
      "id": "dummy_browser_3",
      "appId": "browser",
      "initialState": "normal",
      "search": [
        "ダミーデータ"
      ],
      "record": {
        "title": "ダミーデータ",
        "url": "/demo/browser/dummy.html"
      },
      "cond": "",
      "publicId": "c_2d9ff48c2e57"
    },
    {
      "id": "dummy_browser_4",
      "appId": "browser",
      "initialState": "normal",
      "search": [
        "ダミーデータ"
      ],
      "record": {
        "title": "ダミーデータ",
        "url": "/demo/browser/dummy.html"
      },
      "cond": "",
      "publicId": "c_6583456c66bb"
    },
    {
      "id": "dummy_browser_5",
      "appId": "browser",
      "initialState": "normal",
      "search": [
        "ダミーデータ"
      ],
      "record": {
        "title": "ダミーデータ",
        "url": "/demo/browser/dummy.html"
      },
      "cond": "",
      "publicId": "c_72782ea7ea51"
    },
    {
      "id": "dummy_browser_6",
      "appId": "browser",
      "initialState": "normal",
      "search": [
        "ダミーデータ"
      ],
      "record": {
        "title": "ダミーデータ",
        "url": "/demo/browser/dummy.html"
      },
      "cond": "",
      "publicId": "c_3eeb6b99d118"
    },
    {
      "id": "browser_archive",
      "appId": "browser",
      "initialState": "repairable",
      "repairLabel": "タ▚▐▀▜ブ",
      "search": [
        "アーカイブタブ",
        "ブラウザの記録"
      ],
      "record": {
        "title": "アーカイブ",
        "url": "/demo/browser/archive-k7m2q.html"
      },
      "cond": "",
      "publicId": "c_e9c108f35d34"
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
        "audioUrl": "/system/radio-caption-sample.wav",
        "genAudioId": "demo_voice",
        "transcript": [
          {
            "atMs": 0,
            "text": "ラジオ字幕の表示テストを開始します。"
          },
          {
            "atMs": 3000,
            "text": "再生位置に合わせて字幕が切り替わります。"
          },
          {
            "atMs": 6000,
            "text": "字幕データがなければ、この欄は表示されません。"
          }
        ]
      },
      "cond": "",
      "publicId": "c_513e68175e27"
    },
    {
      "id": "dummy_radio_1",
      "appId": "radio",
      "initialState": "normal",
      "search": [
        "ダミーデータ"
      ],
      "record": {
        "programTitle": "ダミーデータ"
      },
      "cond": "",
      "publicId": "c_a1885b48dd86"
    },
    {
      "id": "dummy_radio_2",
      "appId": "radio",
      "initialState": "normal",
      "search": [
        "ダミーデータ"
      ],
      "record": {
        "programTitle": "ダミーデータ"
      },
      "cond": "",
      "publicId": "c_02a56b40c49f"
    },
    {
      "id": "dummy_radio_3",
      "appId": "radio",
      "initialState": "normal",
      "search": [
        "ダミーデータ"
      ],
      "record": {
        "programTitle": "ダミーデータ"
      },
      "cond": "",
      "publicId": "c_e4a4835b572c"
    },
    {
      "id": "dummy_radio_4",
      "appId": "radio",
      "initialState": "normal",
      "search": [
        "ダミーデータ"
      ],
      "record": {
        "programTitle": "ダミーデータ"
      },
      "cond": "",
      "publicId": "c_21727e0c83a1"
    },
    {
      "id": "dummy_radio_5",
      "appId": "radio",
      "initialState": "normal",
      "search": [
        "ダミーデータ"
      ],
      "record": {
        "programTitle": "ダミーデータ"
      },
      "cond": "",
      "publicId": "c_447380361ccd"
    }
  ],
  "talks": [
    {
      "id": "guide",
      "kind": "sms",
      "appId": "messages",
      "label": "デモ進行係",
      "startBlocks": [
        "guide::history_archive_a",
        "guide::history_archive_b",
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
          "id": "rule_a318c17a8872",
          "order": 3,
          "from": "*",
          "isDefault": false,
          "cond": "",
          "intent": "機能テスト",
          "criteria": "/^(?:着信テスト|遅延メッセージ|メッセージ連携|画像受信テスト|チャットへ送る)$/u",
          "match": "",
          "nextBlocks": [
            "guide::demo_test_ack"
          ],
          "set": [],
          "mode": "stay",
          "notes": "機能テスト一覧メモに記載したデモコマンド",
          "example": "着信テスト"
        },
        {
          "id": "rule_184660bf437e",
          "order": 4,
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
          "id": "rule_73d2fd5c4c48",
          "order": 5,
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
          "id": "rule_f341ac3b908a",
          "order": 6,
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
          "id": "rule_02c16a67d489",
          "order": 7,
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
      "id": "sms_receiver",
      "kind": "sms",
      "appId": "messages",
      "label": "テスト受信箱",
      "startBlocks": [
        "sms_receiver::start"
      ],
      "cond": "",
      "publicId": "t_b18a7456e416",
      "initialFrom": "sms_receiver::start",
      "rules": [
        {
          "id": "rule_237901ed34bc",
          "order": 11,
          "from": "sms_receiver::start",
          "isDefault": true,
          "cond": "",
          "intent": "",
          "criteria": "",
          "match": "",
          "nextBlocks": [
            "sms_receiver::receiver_reply"
          ],
          "set": [],
          "mode": "stay",
          "notes": "",
          "example": ""
        }
      ]
    },
    {
      "id": "sms_media_receiver",
      "kind": "sms",
      "appId": "messages",
      "label": "画像受信",
      "startBlocks": [
        "sms_media_receiver::start"
      ],
      "cond": "",
      "publicId": "t_ef9cabd43865",
      "initialFrom": "sms_media_receiver::start",
      "rules": [
        {
          "id": "rule_7cc00713ef12",
          "order": 12,
          "from": "sms_media_receiver::start",
          "isDefault": true,
          "cond": "",
          "intent": "",
          "criteria": "",
          "match": "",
          "nextBlocks": [
            "sms_media_receiver::receiver_reply"
          ],
          "set": [],
          "mode": "stay",
          "notes": "",
          "example": ""
        }
      ]
    },
    {
      "id": "dummy_sms_1",
      "kind": "sms",
      "appId": "messages",
      "label": "ダミーデータ",
      "startBlocks": [
        "dummy_sms_1::start"
      ],
      "cond": "",
      "publicId": "t_bc14bdf75f7e",
      "initialFrom": "dummy_sms_1::start",
      "rules": [
        {
          "id": "rule_a80663878781",
          "order": 13,
          "from": "dummy_sms_1::start",
          "isDefault": true,
          "cond": "",
          "intent": "",
          "criteria": "",
          "match": "",
          "nextBlocks": [
            "dummy_sms_1::dummy_reply"
          ],
          "set": [],
          "mode": "stay",
          "notes": "",
          "example": ""
        }
      ]
    },
    {
      "id": "dummy_sms_2",
      "kind": "sms",
      "appId": "messages",
      "label": "ダミーデータ",
      "startBlocks": [
        "dummy_sms_2::start"
      ],
      "cond": "",
      "publicId": "t_17983c9a39f9",
      "initialFrom": "dummy_sms_2::start",
      "rules": [
        {
          "id": "rule_b8cb9fb39202",
          "order": 14,
          "from": "dummy_sms_2::start",
          "isDefault": true,
          "cond": "",
          "intent": "",
          "criteria": "",
          "match": "",
          "nextBlocks": [
            "dummy_sms_2::dummy_reply"
          ],
          "set": [],
          "mode": "stay",
          "notes": "",
          "example": ""
        }
      ]
    },
    {
      "id": "dummy_sms_3",
      "kind": "sms",
      "appId": "messages",
      "label": "ダミーデータ",
      "startBlocks": [
        "dummy_sms_3::start"
      ],
      "cond": "",
      "publicId": "t_040dd4088ff1",
      "initialFrom": "dummy_sms_3::start",
      "rules": [
        {
          "id": "rule_1ddece233155",
          "order": 15,
          "from": "dummy_sms_3::start",
          "isDefault": true,
          "cond": "",
          "intent": "",
          "criteria": "",
          "match": "",
          "nextBlocks": [
            "dummy_sms_3::dummy_reply"
          ],
          "set": [],
          "mode": "stay",
          "notes": "",
          "example": ""
        }
      ]
    },
    {
      "id": "dummy_sms_4",
      "kind": "sms",
      "appId": "messages",
      "label": "ダミーデータ",
      "startBlocks": [
        "dummy_sms_4::start"
      ],
      "cond": "",
      "publicId": "t_6f99c15839d9",
      "initialFrom": "dummy_sms_4::start",
      "rules": [
        {
          "id": "rule_a40c4f495233",
          "order": 16,
          "from": "dummy_sms_4::start",
          "isDefault": true,
          "cond": "",
          "intent": "",
          "criteria": "",
          "match": "",
          "nextBlocks": [
            "dummy_sms_4::dummy_reply"
          ],
          "set": [],
          "mode": "stay",
          "notes": "",
          "example": ""
        }
      ]
    },
    {
      "id": "dummy_sms_5",
      "kind": "sms",
      "appId": "messages",
      "label": "ダミーデータ",
      "startBlocks": [
        "dummy_sms_5::start"
      ],
      "cond": "",
      "publicId": "t_f5c8125fca30",
      "initialFrom": "dummy_sms_5::start",
      "rules": [
        {
          "id": "rule_2f626b91363b",
          "order": 17,
          "from": "dummy_sms_5::start",
          "isDefault": true,
          "cond": "",
          "intent": "",
          "criteria": "",
          "match": "",
          "nextBlocks": [
            "dummy_sms_5::dummy_reply"
          ],
          "set": [],
          "mode": "stay",
          "notes": "",
          "example": ""
        }
      ]
    },
    {
      "id": "dummy_sms_6",
      "kind": "sms",
      "appId": "messages",
      "label": "ダミーデータ",
      "startBlocks": [
        "dummy_sms_6::start"
      ],
      "cond": "",
      "publicId": "t_59219841f338",
      "initialFrom": "dummy_sms_6::start",
      "rules": [
        {
          "id": "rule_e5787377e1f5",
          "order": 18,
          "from": "dummy_sms_6::start",
          "isDefault": true,
          "cond": "",
          "intent": "",
          "criteria": "",
          "match": "",
          "nextBlocks": [
            "dummy_sms_6::dummy_reply"
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
        "lobby::history_archive",
        "lobby::start"
      ],
      "publicId": "t_384f82df1ef6",
      "initialFrom": "lobby::start",
      "rules": [
        {
          "id": "rule_be1508bf5141",
          "order": 8,
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
          "id": "rule_b6d5fa01fb78",
          "order": 9,
          "from": "*",
          "isDefault": false,
          "cond": "",
          "intent": "機能テスト",
          "criteria": "/^(?:チャット連携|メッセージへ送る)$/u",
          "match": "",
          "nextBlocks": [
            "lobby::chat_test_ack"
          ],
          "set": [],
          "mode": "stay",
          "notes": "別ルーム・別アプリへの連携確認",
          "example": "チャット連携"
        },
        {
          "id": "rule_21a4e7fdd0fa",
          "order": 10,
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
    },
    {
      "id": "chat_receiver",
      "kind": "chat",
      "appId": "chat",
      "label": "連携受信ログ",
      "cond": "sealed_note_unlocked",
      "startBlocks": [
        "chat_receiver::start"
      ],
      "publicId": "t_b873fa6b67cf",
      "initialFrom": "chat_receiver::start",
      "rules": [
        {
          "id": "rule_7ebccba32abf",
          "order": 19,
          "from": "chat_receiver::start",
          "isDefault": true,
          "cond": "",
          "intent": "",
          "criteria": "",
          "match": "",
          "nextBlocks": [
            "chat_receiver::receiver_reply"
          ],
          "set": [],
          "mode": "stay",
          "notes": "",
          "example": ""
        }
      ]
    },
    {
      "id": "dummy_chat_1",
      "kind": "chat",
      "appId": "chat",
      "label": "ダミーデータ",
      "cond": "sealed_note_unlocked",
      "startBlocks": [
        "dummy_chat_1::start"
      ],
      "publicId": "t_4aff5248b7f8",
      "initialFrom": "dummy_chat_1::start",
      "rules": [
        {
          "id": "rule_f125a18fa8cc",
          "order": 20,
          "from": "dummy_chat_1::start",
          "isDefault": true,
          "cond": "",
          "intent": "",
          "criteria": "",
          "match": "",
          "nextBlocks": [
            "dummy_chat_1::dummy_reply"
          ],
          "set": [],
          "mode": "stay",
          "notes": "",
          "example": ""
        }
      ]
    },
    {
      "id": "dummy_chat_2",
      "kind": "chat",
      "appId": "chat",
      "label": "ダミーデータ",
      "cond": "sealed_note_unlocked",
      "startBlocks": [
        "dummy_chat_2::start"
      ],
      "publicId": "t_31942c9c962d",
      "initialFrom": "dummy_chat_2::start",
      "rules": [
        {
          "id": "rule_0f6379aa4d1d",
          "order": 21,
          "from": "dummy_chat_2::start",
          "isDefault": true,
          "cond": "",
          "intent": "",
          "criteria": "",
          "match": "",
          "nextBlocks": [
            "dummy_chat_2::dummy_reply"
          ],
          "set": [],
          "mode": "stay",
          "notes": "",
          "example": ""
        }
      ]
    },
    {
      "id": "dummy_chat_3",
      "kind": "chat",
      "appId": "chat",
      "label": "ダミーデータ",
      "cond": "sealed_note_unlocked",
      "startBlocks": [
        "dummy_chat_3::start"
      ],
      "publicId": "t_73a75e3d8faa",
      "initialFrom": "dummy_chat_3::start",
      "rules": [
        {
          "id": "rule_888b6d9d255d",
          "order": 22,
          "from": "dummy_chat_3::start",
          "isDefault": true,
          "cond": "",
          "intent": "",
          "criteria": "",
          "match": "",
          "nextBlocks": [
            "dummy_chat_3::dummy_reply"
          ],
          "set": [],
          "mode": "stay",
          "notes": "",
          "example": ""
        }
      ]
    },
    {
      "id": "dummy_chat_4",
      "kind": "chat",
      "appId": "chat",
      "label": "ダミーデータ",
      "cond": "sealed_note_unlocked",
      "startBlocks": [
        "dummy_chat_4::start"
      ],
      "publicId": "t_0e6f206f66af",
      "initialFrom": "dummy_chat_4::start",
      "rules": [
        {
          "id": "rule_c52912399473",
          "order": 23,
          "from": "dummy_chat_4::start",
          "isDefault": true,
          "cond": "",
          "intent": "",
          "criteria": "",
          "match": "",
          "nextBlocks": [
            "dummy_chat_4::dummy_reply"
          ],
          "set": [],
          "mode": "stay",
          "notes": "",
          "example": ""
        }
      ]
    },
    {
      "id": "dummy_chat_5",
      "kind": "chat",
      "appId": "chat",
      "label": "ダミーデータ",
      "cond": "sealed_note_unlocked",
      "startBlocks": [
        "dummy_chat_5::start"
      ],
      "publicId": "t_0a2e442c9bb6",
      "initialFrom": "dummy_chat_5::start",
      "rules": [
        {
          "id": "rule_644607510e59",
          "order": 24,
          "from": "dummy_chat_5::start",
          "isDefault": true,
          "cond": "",
          "intent": "",
          "criteria": "",
          "match": "",
          "nextBlocks": [
            "dummy_chat_5::dummy_reply"
          ],
          "set": [],
          "mode": "stay",
          "notes": "",
          "example": ""
        }
      ]
    },
    {
      "id": "dummy_chat_6",
      "kind": "chat",
      "appId": "chat",
      "label": "ダミーデータ",
      "cond": "sealed_note_unlocked",
      "startBlocks": [
        "dummy_chat_6::start"
      ],
      "publicId": "t_cb0b2cb99f03",
      "initialFrom": "dummy_chat_6::start",
      "rules": [
        {
          "id": "rule_061aee9468ed",
          "order": 25,
          "from": "dummy_chat_6::start",
          "isDefault": true,
          "cond": "",
          "intent": "",
          "criteria": "",
          "match": "",
          "nextBlocks": [
            "dummy_chat_6::dummy_reply"
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
      "name": "デモ進行係",
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
      "id": "guide::history_archive_a",
      "talkId": "guide",
      "blockKey": "history_archive_a",
      "messages": [
        {
          "id": "guide::history_archive_a_1",
          "sender": "guide",
          "body": "これは修復対象になる過去のメッセージ履歴です。",
          "attachmentId": "",
          "sentAt": "2026-08-11T19:10:00+09:00",
          "notes": "",
          "updatedAt": "2026-08-12",
          "source": "human"
        },
        {
          "id": "guide::history_archive_a_2",
          "sender": "owner",
          "body": "block内の複数メッセージもまとめて復元されます。",
          "attachmentId": "",
          "sentAt": "2026-08-11T19:11:00+09:00",
          "notes": "",
          "updatedAt": "2026-08-12",
          "source": "human"
        }
      ]
    },
    {
      "id": "guide::history_archive_b",
      "talkId": "guide",
      "blockKey": "history_archive_b",
      "messages": [
        {
          "id": "guide::history_archive_b_1",
          "sender": "guide",
          "body": "連続する破損blockは、修復前には一つの破損表示へまとまります。",
          "attachmentId": "",
          "sentAt": "2026-08-11T19:12:00+09:00",
          "notes": "",
          "updatedAt": "2026-08-12",
          "source": "human"
        }
      ]
    },
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
      "id": "guide::call_history_guide",
      "talkId": "guide",
      "blockKey": "call_history_guide",
      "messages": [
        {
          "id": "guide::call_history_guide_1",
          "sender": "guide",
          "body": "聞き逃した着信音声は、着信履歴から再生できます。音声書き起こしも同じ画面で最後まで読めます。",
          "segments": [
            {
              "kind": "text",
              "text": "聞き逃した着信音声は、"
            },
            {
              "kind": "link",
              "text": "着信履歴",
              "appId": "phone",
              "contentId": "demo_call_history"
            },
            {
              "kind": "text",
              "text": "から再生できます。音声書き起こしも同じ画面で最後まで読めます。"
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
      "id": "guide::demo_test_ack",
      "talkId": "guide",
      "blockKey": "demo_test_ack",
      "messages": [
        {
          "id": "guide::demo_test_ack_1",
          "sender": "guide",
          "body": "機能テストを受け付けました。別ルームへの受信や、数秒後に起きる変化を確認してください。",
          "attachmentId": "",
          "sentAt": "",
          "delayMs": 350,
          "notes": "",
          "updatedAt": "2026-08-12",
          "source": "human"
        }
      ]
    },
    {
      "id": "lobby::history_archive",
      "talkId": "lobby",
      "blockKey": "history_archive",
      "messages": [
        {
          "id": "lobby::history_archive_1",
          "sender": "visitor",
          "body": "これは修復対象になる過去のチャット履歴です。",
          "attachmentId": "",
          "sentAt": "2026-08-11T20:00:00+09:00",
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
      "id": "lobby::chat_test_ack",
      "talkId": "lobby",
      "blockKey": "chat_test_ack",
      "messages": [
        {
          "id": "lobby::chat_test_ack_1",
          "sender": "visitor",
          "body": "連携テストを受け付けました。別のルームまたはメッセージアプリを確認してください。",
          "attachmentId": "",
          "sentAt": "",
          "delayMs": 350,
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
    },
    {
      "id": "sms_receiver::start",
      "talkId": "sms_receiver",
      "blockKey": "start",
      "messages": [
        {
          "id": "sms_receiver::start_1",
          "sender": "owner",
          "body": "機能テスト用の受信箱です。",
          "attachmentId": "",
          "sentAt": "20:14",
          "notes": "",
          "updatedAt": "2026-08-12",
          "source": "human"
        }
      ]
    },
    {
      "id": "sms_receiver::receiver_reply",
      "talkId": "sms_receiver",
      "blockKey": "receiver_reply",
      "messages": [
        {
          "id": "sms_receiver::receiver_reply_1",
          "sender": "guide",
          "body": "このルームは受信結果の確認用です。",
          "attachmentId": "",
          "sentAt": "",
          "delayMs": 350,
          "notes": "",
          "updatedAt": "2026-08-12",
          "source": "human"
        }
      ]
    },
    {
      "id": "sms_receiver::received_from_sms",
      "talkId": "sms_receiver",
      "blockKey": "received_from_sms",
      "messages": [
        {
          "id": "sms_receiver::received_from_sms_1",
          "sender": "guide",
          "body": "「デモ進行係」から、別のメッセージルームへ届きました。",
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
      "id": "sms_receiver::received_from_chat",
      "talkId": "sms_receiver",
      "blockKey": "received_from_chat",
      "messages": [
        {
          "id": "sms_receiver::received_from_chat_1",
          "sender": "guide",
          "body": "チャットの「サンプルルーム」から、メッセージアプリへ届きました。",
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
      "id": "sms_receiver::received_delayed",
      "talkId": "sms_receiver",
      "blockKey": "received_delayed",
      "messages": [
        {
          "id": "sms_receiver::received_delayed_1",
          "sender": "guide",
          "body": "予定イベントの時刻になったため、遅延メッセージが届きました。",
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
      "id": "sms_media_receiver::start",
      "talkId": "sms_media_receiver",
      "blockKey": "start",
      "messages": [
        {
          "id": "sms_media_receiver::start_1",
          "sender": "owner",
          "body": "アルバム未登録画像の受信確認用です。",
          "attachmentId": "",
          "sentAt": "20:14",
          "notes": "",
          "updatedAt": "2026-08-12",
          "source": "human"
        }
      ]
    },
    {
      "id": "sms_media_receiver::receiver_reply",
      "talkId": "sms_media_receiver",
      "blockKey": "receiver_reply",
      "messages": [
        {
          "id": "sms_media_receiver::receiver_reply_1",
          "sender": "guide",
          "body": "このルームは画像受信の確認用です。",
          "attachmentId": "",
          "sentAt": "",
          "delayMs": 350,
          "notes": "",
          "updatedAt": "2026-08-12",
          "source": "human"
        }
      ]
    },
    {
      "id": "sms_media_receiver::received_image",
      "talkId": "sms_media_receiver",
      "blockKey": "received_image",
      "messages": [
        {
          "id": "sms_media_receiver::received_image_1",
          "sender": "guide",
          "body": "アルバムにまだ表示されていない画像です。このルームで表示するとアルバムへ自動登録されます。",
          "attachmentId": "demo_received_image_attachment",
          "sentAt": "",
          "delayMs": 500,
          "notes": "",
          "updatedAt": "2026-08-12",
          "source": "human"
        }
      ]
    },
    {
      "id": "chat_receiver::start",
      "talkId": "chat_receiver",
      "blockKey": "start",
      "messages": [
        {
          "id": "chat_receiver::start_1",
          "sender": "owner",
          "body": "機能テスト用の連携受信ログです。",
          "attachmentId": "",
          "sentAt": "20:14",
          "notes": "",
          "updatedAt": "2026-08-12",
          "source": "human"
        }
      ]
    },
    {
      "id": "chat_receiver::receiver_reply",
      "talkId": "chat_receiver",
      "blockKey": "receiver_reply",
      "messages": [
        {
          "id": "chat_receiver::receiver_reply_1",
          "sender": "visitor",
          "body": "このルームは連携結果の確認用です。",
          "attachmentId": "",
          "sentAt": "",
          "delayMs": 350,
          "notes": "",
          "updatedAt": "2026-08-12",
          "source": "human"
        }
      ]
    },
    {
      "id": "chat_receiver::received_from_sms",
      "talkId": "chat_receiver",
      "blockKey": "received_from_sms",
      "messages": [
        {
          "id": "chat_receiver::received_from_sms_1",
          "sender": "visitor",
          "body": "メッセージアプリの「デモ進行係」からチャットへ届きました。",
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
      "id": "chat_receiver::received_from_chat",
      "talkId": "chat_receiver",
      "blockKey": "received_from_chat",
      "messages": [
        {
          "id": "chat_receiver::received_from_chat_1",
          "sender": "visitor",
          "body": "「サンプルルーム」から別のチャットルームへ届きました。",
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
      "id": "dummy_sms_1::start",
      "talkId": "dummy_sms_1",
      "blockKey": "start",
      "messages": [
        {
          "id": "dummy_sms_1::start_1",
          "sender": "owner",
          "body": "ダミーデータ",
          "attachmentId": "",
          "sentAt": "20:14",
          "notes": "",
          "updatedAt": "2026-08-12",
          "source": "human"
        }
      ]
    },
    {
      "id": "dummy_sms_1::dummy_reply",
      "talkId": "dummy_sms_1",
      "blockKey": "dummy_reply",
      "messages": [
        {
          "id": "dummy_sms_1::dummy_reply_1",
          "sender": "guide",
          "body": "ダミーデータ",
          "attachmentId": "",
          "sentAt": "",
          "delayMs": 250,
          "notes": "",
          "updatedAt": "2026-08-12",
          "source": "human"
        }
      ]
    },
    {
      "id": "dummy_sms_2::start",
      "talkId": "dummy_sms_2",
      "blockKey": "start",
      "messages": [
        {
          "id": "dummy_sms_2::start_1",
          "sender": "owner",
          "body": "ダミーデータ",
          "attachmentId": "",
          "sentAt": "20:14",
          "notes": "",
          "updatedAt": "2026-08-12",
          "source": "human"
        }
      ]
    },
    {
      "id": "dummy_sms_2::dummy_reply",
      "talkId": "dummy_sms_2",
      "blockKey": "dummy_reply",
      "messages": [
        {
          "id": "dummy_sms_2::dummy_reply_1",
          "sender": "guide",
          "body": "ダミーデータ",
          "attachmentId": "",
          "sentAt": "",
          "delayMs": 250,
          "notes": "",
          "updatedAt": "2026-08-12",
          "source": "human"
        }
      ]
    },
    {
      "id": "dummy_sms_3::start",
      "talkId": "dummy_sms_3",
      "blockKey": "start",
      "messages": [
        {
          "id": "dummy_sms_3::start_1",
          "sender": "owner",
          "body": "ダミーデータ",
          "attachmentId": "",
          "sentAt": "20:14",
          "notes": "",
          "updatedAt": "2026-08-12",
          "source": "human"
        }
      ]
    },
    {
      "id": "dummy_sms_3::dummy_reply",
      "talkId": "dummy_sms_3",
      "blockKey": "dummy_reply",
      "messages": [
        {
          "id": "dummy_sms_3::dummy_reply_1",
          "sender": "guide",
          "body": "ダミーデータ",
          "attachmentId": "",
          "sentAt": "",
          "delayMs": 250,
          "notes": "",
          "updatedAt": "2026-08-12",
          "source": "human"
        }
      ]
    },
    {
      "id": "dummy_sms_4::start",
      "talkId": "dummy_sms_4",
      "blockKey": "start",
      "messages": [
        {
          "id": "dummy_sms_4::start_1",
          "sender": "owner",
          "body": "ダミーデータ",
          "attachmentId": "",
          "sentAt": "20:14",
          "notes": "",
          "updatedAt": "2026-08-12",
          "source": "human"
        }
      ]
    },
    {
      "id": "dummy_sms_4::dummy_reply",
      "talkId": "dummy_sms_4",
      "blockKey": "dummy_reply",
      "messages": [
        {
          "id": "dummy_sms_4::dummy_reply_1",
          "sender": "guide",
          "body": "ダミーデータ",
          "attachmentId": "",
          "sentAt": "",
          "delayMs": 250,
          "notes": "",
          "updatedAt": "2026-08-12",
          "source": "human"
        }
      ]
    },
    {
      "id": "dummy_sms_5::start",
      "talkId": "dummy_sms_5",
      "blockKey": "start",
      "messages": [
        {
          "id": "dummy_sms_5::start_1",
          "sender": "owner",
          "body": "ダミーデータ",
          "attachmentId": "",
          "sentAt": "20:14",
          "notes": "",
          "updatedAt": "2026-08-12",
          "source": "human"
        }
      ]
    },
    {
      "id": "dummy_sms_5::dummy_reply",
      "talkId": "dummy_sms_5",
      "blockKey": "dummy_reply",
      "messages": [
        {
          "id": "dummy_sms_5::dummy_reply_1",
          "sender": "guide",
          "body": "ダミーデータ",
          "attachmentId": "",
          "sentAt": "",
          "delayMs": 250,
          "notes": "",
          "updatedAt": "2026-08-12",
          "source": "human"
        }
      ]
    },
    {
      "id": "dummy_sms_6::start",
      "talkId": "dummy_sms_6",
      "blockKey": "start",
      "messages": [
        {
          "id": "dummy_sms_6::start_1",
          "sender": "owner",
          "body": "ダミーデータ",
          "attachmentId": "",
          "sentAt": "20:14",
          "notes": "",
          "updatedAt": "2026-08-12",
          "source": "human"
        }
      ]
    },
    {
      "id": "dummy_sms_6::dummy_reply",
      "talkId": "dummy_sms_6",
      "blockKey": "dummy_reply",
      "messages": [
        {
          "id": "dummy_sms_6::dummy_reply_1",
          "sender": "guide",
          "body": "ダミーデータ",
          "attachmentId": "",
          "sentAt": "",
          "delayMs": 250,
          "notes": "",
          "updatedAt": "2026-08-12",
          "source": "human"
        }
      ]
    },
    {
      "id": "dummy_chat_1::start",
      "talkId": "dummy_chat_1",
      "blockKey": "start",
      "messages": [
        {
          "id": "dummy_chat_1::start_1",
          "sender": "owner",
          "body": "ダミーデータ",
          "attachmentId": "",
          "sentAt": "20:14",
          "notes": "",
          "updatedAt": "2026-08-12",
          "source": "human"
        }
      ]
    },
    {
      "id": "dummy_chat_1::dummy_reply",
      "talkId": "dummy_chat_1",
      "blockKey": "dummy_reply",
      "messages": [
        {
          "id": "dummy_chat_1::dummy_reply_1",
          "sender": "visitor",
          "body": "ダミーデータ",
          "attachmentId": "",
          "sentAt": "",
          "delayMs": 250,
          "notes": "",
          "updatedAt": "2026-08-12",
          "source": "human"
        }
      ]
    },
    {
      "id": "dummy_chat_2::start",
      "talkId": "dummy_chat_2",
      "blockKey": "start",
      "messages": [
        {
          "id": "dummy_chat_2::start_1",
          "sender": "owner",
          "body": "ダミーデータ",
          "attachmentId": "",
          "sentAt": "20:14",
          "notes": "",
          "updatedAt": "2026-08-12",
          "source": "human"
        }
      ]
    },
    {
      "id": "dummy_chat_2::dummy_reply",
      "talkId": "dummy_chat_2",
      "blockKey": "dummy_reply",
      "messages": [
        {
          "id": "dummy_chat_2::dummy_reply_1",
          "sender": "visitor",
          "body": "ダミーデータ",
          "attachmentId": "",
          "sentAt": "",
          "delayMs": 250,
          "notes": "",
          "updatedAt": "2026-08-12",
          "source": "human"
        }
      ]
    },
    {
      "id": "dummy_chat_3::start",
      "talkId": "dummy_chat_3",
      "blockKey": "start",
      "messages": [
        {
          "id": "dummy_chat_3::start_1",
          "sender": "owner",
          "body": "ダミーデータ",
          "attachmentId": "",
          "sentAt": "20:14",
          "notes": "",
          "updatedAt": "2026-08-12",
          "source": "human"
        }
      ]
    },
    {
      "id": "dummy_chat_3::dummy_reply",
      "talkId": "dummy_chat_3",
      "blockKey": "dummy_reply",
      "messages": [
        {
          "id": "dummy_chat_3::dummy_reply_1",
          "sender": "visitor",
          "body": "ダミーデータ",
          "attachmentId": "",
          "sentAt": "",
          "delayMs": 250,
          "notes": "",
          "updatedAt": "2026-08-12",
          "source": "human"
        }
      ]
    },
    {
      "id": "dummy_chat_4::start",
      "talkId": "dummy_chat_4",
      "blockKey": "start",
      "messages": [
        {
          "id": "dummy_chat_4::start_1",
          "sender": "owner",
          "body": "ダミーデータ",
          "attachmentId": "",
          "sentAt": "20:14",
          "notes": "",
          "updatedAt": "2026-08-12",
          "source": "human"
        }
      ]
    },
    {
      "id": "dummy_chat_4::dummy_reply",
      "talkId": "dummy_chat_4",
      "blockKey": "dummy_reply",
      "messages": [
        {
          "id": "dummy_chat_4::dummy_reply_1",
          "sender": "visitor",
          "body": "ダミーデータ",
          "attachmentId": "",
          "sentAt": "",
          "delayMs": 250,
          "notes": "",
          "updatedAt": "2026-08-12",
          "source": "human"
        }
      ]
    },
    {
      "id": "dummy_chat_5::start",
      "talkId": "dummy_chat_5",
      "blockKey": "start",
      "messages": [
        {
          "id": "dummy_chat_5::start_1",
          "sender": "owner",
          "body": "ダミーデータ",
          "attachmentId": "",
          "sentAt": "20:14",
          "notes": "",
          "updatedAt": "2026-08-12",
          "source": "human"
        }
      ]
    },
    {
      "id": "dummy_chat_5::dummy_reply",
      "talkId": "dummy_chat_5",
      "blockKey": "dummy_reply",
      "messages": [
        {
          "id": "dummy_chat_5::dummy_reply_1",
          "sender": "visitor",
          "body": "ダミーデータ",
          "attachmentId": "",
          "sentAt": "",
          "delayMs": 250,
          "notes": "",
          "updatedAt": "2026-08-12",
          "source": "human"
        }
      ]
    },
    {
      "id": "dummy_chat_6::start",
      "talkId": "dummy_chat_6",
      "blockKey": "start",
      "messages": [
        {
          "id": "dummy_chat_6::start_1",
          "sender": "owner",
          "body": "ダミーデータ",
          "attachmentId": "",
          "sentAt": "20:14",
          "notes": "",
          "updatedAt": "2026-08-12",
          "source": "human"
        }
      ]
    },
    {
      "id": "dummy_chat_6::dummy_reply",
      "talkId": "dummy_chat_6",
      "blockKey": "dummy_reply",
      "messages": [
        {
          "id": "dummy_chat_6::dummy_reply_1",
          "sender": "visitor",
          "body": "ダミーデータ",
          "attachmentId": "",
          "sentAt": "",
          "delayMs": 250,
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
    },
    {
      "id": "demo_received_image_attachment",
      "type": "image",
      "asset": "/demo/dummy-data.svg",
      "content": "demo_received_image"
    },
    {
      "id": "demo_video_poster",
      "type": "image",
      "asset": "/demo/dummy-data.svg"
    },
    {
      "id": "demo_video_attachment",
      "type": "video",
      "asset": "/demo/demo-video.mp4",
      "content": "demo_video",
      "poster": "demo_video_poster"
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
      "name": "着信テスト",
      "audioUrl": "/system/call-caption-sample.wav",
      "transcript": [
        {
          "atMs": 0,
          "text": "［低い確認音］"
        },
        {
          "atMs": 2000,
          "text": "［中くらいの確認音］"
        },
        {
          "atMs": 4000,
          "text": "［高い確認音］"
        }
      ],
      "publicId": "call_101df897abb3"
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
      "text": "メッセージでデモ進行係に灯りの色を伝える",
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
      "title": "デモ進行係",
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
    },
    {
      "id": "demo_sms_message_received",
      "appId": "messages",
      "targetTalkId": "sms_receiver",
      "title": "テスト受信箱",
      "body": "別のメッセージルームから新着メッセージが届きました。",
      "cond": "demo_sms_message_received"
    },
    {
      "id": "demo_sms_cross_received",
      "appId": "messages",
      "targetTalkId": "sms_receiver",
      "title": "テスト受信箱",
      "body": "チャットからメッセージアプリへ新着が届きました。",
      "cond": "demo_sms_cross_received"
    },
    {
      "id": "demo_delayed_message_received",
      "appId": "messages",
      "targetTalkId": "sms_receiver",
      "title": "テスト受信箱",
      "body": "遅延イベントから新着メッセージが届きました。",
      "cond": "demo_delayed_message_received"
    },
    {
      "id": "demo_image_received",
      "appId": "messages",
      "targetTalkId": "sms_media_receiver",
      "title": "画像受信",
      "body": "アルバム未登録の画像が届きました。",
      "cond": "demo_image_received"
    },
    {
      "id": "demo_chat_message_received",
      "appId": "chat",
      "targetTalkId": "chat_receiver",
      "title": "連携受信ログ",
      "body": "別のチャットルームから新着が届きました。",
      "cond": "demo_chat_message_received"
    },
    {
      "id": "demo_chat_cross_received",
      "appId": "chat",
      "targetTalkId": "chat_receiver",
      "title": "連携受信ログ",
      "body": "メッセージアプリからチャットへ新着が届きました。",
      "cond": "demo_chat_cross_received"
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
      "body": "メッセージでデモ進行係に、写真で一番大きく見えた灯りの色を送って。",
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
  "albumMediaAttachmentLinks": [
    {
      "attachmentId": "rainy_window_image",
      "photoId": "rainy_window"
    },
    {
      "attachmentId": "demo_received_image_attachment",
      "photoId": "demo_received_image"
    },
    {
      "attachmentId": "demo_video_attachment",
      "photoId": "demo_video"
    }
  ],
  "lockedContentPasswords": [
    {
      "contentId": "sealed_note",
      "passwordHash": "5335c1c78b99ea77b73cc03f735adc472835dc47c10e553d20f6e7ba338c0da3"
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
      "event": "talk_sent",
      "target": "guide",
      "handler": "activate_unlock_todo",
      "cond": "image_color_reported && !sealed_note_unlocked",
      "llm": false
    },
    {
      "event": "talk_sent",
      "target": "guide",
      "handler": "handle_demo_test_command",
      "cond": "",
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
      "target": "deliver_demo_delayed_message",
      "handler": "deliver_demo_delayed_message",
      "cond": "",
      "llm": false
    },
    {
      "event": "scenario_event",
      "target": "incoming_call_completed",
      "handler": "mark_demo_call_completed",
      "cond": "!demo_call_completed",
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
      "event": "talk_sent",
      "target": "lobby",
      "handler": "complete_demo_todo",
      "cond": "demo_completed",
      "llm": false
    },
    {
      "event": "talk_sent",
      "target": "lobby",
      "handler": "handle_demo_chat_test_command",
      "cond": "",
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
      "dummy_call_1": "c_2026bc4fe74f",
      "dummy_call_2": "c_f70177071c48",
      "dummy_call_3": "c_e73677fd9822",
      "dummy_call_4": "c_8f794be1736f",
      "dummy_call_5": "c_7c4385c5b673",
      "dummy_call_6": "c_07c948744931",
      "demo_call_history": "c_8a5f7f91ea5b",
      "mail_guide": "c_271fc8c96870",
      "guide_history_archive_a": "c_f452f3bfd9c3",
      "guide_history_archive_b": "c_d2fb1ed4cac6",
      "lobby_history_archive": "c_ee422a2fa57f",
      "damaged_mail": "c_4a00ef29e36b",
      "dummy_mail_1": "c_451b9414a8da",
      "dummy_mail_2": "c_eb5be853c25d",
      "dummy_mail_3": "c_79ba43a616d2",
      "dummy_mail_4": "c_74bbb653f3aa",
      "welcome_note": "c_fbeb27e60040",
      "feature_test_guide": "c_cefa574e8306",
      "old_note": "c_32c01e364751",
      "dummy_note_1": "c_9963319fe24e",
      "dummy_note_2": "c_2d05b2ffd3ce",
      "dummy_note_3": "c_e9de14c38b65",
      "dummy_note_4": "c_a59b078ce15f",
      "dummy_note_5": "c_d5126f33366a",
      "dummy_note_6": "c_b6d1a7ef235b",
      "sealed_note": "c_bdffc57fcb5c",
      "evening_platform": "c_5a463a5eb50a",
      "rainy_window": "c_394e3752c02b",
      "coffee_table": "c_64fd68903e0a",
      "demo_video": "c_5d1be1170cf1",
      "demo_received_image": "c_1aaf7fdd7a82",
      "dummy_photo_1": "c_7229adc1604d",
      "dummy_photo_2": "c_fb58b8d23060",
      "dummy_photo_3": "c_358b3bcd1b50",
      "dummy_photo_4": "c_3a6375761b45",
      "dummy_photo_5": "c_a2e7fdc5f793",
      "dummy_photo_6": "c_ec168fb41748",
      "owner_schedule": "c_5ad6b8c27c5f",
      "dummy_schedule_1": "c_a37ddcb9ffde",
      "dummy_schedule_2": "c_9a7365886b8a",
      "dummy_schedule_3": "c_17cc0b436b41",
      "dummy_schedule_4": "c_ad8b983cd8fc",
      "dummy_schedule_5": "c_cd7b2c42cb24",
      "dummy_schedule_6": "c_2e9e5b44006e",
      "dummy_schedule_7": "c_3418c04e0c56",
      "dummy_schedule_8": "c_a0ec894adce6",
      "browser_guide": "c_a0cec9e1ac30",
      "dummy_browser_1": "c_be720b110439",
      "dummy_browser_2": "c_fd4144354636",
      "dummy_browser_3": "c_2d9ff48c2e57",
      "dummy_browser_4": "c_6583456c66bb",
      "dummy_browser_5": "c_72782ea7ea51",
      "dummy_browser_6": "c_3eeb6b99d118",
      "browser_archive": "c_e9c108f35d34",
      "sample_radio": "c_513e68175e27",
      "dummy_radio_1": "c_a1885b48dd86",
      "dummy_radio_2": "c_02a56b40c49f",
      "dummy_radio_3": "c_e4a4835b572c",
      "dummy_radio_4": "c_21727e0c83a1",
      "dummy_radio_5": "c_447380361ccd"
    },
    "talk": {
      "guide": "t_17f5f84e4690",
      "sms_receiver": "t_b18a7456e416",
      "sms_media_receiver": "t_ef9cabd43865",
      "dummy_sms_1": "t_bc14bdf75f7e",
      "dummy_sms_2": "t_17983c9a39f9",
      "dummy_sms_3": "t_040dd4088ff1",
      "dummy_sms_4": "t_6f99c15839d9",
      "dummy_sms_5": "t_f5c8125fca30",
      "dummy_sms_6": "t_59219841f338",
      "lobby": "t_384f82df1ef6",
      "chat_receiver": "t_b873fa6b67cf",
      "dummy_chat_1": "t_4aff5248b7f8",
      "dummy_chat_2": "t_31942c9c962d",
      "dummy_chat_3": "t_73a75e3d8faa",
      "dummy_chat_4": "t_0e6f206f66af",
      "dummy_chat_5": "t_0a2e442c9bb6",
      "dummy_chat_6": "t_cb0b2cb99f03"
    },
    "attachment": {
      "rainy_window_image": "a_e98826327ab7",
      "sealed_note_file": "a_f0739fda5410",
      "demo_received_image_attachment": "a_48c127707e4a",
      "demo_video_poster": "a_eccc2405c02c",
      "demo_video_attachment": "a_b5d08e2fcddf"
    },
    "incomingCall": {
      "demo_call": "call_101df897abb3"
    },
    "form": {},
    "notification": {
      "welcome": "notification_5dd2fa869822",
      "chat_auth": "notification_2459e912b85b",
      "demo_sms_message_received": "notification_a9ed392341e0",
      "demo_sms_cross_received": "notification_fe6ab0399725",
      "demo_delayed_message_received": "notification_623047b9cddc",
      "demo_image_received": "notification_e08922af76e2",
      "demo_chat_message_received": "notification_342ce427a08a",
      "demo_chat_cross_received": "notification_d2b328d53f7c"
    },
    "generatedAudio": {
      "demo_voice": "g_aedd90a2a532"
    },
    "scenarioEvent": {
      "schedule_demo_call": "e_94e1dde96cea",
      "show_demo_call": "e_15f1b15ac2d7",
      "deliver_demo_delayed_message": "e_e62843403b8c",
      "incoming_call_completed": "e_4e6b6c69daf8",
      "demo_form": "e_e681caadd11a",
      "demo_all_clear": "e_a518caaa7a2d",
      "demo_form_reject": "e_26e72f12991e",
      "chat_auth_link_requested": "e_0d203bfe05d8",
      "message_link_opened": "e_f1dc8312dd96",
      "audio_playback_completed": "e_27d23d55cdc7"
    }
  }
};
