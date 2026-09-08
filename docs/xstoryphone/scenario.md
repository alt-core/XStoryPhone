# シナリオ作成

シナリオデータの原本は、次の3ファイルです。

- `scenario/demo/scenario.json`: 端末、アプリ、コンテンツ、状態、通知、hook
- `scenario/demo/authoring/talk_blocks.tsv`: 会話本文、添付、Quick Reply、遅延、更新日、出典
- `scenario/demo/authoring/talk_flow.tsv`: メッセージ、チャット、検索AIの会話分岐

`npm run scenario:build` は原本を検証し、クライアント用とWorker用のデータを生成します。内部IDから公開IDも同時に生成するため、生成済みファイルを手で編集しないでください。

デモを残して別の作品を作る場合は、`scenario/demo` を作品用ディレクトリへ複製し、`XSTORYPHONE_SCENARIO_DIR` で選びます。環境変数を省略した場合だけ `scenario/demo` を使います。

```sh
XSTORYPHONE_SCENARIO_DIR=scenario/my-story npm run scenario:build
XSTORYPHONE_SCENARIO_DIR=scenario/my-story npm run dev
```

## 端末設定

`project` では作品名、作中OS名、検索AI名、日時、壁紙を設定します。

```json
{
  "project": {
    "name": "My Story",
    "osName": "StoryOS",
    "assistantName": "ナビ",
    "date": "2026-08-12",
    "timeLabel": "20:14",
    "wallpaperUrl": "/demo/wallpaper.svg"
  }
}
```

`osName` と `assistantName` はUIへ反映されます。`date` と `timeLabel` は作中の端末が示す日時です。

`date` は `YYYY-MM-DD` 形式で指定します。これは実世界の特定の瞬間ではなく、タイムゾーンを持たない作中の暦日です。UTCへの変換はせず、ロック画面の日付表記とスケジュールアプリが表示する週をこの値から決めます。スケジュールの `record.date` も同じ形式で指定してください。

シナリオ進行中は、予約状態変数 `os_date` と `os_time_label` を通常の状態変数と同じ方法で更新できます。初期値には `project.date` と `project.timeLabel` が自動で入るため、`stateVariables` へ重ねて宣言しません。hookでは `context.state.set("os_date", "2026-08-13")`、会話分岐ではTSVの `set` 列へ `os_time_label = "21:30"` のように書きます。日付が変わると、スケジュールアプリはその日を含む週へ移ります。

