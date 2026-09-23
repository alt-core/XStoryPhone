// scenario:build により生成されます。直接編集しないでください。
import type { WorkerScenario } from "../shared/scenario";

export const workerScenario: WorkerScenario = {
  "revision": "902fc6d07867e51d",
  "clientRevision": "client_8a2baa6cc9e2f3e9",
  "transcriptRevision": "transcript_ced6cb28a4ade7c7",
  "playerMode": "browser",
  "project": {
    "id": "demo",
    "name": "XStoryPhone Demo",
    "osName": "StoryOS",
    "assistantName": "ナビ",
    "talkClock": "real",
    "repairParentApp": false,
    "accentColor": "#8fd2ff",
    "date": "2026-08-12",
    "timeLabel": "20:14",
    "batteryLevel": 72,
    "signalLabel": "4G",
    "wallpaperUrl": "/demo/wallpaper.svg",
    "lockScreen": {
      "method": "none"
    }
  },
  "projectConstants": {
    "project.id": "demo",
    "project.name": "XStoryPhone Demo",
    "device.os_name": "StoryOS",
    "search_agent.name": "ナビ",
    "device.accent_color": "#8fd2ff",
    "device.date": "2026-08-12",
    "device.time_label": "20:14",
    "device.battery_level": "72",
    "device.signal_label": "4G",
    "device.wallpaper_url": "/demo/wallpaper.svg",
    "player.mode": "browser",
    "features.llm": "false",
    "device.lock_method": "none",
    "search_agent.broken_link_tutorial_body": "ごめんなさい。アプリへのリンクが破損しています。右下のナビを開いて「メッセージ」と検索してみてください。",
    "search_agent.broken_link_body": "リンクが破損しています。中身が分かれば、ナビの検索結果から開けるかもしれません。",
    "event.client_callable": "chat_auth_link_requested",
    "chat_auth.cond": "sealed_note_unlocked && !chat_auth_verified",
    "chat_auth.link_sent_cond": "chat_auth_link_sent",
    "search_agent.start": "/input hide\nintro\n/input show"
  },
  "apps": [
    {
      "id": "phone",
      "label": "電話",
      "icon": "phone",
      "accent": "#67d78e",
      "initialState": "normal",
      "cond": "",
      "search": [
        "電話",
        "着信"
      ],
      "badgeCond": "",
      "part": "base",
      "order": 0
    },
    {
      "id": "messages",
      "label": "メッセージ",
      "icon": "message_circle",
      "accent": "#5cc8a7",
      "initialState": "normal",
      "cond": "",
      "search": [
        "メッセージ"
      ],
      "badgeCond": "",
      "part": "base",
      "order": 1
    },
    {
      "id": "mail",
      "label": "メール",
      "icon": "mail",
      "accent": "#aebcff",
      "initialState": "normal",
      "cond": "",
      "search": [
        "メール",
        "電子メール"
      ],
      "badgeCond": "",
      "part": "base",
      "order": 2
    },
    {
      "id": "notes",
      "label": "メモ",
      "icon": "notebook_pen",
      "accent": "#8fd2ff",
      "initialState": "normal",
      "cond": "",
      "search": [
        "メモアプリ",
        "ノートアプリ"
      ],
      "badgeCond": "",
      "part": "base",
      "order": 3
    },
    {
      "id": "photos",
      "label": "アルバム",
      "icon": "album",
      "accent": "#f0b35d",
      "initialState": "normal",
      "cond": "",
      "search": [
        "アルバム",
        "写真"
      ],
      "badgeCond": "",
      "part": "base",
      "order": 4
    },
    {
      "id": "calendar",
      "label": "スケジュール",
      "icon": "calendar_days",
      "accent": "#f07178",
      "initialState": "normal",
      "cond": "",
      "search": [
        "予定",
        "スケジュール"
      ],
      "badgeCond": "",
      "part": "base",
      "order": 5
    },
    {
      "id": "radio",
      "label": "ラジオ",
      "icon": "radio",
      "accent": "#f4c86a",
      "initialState": "normal",
      "cond": "",
      "search": [
        "ラジオ",
        "放送"
      ],
      "badgeCond": "",
      "part": "base",
      "order": 6
    },
    {
      "id": "browser",
      "label": "ブラウザ",
      "icon": "globe_2",
      "accent": "#79b9ff",
      "initialState": "normal",
      "cond": "",
      "search": [
        "ブラウザ",
        "タブ",
        "Web"
      ],
      "badgeCond": "",
      "part": "base",
      "order": 7
    },
    {
      "id": "chat",
      "label": "チャット",
      "icon": "message_square_text",
      "accent": "#7ee093",
      "initialState": "repairable",
      "cond": "sealed_note_unlocked",
      "search": [
        "チャット",
        "ロビー",
        "掲示板"
      ],
      "repairLabel": "チャ▗▛▞▐▀",
      "badgeCond": "",
      "part": "base",
      "order": 8
    }
  ],
  "projectAppIds": [
    "case_files"
  ],
  "features": {
    "llm": false
  },
  "stateVariables": {
    "image_color_reported": false,
    "clue_attachments_pending": false,
    "old_note_opened": false,
    "rainy_window_opened": false,
    "chat_auth_link_sent": false,
    "chat_auth_verified": false,
    "demo_completed": false,
    "demo_completion_announced": false,
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
    "clue_attachments_pending": {
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
    "demo_completion_announced": {
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
    "rainy_window": "雨粒の付いた窓越しに夜景が見え、右下寄りの青い灯りが最も大きく写っている。",
    "coffee_table": "コーヒーカップと開いたノートが木製の机に置かれている。",
    "demo_video": "プログラムで生成したカラーバーが動くデモ動画。",
    "demo_received_image": "メッセージ受信からアルバムへ自動登録されることを確認するダミー画像。"
  },
  "contents": [
    {
      "id": "welcome_note",
      "appId": "notes",
      "initialState": "normal",
      "cond": "",
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
      "publicId": "c_fbeb27e60040",
      "part": "base",
      "order": 0
    },
    {
      "id": "feature_test_guide",
      "appId": "notes",
      "initialState": "normal",
      "cond": "",
      "search": [
        "機能テスト",
        "試し方",
        "着信テスト",
        "遅延メッセージ"
      ],
      "record": {
        "title": "機能テスト一覧",
        "body": "ナビで「機能テスト」と入力するか、Quick Replyの「機能テスト」を選ぶと、次の操作を選べます。\n\n・着信テスト：数秒後に電話が着信します。\n・遅延メッセージ：数秒後に別ルームへ届き、通知が出ます。\n・画像受信テスト：別ルームに画像が届き、開くとアルバムへ自動登録されます。\n・ノイズ演出：端末全体にノイズを表示します。\n・フラッシュ演出：端末全体を白く光らせます。\n・暗転演出：端末全体を一時的に暗転します。\n・ゲームオーバー演出：ゲームオーバー画面を表示します。\n・オールクリア演出：オールクリア画面の後、ラジオへ移動します。\n\nメッセージの「デモ連絡先」では、何か送信すると連携先を選ぶQuick Replyが表示されます。\n・別ルームへ送る：別のメッセージルームへ届きます。\n・チャットへ送る：チャット復旧後、チャットの別ルームへ届きます。\n\nチャットの「サンプルルーム」では、\n・チャット連携：別のチャットルームへ届きます。\n・メッセージへ送る：メッセージの受信箱へ届きます。\n\nナビで「消えた連絡記録」または「消えた談話記録」と検索すると、会話内の破損した初期履歴を修復できます。各受信では通知も表示されます。繰り返す場合は通知シェードの「最初から」を使ってください。",
        "tags": [
          "案内",
          "機能テスト"
        ]
      },
      "publicId": "c_cefa574e8306",
      "part": "base",
      "order": 1
    },
    {
      "id": "old_note",
      "appId": "notes",
      "initialState": "repairable",
      "cond": "",
      "search": [
        "古いメモ",
        "ふるいメモ"
      ],
      "repairLabel": "古▚▐▀▜メモ",
      "record": {
        "title": "古いメモ",
        "body": "次は画像を探します。ナビで「雨」と検索し、表示された画像で一番大きく見える灯りの色を確認してください。色が分かったら、そのままナビに色を伝えてください。",
        "tags": [
          "操作",
          "画像"
        ]
      },
      "publicId": "c_32c01e364751",
      "part": "base",
      "order": 2
    },
    {
      "id": "dummy_note_1",
      "appId": "notes",
      "initialState": "normal",
      "cond": "",
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
      "publicId": "c_9963319fe24e",
      "part": "base",
      "order": 3
    },
    {
      "id": "dummy_note_2",
      "appId": "notes",
      "initialState": "normal",
      "cond": "",
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
      "publicId": "c_2d05b2ffd3ce",
      "part": "base",
      "order": 4
    },
    {
      "id": "dummy_note_3",
      "appId": "notes",
      "initialState": "normal",
      "cond": "",
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
      "publicId": "c_e9de14c38b65",
      "part": "base",
      "order": 5
    },
    {
      "id": "dummy_note_4",
      "appId": "notes",
      "initialState": "normal",
      "cond": "",
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
      "publicId": "c_a59b078ce15f",
      "part": "base",
      "order": 6
    },
    {
      "id": "dummy_note_5",
      "appId": "notes",
      "initialState": "normal",
      "cond": "",
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
      "publicId": "c_d5126f33366a",
      "part": "base",
      "order": 7
    },
    {
      "id": "dummy_note_6",
      "appId": "notes",
      "initialState": "normal",
      "cond": "",
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
      "publicId": "c_b6d1a7ef235b",
      "part": "base",
      "order": 8
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
      "publicId": "c_bdffc57fcb5c",
      "part": "base",
      "order": 9
    },
    {
      "id": "evening_platform",
      "appId": "photos",
      "initialState": "normal",
      "cond": "",
      "search": [
        "駅",
        "ホーム",
        "夕方",
        "写真"
      ],
      "record": {
        "title": "夕方のホーム",
        "imageAttachmentId": "media_7",
        "tags": [
          "駅",
          "夕方"
        ]
      },
      "publicId": "c_5a463a5eb50a",
      "part": "base",
      "order": 10
    },
    {
      "id": "rainy_window",
      "appId": "photos",
      "initialState": "repairable",
      "cond": "",
      "search": [
        "雨",
        "窓",
        "夜",
        "写真"
      ],
      "repairLabel": "暗▚▞▐化された画像",
      "record": {
        "title": "雨の日の窓",
        "imageAttachmentId": "rainy_window_image",
        "tags": [
          "雨",
          "窓"
        ]
      },
      "publicId": "c_394e3752c02b",
      "part": "base",
      "order": 11
    },
    {
      "id": "coffee_table",
      "appId": "photos",
      "initialState": "normal",
      "cond": "",
      "search": [
        "コーヒー",
        "ノート",
        "机",
        "写真"
      ],
      "record": {
        "title": "休憩中",
        "imageAttachmentId": "media_8",
        "tags": [
          "休憩"
        ]
      },
      "publicId": "c_64fd68903e0a",
      "part": "base",
      "order": 12
    },
    {
      "id": "demo_video",
      "appId": "photos",
      "initialState": "normal",
      "cond": "",
      "search": [
        "動画",
        "デモ動画",
        "カラーバー"
      ],
      "record": {
        "title": "デモ動画",
        "imageAttachmentId": "demo_received_image_attachment",
        "mediaKind": "video",
        "videoAttachmentId": "demo_video_attachment",
        "tags": [
          "動画",
          "動作確認"
        ]
      },
      "publicId": "c_5d1be1170cf1",
      "part": "base",
      "order": 13
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
        "imageAttachmentId": "demo_received_image_attachment",
        "tags": [
          "受信",
          "ダミーデータ"
        ]
      },
      "publicId": "c_1aaf7fdd7a82",
      "part": "base",
      "order": 14
    },
    {
      "id": "dummy_photo_1",
      "appId": "photos",
      "initialState": "normal",
      "cond": "",
      "search": [
        "ダミーデータ"
      ],
      "record": {
        "title": "ダミーデータ",
        "imageAttachmentId": "demo_received_image_attachment",
        "tags": [
          "ダミーデータ"
        ]
      },
      "publicId": "c_7229adc1604d",
      "part": "base",
      "order": 15
    },
    {
      "id": "dummy_photo_2",
      "appId": "photos",
      "initialState": "normal",
      "cond": "",
      "search": [
        "ダミーデータ"
      ],
      "record": {
        "title": "ダミーデータ",
        "imageAttachmentId": "demo_received_image_attachment",
        "tags": [
          "ダミーデータ"
        ]
      },
      "publicId": "c_fb58b8d23060",
      "part": "base",
      "order": 16
    },
    {
      "id": "dummy_photo_3",
      "appId": "photos",
      "initialState": "normal",
      "cond": "",
      "search": [
        "ダミーデータ"
      ],
      "record": {
        "title": "ダミーデータ",
        "imageAttachmentId": "demo_received_image_attachment",
        "tags": [
          "ダミーデータ"
        ]
      },
      "publicId": "c_358b3bcd1b50",
      "part": "base",
      "order": 17
    },
    {
      "id": "dummy_photo_4",
      "appId": "photos",
      "initialState": "normal",
      "cond": "",
      "search": [
        "ダミーデータ"
      ],
      "record": {
        "title": "ダミーデータ",
        "imageAttachmentId": "demo_received_image_attachment",
        "tags": [
          "ダミーデータ"
        ]
      },
      "publicId": "c_3a6375761b45",
      "part": "base",
      "order": 18
    },
    {
      "id": "dummy_photo_5",
      "appId": "photos",
      "initialState": "normal",
      "cond": "",
      "search": [
        "ダミーデータ"
      ],
      "record": {
        "title": "ダミーデータ",
        "imageAttachmentId": "demo_received_image_attachment",
        "tags": [
          "ダミーデータ"
        ]
      },
      "publicId": "c_a2e7fdc5f793",
      "part": "base",
      "order": 19
    },
    {
      "id": "dummy_photo_6",
      "appId": "photos",
      "initialState": "normal",
      "cond": "",
      "search": [
        "ダミーデータ"
      ],
      "record": {
        "title": "ダミーデータ",
        "imageAttachmentId": "demo_received_image_attachment",
        "tags": [
          "ダミーデータ"
        ]
      },
      "publicId": "c_ec168fb41748",
      "part": "base",
      "order": 20
    },
    {
      "id": "owner_schedule",
      "appId": "calendar",
      "initialState": "normal",
      "cond": "",
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
      "publicId": "c_5ad6b8c27c5f",
      "part": "base",
      "order": 21
    },
    {
      "id": "dummy_schedule_1",
      "appId": "calendar",
      "initialState": "normal",
      "cond": "",
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
      "publicId": "c_a37ddcb9ffde",
      "part": "base",
      "order": 22
    },
    {
      "id": "dummy_schedule_2",
      "appId": "calendar",
      "initialState": "normal",
      "cond": "",
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
      "publicId": "c_9a7365886b8a",
      "part": "base",
      "order": 23
    },
    {
      "id": "dummy_schedule_3",
      "appId": "calendar",
      "initialState": "normal",
      "cond": "",
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
      "publicId": "c_17cc0b436b41",
      "part": "base",
      "order": 24
    },
    {
      "id": "dummy_schedule_4",
      "appId": "calendar",
      "initialState": "normal",
      "cond": "",
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
      "publicId": "c_ad8b983cd8fc",
      "part": "base",
      "order": 25
    },
    {
      "id": "dummy_schedule_5",
      "appId": "calendar",
      "initialState": "normal",
      "cond": "",
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
      "publicId": "c_cd7b2c42cb24",
      "part": "base",
      "order": 26
    },
    {
      "id": "dummy_schedule_6",
      "appId": "calendar",
      "initialState": "normal",
      "cond": "",
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
      "publicId": "c_2e9e5b44006e",
      "part": "base",
      "order": 27
    },
    {
      "id": "dummy_schedule_7",
      "appId": "calendar",
      "initialState": "normal",
      "cond": "",
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
      "publicId": "c_3418c04e0c56",
      "part": "base",
      "order": 28
    },
    {
      "id": "dummy_schedule_8",
      "appId": "calendar",
      "initialState": "normal",
      "cond": "",
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
      "publicId": "c_a0ec894adce6",
      "part": "base",
      "order": 29
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
        "audioAttachmentId": "media_6",
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
      "publicId": "c_8a5f7f91ea5b",
      "part": "base",
      "order": 30
    },
    {
      "id": "missed_call",
      "appId": "phone",
      "initialState": "normal",
      "cond": "",
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
      "publicId": "c_0376fabddf4f",
      "part": "base",
      "order": 31
    },
    {
      "id": "demo_voicemail",
      "appId": "phone",
      "initialState": "normal",
      "cond": "",
      "search": [
        "留守番電話",
        "留守電",
        "ボイスメール"
      ],
      "record": {
        "name": "案内係",
        "kind": "voicemail",
        "at": "19:48",
        "durationLabel": "6秒",
        "audioAttachmentId": "media_6",
        "transcript": [
          {
            "atMs": 0,
            "text": "留守番電話の再生確認です。"
          },
          {
            "atMs": 2000,
            "text": "書き起こしは時刻を付けずに表示します。"
          },
          {
            "atMs": 4000,
            "text": "最後までスクロールして確認できます。"
          }
        ]
      },
      "publicId": "c_1587119bb83d",
      "part": "base",
      "order": 32
    },
    {
      "id": "dummy_call_1",
      "appId": "phone",
      "initialState": "normal",
      "cond": "",
      "search": [
        "ダミーデータ"
      ],
      "record": {
        "name": "ダミーデータ",
        "kind": "missed",
        "at": "00:00",
        "durationLabel": "応答なし"
      },
      "publicId": "c_2026bc4fe74f",
      "part": "base",
      "order": 33
    },
    {
      "id": "dummy_call_2",
      "appId": "phone",
      "initialState": "normal",
      "cond": "",
      "search": [
        "ダミーデータ"
      ],
      "record": {
        "name": "ダミーデータ",
        "kind": "missed",
        "at": "00:00",
        "durationLabel": "応答なし"
      },
      "publicId": "c_f70177071c48",
      "part": "base",
      "order": 34
    },
    {
      "id": "dummy_call_3",
      "appId": "phone",
      "initialState": "normal",
      "cond": "",
      "search": [
        "ダミーデータ"
      ],
      "record": {
        "name": "ダミーデータ",
        "kind": "missed",
        "at": "00:00",
        "durationLabel": "応答なし"
      },
      "publicId": "c_e73677fd9822",
      "part": "base",
      "order": 35
    },
    {
      "id": "dummy_call_4",
      "appId": "phone",
      "initialState": "normal",
      "cond": "",
      "search": [
        "ダミーデータ"
      ],
      "record": {
        "name": "ダミーデータ",
        "kind": "missed",
        "at": "00:00",
        "durationLabel": "応答なし"
      },
      "publicId": "c_8f794be1736f",
      "part": "base",
      "order": 36
    },
    {
      "id": "dummy_call_5",
      "appId": "phone",
      "initialState": "normal",
      "cond": "",
      "search": [
        "ダミーデータ"
      ],
      "record": {
        "name": "ダミーデータ",
        "kind": "missed",
        "at": "00:00",
        "durationLabel": "応答なし"
      },
      "publicId": "c_7c4385c5b673",
      "part": "base",
      "order": 37
    },
    {
      "id": "dummy_call_6",
      "appId": "phone",
      "initialState": "normal",
      "cond": "",
      "search": [
        "ダミーデータ"
      ],
      "record": {
        "name": "ダミーデータ",
        "kind": "missed",
        "at": "00:00",
        "durationLabel": "応答なし"
      },
      "publicId": "c_07c948744931",
      "part": "base",
      "order": 38
    },
    {
      "id": "sample_radio",
      "appId": "radio",
      "initialState": "normal",
      "cond": "",
      "search": [
        "ラジオ",
        "放送",
        "音声"
      ],
      "record": {
        "programTitle": "接続テスト放送",
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
        ],
        "audioAttachmentId": "media_9"
      },
      "publicId": "c_513e68175e27",
      "part": "base",
      "order": 39
    },
    {
      "id": "dummy_radio_1",
      "appId": "radio",
      "initialState": "normal",
      "cond": "",
      "search": [
        "ダミーデータ"
      ],
      "record": {
        "programTitle": "ダミーデータ"
      },
      "publicId": "c_a1885b48dd86",
      "part": "base",
      "order": 40
    },
    {
      "id": "dummy_radio_2",
      "appId": "radio",
      "initialState": "normal",
      "cond": "",
      "search": [
        "ダミーデータ"
      ],
      "record": {
        "programTitle": "ダミーデータ"
      },
      "publicId": "c_02a56b40c49f",
      "part": "base",
      "order": 41
    },
    {
      "id": "dummy_radio_3",
      "appId": "radio",
      "initialState": "normal",
      "cond": "",
      "search": [
        "ダミーデータ"
      ],
      "record": {
        "programTitle": "ダミーデータ"
      },
      "publicId": "c_e4a4835b572c",
      "part": "base",
      "order": 42
    },
    {
      "id": "dummy_radio_4",
      "appId": "radio",
      "initialState": "normal",
      "cond": "",
      "search": [
        "ダミーデータ"
      ],
      "record": {
        "programTitle": "ダミーデータ"
      },
      "publicId": "c_21727e0c83a1",
      "part": "base",
      "order": 43
    },
    {
      "id": "dummy_radio_5",
      "appId": "radio",
      "initialState": "normal",
      "cond": "",
      "search": [
        "ダミーデータ"
      ],
      "record": {
        "programTitle": "ダミーデータ"
      },
      "publicId": "c_447380361ccd",
      "part": "base",
      "order": 44
    },
    {
      "id": "mail_guide",
      "appId": "mail",
      "initialState": "normal",
      "cond": "",
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
      "publicId": "c_271fc8c96870",
      "part": "base",
      "order": 45
    },
    {
      "id": "damaged_mail",
      "appId": "mail",
      "initialState": "repairable",
      "cond": "",
      "search": [
        "未整理メール",
        "破損メール",
        "メール修復"
      ],
      "repairLabel": "未▚▐▀▜メール",
      "record": {
        "from": "確認担当",
        "to": "プレイヤー",
        "subject": "修復されたメール",
        "date": "2026年8月12日 18:45",
        "body": "メール単位の修復が完了しました。Ccが設定された場合は、宛先情報の中に表示されます。",
        "cc": "デモ運営"
      },
      "publicId": "c_4a00ef29e36b",
      "part": "base",
      "order": 46
    },
    {
      "id": "dummy_mail_1",
      "appId": "mail",
      "initialState": "normal",
      "cond": "",
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
      "publicId": "c_451b9414a8da",
      "part": "base",
      "order": 47
    },
    {
      "id": "dummy_mail_2",
      "appId": "mail",
      "initialState": "normal",
      "cond": "",
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
      "publicId": "c_eb5be853c25d",
      "part": "base",
      "order": 48
    },
    {
      "id": "dummy_mail_3",
      "appId": "mail",
      "initialState": "normal",
      "cond": "",
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
      "publicId": "c_79ba43a616d2",
      "part": "base",
      "order": 49
    },
    {
      "id": "dummy_mail_4",
      "appId": "mail",
      "initialState": "normal",
      "cond": "",
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
      "publicId": "c_74bbb653f3aa",
      "part": "base",
      "order": 50
    },
    {
      "id": "browser_guide",
      "appId": "browser",
      "initialState": "normal",
      "cond": "",
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
      "publicId": "c_a0cec9e1ac30",
      "part": "base",
      "order": 51
    },
    {
      "id": "dummy_browser_1",
      "appId": "browser",
      "initialState": "normal",
      "cond": "",
      "search": [
        "ダミーデータ"
      ],
      "record": {
        "title": "ダミーデータ",
        "url": "/demo/browser/dummy.html"
      },
      "publicId": "c_be720b110439",
      "part": "base",
      "order": 52
    },
    {
      "id": "dummy_browser_2",
      "appId": "browser",
      "initialState": "normal",
      "cond": "",
      "search": [
        "ダミーデータ"
      ],
      "record": {
        "title": "ダミーデータ",
        "url": "/demo/browser/dummy.html"
      },
      "publicId": "c_fd4144354636",
      "part": "base",
      "order": 53
    },
    {
      "id": "dummy_browser_3",
      "appId": "browser",
      "initialState": "normal",
      "cond": "",
      "search": [
        "ダミーデータ"
      ],
      "record": {
        "title": "ダミーデータ",
        "url": "/demo/browser/dummy.html"
      },
      "publicId": "c_2d9ff48c2e57",
      "part": "base",
      "order": 54
    },
    {
      "id": "dummy_browser_4",
      "appId": "browser",
      "initialState": "normal",
      "cond": "",
      "search": [
        "ダミーデータ"
      ],
      "record": {
        "title": "ダミーデータ",
        "url": "/demo/browser/dummy.html"
      },
      "publicId": "c_6583456c66bb",
      "part": "base",
      "order": 55
    },
    {
      "id": "dummy_browser_5",
      "appId": "browser",
      "initialState": "normal",
      "cond": "",
      "search": [
        "ダミーデータ"
      ],
      "record": {
        "title": "ダミーデータ",
        "url": "/demo/browser/dummy.html"
      },
      "publicId": "c_72782ea7ea51",
      "part": "base",
      "order": 56
    },
    {
      "id": "dummy_browser_6",
      "appId": "browser",
      "initialState": "normal",
      "cond": "",
      "search": [
        "ダミーデータ"
      ],
      "record": {
        "title": "ダミーデータ",
        "url": "/demo/browser/dummy.html"
      },
      "publicId": "c_3eeb6b99d118",
      "part": "base",
      "order": 57
    },
    {
      "id": "browser_archive",
      "appId": "browser",
      "initialState": "repairable",
      "cond": "",
      "search": [
        "アーカイブタブ",
        "ブラウザの記録"
      ],
      "repairLabel": "タ▚▐▀▜ブ",
      "record": {
        "title": "アーカイブ",
        "url": "/demo/browser/archive-k7m2q.html"
      },
      "publicId": "c_e9c108f35d34",
      "part": "base",
      "order": 58
    },
    {
      "id": "guide_history_archive_a",
      "appId": "messages",
      "initialState": "repairable",
      "cond": "",
      "search": [
        "消えた連絡記録",
        "履歴修復A"
      ],
      "repairLabel": "破損した履歴",
      "record": {
        "talk": "guide",
        "block": "guide::history_archive_a"
      },
      "publicId": "c_f452f3bfd9c3",
      "part": "base",
      "order": 59
    },
    {
      "id": "guide_history_archive_b",
      "appId": "messages",
      "initialState": "repairable",
      "cond": "",
      "search": [
        "連続破損の記録",
        "履歴修復B"
      ],
      "repairLabel": "破損した履歴",
      "record": {
        "talk": "guide",
        "block": "guide::history_archive_b"
      },
      "publicId": "c_d2fb1ed4cac6",
      "part": "base",
      "order": 60
    },
    {
      "id": "lobby_history_archive",
      "appId": "chat",
      "initialState": "repairable",
      "cond": "sealed_note_unlocked",
      "search": [
        "消えた談話記録",
        "チャット履歴修復"
      ],
      "repairLabel": "破損した履歴",
      "record": {
        "talk": "lobby",
        "block": "lobby::history_archive"
      },
      "publicId": "c_ee422a2fa57f",
      "part": "base",
      "order": 61
    }
  ],
  "talks": [
    {
      "id": "guide",
      "kind": "sms",
      "appId": "messages",
      "label": "デモ連絡先",
      "startBlocks": [
        "guide::history_archive_a",
        "guide::history_archive_b",
        "guide::intro"
      ],
      "initialState": "normal",
      "search": [
        "デモ連絡先",
        "連絡先"
      ],
      "cond": "",
      "inputVisible": true,
      "inputEnabled": true,
      "publicId": "t_17f5f84e4690",
      "initialFrom": "guide::intro",
      "rules": [
        {
          "id": "rule_ccbbc7beb27004f8",
          "type": "match",
          "part": "base",
          "loadParts": [],
          "order": 2,
          "from": "*",
          "isDefault": false,
          "cond": "!chat_auth_verified",
          "intent": "チャット未認証",
          "criteria": "/^チャットへ送る$/u",
          "match": "",
          "outputSteps": [
            {
              "kind": "block",
              "blockId": "guide::chat_auth_required"
            }
          ],
          "nextBlocks": [
            "guide::chat_auth_required"
          ],
          "nextFromId": "guide::chat_auth_required",
          "set": [],
          "mode": "stay",
          "notes": "未認証時は案内だけを返し、hookで会話位置を変更しない",
          "example": "チャットへ送る"
        },
        {
          "id": "rule_0242ab445ef14595",
          "type": "match",
          "part": "base",
          "loadParts": [],
          "order": 3,
          "from": "*",
          "isDefault": false,
          "cond": "",
          "intent": "メッセージ機能テスト",
          "criteria": "/^(?:メッセージ連携|別ルームへ送る|チャットへ送る)$/u",
          "match": "",
          "outputSteps": [
            {
              "kind": "block",
              "blockId": "guide::message_test_ack"
            }
          ],
          "nextBlocks": [
            "guide::message_test_ack"
          ],
          "nextFromId": "guide::message_test_ack",
          "set": [],
          "mode": "stay",
          "notes": "メッセージアプリから別ルーム・別アプリへ送る確認",
          "example": "別ルームへ送る"
        },
        {
          "id": "rule_78d0c4947fc3bc1e",
          "type": "default",
          "part": "base",
          "loadParts": [],
          "order": 4,
          "from": "guide::intro",
          "isDefault": true,
          "cond": "",
          "intent": "",
          "criteria": "",
          "match": "",
          "outputSteps": [
            {
              "kind": "block",
              "blockId": "guide::message_reply"
            }
          ],
          "nextBlocks": [
            "guide::message_reply"
          ],
          "nextFromId": "guide::message_reply",
          "set": [],
          "mode": "stay",
          "notes": "",
          "example": ""
        }
      ],
      "part": "base",
      "order": 0
    },
    {
      "id": "sms_receiver",
      "kind": "sms",
      "appId": "messages",
      "label": "テスト受信箱",
      "startBlocks": [
        "sms_receiver::start"
      ],
      "initialState": "normal",
      "search": [],
      "cond": "",
      "inputVisible": true,
      "inputEnabled": true,
      "publicId": "t_b18a7456e416",
      "initialFrom": "sms_receiver::start",
      "rules": [
        {
          "id": "rule_57d2822cead9f5d1",
          "type": "default",
          "part": "base",
          "loadParts": [],
          "order": 8,
          "from": "sms_receiver::start",
          "isDefault": true,
          "cond": "",
          "intent": "",
          "criteria": "",
          "match": "",
          "outputSteps": [
            {
              "kind": "block",
              "blockId": "sms_receiver::receiver_reply"
            }
          ],
          "nextBlocks": [
            "sms_receiver::receiver_reply"
          ],
          "nextFromId": "sms_receiver::receiver_reply",
          "set": [],
          "mode": "stay",
          "notes": "",
          "example": ""
        },
        {
          "id": "rule_4d831274d8a3dd94",
          "type": "default",
          "part": "base",
          "loadParts": [],
          "order": 9,
          "from": "sms_receiver::received_from_sms",
          "isDefault": true,
          "cond": "",
          "intent": "",
          "criteria": "",
          "match": "",
          "outputSteps": [
            {
              "kind": "block",
              "blockId": "sms_receiver::receiver_reply"
            }
          ],
          "nextBlocks": [
            "sms_receiver::receiver_reply"
          ],
          "nextFromId": "sms_receiver::receiver_reply",
          "set": [],
          "mode": "stay",
          "notes": "受信後も確認用返信を受け付ける",
          "example": ""
        },
        {
          "id": "rule_55309370d8baef2a",
          "type": "default",
          "part": "base",
          "loadParts": [],
          "order": 10,
          "from": "sms_receiver::received_from_chat",
          "isDefault": true,
          "cond": "",
          "intent": "",
          "criteria": "",
          "match": "",
          "outputSteps": [
            {
              "kind": "block",
              "blockId": "sms_receiver::receiver_reply"
            }
          ],
          "nextBlocks": [
            "sms_receiver::receiver_reply"
          ],
          "nextFromId": "sms_receiver::receiver_reply",
          "set": [],
          "mode": "stay",
          "notes": "受信後も確認用返信を受け付ける",
          "example": ""
        },
        {
          "id": "rule_744e65c4c73155b9",
          "type": "default",
          "part": "base",
          "loadParts": [],
          "order": 11,
          "from": "sms_receiver::received_delayed",
          "isDefault": true,
          "cond": "",
          "intent": "",
          "criteria": "",
          "match": "",
          "outputSteps": [
            {
              "kind": "block",
              "blockId": "sms_receiver::receiver_reply"
            }
          ],
          "nextBlocks": [
            "sms_receiver::receiver_reply"
          ],
          "nextFromId": "sms_receiver::receiver_reply",
          "set": [],
          "mode": "stay",
          "notes": "受信後も確認用返信を受け付ける",
          "example": ""
        }
      ],
      "part": "base",
      "order": 1
    },
    {
      "id": "sms_media_receiver",
      "kind": "sms",
      "appId": "messages",
      "label": "画像受信",
      "startBlocks": [
        "sms_media_receiver::start"
      ],
      "initialState": "normal",
      "search": [],
      "cond": "",
      "inputVisible": true,
      "inputEnabled": true,
      "publicId": "t_ef9cabd43865",
      "initialFrom": "sms_media_receiver::start",
      "rules": [
        {
          "id": "rule_be10570588394753",
          "type": "default",
          "part": "base",
          "loadParts": [],
          "order": 12,
          "from": "sms_media_receiver::start",
          "isDefault": true,
          "cond": "",
          "intent": "",
          "criteria": "",
          "match": "",
          "outputSteps": [
            {
              "kind": "block",
              "blockId": "sms_media_receiver::receiver_reply"
            }
          ],
          "nextBlocks": [
            "sms_media_receiver::receiver_reply"
          ],
          "nextFromId": "sms_media_receiver::receiver_reply",
          "set": [],
          "mode": "stay",
          "notes": "",
          "example": ""
        },
        {
          "id": "rule_f55dc35cb8760fe3",
          "type": "default",
          "part": "base",
          "loadParts": [],
          "order": 13,
          "from": "sms_media_receiver::received_image",
          "isDefault": true,
          "cond": "",
          "intent": "",
          "criteria": "",
          "match": "",
          "outputSteps": [
            {
              "kind": "block",
              "blockId": "sms_media_receiver::receiver_reply"
            }
          ],
          "nextBlocks": [
            "sms_media_receiver::receiver_reply"
          ],
          "nextFromId": "sms_media_receiver::receiver_reply",
          "set": [],
          "mode": "stay",
          "notes": "受信後も確認用返信を受け付ける",
          "example": ""
        }
      ],
      "part": "base",
      "order": 2
    },
    {
      "id": "dummy_sms_1",
      "kind": "sms",
      "appId": "messages",
      "label": "ダミーデータ",
      "startBlocks": [
        "dummy_sms_1::start"
      ],
      "initialState": "normal",
      "search": [],
      "cond": "",
      "inputVisible": true,
      "inputEnabled": true,
      "publicId": "t_bc14bdf75f7e",
      "initialFrom": "dummy_sms_1::start",
      "rules": [
        {
          "id": "rule_c56ba61c0ef4cb29",
          "type": "default",
          "part": "base",
          "loadParts": [],
          "order": 14,
          "from": "dummy_sms_1::start",
          "isDefault": true,
          "cond": "",
          "intent": "",
          "criteria": "",
          "match": "",
          "outputSteps": [
            {
              "kind": "block",
              "blockId": "dummy_sms_1::dummy_reply"
            }
          ],
          "nextBlocks": [
            "dummy_sms_1::dummy_reply"
          ],
          "nextFromId": "dummy_sms_1::dummy_reply",
          "set": [],
          "mode": "stay",
          "notes": "",
          "example": ""
        }
      ],
      "part": "base",
      "order": 3
    },
    {
      "id": "dummy_sms_2",
      "kind": "sms",
      "appId": "messages",
      "label": "ダミーデータ",
      "startBlocks": [
        "dummy_sms_2::start"
      ],
      "initialState": "normal",
      "search": [],
      "cond": "",
      "inputVisible": true,
      "inputEnabled": true,
      "publicId": "t_17983c9a39f9",
      "initialFrom": "dummy_sms_2::start",
      "rules": [
        {
          "id": "rule_f54eca82cda84f9f",
          "type": "default",
          "part": "base",
          "loadParts": [],
          "order": 15,
          "from": "dummy_sms_2::start",
          "isDefault": true,
          "cond": "",
          "intent": "",
          "criteria": "",
          "match": "",
          "outputSteps": [
            {
              "kind": "block",
              "blockId": "dummy_sms_2::dummy_reply"
            }
          ],
          "nextBlocks": [
            "dummy_sms_2::dummy_reply"
          ],
          "nextFromId": "dummy_sms_2::dummy_reply",
          "set": [],
          "mode": "stay",
          "notes": "",
          "example": ""
        }
      ],
      "part": "base",
      "order": 4
    },
    {
      "id": "dummy_sms_3",
      "kind": "sms",
      "appId": "messages",
      "label": "ダミーデータ",
      "startBlocks": [
        "dummy_sms_3::start"
      ],
      "initialState": "normal",
      "search": [],
      "cond": "",
      "inputVisible": true,
      "inputEnabled": true,
      "publicId": "t_040dd4088ff1",
      "initialFrom": "dummy_sms_3::start",
      "rules": [
        {
          "id": "rule_dc81bf82310a9518",
          "type": "default",
          "part": "base",
          "loadParts": [],
          "order": 16,
          "from": "dummy_sms_3::start",
          "isDefault": true,
          "cond": "",
          "intent": "",
          "criteria": "",
          "match": "",
          "outputSteps": [
            {
              "kind": "block",
              "blockId": "dummy_sms_3::dummy_reply"
            }
          ],
          "nextBlocks": [
            "dummy_sms_3::dummy_reply"
          ],
          "nextFromId": "dummy_sms_3::dummy_reply",
          "set": [],
          "mode": "stay",
          "notes": "",
          "example": ""
        }
      ],
      "part": "base",
      "order": 5
    },
    {
      "id": "dummy_sms_4",
      "kind": "sms",
      "appId": "messages",
      "label": "ダミーデータ",
      "startBlocks": [
        "dummy_sms_4::start"
      ],
      "initialState": "normal",
      "search": [],
      "cond": "",
      "inputVisible": true,
      "inputEnabled": true,
      "publicId": "t_6f99c15839d9",
      "initialFrom": "dummy_sms_4::start",
      "rules": [
        {
          "id": "rule_c43746fad3cc261d",
          "type": "default",
          "part": "base",
          "loadParts": [],
          "order": 17,
          "from": "dummy_sms_4::start",
          "isDefault": true,
          "cond": "",
          "intent": "",
          "criteria": "",
          "match": "",
          "outputSteps": [
            {
              "kind": "block",
              "blockId": "dummy_sms_4::dummy_reply"
            }
          ],
          "nextBlocks": [
            "dummy_sms_4::dummy_reply"
          ],
          "nextFromId": "dummy_sms_4::dummy_reply",
          "set": [],
          "mode": "stay",
          "notes": "",
          "example": ""
        }
      ],
      "part": "base",
      "order": 6
    },
    {
      "id": "dummy_sms_5",
      "kind": "sms",
      "appId": "messages",
      "label": "ダミーデータ",
      "startBlocks": [
        "dummy_sms_5::start"
      ],
      "initialState": "normal",
      "search": [],
      "cond": "",
      "inputVisible": true,
      "inputEnabled": true,
      "publicId": "t_f5c8125fca30",
      "initialFrom": "dummy_sms_5::start",
      "rules": [
        {
          "id": "rule_1849b53836e15bc3",
          "type": "default",
          "part": "base",
          "loadParts": [],
          "order": 18,
          "from": "dummy_sms_5::start",
          "isDefault": true,
          "cond": "",
          "intent": "",
          "criteria": "",
          "match": "",
          "outputSteps": [
            {
              "kind": "block",
              "blockId": "dummy_sms_5::dummy_reply"
            }
          ],
          "nextBlocks": [
            "dummy_sms_5::dummy_reply"
          ],
          "nextFromId": "dummy_sms_5::dummy_reply",
          "set": [],
          "mode": "stay",
          "notes": "",
          "example": ""
        }
      ],
      "part": "base",
      "order": 7
    },
    {
      "id": "dummy_sms_6",
      "kind": "sms",
      "appId": "messages",
      "label": "ダミーデータ",
      "startBlocks": [
        "dummy_sms_6::start"
      ],
      "initialState": "normal",
      "search": [],
      "cond": "",
      "inputVisible": true,
      "inputEnabled": true,
      "publicId": "t_59219841f338",
      "initialFrom": "dummy_sms_6::start",
      "rules": [
        {
          "id": "rule_3956c5432facc194",
          "type": "default",
          "part": "base",
          "loadParts": [],
          "order": 19,
          "from": "dummy_sms_6::start",
          "isDefault": true,
          "cond": "",
          "intent": "",
          "criteria": "",
          "match": "",
          "outputSteps": [
            {
              "kind": "block",
              "blockId": "dummy_sms_6::dummy_reply"
            }
          ],
          "nextBlocks": [
            "dummy_sms_6::dummy_reply"
          ],
          "nextFromId": "dummy_sms_6::dummy_reply",
          "set": [],
          "mode": "stay",
          "notes": "",
          "example": ""
        }
      ],
      "part": "base",
      "order": 8
    },
    {
      "id": "lobby",
      "kind": "chat",
      "appId": "chat",
      "label": "サンプルルーム",
      "startBlocks": [
        "lobby::history_archive",
        "lobby::start"
      ],
      "initialState": "normal",
      "search": [
        "サンプルルーム"
      ],
      "cond": "sealed_note_unlocked",
      "inputVisible": true,
      "inputEnabled": true,
      "publicId": "t_384f82df1ef6",
      "initialFrom": "lobby::start",
      "rules": [
        {
          "id": "rule_c33da1e3d23b43a1",
          "type": "default",
          "part": "base",
          "loadParts": [],
          "order": 5,
          "from": "lobby::start",
          "isDefault": true,
          "cond": "",
          "intent": "",
          "criteria": "",
          "match": "",
          "outputSteps": [
            {
              "kind": "block",
              "blockId": "lobby::lobby_reply"
            }
          ],
          "nextBlocks": [
            "lobby::lobby_reply"
          ],
          "nextFromId": "lobby::lobby_reply",
          "set": [
            "demo_completed=true"
          ],
          "mode": "",
          "notes": "",
          "example": ""
        },
        {
          "id": "rule_416fc65de6a3d722",
          "type": "match",
          "part": "base",
          "loadParts": [],
          "order": 6,
          "from": "*",
          "isDefault": false,
          "cond": "",
          "intent": "機能テスト",
          "criteria": "/^(?:チャット連携|メッセージへ送る)$/u",
          "match": "",
          "outputSteps": [
            {
              "kind": "block",
              "blockId": "lobby::chat_test_ack"
            }
          ],
          "nextBlocks": [
            "lobby::chat_test_ack"
          ],
          "nextFromId": "lobby::chat_test_ack",
          "set": [],
          "mode": "stay",
          "notes": "別ルーム・別アプリへの連携確認",
          "example": "チャット連携"
        },
        {
          "id": "rule_cad3a7bd4abe71c8",
          "type": "default",
          "part": "base",
          "loadParts": [],
          "order": 7,
          "from": "lobby::lobby_reply",
          "isDefault": true,
          "cond": "",
          "intent": "",
          "criteria": "",
          "match": "",
          "outputSteps": [
            {
              "kind": "block",
              "blockId": "lobby::lobby_done"
            }
          ],
          "nextBlocks": [
            "lobby::lobby_done"
          ],
          "nextFromId": "lobby::lobby_done",
          "set": [],
          "mode": "stay",
          "notes": "",
          "example": ""
        }
      ],
      "part": "base",
      "order": 9
    },
    {
      "id": "chat_receiver",
      "kind": "chat",
      "appId": "chat",
      "label": "連携受信ログ",
      "startBlocks": [
        "chat_receiver::start"
      ],
      "initialState": "normal",
      "search": [],
      "cond": "sealed_note_unlocked",
      "inputVisible": true,
      "inputEnabled": true,
      "publicId": "t_b873fa6b67cf",
      "initialFrom": "chat_receiver::start",
      "rules": [
        {
          "id": "rule_dbbc58690e96076b",
          "type": "default",
          "part": "base",
          "loadParts": [],
          "order": 20,
          "from": "chat_receiver::start",
          "isDefault": true,
          "cond": "",
          "intent": "",
          "criteria": "",
          "match": "",
          "outputSteps": [
            {
              "kind": "block",
              "blockId": "chat_receiver::receiver_reply"
            }
          ],
          "nextBlocks": [
            "chat_receiver::receiver_reply"
          ],
          "nextFromId": "chat_receiver::receiver_reply",
          "set": [],
          "mode": "stay",
          "notes": "",
          "example": ""
        },
        {
          "id": "rule_a791f5b8a55a0a45",
          "type": "default",
          "part": "base",
          "loadParts": [],
          "order": 21,
          "from": "chat_receiver::received_from_sms",
          "isDefault": true,
          "cond": "",
          "intent": "",
          "criteria": "",
          "match": "",
          "outputSteps": [
            {
              "kind": "block",
              "blockId": "chat_receiver::receiver_reply"
            }
          ],
          "nextBlocks": [
            "chat_receiver::receiver_reply"
          ],
          "nextFromId": "chat_receiver::receiver_reply",
          "set": [],
          "mode": "stay",
          "notes": "受信後も確認用返信を受け付ける",
          "example": ""
        },
        {
          "id": "rule_634c23a869173adc",
          "type": "default",
          "part": "base",
          "loadParts": [],
          "order": 22,
          "from": "chat_receiver::received_from_chat",
          "isDefault": true,
          "cond": "",
          "intent": "",
          "criteria": "",
          "match": "",
          "outputSteps": [
            {
              "kind": "block",
              "blockId": "chat_receiver::receiver_reply"
            }
          ],
          "nextBlocks": [
            "chat_receiver::receiver_reply"
          ],
          "nextFromId": "chat_receiver::receiver_reply",
          "set": [],
          "mode": "stay",
          "notes": "受信後も確認用返信を受け付ける",
          "example": ""
        }
      ],
      "part": "base",
      "order": 10
    },
    {
      "id": "dummy_chat_1",
      "kind": "chat",
      "appId": "chat",
      "label": "ダミーデータ",
      "startBlocks": [
        "dummy_chat_1::start"
      ],
      "initialState": "normal",
      "search": [],
      "cond": "sealed_note_unlocked",
      "inputVisible": true,
      "inputEnabled": true,
      "publicId": "t_4aff5248b7f8",
      "initialFrom": "dummy_chat_1::start",
      "rules": [
        {
          "id": "rule_fcbb2264d7b0f31b",
          "type": "default",
          "part": "base",
          "loadParts": [],
          "order": 23,
          "from": "dummy_chat_1::start",
          "isDefault": true,
          "cond": "",
          "intent": "",
          "criteria": "",
          "match": "",
          "outputSteps": [
            {
              "kind": "block",
              "blockId": "dummy_chat_1::dummy_reply"
            }
          ],
          "nextBlocks": [
            "dummy_chat_1::dummy_reply"
          ],
          "nextFromId": "dummy_chat_1::dummy_reply",
          "set": [],
          "mode": "stay",
          "notes": "",
          "example": ""
        }
      ],
      "part": "base",
      "order": 11
    },
    {
      "id": "dummy_chat_2",
      "kind": "chat",
      "appId": "chat",
      "label": "ダミーデータ",
      "startBlocks": [
        "dummy_chat_2::start"
      ],
      "initialState": "normal",
      "search": [],
      "cond": "sealed_note_unlocked",
      "inputVisible": true,
      "inputEnabled": true,
      "publicId": "t_31942c9c962d",
      "initialFrom": "dummy_chat_2::start",
      "rules": [
        {
          "id": "rule_351b6ff6c0eb42d2",
          "type": "default",
          "part": "base",
          "loadParts": [],
          "order": 24,
          "from": "dummy_chat_2::start",
          "isDefault": true,
          "cond": "",
          "intent": "",
          "criteria": "",
          "match": "",
          "outputSteps": [
            {
              "kind": "block",
              "blockId": "dummy_chat_2::dummy_reply"
            }
          ],
          "nextBlocks": [
            "dummy_chat_2::dummy_reply"
          ],
          "nextFromId": "dummy_chat_2::dummy_reply",
          "set": [],
          "mode": "stay",
          "notes": "",
          "example": ""
        }
      ],
      "part": "base",
      "order": 12
    },
    {
      "id": "dummy_chat_3",
      "kind": "chat",
      "appId": "chat",
      "label": "ダミーデータ",
      "startBlocks": [
        "dummy_chat_3::start"
      ],
      "initialState": "normal",
      "search": [],
      "cond": "sealed_note_unlocked",
      "inputVisible": true,
      "inputEnabled": true,
      "publicId": "t_73a75e3d8faa",
      "initialFrom": "dummy_chat_3::start",
      "rules": [
        {
          "id": "rule_521065cc59cf4ed2",
          "type": "default",
          "part": "base",
          "loadParts": [],
          "order": 25,
          "from": "dummy_chat_3::start",
          "isDefault": true,
          "cond": "",
          "intent": "",
          "criteria": "",
          "match": "",
          "outputSteps": [
            {
              "kind": "block",
              "blockId": "dummy_chat_3::dummy_reply"
            }
          ],
          "nextBlocks": [
            "dummy_chat_3::dummy_reply"
          ],
          "nextFromId": "dummy_chat_3::dummy_reply",
          "set": [],
          "mode": "stay",
          "notes": "",
          "example": ""
        }
      ],
      "part": "base",
      "order": 13
    },
    {
      "id": "dummy_chat_4",
      "kind": "chat",
      "appId": "chat",
      "label": "ダミーデータ",
      "startBlocks": [
        "dummy_chat_4::start"
      ],
      "initialState": "normal",
      "search": [],
      "cond": "sealed_note_unlocked",
      "inputVisible": true,
      "inputEnabled": true,
      "publicId": "t_0e6f206f66af",
      "initialFrom": "dummy_chat_4::start",
      "rules": [
        {
          "id": "rule_1611fdaf0de7806f",
          "type": "default",
          "part": "base",
          "loadParts": [],
          "order": 26,
          "from": "dummy_chat_4::start",
          "isDefault": true,
          "cond": "",
          "intent": "",
          "criteria": "",
          "match": "",
          "outputSteps": [
            {
              "kind": "block",
              "blockId": "dummy_chat_4::dummy_reply"
            }
          ],
          "nextBlocks": [
            "dummy_chat_4::dummy_reply"
          ],
          "nextFromId": "dummy_chat_4::dummy_reply",
          "set": [],
          "mode": "stay",
          "notes": "",
          "example": ""
        }
      ],
      "part": "base",
      "order": 14
    },
    {
      "id": "dummy_chat_5",
      "kind": "chat",
      "appId": "chat",
      "label": "ダミーデータ",
      "startBlocks": [
        "dummy_chat_5::start"
      ],
      "initialState": "normal",
      "search": [],
      "cond": "sealed_note_unlocked",
      "inputVisible": true,
      "inputEnabled": true,
      "publicId": "t_0a2e442c9bb6",
      "initialFrom": "dummy_chat_5::start",
      "rules": [
        {
          "id": "rule_9f708a551c932dca",
          "type": "default",
          "part": "base",
          "loadParts": [],
          "order": 27,
          "from": "dummy_chat_5::start",
          "isDefault": true,
          "cond": "",
          "intent": "",
          "criteria": "",
          "match": "",
          "outputSteps": [
            {
              "kind": "block",
              "blockId": "dummy_chat_5::dummy_reply"
            }
          ],
          "nextBlocks": [
            "dummy_chat_5::dummy_reply"
          ],
          "nextFromId": "dummy_chat_5::dummy_reply",
          "set": [],
          "mode": "stay",
          "notes": "",
          "example": ""
        }
      ],
      "part": "base",
      "order": 15
    },
    {
      "id": "dummy_chat_6",
      "kind": "chat",
      "appId": "chat",
      "label": "ダミーデータ",
      "startBlocks": [
        "dummy_chat_6::start"
      ],
      "initialState": "normal",
      "search": [],
      "cond": "sealed_note_unlocked",
      "inputVisible": true,
      "inputEnabled": true,
      "publicId": "t_cb0b2cb99f03",
      "initialFrom": "dummy_chat_6::start",
      "rules": [
        {
          "id": "rule_385b4276662e16e5",
          "type": "default",
          "part": "base",
          "loadParts": [],
          "order": 28,
          "from": "dummy_chat_6::start",
          "isDefault": true,
          "cond": "",
          "intent": "",
          "criteria": "",
          "match": "",
          "outputSteps": [
            {
              "kind": "block",
              "blockId": "dummy_chat_6::dummy_reply"
            }
          ],
          "nextBlocks": [
            "dummy_chat_6::dummy_reply"
          ],
          "nextFromId": "dummy_chat_6::dummy_reply",
          "set": [],
          "mode": "stay",
          "notes": "",
          "example": ""
        }
      ],
      "part": "base",
      "order": 16
    },
    {
      "id": "search_agent",
      "publicId": "t_0ed8a2c8a5f6",
      "kind": "search_agent",
      "label": "ナビ",
      "inputVisible": true,
      "inputEnabled": true,
      "startSteps": [
        {
          "kind": "input",
          "action": "hide"
        },
        {
          "kind": "block",
          "blockId": "search_agent::intro"
        },
        {
          "kind": "input",
          "action": "show"
        }
      ],
      "initialFrom": "search_agent::intro",
      "rules": [
        {
          "id": "rule_b20e761b9a046a5a",
          "type": "match",
          "part": "base",
          "loadParts": [],
          "order": 29,
          "from": "*",
          "isDefault": false,
          "cond": "",
          "intent": "ヘルプ",
          "criteria": "/^(?:help|ヘルプ)$/i",
          "match": "",
          "outputSteps": [
            {
              "kind": "block",
              "blockId": "search_agent::common_help"
            }
          ],
          "nextBlocks": [
            "search_agent::common_help"
          ],
          "nextFromId": "search_agent::common_help",
          "set": [],
          "mode": "stay",
          "notes": "検索ナビの役割を案内する共通分岐",
          "example": "ヘルプ"
        },
        {
          "id": "rule_5429ee9a4df224e9",
          "type": "match",
          "part": "base",
          "loadParts": [],
          "order": 30,
          "from": "*",
          "isDefault": false,
          "cond": "old_note_opened && !image_color_reported",
          "intent": "灯りの色を報告",
          "criteria": "/(?:青|あお|水色|みずいろ|ブルー|シアン|黄色?|きいろ|オレンジ(?:色)?|橙色)/u",
          "match": "",
          "outputSteps": [
            {
              "kind": "block",
              "blockId": "search_agent::color_reported"
            }
          ],
          "nextBlocks": [
            "search_agent::color_reported"
          ],
          "nextFromId": "search_agent::color_reported",
          "set": [
            "image_color_reported=true",
            "clue_attachments_pending=true"
          ],
          "mode": "stay",
          "notes": "検索結果の画像だけで色を判断した場合も受け付け、同じturnのhookでSMS添付を配送する",
          "example": "黄色です"
        },
        {
          "id": "rule_060421c56eb1abc2",
          "type": "match",
          "part": "base",
          "loadParts": [],
          "order": 31,
          "from": "*",
          "isDefault": false,
          "cond": "",
          "intent": "機能テスト一覧",
          "criteria": "/^(?:機能テスト|テストメニュー)$/u",
          "match": "",
          "outputSteps": [
            {
              "kind": "block",
              "blockId": "search_agent::test_menu"
            }
          ],
          "nextBlocks": [
            "search_agent::test_menu"
          ],
          "nextFromId": "search_agent::test_menu",
          "set": [],
          "mode": "stay",
          "notes": "Quick Replyから汎用機能テストを選ぶ",
          "example": "機能テスト"
        },
        {
          "id": "rule_88793eb33a67d548",
          "type": "match",
          "part": "base",
          "loadParts": [],
          "order": 32,
          "from": "*",
          "isDefault": false,
          "cond": "demo_call_completed",
          "intent": "完了済み着信テスト",
          "criteria": "/^着信テスト$/u",
          "match": "",
          "outputSteps": [
            {
              "kind": "block",
              "blockId": "search_agent::demo_test_already_done"
            }
          ],
          "nextBlocks": [
            "search_agent::demo_test_already_done"
          ],
          "nextFromId": "search_agent::demo_test_already_done",
          "set": [],
          "mode": "stay",
          "notes": "一度限りの機能テストは成功文を出す前に判定する",
          "example": "着信テスト"
        },
        {
          "id": "rule_95b50fa2c8c06da5",
          "type": "match",
          "part": "base",
          "loadParts": [],
          "order": 33,
          "from": "*",
          "isDefault": false,
          "cond": "demo_delayed_message_received",
          "intent": "完了済み遅延メッセージ",
          "criteria": "/^遅延メッセージ$/u",
          "match": "",
          "outputSteps": [
            {
              "kind": "block",
              "blockId": "search_agent::demo_test_already_done"
            }
          ],
          "nextBlocks": [
            "search_agent::demo_test_already_done"
          ],
          "nextFromId": "search_agent::demo_test_already_done",
          "set": [],
          "mode": "stay",
          "notes": "一度限りの機能テストは成功文を出す前に判定する",
          "example": "遅延メッセージ"
        },
        {
          "id": "rule_023ab1c9e03fa851",
          "type": "match",
          "part": "base",
          "loadParts": [],
          "order": 34,
          "from": "*",
          "isDefault": false,
          "cond": "demo_image_received",
          "intent": "完了済み画像受信テスト",
          "criteria": "/^画像受信テスト$/u",
          "match": "",
          "outputSteps": [
            {
              "kind": "block",
              "blockId": "search_agent::demo_test_already_done"
            }
          ],
          "nextBlocks": [
            "search_agent::demo_test_already_done"
          ],
          "nextFromId": "search_agent::demo_test_already_done",
          "set": [],
          "mode": "stay",
          "notes": "一度限りの機能テストは成功文を出す前に判定する",
          "example": "画像受信テスト"
        },
        {
          "id": "rule_cb7cb2c15af7b306",
          "type": "match",
          "part": "base",
          "loadParts": [],
          "order": 35,
          "from": "*",
          "isDefault": false,
          "cond": "",
          "intent": "機能テスト",
          "criteria": "/^(?:着信テスト|遅延メッセージ|画像受信テスト|ノイズ演出|フラッシュ演出|暗転演出|ゲームオーバー演出|オールクリア演出)$/u",
          "match": "",
          "outputSteps": [
            {
              "kind": "block",
              "blockId": "search_agent::demo_test_ack"
            }
          ],
          "nextBlocks": [
            "search_agent::demo_test_ack"
          ],
          "nextFromId": "search_agent::demo_test_ack",
          "set": [],
          "mode": "stay",
          "notes": "検索ナビへ集約した汎用機能テスト",
          "example": "着信テスト"
        },
        {
          "id": "rule_a3c1273386ed531e",
          "type": "match",
          "part": "base",
          "loadParts": [],
          "order": 36,
          "from": "search_agent::intro",
          "isDefault": false,
          "cond": "!old_note_opened",
          "intent": "最初のヒント",
          "criteria": "/ヒント/u",
          "match": "",
          "outputSteps": [
            {
              "kind": "block",
              "blockId": "search_agent::hint_first"
            }
          ],
          "nextBlocks": [
            "search_agent::hint_first"
          ],
          "nextFromId": "search_agent::hint_first",
          "set": [],
          "mode": "stay",
          "notes": "結果を出さず案内だけを返す",
          "example": "ヒント"
        },
        {
          "id": "rule_f51115100607ac0d",
          "type": "match",
          "part": "base",
          "loadParts": [],
          "order": 37,
          "from": "search_agent::intro",
          "isDefault": false,
          "cond": "old_note_opened && !rainy_window_opened && !image_color_reported",
          "intent": "写真のヒント",
          "criteria": "/ヒント/u",
          "match": "",
          "outputSteps": [
            {
              "kind": "block",
              "blockId": "search_agent::hint_photo"
            }
          ],
          "nextBlocks": [
            "search_agent::hint_photo"
          ],
          "nextFromId": "search_agent::hint_photo",
          "set": [],
          "mode": "stay",
          "notes": "結果を出さず案内だけを返す",
          "example": "ヒント"
        },
        {
          "id": "rule_234b510784ada779",
          "type": "match",
          "part": "base",
          "loadParts": [],
          "order": 38,
          "from": "search_agent::intro",
          "isDefault": false,
          "cond": "rainy_window_opened && !image_color_reported",
          "intent": "報告のヒント",
          "criteria": "/ヒント/u",
          "match": "",
          "outputSteps": [
            {
              "kind": "block",
              "blockId": "search_agent::hint_report"
            }
          ],
          "nextBlocks": [
            "search_agent::hint_report"
          ],
          "nextFromId": "search_agent::hint_report",
          "set": [],
          "mode": "stay",
          "notes": "結果を出さず案内だけを返す",
          "example": "ヒント"
        },
        {
          "id": "rule_cd822dbcfd1a3f75",
          "type": "match",
          "part": "base",
          "loadParts": [],
          "order": 39,
          "from": "search_agent::intro",
          "isDefault": false,
          "cond": "image_color_reported && !sealed_note_unlocked",
          "intent": "添付解錠のヒント",
          "criteria": "/ヒント/u",
          "match": "",
          "outputSteps": [
            {
              "kind": "block",
              "blockId": "search_agent::hint_unlock"
            }
          ],
          "nextBlocks": [
            "search_agent::hint_unlock"
          ],
          "nextFromId": "search_agent::hint_unlock",
          "set": [],
          "mode": "stay",
          "notes": "結果を出さず案内だけを返す",
          "example": "ヒント"
        },
        {
          "id": "rule_7e970c2055b899d3",
          "type": "match",
          "part": "base",
          "loadParts": [],
          "order": 40,
          "from": "search_agent::intro",
          "isDefault": false,
          "cond": "sealed_note_unlocked && !chat_auth_link_sent",
          "intent": "チャットのヒント",
          "criteria": "/ヒント/u",
          "match": "",
          "outputSteps": [
            {
              "kind": "block",
              "blockId": "search_agent::hint_chat"
            }
          ],
          "nextBlocks": [
            "search_agent::hint_chat"
          ],
          "nextFromId": "search_agent::hint_chat",
          "set": [],
          "mode": "stay",
          "notes": "結果を出さず案内だけを返す",
          "example": "ヒント"
        },
        {
          "id": "rule_4267ac67fdaae456",
          "type": "match",
          "part": "base",
          "loadParts": [],
          "order": 41,
          "from": "search_agent::intro",
          "isDefault": false,
          "cond": "chat_auth_link_sent && !chat_auth_verified",
          "intent": "再認証のヒント",
          "criteria": "/ヒント/u",
          "match": "",
          "outputSteps": [
            {
              "kind": "block",
              "blockId": "search_agent::hint_auth"
            }
          ],
          "nextBlocks": [
            "search_agent::hint_auth"
          ],
          "nextFromId": "search_agent::hint_auth",
          "set": [],
          "mode": "stay",
          "notes": "結果を出さず案内だけを返す",
          "example": "ヒント"
        },
        {
          "id": "rule_52921c7d52af7588",
          "type": "match",
          "part": "base",
          "loadParts": [],
          "order": 42,
          "from": "search_agent::intro",
          "isDefault": false,
          "cond": "chat_auth_verified && !demo_completed",
          "intent": "チャット投稿のヒント",
          "criteria": "/ヒント/u",
          "match": "",
          "outputSteps": [
            {
              "kind": "block",
              "blockId": "search_agent::hint_contact"
            }
          ],
          "nextBlocks": [
            "search_agent::hint_contact"
          ],
          "nextFromId": "search_agent::hint_contact",
          "set": [],
          "mode": "stay",
          "notes": "結果を出さず案内だけを返す",
          "example": "ヒント"
        },
        {
          "id": "rule_e1b05bafb78d76af",
          "type": "match",
          "part": "base",
          "loadParts": [],
          "order": 43,
          "from": "search_agent::intro",
          "isDefault": false,
          "cond": "demo_completed",
          "intent": "完了後のヒント",
          "criteria": "/ヒント/u",
          "match": "",
          "outputSteps": [
            {
              "kind": "block",
              "blockId": "search_agent::hint_done"
            }
          ],
          "nextBlocks": [
            "search_agent::hint_done"
          ],
          "nextFromId": "search_agent::hint_done",
          "set": [],
          "mode": "stay",
          "notes": "結果を出さず案内だけを返す",
          "example": "ヒント"
        },
        {
          "id": "rule_4077a88556f66863",
          "type": "default",
          "part": "base",
          "loadParts": [],
          "contextPart": "base",
          "order": 45,
          "from": "search_agent::intro",
          "isDefault": true,
          "cond": "",
          "intent": "",
          "criteria": "入力された言葉で端末内のデータを検索する。",
          "match": "",
          "outputSteps": [
            {
              "kind": "search",
              "queryTemplate": "{{player_input}}"
            },
            {
              "kind": "if",
              "cond": "search_found",
              "blockId": "search_agent::found"
            },
            {
              "kind": "if",
              "cond": "!search_found",
              "blockId": "search_agent::not_found"
            }
          ],
          "nextBlocks": [
            "search_agent::found",
            "search_agent::not_found"
          ],
          "nextFromId": "",
          "set": [],
          "mode": "stay",
          "notes": "/searchは一度だけ事前評価し、結果の後に復帰メニューを表示する",
          "example": "古いメモ"
        }
      ],
      "part": "base",
      "order": 17
    }
  ],
  "talkPeople": [
    {
      "id": "owner",
      "name": "あなた",
      "role": "owner",
      "part": "base",
      "order": 0
    },
    {
      "id": "guide",
      "name": "デモ連絡先",
      "role": "npc",
      "part": "base",
      "order": 1
    },
    {
      "id": "visitor",
      "name": "デモ参加者",
      "role": "npc",
      "part": "base",
      "order": 2
    },
    {
      "id": "search_agent",
      "name": "ナビ",
      "role": "npc",
      "part": "base",
      "order": 3
    }
  ],
  "talkBlocks": [
    {
      "id": "guide::history_archive_a",
      "talkId": "guide",
      "blockKey": "history_archive_a",
      "part": "base",
      "order": 3,
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
      ],
      "acceptsInput": false
    },
    {
      "id": "guide::history_archive_b",
      "talkId": "guide",
      "blockKey": "history_archive_b",
      "part": "base",
      "order": 6,
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
      ],
      "acceptsInput": false
    },
    {
      "id": "guide::intro",
      "talkId": "guide",
      "blockKey": "intro",
      "part": "base",
      "order": 8,
      "messages": [
        {
          "id": "guide::intro_1",
          "sender": "owner",
          "body": "メッセージアプリ固有の送受信、添付、リンク、未読を確認するための連絡先です。何か送信すると、連携先を選ぶQuick Replyが表示されます。",
          "attachmentId": "",
          "sentAt": "20:14",
          "notes": "",
          "updatedAt": "2026-08-12",
          "source": "human"
        }
      ],
      "acceptsInput": true
    },
    {
      "id": "guide::message_reply",
      "talkId": "guide",
      "blockKey": "message_reply",
      "part": "base",
      "order": 10,
      "messages": [
        {
          "id": "guide::message_reply_1",
          "sender": "guide",
          "body": "メッセージの送受信を確認できました。",
          "attachmentId": "",
          "sentAt": "",
          "delayMs": 350,
          "quickReplies": [
            "別ルームへ送る",
            "チャットへ送る"
          ],
          "notes": "",
          "updatedAt": "2026-08-12",
          "source": "human"
        }
      ],
      "acceptsInput": false
    },
    {
      "id": "guide::message_reply@2",
      "talkId": "guide",
      "blockKey": "message_reply@2",
      "part": "base",
      "order": 12,
      "repeatOf": "guide::message_reply",
      "repeatIndex": 2,
      "messages": [
        {
          "id": "guide::message_reply@2_1",
          "sender": "guide",
          "body": "追加のメッセージも受け取りました。",
          "attachmentId": "",
          "sentAt": "",
          "delayMs": 350,
          "quickReplies": [
            "別ルームへ送る",
            "チャットへ送る"
          ],
          "notes": "",
          "updatedAt": "2026-08-12",
          "source": "human"
        }
      ],
      "acceptsInput": false
    },
    {
      "id": "guide::message_test_ack",
      "talkId": "guide",
      "blockKey": "message_test_ack",
      "part": "base",
      "order": 14,
      "messages": [
        {
          "id": "guide::message_test_ack_1",
          "sender": "guide",
          "body": "送信を受け付けました。別ルームまたはチャットの通知を確認してください。",
          "attachmentId": "",
          "sentAt": "",
          "delayMs": 350,
          "quickReplies": [
            "別ルームへ送る",
            "チャットへ送る"
          ],
          "notes": "",
          "updatedAt": "2026-08-12",
          "source": "human"
        }
      ],
      "acceptsInput": false
    },
    {
      "id": "guide::clue_attachments",
      "talkId": "guide",
      "blockKey": "clue_attachments",
      "part": "base",
      "order": 16,
      "messages": [
        {
          "id": "guide::clue_attachments_1",
          "sender": "guide",
          "body": "灯りが写った画像を、メッセージ添付として届けます。",
          "attachmentId": "rainy_window_image",
          "sentAt": "",
          "delayMs": 700,
          "notes": "",
          "updatedAt": "2026-08-12",
          "source": "human"
        },
        {
          "id": "guide::clue_attachments_2",
          "sender": "guide",
          "body": "続いて鍵付き添付です。パスワード「0420」で開いてください。最初の操作ガイドもここから読み返せます。",
          "segments": [
            {
              "kind": "text",
              "text": "続いて鍵付き添付です。パスワード「0420」で開いてください。最初の"
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
          "quickReplies": [
            "別ルームへ送る"
          ],
          "notes": "",
          "updatedAt": "2026-08-12",
          "source": "human"
        }
      ],
      "acceptsInput": false
    },
    {
      "id": "guide::chat_auth_link",
      "talkId": "guide",
      "blockKey": "chat_auth_link",
      "part": "base",
      "order": 19,
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
      ],
      "acceptsInput": false
    },
    {
      "id": "guide::call_history_guide",
      "talkId": "guide",
      "blockKey": "call_history_guide",
      "part": "base",
      "order": 21,
      "messages": [
        {
          "id": "guide::call_history_guide_1",
          "sender": "guide",
          "body": "着信履歴へのメッセージ内リンクです。着信履歴から音声の再生と書き起こしを確認できます。",
          "segments": [
            {
              "kind": "text",
              "text": "着信履歴へのメッセージ内リンクです。"
            },
            {
              "kind": "link",
              "text": "着信履歴",
              "appId": "phone",
              "contentId": "demo_call_history"
            },
            {
              "kind": "text",
              "text": "から音声の再生と書き起こしを確認できます。"
            }
          ],
          "attachmentId": "",
          "sentAt": "",
          "delayMs": 500,
          "notes": "",
          "updatedAt": "2026-08-12",
          "source": "human"
        }
      ],
      "acceptsInput": false
    },
    {
      "id": "guide::chat_auth_required",
      "talkId": "guide",
      "blockKey": "chat_auth_required",
      "part": "base",
      "order": 23,
      "messages": [
        {
          "id": "guide::chat_auth_required_1",
          "sender": "guide",
          "body": "この送信テストは、チャットの再認証を完了してから実行してください。",
          "attachmentId": "",
          "sentAt": "",
          "quickReplies": [
            "別ルームへ送る"
          ],
          "notes": "",
          "updatedAt": "2026-08-12",
          "source": "human"
        }
      ],
      "acceptsInput": false
    },
    {
      "id": "lobby::history_archive",
      "talkId": "lobby",
      "blockKey": "history_archive",
      "part": "base",
      "order": 26,
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
      ],
      "acceptsInput": false
    },
    {
      "id": "lobby::start",
      "talkId": "lobby",
      "blockKey": "start",
      "part": "base",
      "order": 28,
      "messages": [
        {
          "id": "lobby::start_1",
          "sender": "visitor",
          "body": "チャットUIとdefault分岐の確認です。何かメッセージを送ってください。",
          "attachmentId": "",
          "sentAt": "20:14",
          "quickReplies": [
            "こんにちは"
          ],
          "notes": "",
          "updatedAt": "2026-08-12",
          "source": "human"
        }
      ],
      "acceptsInput": true
    },
    {
      "id": "lobby::chat_test_ack",
      "talkId": "lobby",
      "blockKey": "chat_test_ack",
      "part": "base",
      "order": 30,
      "messages": [
        {
          "id": "lobby::chat_test_ack_1",
          "sender": "visitor",
          "body": "連携テストを受け付けました。別のルームまたはメッセージアプリを確認してください。",
          "attachmentId": "",
          "sentAt": "",
          "delayMs": 350,
          "quickReplies": [
            "チャット連携",
            "メッセージへ送る"
          ],
          "notes": "",
          "updatedAt": "2026-08-12",
          "source": "human"
        }
      ],
      "acceptsInput": false
    },
    {
      "id": "lobby::lobby_reply",
      "talkId": "lobby",
      "blockKey": "lobby_reply",
      "part": "base",
      "order": 32,
      "messages": [
        {
          "id": "lobby::lobby_reply_1",
          "sender": "visitor",
          "body": "メッセージを受け取りました。",
          "attachmentId": "",
          "sentAt": "",
          "delayMs": 400,
          "quickReplies": [
            "チャット連携",
            "メッセージへ送る"
          ],
          "notes": "",
          "updatedAt": "2026-08-12",
          "source": "human"
        }
      ],
      "acceptsInput": true
    },
    {
      "id": "lobby::lobby_done",
      "talkId": "lobby",
      "blockKey": "lobby_done",
      "part": "base",
      "order": 34,
      "messages": [
        {
          "id": "lobby::lobby_done_1",
          "sender": "visitor",
          "body": "追加のメッセージも受け取りました。",
          "attachmentId": "",
          "sentAt": "",
          "delayMs": 400,
          "quickReplies": [
            "チャット連携",
            "メッセージへ送る"
          ],
          "notes": "",
          "updatedAt": "2026-08-12",
          "source": "human"
        }
      ],
      "acceptsInput": false
    },
    {
      "id": "sms_receiver::start",
      "talkId": "sms_receiver",
      "blockKey": "start",
      "part": "base",
      "order": 37,
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
      ],
      "acceptsInput": true
    },
    {
      "id": "sms_receiver::receiver_reply",
      "talkId": "sms_receiver",
      "blockKey": "receiver_reply",
      "part": "base",
      "order": 39,
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
      ],
      "acceptsInput": false
    },
    {
      "id": "sms_receiver::received_from_sms",
      "talkId": "sms_receiver",
      "blockKey": "received_from_sms",
      "part": "base",
      "order": 41,
      "messages": [
        {
          "id": "sms_receiver::received_from_sms_1",
          "sender": "guide",
          "body": "「デモ連絡先」から、別のメッセージルームへ届きました。",
          "attachmentId": "",
          "sentAt": "",
          "delayMs": 500,
          "notes": "",
          "updatedAt": "2026-08-12",
          "source": "human"
        }
      ],
      "acceptsInput": true
    },
    {
      "id": "sms_receiver::received_from_chat",
      "talkId": "sms_receiver",
      "blockKey": "received_from_chat",
      "part": "base",
      "order": 43,
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
      ],
      "acceptsInput": true
    },
    {
      "id": "sms_receiver::received_delayed",
      "talkId": "sms_receiver",
      "blockKey": "received_delayed",
      "part": "base",
      "order": 45,
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
      ],
      "acceptsInput": true
    },
    {
      "id": "sms_media_receiver::start",
      "talkId": "sms_media_receiver",
      "blockKey": "start",
      "part": "base",
      "order": 48,
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
      ],
      "acceptsInput": true
    },
    {
      "id": "sms_media_receiver::receiver_reply",
      "talkId": "sms_media_receiver",
      "blockKey": "receiver_reply",
      "part": "base",
      "order": 50,
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
      ],
      "acceptsInput": false
    },
    {
      "id": "sms_media_receiver::received_image",
      "talkId": "sms_media_receiver",
      "blockKey": "received_image",
      "part": "base",
      "order": 52,
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
      ],
      "acceptsInput": true
    },
    {
      "id": "chat_receiver::start",
      "talkId": "chat_receiver",
      "blockKey": "start",
      "part": "base",
      "order": 55,
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
      ],
      "acceptsInput": true
    },
    {
      "id": "chat_receiver::receiver_reply",
      "talkId": "chat_receiver",
      "blockKey": "receiver_reply",
      "part": "base",
      "order": 57,
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
      ],
      "acceptsInput": false
    },
    {
      "id": "chat_receiver::received_from_sms",
      "talkId": "chat_receiver",
      "blockKey": "received_from_sms",
      "part": "base",
      "order": 59,
      "messages": [
        {
          "id": "chat_receiver::received_from_sms_1",
          "sender": "visitor",
          "body": "メッセージアプリの「デモ連絡先」からチャットへ届きました。",
          "attachmentId": "",
          "sentAt": "",
          "delayMs": 500,
          "notes": "",
          "updatedAt": "2026-08-12",
          "source": "human"
        }
      ],
      "acceptsInput": true
    },
    {
      "id": "chat_receiver::received_from_chat",
      "talkId": "chat_receiver",
      "blockKey": "received_from_chat",
      "part": "base",
      "order": 61,
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
      ],
      "acceptsInput": true
    },
    {
      "id": "dummy_sms_1::start",
      "talkId": "dummy_sms_1",
      "blockKey": "start",
      "part": "base",
      "order": 64,
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
      ],
      "acceptsInput": true
    },
    {
      "id": "dummy_sms_1::dummy_reply",
      "talkId": "dummy_sms_1",
      "blockKey": "dummy_reply",
      "part": "base",
      "order": 66,
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
      ],
      "acceptsInput": false
    },
    {
      "id": "dummy_sms_2::start",
      "talkId": "dummy_sms_2",
      "blockKey": "start",
      "part": "base",
      "order": 69,
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
      ],
      "acceptsInput": true
    },
    {
      "id": "dummy_sms_2::dummy_reply",
      "talkId": "dummy_sms_2",
      "blockKey": "dummy_reply",
      "part": "base",
      "order": 71,
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
      ],
      "acceptsInput": false
    },
    {
      "id": "dummy_sms_3::start",
      "talkId": "dummy_sms_3",
      "blockKey": "start",
      "part": "base",
      "order": 74,
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
      ],
      "acceptsInput": true
    },
    {
      "id": "dummy_sms_3::dummy_reply",
      "talkId": "dummy_sms_3",
      "blockKey": "dummy_reply",
      "part": "base",
      "order": 76,
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
      ],
      "acceptsInput": false
    },
    {
      "id": "dummy_sms_4::start",
      "talkId": "dummy_sms_4",
      "blockKey": "start",
      "part": "base",
      "order": 79,
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
      ],
      "acceptsInput": true
    },
    {
      "id": "dummy_sms_4::dummy_reply",
      "talkId": "dummy_sms_4",
      "blockKey": "dummy_reply",
      "part": "base",
      "order": 81,
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
      ],
      "acceptsInput": false
    },
    {
      "id": "dummy_sms_5::start",
      "talkId": "dummy_sms_5",
      "blockKey": "start",
      "part": "base",
      "order": 84,
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
      ],
      "acceptsInput": true
    },
    {
      "id": "dummy_sms_5::dummy_reply",
      "talkId": "dummy_sms_5",
      "blockKey": "dummy_reply",
      "part": "base",
      "order": 86,
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
      ],
      "acceptsInput": false
    },
    {
      "id": "dummy_sms_6::start",
      "talkId": "dummy_sms_6",
      "blockKey": "start",
      "part": "base",
      "order": 89,
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
      ],
      "acceptsInput": true
    },
    {
      "id": "dummy_sms_6::dummy_reply",
      "talkId": "dummy_sms_6",
      "blockKey": "dummy_reply",
      "part": "base",
      "order": 91,
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
      ],
      "acceptsInput": false
    },
    {
      "id": "dummy_chat_1::start",
      "talkId": "dummy_chat_1",
      "blockKey": "start",
      "part": "base",
      "order": 94,
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
      ],
      "acceptsInput": true
    },
    {
      "id": "dummy_chat_1::dummy_reply",
      "talkId": "dummy_chat_1",
      "blockKey": "dummy_reply",
      "part": "base",
      "order": 96,
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
      ],
      "acceptsInput": false
    },
    {
      "id": "dummy_chat_2::start",
      "talkId": "dummy_chat_2",
      "blockKey": "start",
      "part": "base",
      "order": 99,
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
      ],
      "acceptsInput": true
    },
    {
      "id": "dummy_chat_2::dummy_reply",
      "talkId": "dummy_chat_2",
      "blockKey": "dummy_reply",
      "part": "base",
      "order": 101,
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
      ],
      "acceptsInput": false
    },
    {
      "id": "dummy_chat_3::start",
      "talkId": "dummy_chat_3",
      "blockKey": "start",
      "part": "base",
      "order": 104,
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
      ],
      "acceptsInput": true
    },
    {
      "id": "dummy_chat_3::dummy_reply",
      "talkId": "dummy_chat_3",
      "blockKey": "dummy_reply",
      "part": "base",
      "order": 106,
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
      ],
      "acceptsInput": false
    },
    {
      "id": "dummy_chat_4::start",
      "talkId": "dummy_chat_4",
      "blockKey": "start",
      "part": "base",
      "order": 109,
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
      ],
      "acceptsInput": true
    },
    {
      "id": "dummy_chat_4::dummy_reply",
      "talkId": "dummy_chat_4",
      "blockKey": "dummy_reply",
      "part": "base",
      "order": 111,
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
      ],
      "acceptsInput": false
    },
    {
      "id": "dummy_chat_5::start",
      "talkId": "dummy_chat_5",
      "blockKey": "start",
      "part": "base",
      "order": 114,
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
      ],
      "acceptsInput": true
    },
    {
      "id": "dummy_chat_5::dummy_reply",
      "talkId": "dummy_chat_5",
      "blockKey": "dummy_reply",
      "part": "base",
      "order": 116,
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
      ],
      "acceptsInput": false
    },
    {
      "id": "dummy_chat_6::start",
      "talkId": "dummy_chat_6",
      "blockKey": "start",
      "part": "base",
      "order": 119,
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
      ],
      "acceptsInput": true
    },
    {
      "id": "dummy_chat_6::dummy_reply",
      "talkId": "dummy_chat_6",
      "blockKey": "dummy_reply",
      "part": "base",
      "order": 121,
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
      ],
      "acceptsInput": false
    },
    {
      "id": "search_agent::intro",
      "talkId": "search_agent",
      "blockKey": "intro",
      "part": "base",
      "order": 124,
      "messages": [
        {
          "id": "search_agent::intro_1",
          "sender": "search_agent",
          "body": "検索とデモ全体の案内を担当するよ。まずは「古いメモ」を探してみよう。",
          "attachmentId": "",
          "sentAt": "",
          "delayMs": 350,
          "quickReplies": [
            "古いメモ",
            "ヒント",
            "機能テスト",
            "ヘルプ"
          ],
          "notes": "",
          "updatedAt": "2026-08-12",
          "source": "human"
        }
      ],
      "acceptsInput": true
    },
    {
      "id": "search_agent::common_help",
      "talkId": "search_agent",
      "blockKey": "common_help",
      "part": "base",
      "order": 126,
      "messages": [
        {
          "id": "search_agent::common_help_1",
          "sender": "search_agent",
          "body": "このナビでは、端末内検索、次の手順のヒント、デモ機能の起動をまとめて行えます。",
          "attachmentId": "",
          "sentAt": "",
          "delayMs": 250,
          "quickReplies": [
            "ヒント",
            "機能テスト"
          ],
          "notes": "",
          "updatedAt": "2026-08-12",
          "source": "human"
        }
      ],
      "acceptsInput": false
    },
    {
      "id": "search_agent::stage_photo",
      "talkId": "search_agent",
      "blockKey": "stage_photo",
      "part": "base",
      "order": 128,
      "messages": [
        {
          "id": "search_agent::stage_photo_1",
          "sender": "search_agent",
          "body": "古いメモを開けたね。次は「雨」と検索して、表示された写真で一番大きな灯りの色を確かめて。",
          "attachmentId": "",
          "sentAt": "",
          "delayMs": 300,
          "quickReplies": [
            "雨",
            "ヒント",
            "機能テスト",
            "ヘルプ"
          ],
          "notes": "",
          "updatedAt": "2026-08-12",
          "source": "human"
        }
      ],
      "acceptsInput": false
    },
    {
      "id": "search_agent::stage_report",
      "talkId": "search_agent",
      "blockKey": "stage_report",
      "part": "base",
      "order": 130,
      "messages": [
        {
          "id": "search_agent::stage_report_1",
          "sender": "search_agent",
          "body": "写真を開けたね。一番大きく見える灯りの色を、このナビに入力して教えて。",
          "attachmentId": "",
          "sentAt": "",
          "delayMs": 300,
          "quickReplies": [
            "ヒント",
            "機能テスト",
            "ヘルプ"
          ],
          "notes": "",
          "updatedAt": "2026-08-12",
          "source": "human"
        }
      ],
      "acceptsInput": false
    },
    {
      "id": "search_agent::color_reported",
      "talkId": "search_agent",
      "blockKey": "color_reported",
      "part": "base",
      "order": 132,
      "messages": [
        {
          "id": "search_agent::color_reported_1",
          "sender": "search_agent",
          "body": "色を受け付けたよ。メッセージの「デモ連絡先」に、灯りが写った画像と鍵付き添付を届けました。",
          "attachmentId": "",
          "sentAt": "",
          "delayMs": 300,
          "quickReplies": [
            "デモ連絡先",
            "ヒント",
            "機能テスト",
            "ヘルプ"
          ],
          "notes": "",
          "updatedAt": "2026-08-12",
          "source": "human"
        }
      ],
      "acceptsInput": false
    },
    {
      "id": "search_agent::stage_chat",
      "talkId": "search_agent",
      "blockKey": "stage_chat",
      "part": "base",
      "order": 134,
      "messages": [
        {
          "id": "search_agent::stage_chat_1",
          "sender": "search_agent",
          "body": "鍵付き添付を開けたね。次は「チャット」と検索して、壊れたアプリを修復して開いてみて。",
          "attachmentId": "",
          "sentAt": "",
          "delayMs": 300,
          "quickReplies": [
            "チャット",
            "ヒント",
            "機能テスト",
            "ヘルプ"
          ],
          "notes": "",
          "updatedAt": "2026-08-12",
          "source": "human"
        }
      ],
      "acceptsInput": false
    },
    {
      "id": "search_agent::stage_auth",
      "talkId": "search_agent",
      "blockKey": "stage_auth",
      "part": "base",
      "order": 136,
      "messages": [
        {
          "id": "search_agent::stage_auth_1",
          "sender": "search_agent",
          "body": "チャットの再認証リンクを「デモ連絡先」へ届けました。メッセージからリンクを開いてね。",
          "attachmentId": "",
          "sentAt": "",
          "delayMs": 300,
          "quickReplies": [
            "デモ連絡先",
            "ヒント",
            "機能テスト",
            "ヘルプ"
          ],
          "notes": "",
          "updatedAt": "2026-08-12",
          "source": "human"
        }
      ],
      "acceptsInput": false
    },
    {
      "id": "search_agent::stage_contact",
      "talkId": "search_agent",
      "blockKey": "stage_contact",
      "part": "base",
      "order": 138,
      "messages": [
        {
          "id": "search_agent::stage_contact_1",
          "sender": "search_agent",
          "body": "再認証できました。チャットの「サンプルルーム」でメッセージを送ってみて。",
          "attachmentId": "",
          "sentAt": "",
          "delayMs": 300,
          "quickReplies": [
            "サンプルルーム",
            "ヒント",
            "機能テスト",
            "ヘルプ"
          ],
          "notes": "",
          "updatedAt": "2026-08-12",
          "source": "human"
        }
      ],
      "acceptsInput": false
    },
    {
      "id": "search_agent::stage_done",
      "talkId": "search_agent",
      "blockKey": "stage_done",
      "part": "base",
      "order": 140,
      "messages": [
        {
          "id": "search_agent::stage_done_1",
          "sender": "search_agent",
          "body": "検索、修復、添付解錠、チャット再認証、チャット投稿までの基本デモは完了です。「機能テスト」でほかの機能も試せます。",
          "attachmentId": "",
          "sentAt": "",
          "delayMs": 300,
          "quickReplies": [
            "機能テスト",
            "ヘルプ"
          ],
          "notes": "",
          "updatedAt": "2026-08-12",
          "source": "human"
        }
      ],
      "acceptsInput": false
    },
    {
      "id": "search_agent::call_completed",
      "talkId": "search_agent",
      "blockKey": "call_completed",
      "part": "base",
      "order": 142,
      "messages": [
        {
          "id": "search_agent::call_completed_1",
          "sender": "search_agent",
          "body": "通話を終了しました。音声と書き起こしは着信履歴で確認でき、メッセージ内リンクも届いています。",
          "attachmentId": "",
          "sentAt": "",
          "delayMs": 300,
          "quickReplies": [
            "書き起こし",
            "ヒント",
            "機能テスト",
            "ヘルプ"
          ],
          "notes": "",
          "updatedAt": "2026-08-12",
          "source": "human"
        }
      ],
      "acceptsInput": false
    },
    {
      "id": "search_agent::hint_first",
      "talkId": "search_agent",
      "blockKey": "hint_first",
      "part": "base",
      "order": 144,
      "messages": [
        {
          "id": "search_agent::hint_first_1",
          "sender": "search_agent",
          "body": "まずは「古いメモ」と検索して、コンテンツ修復を試してみて。",
          "attachmentId": "",
          "sentAt": "",
          "delayMs": 250,
          "quickReplies": [
            "古いメモ",
            "機能テスト",
            "ヘルプ"
          ],
          "notes": "",
          "updatedAt": "2026-08-12",
          "source": "human"
        }
      ],
      "acceptsInput": false
    },
    {
      "id": "search_agent::hint_photo",
      "talkId": "search_agent",
      "blockKey": "hint_photo",
      "part": "base",
      "order": 146,
      "messages": [
        {
          "id": "search_agent::hint_photo_1",
          "sender": "search_agent",
          "body": "「雨」と検索して、表示された写真で一番大きく見える灯りの色を確かめて。",
          "attachmentId": "",
          "sentAt": "",
          "delayMs": 250,
          "quickReplies": [
            "雨",
            "機能テスト",
            "ヘルプ"
          ],
          "notes": "",
          "updatedAt": "2026-08-12",
          "source": "human"
        }
      ],
      "acceptsInput": false
    },
    {
      "id": "search_agent::hint_report",
      "talkId": "search_agent",
      "blockKey": "hint_report",
      "part": "base",
      "order": 148,
      "messages": [
        {
          "id": "search_agent::hint_report_1",
          "sender": "search_agent",
          "body": "写真で一番大きく見えた灯りの色を、このナビに入力して教えて。",
          "attachmentId": "",
          "sentAt": "",
          "delayMs": 250,
          "quickReplies": [
            "機能テスト",
            "ヘルプ"
          ],
          "notes": "",
          "updatedAt": "2026-08-12",
          "source": "human"
        }
      ],
      "acceptsInput": false
    },
    {
      "id": "search_agent::hint_unlock",
      "talkId": "search_agent",
      "blockKey": "hint_unlock",
      "part": "base",
      "order": 150,
      "messages": [
        {
          "id": "search_agent::hint_unlock_1",
          "sender": "search_agent",
          "body": "メッセージの「デモ連絡先」に届いた鍵付き添付を、パスワード「0420」で開いて。",
          "attachmentId": "",
          "sentAt": "",
          "delayMs": 250,
          "quickReplies": [
            "デモ連絡先",
            "機能テスト",
            "ヘルプ"
          ],
          "notes": "",
          "updatedAt": "2026-08-12",
          "source": "human"
        }
      ],
      "acceptsInput": false
    },
    {
      "id": "search_agent::hint_chat",
      "talkId": "search_agent",
      "blockKey": "hint_chat",
      "part": "base",
      "order": 152,
      "messages": [
        {
          "id": "search_agent::hint_chat_1",
          "sender": "search_agent",
          "body": "「チャット」を検索して開き、再認証リンクを発行して。",
          "attachmentId": "",
          "sentAt": "",
          "delayMs": 250,
          "quickReplies": [
            "チャット",
            "機能テスト",
            "ヘルプ"
          ],
          "notes": "",
          "updatedAt": "2026-08-12",
          "source": "human"
        }
      ],
      "acceptsInput": false
    },
    {
      "id": "search_agent::hint_auth",
      "talkId": "search_agent",
      "blockKey": "hint_auth",
      "part": "base",
      "order": 154,
      "messages": [
        {
          "id": "search_agent::hint_auth_1",
          "sender": "search_agent",
          "body": "「デモ連絡先」に届いた再認証リンクから、チャットを開いて。",
          "attachmentId": "",
          "sentAt": "",
          "delayMs": 250,
          "quickReplies": [
            "デモ連絡先",
            "機能テスト",
            "ヘルプ"
          ],
          "notes": "",
          "updatedAt": "2026-08-12",
          "source": "human"
        }
      ],
      "acceptsInput": false
    },
    {
      "id": "search_agent::hint_contact",
      "talkId": "search_agent",
      "blockKey": "hint_contact",
      "part": "base",
      "order": 156,
      "messages": [
        {
          "id": "search_agent::hint_contact_1",
          "sender": "search_agent",
          "body": "再認証したチャットを開いて、サンプルルームでメッセージを送ってみて。",
          "attachmentId": "",
          "sentAt": "",
          "delayMs": 250,
          "quickReplies": [
            "サンプルルーム",
            "機能テスト",
            "ヘルプ"
          ],
          "notes": "",
          "updatedAt": "2026-08-12",
          "source": "human"
        }
      ],
      "acceptsInput": false
    },
    {
      "id": "search_agent::hint_done",
      "talkId": "search_agent",
      "blockKey": "hint_done",
      "part": "base",
      "order": 158,
      "messages": [
        {
          "id": "search_agent::hint_done_1",
          "sender": "search_agent",
          "body": "検索・修復・会話・添付解錠・再認証のデモは完了しています。",
          "attachmentId": "",
          "sentAt": "",
          "delayMs": 250,
          "quickReplies": [
            "機能テスト",
            "ヘルプ"
          ],
          "notes": "",
          "updatedAt": "2026-08-12",
          "source": "human"
        }
      ],
      "acceptsInput": false
    },
    {
      "id": "search_agent::test_menu",
      "talkId": "search_agent",
      "blockKey": "test_menu",
      "part": "base",
      "order": 160,
      "messages": [
        {
          "id": "search_agent::test_menu_1",
          "sender": "search_agent",
          "body": "試したい機能を選んでね。メッセージ固有の送信確認は「デモ連絡先」から試せます。",
          "attachmentId": "",
          "sentAt": "",
          "delayMs": 250,
          "quickReplies": [
            "デモ連絡先",
            "着信テスト",
            "遅延メッセージ",
            "画像受信テスト",
            "ノイズ演出",
            "フラッシュ演出",
            "暗転演出",
            "ゲームオーバー演出",
            "オールクリア演出",
            "ヒント",
            "ヘルプ"
          ],
          "notes": "",
          "updatedAt": "2026-08-12",
          "source": "human"
        }
      ],
      "acceptsInput": false
    },
    {
      "id": "search_agent::demo_test_ack",
      "talkId": "search_agent",
      "blockKey": "demo_test_ack",
      "part": "base",
      "order": 162,
      "messages": [
        {
          "id": "search_agent::demo_test_ack_1",
          "sender": "search_agent",
          "body": "「{{player_input}}」を実行しました。着信や通知を選んだ場合は、少し待ってから確認してください。",
          "attachmentId": "",
          "sentAt": "",
          "delayMs": 250,
          "quickReplies": [
            "機能テスト",
            "ヒント",
            "ヘルプ"
          ],
          "notes": "",
          "updatedAt": "2026-08-12",
          "source": "human"
        }
      ],
      "acceptsInput": false
    },
    {
      "id": "search_agent::demo_test_already_done",
      "talkId": "search_agent",
      "blockKey": "demo_test_already_done",
      "part": "base",
      "order": 164,
      "messages": [
        {
          "id": "search_agent::demo_test_already_done_1",
          "sender": "search_agent",
          "body": "このテストはすでに完了しています。もう一度試す場合は、通知シェードの「最初から」を使ってください。",
          "attachmentId": "",
          "sentAt": "",
          "delayMs": 250,
          "quickReplies": [
            "機能テスト",
            "ヒント",
            "ヘルプ"
          ],
          "notes": "",
          "updatedAt": "2026-08-12",
          "source": "human"
        }
      ],
      "acceptsInput": false
    },
    {
      "id": "search_agent::found",
      "talkId": "search_agent",
      "blockKey": "found",
      "part": "base",
      "order": 166,
      "messages": [
        {
          "id": "search_agent::found_1",
          "sender": "search_agent",
          "body": "見つかったよ。結果を開くと、次の案内へ進みます。",
          "attachmentId": "",
          "sentAt": "",
          "delayMs": 250,
          "quickReplies": [
            "ヒント",
            "機能テスト",
            "ヘルプ"
          ],
          "notes": "",
          "updatedAt": "2026-08-12",
          "source": "human"
        }
      ],
      "acceptsInput": false
    },
    {
      "id": "search_agent::not_found",
      "talkId": "search_agent",
      "blockKey": "not_found",
      "part": "base",
      "order": 168,
      "messages": [
        {
          "id": "search_agent::not_found_1",
          "sender": "search_agent",
          "body": "該当するデータは見つかりませんでした。入力を確認するか、ヒントを使ってください。",
          "attachmentId": "",
          "sentAt": "",
          "delayMs": 250,
          "quickReplies": [
            "ヒント",
            "機能テスト",
            "ヘルプ"
          ],
          "notes": "",
          "updatedAt": "2026-08-12",
          "source": "human"
        }
      ],
      "acceptsInput": false
    }
  ],
  "attachments": [
    {
      "id": "rainy_window_image",
      "type": "image",
      "asset": "/demo/album/rainy-window.webp",
      "content": "rainy_window",
      "part": "base",
      "order": 0
    },
    {
      "id": "sealed_note_file",
      "type": "image",
      "asset": "/demo/sealed-note.svg",
      "content": "sealed_note",
      "lock": "password",
      "title": "鍵付きのメモ",
      "body": "鍵付き添付を開封できました。",
      "part": "base",
      "order": 1
    },
    {
      "id": "demo_received_image_attachment",
      "type": "image",
      "asset": "/demo/dummy-data.svg",
      "content": "demo_received_image",
      "part": "base",
      "order": 2
    },
    {
      "id": "demo_video_poster",
      "type": "image",
      "asset": "/demo/dummy-data.svg",
      "part": "base",
      "order": 3
    },
    {
      "id": "demo_video_attachment",
      "type": "video",
      "asset": "/demo/demo-video.mp4",
      "content": "demo_video",
      "poster": "demo_video_poster",
      "part": "base",
      "order": 4
    },
    {
      "id": "media_6",
      "type": "audio",
      "asset": "/system/call-caption-sample.wav",
      "part": "base",
      "order": 5
    },
    {
      "id": "media_7",
      "type": "image",
      "asset": "/demo/album/evening-platform.webp",
      "part": "base",
      "order": 6
    },
    {
      "id": "media_8",
      "type": "image",
      "asset": "/demo/album/coffee-table.webp",
      "part": "base",
      "order": 7
    },
    {
      "id": "media_9",
      "type": "audio",
      "asset": "/system/radio-caption-sample.wav",
      "part": "base",
      "order": 8
    }
  ],
  "repeatTalkBlocks": {
    "guide::message_reply": [
      "guide::message_reply@2"
    ]
  },
  "incomingCalls": [
    {
      "id": "demo_call",
      "name": "着信テスト",
      "cond": "",
      "audioAttachmentId": "media_6",
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
      "publicId": "call_101df897abb3",
      "part": "base",
      "order": 0
    }
  ],
  "initialSchedules": [],
  "todos": [
    {
      "id": "find_old_note",
      "text": "ナビで「古いメモ」を検索する",
      "cond": "!old_note_opened",
      "part": "base",
      "order": 0
    },
    {
      "id": "find_rainy_window",
      "text": "ナビで「雨」と検索し、写真の灯りの色を確かめる",
      "cond": "old_note_opened && !rainy_window_opened && !image_color_reported",
      "part": "base",
      "order": 1
    },
    {
      "id": "report_clue",
      "text": "ナビに写真の灯りの色を伝える",
      "cond": "rainy_window_opened && !image_color_reported",
      "part": "base",
      "order": 2
    },
    {
      "id": "unlock_recovery_note",
      "text": "パスワード「0420」で鍵付きメモを開く",
      "cond": "image_color_reported && !sealed_note_unlocked",
      "part": "base",
      "order": 3
    },
    {
      "id": "restore_chat",
      "text": "「チャット」を検索して開き、再認証リンクを発行する",
      "cond": "sealed_note_unlocked && !chat_auth_link_sent",
      "part": "base",
      "order": 4
    },
    {
      "id": "authenticate_chat",
      "text": "メッセージに届いたリンクからチャットを開く",
      "cond": "chat_auth_link_sent && !chat_auth_verified",
      "part": "base",
      "order": 5
    },
    {
      "id": "contact_owner",
      "text": "サンプルルームでメッセージを送る",
      "cond": "chat_auth_verified && !demo_completed",
      "part": "base",
      "order": 6
    }
  ],
  "notifications": [
    {
      "id": "clue_attachments",
      "appId": "messages",
      "title": "デモ連絡先",
      "body": "確認用の画像と鍵付き添付が届きました。",
      "cond": "image_color_reported && !sealed_note_unlocked",
      "targetTalkId": "guide",
      "part": "base",
      "order": 0
    },
    {
      "id": "chat_auth",
      "appId": "messages",
      "title": "デモ連絡先",
      "body": "再認証用のリンクを発行しました。",
      "cond": "chat_auth_link_sent && !chat_auth_verified",
      "targetTalkId": "guide",
      "part": "base",
      "order": 1
    },
    {
      "id": "demo_sms_message_received",
      "appId": "messages",
      "title": "テスト受信箱",
      "body": "別のメッセージルームから新着メッセージが届きました。",
      "cond": "demo_sms_message_received",
      "targetTalkId": "sms_receiver",
      "part": "base",
      "order": 2
    },
    {
      "id": "demo_sms_cross_received",
      "appId": "messages",
      "title": "テスト受信箱",
      "body": "チャットからメッセージアプリへ新着が届きました。",
      "cond": "demo_sms_cross_received",
      "targetTalkId": "sms_receiver",
      "part": "base",
      "order": 3
    },
    {
      "id": "demo_delayed_message_received",
      "appId": "messages",
      "title": "テスト受信箱",
      "body": "遅延イベントから新着メッセージが届きました。",
      "cond": "demo_delayed_message_received",
      "targetTalkId": "sms_receiver",
      "part": "base",
      "order": 4
    },
    {
      "id": "demo_image_received",
      "appId": "messages",
      "title": "画像受信",
      "body": "アルバム未登録の画像が届きました。",
      "cond": "demo_image_received",
      "targetTalkId": "sms_media_receiver",
      "part": "base",
      "order": 5
    },
    {
      "id": "demo_chat_message_received",
      "appId": "chat",
      "title": "連携受信ログ",
      "body": "別のチャットルームから新着が届きました。",
      "cond": "demo_chat_message_received",
      "targetTalkId": "chat_receiver",
      "part": "base",
      "order": 6
    },
    {
      "id": "demo_chat_cross_received",
      "appId": "chat",
      "title": "連携受信ログ",
      "body": "メッセージアプリからチャットへ新着が届きました。",
      "cond": "demo_chat_cross_received",
      "targetTalkId": "chat_receiver",
      "part": "base",
      "order": 7
    }
  ],
  "assistantMessages": [
    {
      "id": "home_hint",
      "surface": "home",
      "body": "ナビで「古いメモ」を検索し、修復してみよう。",
      "weight": 1,
      "cond": "!old_note_opened",
      "agentAction": "hi",
      "part": "base",
      "order": 0
    },
    {
      "id": "photo_hint",
      "surface": "home",
      "body": "古いメモに書かれた写真を探して、灯りの色を確かめよう。",
      "weight": 1,
      "cond": "old_note_opened && !rainy_window_opened && !image_color_reported",
      "agentAction": "hi",
      "part": "base",
      "order": 1
    },
    {
      "id": "report_hint",
      "surface": "home",
      "body": "写真で一番大きく見える灯りの色を、ナビで教えて。",
      "weight": 1,
      "cond": "rainy_window_opened && !image_color_reported",
      "agentAction": "hi",
      "part": "base",
      "order": 2
    },
    {
      "id": "sealed_note_opened",
      "surface": "messages",
      "body": "次の案内がナビに届いています。右下のナビを開いてください。",
      "weight": 1,
      "cond": "sealed_note_unlocked && !chat_auth_link_sent",
      "agentAction": "hi",
      "part": "base",
      "order": 3
    },
    {
      "id": "contact_owner",
      "surface": "home",
      "body": "再認証したチャットで、メッセージを送ってみよう。",
      "weight": 1,
      "cond": "chat_auth_verified && !demo_completed",
      "agentAction": "hi",
      "part": "base",
      "order": 4
    },
    {
      "id": "demo_completed_nav",
      "surface": "chat",
      "body": "基本デモが完了しました。右下のナビから機能テストも試せます。",
      "weight": 1,
      "cond": "demo_completed",
      "agentAction": "hi",
      "part": "base",
      "order": 5
    },
    {
      "id": "radio_completed",
      "surface": "radio",
      "body": "音声の再生完了イベントを受け取りました。",
      "weight": 1,
      "cond": "radio_playback_completed",
      "part": "base",
      "order": 6
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
      "staticUrl": "/api/generated-audio/static/g_aedd90a2a532.wav",
      "part": "base",
      "order": 0
    }
  ],
  "albumMediaAttachmentLinks": [
    {
      "attachmentId": "media_7",
      "photoId": "evening_platform"
    },
    {
      "attachmentId": "rainy_window_image",
      "photoId": "rainy_window"
    },
    {
      "attachmentId": "media_8",
      "photoId": "coffee_table"
    },
    {
      "attachmentId": "demo_video_attachment",
      "photoId": "demo_video"
    },
    {
      "attachmentId": "demo_received_image_attachment",
      "photoId": "demo_received_image"
    },
    {
      "attachmentId": "demo_received_image_attachment",
      "photoId": "dummy_photo_1"
    },
    {
      "attachmentId": "demo_received_image_attachment",
      "photoId": "dummy_photo_2"
    },
    {
      "attachmentId": "demo_received_image_attachment",
      "photoId": "dummy_photo_3"
    },
    {
      "attachmentId": "demo_received_image_attachment",
      "photoId": "dummy_photo_4"
    },
    {
      "attachmentId": "demo_received_image_attachment",
      "photoId": "dummy_photo_5"
    },
    {
      "attachmentId": "demo_received_image_attachment",
      "photoId": "dummy_photo_6"
    }
  ],
  "lockedContentPasswords": [
    {
      "contentId": "sealed_note",
      "target": "attachment",
      "answers": [
        "0420"
      ],
      "loadParts": [],
      "part": "base"
    }
  ],
  "hooks": [
    {
      "event": "session_started",
      "target": "",
      "cond": "!session_started",
      "handler": "mark_session_started",
      "llm": false,
      "part": "base",
      "order": 0
    },
    {
      "event": "content_repaired",
      "target": "old_note",
      "cond": "!old_note_opened",
      "handler": "mark_old_note_opened",
      "llm": false,
      "part": "base",
      "order": 1
    },
    {
      "event": "content_repaired",
      "target": "rainy_window",
      "cond": "!rainy_window_opened",
      "handler": "mark_rainy_window_opened",
      "llm": false,
      "part": "base",
      "order": 2
    },
    {
      "event": "talk_turn_completed",
      "target": "search_agent",
      "cond": "clue_attachments_pending",
      "handler": "deliver_clue_attachments",
      "llm": false,
      "part": "base",
      "order": 3
    },
    {
      "event": "talk_turn_completed",
      "target": "search_agent",
      "cond": "",
      "handler": "handle_demo_nav_test_command",
      "llm": false,
      "part": "base",
      "order": 4
    },
    {
      "event": "talk_turn_completed",
      "target": "guide",
      "cond": "",
      "handler": "handle_demo_message_test_command",
      "llm": false,
      "part": "base",
      "order": 5
    },
    {
      "event": "content_unlocked",
      "target": "sealed_note",
      "cond": "!sealed_note_unlocked",
      "handler": "mark_sealed_note_unlocked",
      "llm": false,
      "part": "base",
      "order": 6
    },
    {
      "event": "schedule_demo_call",
      "target": "",
      "cond": "",
      "handler": "schedule_demo_call",
      "llm": false,
      "part": "base",
      "order": 7
    },
    {
      "event": "scheduled_event",
      "target": "show_demo_call",
      "cond": "",
      "handler": "show_demo_call",
      "llm": false,
      "part": "base",
      "order": 8
    },
    {
      "event": "scheduled_event",
      "target": "deliver_demo_delayed_message",
      "cond": "",
      "handler": "deliver_demo_delayed_message",
      "llm": false,
      "part": "base",
      "order": 9
    },
    {
      "event": "incoming_call_completed",
      "target": "demo_call",
      "cond": "!demo_call_completed",
      "handler": "mark_demo_call_completed",
      "llm": false,
      "part": "base",
      "order": 10
    },
    {
      "event": "demo_form",
      "target": "",
      "cond": "",
      "handler": "demo_form_game_over",
      "llm": false,
      "part": "base",
      "order": 11
    },
    {
      "event": "demo_all_clear",
      "target": "",
      "cond": "",
      "handler": "demo_all_clear",
      "llm": false,
      "part": "base",
      "order": 12
    },
    {
      "event": "demo_form_reject",
      "target": "",
      "cond": "",
      "handler": "demo_form_reject",
      "llm": false,
      "part": "base",
      "order": 13
    },
    {
      "event": "chat_auth_link_requested",
      "target": "",
      "cond": "sealed_note_unlocked && !chat_auth_link_sent && !chat_auth_verified",
      "handler": "send_chat_auth_link",
      "llm": false,
      "part": "base",
      "order": 14
    },
    {
      "event": "message_link_opened",
      "target": "chat_auth_link_opened",
      "cond": "chat_auth_link_sent && !chat_auth_verified",
      "handler": "verify_chat_auth",
      "llm": false,
      "part": "base",
      "order": 15
    },
    {
      "event": "talk_turn_completed",
      "target": "lobby",
      "cond": "demo_completed && !demo_completion_announced",
      "handler": "complete_demo_todo",
      "llm": false,
      "part": "base",
      "order": 16
    },
    {
      "event": "talk_turn_completed",
      "target": "lobby",
      "cond": "",
      "handler": "handle_demo_chat_test_command",
      "llm": false,
      "part": "base",
      "order": 17
    },
    {
      "event": "audio_playback_completed",
      "target": "sample_radio",
      "cond": "!radio_playback_completed",
      "handler": "mark_radio_playback_completed",
      "llm": false,
      "part": "base",
      "order": 18
    }
  ],
  "publicIds": {
    "content": {
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
      "demo_call_history": "c_8a5f7f91ea5b",
      "missed_call": "c_0376fabddf4f",
      "demo_voicemail": "c_1587119bb83d",
      "dummy_call_1": "c_2026bc4fe74f",
      "dummy_call_2": "c_f70177071c48",
      "dummy_call_3": "c_e73677fd9822",
      "dummy_call_4": "c_8f794be1736f",
      "dummy_call_5": "c_7c4385c5b673",
      "dummy_call_6": "c_07c948744931",
      "sample_radio": "c_513e68175e27",
      "dummy_radio_1": "c_a1885b48dd86",
      "dummy_radio_2": "c_02a56b40c49f",
      "dummy_radio_3": "c_e4a4835b572c",
      "dummy_radio_4": "c_21727e0c83a1",
      "dummy_radio_5": "c_447380361ccd",
      "mail_guide": "c_271fc8c96870",
      "damaged_mail": "c_4a00ef29e36b",
      "dummy_mail_1": "c_451b9414a8da",
      "dummy_mail_2": "c_eb5be853c25d",
      "dummy_mail_3": "c_79ba43a616d2",
      "dummy_mail_4": "c_74bbb653f3aa",
      "browser_guide": "c_a0cec9e1ac30",
      "dummy_browser_1": "c_be720b110439",
      "dummy_browser_2": "c_fd4144354636",
      "dummy_browser_3": "c_2d9ff48c2e57",
      "dummy_browser_4": "c_6583456c66bb",
      "dummy_browser_5": "c_72782ea7ea51",
      "dummy_browser_6": "c_3eeb6b99d118",
      "browser_archive": "c_e9c108f35d34",
      "guide_history_archive_a": "c_f452f3bfd9c3",
      "guide_history_archive_b": "c_d2fb1ed4cac6",
      "lobby_history_archive": "c_ee422a2fa57f"
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
      "dummy_chat_6": "t_cb0b2cb99f03",
      "search_agent": "t_0ed8a2c8a5f6"
    },
    "attachment": {
      "rainy_window_image": "a_e98826327ab7",
      "sealed_note_file": "a_f0739fda5410",
      "demo_received_image_attachment": "a_48c127707e4a",
      "demo_video_poster": "a_eccc2405c02c",
      "demo_video_attachment": "a_b5d08e2fcddf",
      "media_6": "a_c0a7526bba86",
      "media_7": "a_def327a3cdab",
      "media_8": "a_52e9796cb1c3",
      "media_9": "a_36de402e3f3b"
    },
    "incomingCall": {
      "demo_call": "call_101df897abb3"
    },
    "form": {},
    "notification": {
      "clue_attachments": "notification_84dc626998fe",
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
      "demo_form": "e_e681caadd11a",
      "demo_all_clear": "e_a518caaa7a2d",
      "demo_form_reject": "e_26e72f12991e",
      "chat_auth_link_requested": "e_0d203bfe05d8",
      "show_demo_call": "e_15f1b15ac2d7",
      "deliver_demo_delayed_message": "e_e62843403b8c"
    }
  },
  "parts": [
    "base"
  ],
  "stateVariableParts": {
    "image_color_reported": "base",
    "clue_attachments_pending": "base",
    "old_note_opened": "base",
    "rainy_window_opened": "base",
    "chat_auth_link_sent": "base",
    "chat_auth_verified": "base",
    "demo_completed": "base",
    "demo_completion_announced": "base",
    "demo_call_completed": "base",
    "demo_chat_cross_received": "base",
    "demo_chat_message_received": "base",
    "session_started": "base",
    "demo_delayed_message_received": "base",
    "demo_image_received": "base",
    "demo_sms_cross_received": "base",
    "demo_sms_message_received": "base",
    "sealed_note_unlocked": "base",
    "radio_playback_completed": "base",
    "os_date": "base",
    "os_time_label": "base"
  },
  "hookTalkBlocks": {
    "guide": [
      "history_archive_a",
      "history_archive_b",
      "intro",
      "message_reply",
      "message_test_ack",
      "clue_attachments",
      "chat_auth_link",
      "call_history_guide",
      "chat_auth_required"
    ],
    "sms_receiver": [
      "start",
      "receiver_reply",
      "received_from_sms",
      "received_from_chat",
      "received_delayed"
    ],
    "sms_media_receiver": [
      "start",
      "receiver_reply",
      "received_image"
    ],
    "dummy_sms_1": [
      "start",
      "dummy_reply"
    ],
    "dummy_sms_2": [
      "start",
      "dummy_reply"
    ],
    "dummy_sms_3": [
      "start",
      "dummy_reply"
    ],
    "dummy_sms_4": [
      "start",
      "dummy_reply"
    ],
    "dummy_sms_5": [
      "start",
      "dummy_reply"
    ],
    "dummy_sms_6": [
      "start",
      "dummy_reply"
    ],
    "lobby": [
      "history_archive",
      "start",
      "chat_test_ack",
      "lobby_reply",
      "lobby_done"
    ],
    "chat_receiver": [
      "start",
      "receiver_reply",
      "received_from_sms",
      "received_from_chat"
    ],
    "dummy_chat_1": [
      "start",
      "dummy_reply"
    ],
    "dummy_chat_2": [
      "start",
      "dummy_reply"
    ],
    "dummy_chat_3": [
      "start",
      "dummy_reply"
    ],
    "dummy_chat_4": [
      "start",
      "dummy_reply"
    ],
    "dummy_chat_5": [
      "start",
      "dummy_reply"
    ],
    "dummy_chat_6": [
      "start",
      "dummy_reply"
    ],
    "search_agent": [
      "intro",
      "common_help",
      "stage_photo",
      "stage_report",
      "color_reported",
      "stage_chat",
      "stage_auth",
      "stage_contact",
      "stage_done",
      "call_completed",
      "hint_first",
      "hint_photo",
      "hint_report",
      "hint_unlock",
      "hint_chat",
      "hint_auth",
      "hint_contact",
      "hint_done",
      "test_menu",
      "demo_test_already_done",
      "found",
      "not_found"
    ]
  }
};
