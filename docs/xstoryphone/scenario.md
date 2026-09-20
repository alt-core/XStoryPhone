# シナリオ作成

制作上の正本はGoogle Sheetsです。メモ・画像・通知・状態・hookを含む制作表を明示的にpullし、取得したローカルTSV一式から検証・生成します。デモは取得済みTSVを同梱しているため、Sheetへ接続せずビルドできます。接続設定、pull/compare/put、安全な投入手順は[Google Sheetsでの制作・同期](spreadsheet-authoring.md)を参照してください。

- `scenario/<作品>/scenario.source.json`: Sheet名と論理表IDの対応、TSV取得先などの設定。本文を直接記述するファイルではありません。
- 設定の`exportDir`にある`<Sheet名>.tsv`: 全制作表のローカル取得データ。デモでは`scenario/demo/authoring/`です。
- `public/`以下: 画像・音声・動画・作品HTMLなどの実ファイル。TSVから参照します。

`npm run scenario:build` は取得済みTSVを検証し、クライアント用とWorker用のデータ、型付きhook handlerを生成します。Google Sheetsを自動取得・更新する処理ではありません。内部IDから公開IDも同時に生成するため、生成済みファイルを手で編集しないでください。別の`scenario.json`や`hooks.ts`を作者原本として併用しません。

デモを残して別の作品を作る場合は、`scenario/demo` を作品用ディレクトリへ複製し、`XSTORYPHONE_SCENARIO_DIR` で選びます。環境変数を省略した場合だけ `scenario/demo` を使います。

```sh
XSTORYPHONE_SCENARIO_DIR=scenario/my-story npm run scenario:build
XSTORYPHONE_SCENARIO_DIR=scenario/my-story npm run dev
```

## 制作表の一覧

表名は論理IDです。実際のSheet名とTSV名はmanifestの`tables`で対応させます。デモは次の26表を持ちます。

| 表 | 内容 |
|---|---|
| `project_constants` | 作品・端末・検索AIの定数、公開範囲、保存方式 |
| `state_vars` | 型付き状態変数、初期値、enum、Stageへの公開指定 |
| `home_items` | ホームのアプリ、修復状態、検索語、バッジ条件 |
| `message_items` / `chat_items` | 会話相手・ルーム、初期履歴、入力設定、talk全体の修復 |
| `call_items` | 着信履歴・留守番電話、音声、書き起こし |
| `gen_audio` / `incoming_calls` | 生成音声定義／着信・字幕 |
| `todo_items` / `notifications` | ToDo／通知 |
| `hooks` / `passwords` | eventと同期script／鍵付き添付の正解 |
| `calendar_items` / `photo_items` / `note_items` | 予定／画像・動画／メモ |
| `radio_items` | ラジオの音声、cue、字幕、投稿フォーム |
| `talk_people` / `talk_flow` / `talk_blocks` | 発話者／分岐／台本・添付・Quick Reply |
| `assistant_messages` / `attachments` | 補助案内文／素材・添付と検索導線 |
| `mail_items` / `browser_items` | メール／ブラウザのタブ |
| `talk_history` / `schedules` / `project_items` | 初期履歴の部分修復／初期予約／作品固有アプリの項目 |

追加5表の`mail_items`、`browser_items`、`talk_history`、`schedules`、`project_items`は、未使用ならmanifestから省略できます。それ以外は表を用意し、使わない表はheaderだけ残します。検索AIは通常のtalkへ統合されており、専用の検索返答表はありません。

各表のA列は`comment`です。通常表はcommentが空の行だけを読み、`notes`は制作メモです。`talk_blocks`だけは`*talk_id`、block名、`---`等をcomment列の構造として使います。空欄継承は`talk_flow`のtalk/from、`hooks`のevent、`attachments`のtype、`calendar_items`のdateだけです。継承値を消すときは`-`を指定しますが、解除結果が必須セルの空欄ならエラーになります。行を無効にする指定ではありません。必要なheader、未知列、参照先、型はビルド時に検証します。

以下の表やコード例はSheetsのセル内容を表します。TSVを直接編集する場合、改行・タブ・引用符を含むセルはTSV規則でquote/escapeしてください。