疑似端末のロック方式は `project.lockScreen` で設定します。プレイヤーパスコード、サーバー判定の固定PIN、ロック画面なしの違いと画面遷移は[プレイヤー進行の保存モード](player-modes.md#プレイヤーパスコードとロック画面)を参照してください。

進行状態の保存方式は、最上位の `playerMode` へ `server` または `browser` を指定します。省略時は `server` です。用途と運用上の違いは[プレイヤー進行の保存モード](player-modes.md)を参照してください。

## アプリとコンテンツの状態

`initialState` は次の3種類です。

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

`messages` と `chat` の中身は、`talks`、`talkPeople`、`attachments` と2つのTSVで定義します。talk全体、または初期履歴blockを検索・修復対象にできます。自由入力composerの表示・有効状態とQuick Replyもtalk共通機能です。詳しくは[会話エンジン](conversation.md#talk全体の修復)と[入力欄とQuick Reply](conversation.md#入力欄とquick-reply)を参照してください。それ以外は `contents[].record` に、そのアプリの表示データを書きます。具体的な最小例はデモシナリオを参照してください。

`notes` と `photos` の `record` には、任意で `tags` を指定できます。タグは記述順に詳細表示へ並び、多い場合は横へスクロールします。絞り込みには使いません。

```json
{
  "title": "駅前で見つけた写真",
  "imageUrl": "/demo/photo.svg",
  "tags": ["駅前", "手がかり"]
}
```

`mail` はメール単位で `contents` に定義します。`from`、`to`、`subject`、`date`、`body` は必須の表示用文字列で、`cc` は必要なメールだけに指定します。宛先が複数の場合は、作者が1つの文字列へまとめてください。日付は変換や自動ソートをせず、そのまま表示します。メールの一覧順は `contents` の記述順です。

```json
{
  "id": "notice_mail",
  "appId": "mail",
  "initialState": "repairable",
  "repairLabel": "破損したメール",
  "search": ["お知らせメール"],
  "record": {
    "from": "案内係",
    "to": "プレイヤー",
    "cc": "関係者",
    "subject": "お知らせ",
    "date": "2026年8月12日 19:40",
    "body": "メール本文"
  }
}
```

アルバムの動画は2種類です。従来の `still_video` は静止サムネイルと音声を組み合わせます。実際の映像を再生する場合は `video` と `videoUrl` を使い、`imageUrl`には任意のポスター画像を指定します。どちらも写真・動画選択からメッセージやチャットへ添付できます。

会話台本から実動画を添付する場合は、`attachments` に `type: "video"`、動画の `asset`、対応するアルバム項目の `content`、任意の画像attachmentを示す `poster` を指定します。画像・音声・動画attachmentとアルバム項目の対応はシナリオ生成時に作られ、会話内メディアからアルバム表示へ移動できます。

```json
{
  "title": "確認用動画",
  "mediaKind": "video",
  "imageUrl": "/media/poster.jpg",
  "videoUrl": "/media/sample.mp4",
  "tags": ["動画", "確認用"]
}
```

### 電話の字幕と書き起こし

`incomingCalls` の `transcript` は、着信へ応答した後に音声の再生位置と同期して表示する字幕です。着信履歴となる `phone` コンテンツにも同じ形式の `record.transcript` を指定でき、詳細画面で全文をスクロールして読めます。着信と履歴は独立した定義です。字幕や書き起こしが必要な方だけに `transcript` を指定し、省略した場合は音声だけを再生します。

```json
{
  "id": "scheduled_call",
  "name": "案内係",
  "audioUrl": "/audio/call.wav",
  "transcript": [
    { "atMs": 0, "text": "もしもし。" },
    { "atMs": 1200, "text": "確認したいことがあります。" }
  ]
}
```

`phone` コンテンツの `record.kind` には `incoming`、`missed`、`outgoing`、`voicemail` を指定できます。`voicemail` は履歴一覧で「留守番電話」と表示し、`audioUrl` と `transcript` の再生・書き起こし機能はほかの着信履歴と共通です。

```json
{
  "name": "案内係",
  "kind": "voicemail",
  "at": "19:48",
  "durationLabel": "18秒",
  "audioUrl": "/audio/voicemail.wav",
  "transcript": [
    { "atMs": 0, "text": "留守番電話の本文です。" }
  ]
}
```

`atMs` は音声開始からのミリ秒で、昇順に書きます。着信中の字幕同期には使いますが、履歴詳細の書き起こしにはタイムスタンプを表示せず、本文だけを順番に並べます。着信履歴へ案内する場合は、会話blockに `[着信履歴](open:phone:content_id)` のリンクを置けます。

### ブラウザ

`browser` コンテンツ1件を1つのタブとして表示します。URL入力や任意サイトへの移動はなく、`record.url` と `record.allowedUrls` に指定した同一オリジンのHTMLだけを開けます。HTML内のリンクを押すと同じタブ内に履歴が積まれ、端末上部の戻るボタンで戻れます。

```json
{
  "id": "guide_tab",
  "appId": "browser",
  "initialState": "normal",
  "search": ["案内ページ"],
  "record": {
    "title": "案内",
    "url": "/pages/guide-a8k3.html",
    "allowedUrls": ["/pages/details-p2m7.html"]
  }
}
```

表示するHTMLは `public` 以下へ置きます。未修復タブのURLはPlayerStateへ返りませんが、URLを知っていれば静的ファイルへ直接アクセスできます。未到達ページには作品ごとに推測されにくいファイル名を付けてください。iframe内ではスクリプト、フォーム送信、外部ページ、新しいウィンドウを使用できません。

## 状態条件による表示

`apps`、`contents`、`talks`、`todos`、`notifications`、`assistantMessages` には任意の `cond` を書けます。条件を満たさない項目はクライアントへ表示されず、検索やAPIの直接呼び出しでも利用できません。

`apps[].badgeCond` に条件式を書くと、条件を満たす間だけホームのアイコンへ未読ドットを表示します。メッセージ・チャットの通常の未読判定とはORで扱われます。作品固有の状態でバッジを点灯したい場合に使います。

```json
{
  "id": "chat",
  "initialState": "repairable",
  "cond": "clue_reported && !chat_auth_verified",
  "badgeCond": "new_chat_notice"
}
```

状態変数は、既定値だけを書く短縮形と、型を明示するobject形式のどちらでも宣言できます。選択肢を固定したい値には `enum` を使うと、条件式と `set` の誤記をビルド時に検出できます。

```json
{
  "stateVariables": {
    "clue_reported": false,
    "new_chat_notice": false,
    "visit_count": { "type": "integer", "initial": 0 },
    "chapter": { "type": "enum", "initial": "opening", "values": ["opening", "ending"] },
    "player_name": { "type": "string", "initial": "" }
  }
}
```

条件式では `!`、`&&`、`||`、`==`、`!=`、整数の大小比較、文字列またはenumに対する `=~` / `!~` の正規表現照合、括弧を使用できます。値だけを条件に書けるのはboolean変数です。`player_input` は会話ruleの `cond` で現在の送信内容を参照する予約変数で、`stateVariables`には宣言できません。ほかの表示条件では空文字として扱われます。

```text
clue_reported && visit_count >= 2
chapter == "ending"
player_input =~ /^(はい|了解)/u
```

表示条件は状態変数を更新した次の評価から反映されます。TSVの `set` は `chapter = "ending"` のように書きます。integer変数だけは整数literalによる`count += 1`と`count -= 1`も使えます。右辺の式・状態参照・`++`は使えません。`match` で抽出した文字列は、string変数に限り `player_name = $match.name` で代入できます。

作品固有Stageの表示に必要な状態だけは、最上位の `publicStateVariables` へ状態変数IDを列挙できます。公開値はPlayerStateの `projectState` へ入り、未指定の状態変数はクライアントへ返りません。正解、未到達本文、素材URLなどは公開対象にしないでください。未定義のIDや重複はscenario検証で拒否されます。

```json
{
  "publicStateVariables": ["presentation_started"]
}
```

制作中の既存プレイデータを開いた場合も、あとから追加した状態変数は宣言した既定値として評価され、talkは利用可能になった時点で作られます。一度消したToDoや通知は、シナリオ定義を再生成しても勝手に復活しません。

## 検索語

アプリ、コンテンツ、talkの `search` へ、プレイヤーが入力しそうな語句を列挙します。入力はNFKCで正規化し、プレイヤーの入力に検索語が含まれる場合に一致します。短い入力を長い検索語へ逆向きに一致させることはありません。

```json
{
  "id": "old_note",
  "appId": "notes",
  "initialState": "repairable",
  "repairLabel": "古▚▐▀▜メモ",
  "search": ["古いメモ", "ふるいメモ", "鍵"]
}
```

最上位の各要素はOR条件です。1つの候補へ複数語をすべて含めさせる場合だけ、内側を配列にします。

```json
{
  "search": ["古いメモ", ["駅前", "写真"]]
}
```

この例は「古いメモ」を含む入力、または「駅前」と「写真」の両方を含む入力へ一致します。コンテンツ自身の `cond` を満たしていれば、親アプリが未修復でも検索結果には現れます。その結果を開こうとした時は修復せず、まだ開けない旨を検索AIが返します。

`repairLabel` は修復前に表示する壊れた名称です。

検索AIの案内文、ヒント、検索結果の前後に出す台詞は、固定の`search_agent` talkとして`talk_blocks.tsv`と`talk_flow.tsv`へ記述します。固定の発見／未発見メッセージはなく、作品に合う文面をblockとして定義できます。検索実行と入力欄制御を含む書き方は[会話エンジン](conversation.md#検索ai-talk)を参照してください。

## ラジオの再生条件と音声cue

ラジオcontentの `record.playbackCond` が偽の間は音声情報をクライアントへ渡さず、`playbackDisabledLabel` を表示します。投稿フォームは `formDisabledCond` が真の間だけ無効になります。どちらの条件式もサーバーで評価され、条件式自体はクライアントへ公開されません。フォームhookでは照合済みの`event.formId`と`event.contentId`を直接参照し、入力値と`appId`は`event.fields`に入ります。

`record.transcript` を指定すると、ラジオ再生位置に同期した字幕を再生画面へ表示します。形式は着信字幕と同じ `{ "atMs": 0, "text": "..." }` の配列です。ラジオには全文書き起こし画面はありません。`transcript` は任意で、省略した番組は字幕欄を表示しません。

`audioCues` は `{ "id": "cue_name", "atMs": 25000 }` の配列です。authoringでは`{ "id": "cue_name", "at": "00:25" }`のように秒、`MM:SS`、`HH:MM:SS`を指定しても、build時に`atMs`へ正規化されます。クライアントには順番と時刻だけを渡し、到達通知を受けたサーバーが `cueId` と `cueTarget`（`content_id:cue_name`）を復元してhookへ渡します。hookはeventを`audio_cue_reached`、targetを`content_id:cue_name`とし、`event.cueId / cueTarget / cueIndex`を確認します。

固定音声と生成音声をつなぐ場合は、`audioSegments` に `{ "kind": "audio", "audioUrl": "/..." }` と `{ "kind": "generated", "genAudioId": "..." }` を並べます。生成音声の状態と再生URLは、ラジオ項目と着信履歴のどちらでもサーバー応答時に解決されます。

## チャット再認証

`chatAuthGate` の `cond` を満たす間、チャットは再認証画面を表示し、直接投稿も拒否します。`linkSentCond` は認証リンク発行済みの表示に使います。リンク発行はcustom event、認証完了は`message_link_opened` hookで書きます。デモの `send_chat_auth_link` と `verify_chat_auth` が一巡例です。

## hook

`scenario.json` で発火条件を宣言し、選択するシナリオディレクトリの`hooks.ts`に同名の処理を書きます。例えば`XSTORYPHONE_SCENARIO_DIR=scenario/my-story`なら`scenario/my-story/hooks.ts`を使います。hookを宣言しないシナリオでは、このファイルを省略できます。hookの宣言と実装のIDが一致しない場合はビルドエラーになります。ビルド時に選択したhook moduleだけをWorkerへ静的に組み込み、未選択シナリオのhookは配布物へ含めません。

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

このほか、`clientCallableEvents`や予約処理から呼ぶ作品固有event IDを定義できます。廃止済みの`talk_sent`と`scenario_event`は使用できません。

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

作品固有UIから `ProjectStageContext.dispatchScenarioEvent` で呼ぶcustom eventだけは、シナリオ最上位の `clientCallableEvents` へevent IDを指定します。同じevent名のhookが通常どおり評価されます。音声再生完了、音声cue、着信完了、破損リンク通知はコアUIの標準eventなので指定不要です。予約イベント、メッセージ内リンク、フォーム送信にも指定は不要です。

```json
{
  "clientCallableEvents": ["chat_auth_link_requested"]
}
```

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