## 端末設定

`project_constants`のkey/valueで設定します。`exposure`は`public`または`private`です。任意の作品定数も同じ表へ追加できますが、秘密情報をpublicにしないでください。

| key | value例 | 用途 |
|---|---|---|
| `project.id` / `project.name` | `my_story` / `My Story` | 安定した作品ID／作品名 |
| `device.os_name` / `search_agent.name` | `StoryOS` / `ナビ` | 画面上の名称 |
| `device.date` / `device.time_label` | `2026-08-12` / `20:14` | 作中の日時 |
| `device.wallpaper_url` | `/media/wallpaper.svg` | 壁紙 |
| `device.lock_method` | `none` | `player-passcode` / `fixed-pin` / `none` |
| `device.lock_pin` | `0420` | fixed-pin時だけ指定し、exposureはprivate |
| `player.mode` | `server` | `server`または`browser`。省略時server |
| `features.llm` | `false` | LLM有効化。privateの設定値 |
| `search_agent.start` | `intro` | 検索AIの初期block/step。改行区切り |

日時は実世界の特定の瞬間ではなく、タイムゾーンを持たない作中の暦日・表示時刻です。日付は`YYYY-MM-DD`で、UTCへ変換せずロック画面とカレンダーの表示週へ使います。`calendar_items.date`も同じ形式です。

進行中は予約状態変数`os_date`と`os_time_label`を更新できます。上の定数が初期値になるため、`state_vars`へ重ねて宣言しません。hookのscriptセルには`state.set("os_date", "2026-08-13")`、会話のsetセルには`os_time_label = "21:30"`のように書きます。日付が変わるとカレンダーはその週を表示します。

固定PINは4〜8桁の数字文字列です。Sheetで先頭ゼロを落とさず文字列として保持してください。値はクライアントへ出さず、サーバーで一致判定します。入力画面の順序と保存方式は[プレイヤー進行の保存モード](player-modes.md#プレイヤーパスコードとロック画面)を参照してください。

破損リンク案内の`search_agent.broken_link_tutorial_body`と`search_agent.broken_link_body`もこの表で制作します。必須定数と初期画面の値はデモ表を基に編集し、`client.*`と`device.lock_pin_length`は自動生成されるため書きません。

## アプリとコンテンツの状態

`home_items`と各コンテンツ表の`initial`は次の3種類です。空欄はnormalです。`repair_label`は破損時の名称です。

| 値 | 初期表示 | 検索結果から開いた時 |
|---|---|---|
| `normal` | 通常表示 | そのまま開く |
| `repairable` | ノイズ混じり、通常利用不可 | 修復して開く |
| `hidden` | 通常経路には表示しない | 表示して開く |

検索は対象を修復しません。`POST /api/content/opened` が成功した時だけ修復し、`content_repaired`、`content_opened` の順でhookを実行します。

標準で使えるアプリIDは次の9つです。

- `phone`
- `messages`
- `mail`
- `notes`
- `photos`
- `calendar`
- `radio`
- `chat`
- `browser`

`message_items`と`chat_items`にtalkのid/name/startを書き、`talk_people`と`talk_blocks`、`talk_flow`、`attachments`で内容を組み立てます。`start`は初期blockの改行区切りです。talk全体を修復する場合はその行のinitial/search/repair_labelを使います。入力欄の表示と入力許可はinput_visible/input_enabledで独立に指定でき、空欄はtrueです。詳しくは[会話エンジン](conversation.md#talk全体の修復)と[入力欄とQuick Reply](conversation.md#入力欄とquick-reply)を参照してください。

過去履歴の一部分だけを壊す場合は`talk_history`にid、talk、block、initial=repairable、repair_label、searchを書きます。対象blockはそのtalkのstartに一度だけ含まれる必要があり、各発話のtimeも必須です。talk全体の修復との併用、repeatや途中追加blockの部分修復はできません。連続する破損範囲はまとめて表示し、検索結果から開くと復元blockの先頭へ移動します。

### メモ・メール

`note_items`にid/title/bodyを書きます。`mail_items`はメール1通で1行とし、from/to/subject/date/body、必要ならccを書きます。アドレスは不要で、宛先が複数の場合も名前を1セルへまとめます。メール日付は変換や自動ソートをせず表示し、一覧順は表の行順です。

`note_items.tags`と`photo_items.tags`は任意の改行区切りです。タグは記述順に詳細表示へ並び、多い場合は横スクロールします。絞込みには使いません。

| 表 | id | titleまたはsubject | その他のセル例 |
|---|---|---|---|
| note_items | old_note | 古いメモ | body=`写真の色を確認してください。`、initial=`repairable`、search=`古いメモ` |
| mail_items | notice_mail | お知らせ | from=`案内係`、to=`プレイヤー`、date=`2026年8月12日 19:40`、body=`メール本文` |

### 画像・動画・添付

素材URLは`attachments`のid/type/assetで登録します。typeはimage/audio/video/documentです。`photo_items.image`、audio、videoはURLではなく、そのattachment IDを参照します。

| photo_itemsの指定 | 表示 |
|---|---|
| image | 静止画像 |
| image＋audio | 静止サムネイルと音声を組み合わせた動画（内部形式still_video） |
| video、必要ならimage | 実動画。imageは任意のポスター画像 |

例えばattachmentsに`id=station_image / type=image / asset=/media/station.webp`を置き、photo_itemsに`id=station_photo / image=station_image / title=駅前の写真`を書きます。descriptionは会話判定・監修用の内容説明であり、アルバムへ表示する本文ではありません。

会話で添付する場合はtalk_blocksのattachmentに同じIDを書きます。attachmentsのcontentは対応するコンテンツID、posterは画像attachment IDです。画像・音声・動画とアルバム項目の対応は生成時に作られ、会話内メディアからアルバムへ移動できます。still_videoと実動画の両方をメッセージ・チャットへ添付できます。

鍵付き添付はattachmentsにlock=passwordとcontentを指定し、`passwords`にそのcontentとpasswordを書きます。document型はbodyが必要です。正解はクライアントへ配らず、到達済み添付の入力をサーバーで判定します。通常の一覧項目を持たない鍵付き添付も定義できます。

### 電話の字幕と書き起こし

`incoming_calls`にid/name/audioを、`call_items`に履歴のid/name/kind/at/duration/audioを書きます。audioはaudio型attachmentのIDです。着信と履歴は独立した定義です。

両表の任意のtranscriptセルへ、次のJSON配列を記述します。これは1セル内の字幕データであり、別のシナリオJSON原本ではありません。

```json
[
  { "atMs": 0, "text": "もしもし。" },
  { "atMs": 1200, "text": "確認したいことがあります。" }
]
```

着信時は音声位置に同期した字幕を表示し、履歴では全文をスクロールして読めます。字幕は任意で、省略した場合は音声だけです。同じ通話の字幕と履歴を一致させたい場合は同じ配列を使います。

`call_items.kind`はincoming/missed/outgoing/voicemailです。voicemailは一覧で「留守番電話」と表示し、audio/transcriptの再生・書き起こし機能は他の履歴と共通です。atは表示時刻、durationは「18秒」などの表示用文字列です。

`atMs` は音声開始からのミリ秒で、昇順に書きます。着信中の字幕同期には使いますが、履歴詳細の書き起こしにはタイムスタンプを表示せず、本文だけを順番に並べます。着信履歴へ案内する場合は、会話blockに `[着信履歴](open:phone:content_id)` のリンクを置けます。

### ブラウザ

`browser_items`の1行を1つのタブとして表示します。id/title/urlを書き、タブ内で移動を許可する追加ページはallowed_urlsへ改行区切りで書きます。例はurl=`/pages/guide-a8k3.html`、allowed_urls=`/pages/details-p2m7.html`です。

URL入力や任意サイトへの移動はなく、指定した同一オリジンのHTMLだけを開けます。HTML内のリンクを押すと同じタブ内に履歴が積まれ、端末上部の戻るボタンで戻れます。

表示するHTMLは `public` 以下へ置きます。未修復タブのURLはPlayerStateへ返りませんが、URLを知っていれば静的ファイルへ直接アクセスできます。未到達ページには作品ごとに推測されにくいファイル名を付けてください。iframe内ではスクリプト、フォーム送信、外部ページ、新しいウィンドウを使用できません。

## 状態条件による表示

アプリ、コンテンツ、talk、ToDo、通知、補助案内文などの表に`cond`を書けます。条件を満たさない項目はクライアントへ表示されず、検索やAPIの直接呼出しでも利用できません。

`home_items.badge_cond`に条件式を書くと、条件を満たす間だけホームのアイコンへ未読ドットを表示します。メッセージ・チャットの通常の未読判定とはORで扱われます。例えば`cond=clue_reported`、`badge_cond=new_chat_notice`のように別々の条件を指定できます。

状態は`state_vars`にid/type/initialを書きます。typeはboolean/integer/string/enumです。enumはvaluesセルに選択肢を改行区切りで書き、条件式とsetの誤記を検査できます。

| id | type | initial | values |
|---|---|---|---|
| clue_reported | boolean | false | 空 |
| new_chat_notice | boolean | false | 空 |
| visit_count | integer | 0 | 空 |
| chapter | enum | opening | openingとendingをセル内改行で列挙 |
| player_name | string | 空文字 | 空 |

条件式では `!`、`&&`、`||`、`==`、`!=`、整数の大小比較、文字列またはenumに対する `=~` / `!~` の正規表現照合、括弧を使用できます。値だけを条件に書けるのはboolean変数です。`player_input` は会話ruleの `cond` で現在の送信内容を参照する予約変数で、`state_vars`には宣言できません。ほかの表示条件では空文字として扱われます。

```text
clue_reported && visit_count >= 2
chapter == "ending"
player_input =~ /^(はい|了解)/u
```

表示条件は状態変数を更新した次の評価から反映されます。TSVの `set` は `chapter = "ending"` のように書きます。integer変数だけは整数literalによる`count += 1`と`count -= 1`も使えます。右辺の式・状態参照・`++`は使えません。`match` で抽出した文字列は、string変数に限り `player_name = $match.name` で代入できます。

作品固有Stageへ公開する必要がある状態だけは、`state_vars`のpublic列をtrueにします。公開値はPlayerStateの`projectState`へ入り、空欄またはfalseの状態変数は返りません。正解、未到達本文、素材URLなどは公開対象にしないでください。ID重複や型不正はシナリオ検証で拒否されます。

制作中の既存プレイデータを開いた場合も、あとから追加した状態変数は宣言した既定値として評価され、talkは利用可能になった時点で作られます。一度消したToDoや通知は、シナリオ定義を再生成しても勝手に復活しません。

## 検索語

アプリ、コンテンツ、talkのsearchセルへ、語句を改行区切りで列挙します。行同士はOR、同じ行の空白区切り語句はANDです。例えば次のセルは「古いメモ」を含む入力、または「駅前」と「写真」の両方を含む入力に一致します。

```text
古いメモ
駅前 写真
```

入力はNFKCで正規化し、プレイヤーの入力に検索語が含まれる場合に一致します。短い入力を長い検索語へ逆向きに一致させることはありません。

コンテンツ自身の`cond`を満たしていれば、親アプリが未修復でも検索結果には現れます。その結果を開こうとした時は修復せず、まだ開けない旨を検索AIが返します。

`repair_label` は修復前に表示する壊れた名称です。

検索AIの案内文、ヒント、検索結果の前後に出す台詞は、固定の`search_agent` talkとして`talk_blocks.tsv`と`talk_flow.tsv`へ記述します。固定の発見／未発見メッセージはなく、作品に合う文面をblockとして定義できます。検索実行と入力欄制御を含む書き方は[会話エンジン](conversation.md#検索ai-talk)を参照してください。

## ラジオの再生条件と音声cue

`radio_items.playback_cond`が偽の間は音声情報をクライアントへ渡さず、playback_disabled_labelを表示します。投稿フォームはform_disabled_condが真の間だけ無効になります。どちらの条件式もサーバーで評価され、条件式自体はクライアントへ公開されません。

HTMLフォームはform_kind=htmlとし、form_id/form_label/form_urlを記述します。フォームhookでは照合済みの`event.formId`と`event.contentId`を直接参照し、入力値とappIdは`event.fields`に入ります。

transcriptセルに着信字幕と同じJSON配列を指定すると、ラジオ再生位置に同期した字幕を表示します。ラジオには全文書き起こし画面はありません。transcriptは任意で、省略した番組は字幕欄を表示しません。

`cues`セルは、cue IDをkey、秒数または`MM:SS`/`HH:MM:SS`をvalueにしたJSON objectです。例えば`{"notice":"00:25","finish":40}`と書きます。build時に時刻順へ並べ、ミリ秒へ正規化します。クライアントには順番と時刻だけを渡し、到達通知を受けたサーバーがcueIdとcueTarget（`content_id:cue_name`）を復元してhookへ渡します。hookはeventをaudio_cue_reached、targetを`content_id:cue_name`とし、`event.cueId / cueTarget / cueIndex`を確認します。

固定音声はaudioセルへaudio attachmentのIDを書きます。複数音声をつなぐ場合は改行区切りで列挙し、生成音声は`gen_audio:音声ID`と書きます。単独の生成音声を使うgen_audio列もあります。定義はgen_audio表のid/title/providerで行い、状態と再生URLはラジオ項目と着信履歴のどちらでもサーバー応答時に解決されます。

## チャット再認証

project_constantsの`chat_auth.cond`を満たす間、チャットは再認証画面を表示し、直接投稿も拒否します。`chat_auth.link_sent_cond`は認証リンク発行済みの表示に使います。両定数はprivateにします。リンク発行はcustom event、認証完了はmessage_link_opened hookで書きます。デモのhooks表のsend_chat_auth_linkとverify_chat_authが一巡例です。

## 通知・予定・作品固有アプリ

`notifications`はid/app/target/title/bodyと任意のcondで定義します。targetは同じアプリに属するコンテンツIDまたはtalk ID、アプリのトップへ飛ばす場合はアプリIDです。通知を開くと、その対象へ移動します。`todo_items`はid/text/condで内容を定義し、表示対象への追加・削除はhookで行います。

`calendar_items`にはtitle/date/time/place/memoを書きます。dateは作中の日付で、空欄は直前行から継承します。表示する時刻や場所は文字列です。

初期予約は`schedules`のid/event/delay_msで指定します。fieldsは必要な場合だけ、文字列値のJSON objectを1セルへ書きます（例: `{"source":"opening"}`）。eventには対応するscheduled_event hookのtargetを指定します。進行中の予約には後述の`context.schedule.after`を使います。

作品固有アプリはコード側のregistryと画面componentを登録し、home_itemsへアプリを加え、`project_items`へid/app/recordを書きます。recordはそのアプリ固有のJSON objectを1セルに記述する場所です（例: `{"title":"資料","body":"本文"}`）。標準アプリの本文を別JSON原本へ戻すための欄ではありません。registryの検証と公開投影を通し、未修復のrecordをクライアントへ先に出しません。詳細は[作品固有の拡張](extensions.md)を参照してください。

## hook

`hooks`の1行へevent/target/cond/scriptを書きます。処理本文はscriptセルが正本で、別のhooks.tsへ二重に記述しません。idは必要な場合だけ付けられ、省略時は生成します。handlerを自分で宣言せず、セル内に同期処理の本文だけを書いてください。

```ts
state.set("clue_reported", true);
talk.addBlock("guide", "received", { mode: "stay" });
```

セル内ではstate/talk等を直接使えるほか、`context.state`や`context.talk`も使えます。eventは第2引数として参照できます。scriptは型付きhandlerへ生成され、構文検査と`npm run check`の型検査を受けます。await/async/Promise/import/export/fetchを使う非同期scriptは書けません。LLMを使うhookはllm列で明示でき、未指定なら対応するllm呼出しから判定します。

利用できるイベントは次の通りです。

- `session_started`
- `blocked_content_link_opened`
- `content_repaired`
- `content_opened`
- `content_unlocked`
- `audio_playback_completed`
- `audio_cue_reached`
- `incoming_call_completed`
- `message_link_opened`
- `talk_turn_completed`
- `form_submitted`
- `scheduled_event`

このほか、作品Stageや予約処理から呼ぶ作品固有event IDを定義できます。廃止済みのtalk_sentとscenario_eventは使用できません。

hookからは、状態変数、コンテンツ、アプリ、会話block、ToDo、予約、着信、生成音声、終了演出を操作できます。複数の状態更新は`context.state.apply([...])`へまとめられます。ToDoは定義しただけでは表示されず、`context.todo.add(id)` で表示対象へ加え、完了時に `context.todo.remove(id)` で外します。

`context.talk.addBlock(talkId, blockId)`はTSVのblockを追加し、その瞬間のtemplate値を固定したうえで、talk flowの通常遷移と同じく`from`を追加blockへ進めます。指定できるblockは、指定talkに属する非repeat blockのうち、repeat派生を含む全表示でtemplateを状態変数だけから解決できるものです。別talkのblockやmatch値を必要とするblockは、生成されたhook contextの型で拒否します。会話を続ける場合は、追加先blockを`from`にしたdefault ruleが必要です。`context.talk.addBlock(talkId, blockId, { mode: "stay" })`は、talk flowの`mode=stay`と同様にblockを追加しても`from`と`turnKey`を変更しません。会話位置と無関係な案内、新着、別eventの結果通知には`mode: "stay"`を使います。hook handlerは同期関数として副作用を順番に記録し、PlayerStateと同じcommitへ保存します。

hookから検索結果カードだけを検索AIへ追加する場合は、`context.talk.search("search_agent", query)`を使います。これは固定の`search_agent` talkへ結果を追加しますが、talkの`from`と検索入力欄の状態は変更しません。

hookから入力状態を変える場合は、SMS、チャット、検索AIのいずれにも次を使用できます。

```ts
context.talk.showInput("guide");
context.talk.hideInput("guide");
context.talk.enableInput("guide");
context.talk.disableInput("guide");
```

show／hideは自由入力composerの表示だけを変え、Quick Replyには影響しません。enable／disableは通常入力、添付、共有、Quick Replyのすべてへ適用します。入力状態だけではfromとturnKeyを変更せず、ほかのtalk effectと同じく記述順にPlayerStateへ反映します。

アプリに属さない単発演出は`context.effect.noise(durationMs?)`、`flash(options?)`、`blackout(options?)`で記録します。複数指定した場合は記述順に再生します。ノイズは既定100ms、上限8秒です。フラッシュと暗転は次のobject形式で、フェードイン、最大強度の維持、フェードアウトを指定します。旧来の数値だけを渡す形式は使用できません。

```ts
context.effect.flash({
  fadeInMs: 30,
  holdMs: 40,
  fadeOutMs: 270,
  intensity: 0.9,
  color: "#fffaf2"
});
context.effect.blackout({
  fadeInMs: 220,
  holdMs: 180,
  fadeOutMs: 300,
  intensity: 1
});
```

object自体と各項目は省略できます。上記がそれぞれの既定値です。`intensity`は0〜1へ補正し、暗転色は黒で固定します。フラッシュの`color`は6桁HEXだけを受け付け、小文字へ正規化します。不正値は`#fffaf2`になります。非有限または欠落した時間は既定値へ戻し、負の時間は補正します。`holdMs`は0まで、必須の`fadeInMs`と`fadeOutMs`は最小16msです。3区間の合計が8秒を超える場合は、両フェードの最小時間を確保したまま比率を保って8秒へ収めます。

複数phaseとdismiss後の遷移を持つ演出は`context.effectSequence.gameOver(reasonMessage?)`または`allClear(appId, contentId, autoplay?)`を使います。effect sequenceは一度のhook実行で最大1件かつ最後の命令です。それ以前のstateやtalk変更はcommitし、同じrequest内の後続hook eventと予約event処理は実行しません。`context.form.deny(error)`だけは入力拒否として全変更と演出を破棄します。`scheduled_event`は応答先が安定しないため、effect、effect sequence、`form.deny`、`genAudio.reject`を使用できません。誤って使用した予定イベントは完了扱いにせず、再実行可能な待機状態へ戻します。

`form.deny`や`genAudio.reject`の理由コードは、認証解除や再試行の命令ではありません。`unauthorized`、`conflict`などと同じ文字列でも、エンジンはHTTPステータスと合わせて区別します。拒否時の表示・終了方法は送信元の仕様に従い、すべての拒否を非致命的に扱うわけではありません。

`content_repaired` と `content_opened` の `target` には、コンテンツID、アプリID、talk IDを指定できます。`content_repaired`は対象が修復された時、`content_opened`は修復hookがeffect sequenceで後続処理を終了した場合を除き、利用可能な対象を開くたびにシナリオで定義したIDで発火します。hookから修復する場合は`context.content.setState(id, "repaired")`を使います。`content_unlocked` は鍵付きコンテンツだけを対象とするため、コンテンツIDを指定します。

同じeventで実行するhookは、dispatch開始時点の状態から先に確定します。先に書いたhookが状態を変更しても、その変更によって同じdispatch内の別hookが新たに発火することはありません。連続処理が必要なら、1つのhookへまとめるか、別のscenario eventを予約してください。

`context.schedule.after("show_call", 30_000, fields?, instanceId?)`で後続eventを予約でき、`scheduled_event` hookのtargetへ`show_call`を指定します。同じlogical eventを複数instance持つ場合だけ第4引数を使います。`context.incoming.start(id)`で着信を表示し、`markCompleted(id)`で完了済みとして再発火を防ぎます。通話完了時はコアが表示中の着信を閉じ、`incoming_call_completed` eventとcall IDをhookへ渡します。

`schedule.after` のschedule IDは、一度の予約を識別する使い切りIDです。完了したIDの再予約は保存モードをまたいで保証されないため、同じ処理をもう一度予約するときは新しいIDを使ってください。

一つのhook dispatch内だけでなく、コンテンツ修復時の`content_repaired`と`content_opened`など、一度の保存へまとまる複数hookでも同じschedule instance IDを複数操作できません。生成音声も、一度の保存で同じIDを複数回`prepare`しないでください。Cloudflare、AWS、browserのすべてで保存前にauthoring errorとして拒否します。

作品固有UIから`ProjectStageContext.dispatchScenarioEvent`で呼ぶcustom eventだけは、project_constantsの`event.client_callable`へevent IDを改行区切りで指定します。exposureはprivateにします。同じevent名のhookが通常どおり評価されます。音声再生完了、音声cue、着信完了、破損リンク通知はコアUIの標準eventなので指定不要です。予約イベント、メッセージ内リンク、フォーム送信にも指定は不要です。

音声完了、音声cue到達、通話完了などの背景eventと、予定時刻の状態取得は、一時的な通信失敗時に限定回数だけ再送されます。予定eventは失敗時に同じ行を再利用して待機へ戻り、実行中のまま5分以上経過した場合も再実行対象になります。

音声cue・音声完了・通話完了・作品Stageからのeventは、再試行も含めて発生順に送信します。先の通知が通信待ちの間、後の通知は待機します。音源の末尾でも未通知の到達済みcueを処理しますが、ブラウザが背面にある間の演出時刻まで厳密に保証するものではありません。

着信中は予約処理を一時停止し、通話完了後に再開します。クライアントの予定時刻による再取得には500msの最小間隔があるため、予約をミリ秒単位の正確な同期に使わないでください。

一度だけ行う処理には専用の状態変数を用意し、hookの `cond` が実行後に偽になるようにしてください。会話追加、予定登録、生成音声準備などの副作用も同じhook内で行います。外部providerの処理は再実行される可能性があるため、同じ入力を冪等に扱ってください。再送に失敗した場合はゲーム外エラー画面からリロードして復旧します。

## 検証

```sh
npm run scenario:validate
npm run scenario:build
```

LLMを無効にしたシナリオへ自然文criteriaやmatch抽出を書いた場合も、ここでエラーになります。
通常の `npm run check` では、未到達本文を持つWorkerシナリオがクライアントのimport経路へ入っていないことも検査します。
