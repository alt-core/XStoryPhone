# シナリオ作成

シナリオデータの原本は、次の3ファイルです。

- `scenario/demo/scenario.json`: 端末、アプリ、コンテンツ、状態、通知、hook
- `scenario/demo/authoring/talk_blocks.tsv`: 会話本文、添付、遅延、更新日、出典
- `scenario/demo/authoring/talk_flow.tsv`: メッセージとチャットの会話分岐

`npm run scenario:build` は原本を検証し、クライアント用とWorker用のデータを生成します。内部IDから公開IDも同時に生成するため、生成済みファイルを手で編集しないでください。

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

標準で使えるアプリIDは次の7つです。

- `phone`
- `messages`
- `notes`
- `photos`
- `calendar`
- `radio`
- `chat`

`messages` と `chat` の中身は、`talks`、`talkPeople`、`attachments` と2つのTSVで定義します。それ以外は `contents[].record` に、そのアプリの表示データを書きます。具体的な最小例はデモシナリオを参照してください。

`notes` と `photos` の `record` には、任意で `tags` を指定できます。タグは記述順に詳細表示へ並び、多い場合は横へスクロールします。絞り込みには使いません。

```json
{
  "title": "駅前で見つけた写真",
  "imageUrl": "/demo/photo.svg",
  "tags": ["駅前", "手がかり"]
}
```

## 状態条件による表示

`apps`、`contents`、`talks`、`todos`、`notifications`、`assistantMessages` には任意の `cond` を書けます。条件を満たさない項目はクライアントへ表示されず、検索やAPIの直接呼び出しでも利用できません。

```json
{
  "id": "chat",
  "initialState": "repairable",
  "cond": "clue_reported && !chat_auth_verified"
}
```

条件式では状態変数、`!`、`&&`、`||`、`==`、`!=`、括弧を使用できます。表示条件はhookで状態変数を更新した直後に再評価されます。

作品固有Stageの表示に必要な状態だけは、最上位の `publicStateVariables` へ状態変数IDを列挙できます。公開値はPlayerStateの `projectState` へ入り、未指定の状態変数はクライアントへ返りません。正解、未到達本文、素材URLなどは公開対象にしないでください。未定義のIDや重複はscenario検証で拒否されます。

```json
{
  "publicStateVariables": ["presentation_started"]
}
```

制作中の既存プレイデータを開いた場合も、あとから追加した状態変数は宣言した既定値として評価され、talkは利用可能になった時点で作られます。一度消したToDoや通知は、シナリオ定義を再生成しても勝手に復活しません。

## 検索語

アプリとコンテンツの `search` へ、プレイヤーが入力しそうな語句を列挙します。検索語は部分一致です。

```json
{
  "id": "old_note",
  "appId": "notes",
  "initialState": "repairable",
  "repairLabel": "古▚▐▀▜メモ",
  "search": ["古いメモ", "ふるいメモ", "鍵"]
}
```

`repairLabel` は修復前に表示する壊れた名称です。

`searchResponses` では、検索結果の有無を示す `when`、任意の検索語 `search`、状態条件 `cond`、返答本文を上から順に定義します。`suppressResults: true` は「ヒント」のように返答だけを表示する場合に使います。該当定義がなければ標準の発見／未発見メッセージを返します。

## チャット再認証

`chatAuthGate` の `cond` を満たす間、チャットは再認証画面を表示し、直接投稿も拒否します。`linkSentCond` は認証リンク発行済みの表示に使います。リンク発行と認証完了の状態更新は通常のscenario event hookで書きます。デモの `send_chat_auth_link` と `verify_chat_auth` が一巡例です。

## hook

`scenario.json` で発火条件を宣言し、`src/project/hooks.ts` に同名の処理を書きます。

利用できるイベントは次の通りです。

- `session_started`
- `content_repaired`
- `content_opened`
- `content_unlocked`
- `talk_sent`
- `scenario_event`

hookからは、状態変数、コンテンツ、アプリ、会話block、ToDo、予約、着信、生成音声、終了演出を操作できます。外部サービスを使う生成音声ジョブはserverモード向けです。`context.talk.addBlock(talkId, blockId)` はTSVのblockをそのまま追加するため、リンク・添付・表示間隔も保持します。作品固有の処理はhookへ置き、汎用Workerへ条件分岐を増やさない方針です。

`context.schedule.after` で後続のscenario eventを予約でき、次の予定時刻はクライアントへ返されます。予約するevent IDには、同じtargetを持つ `scenario_event` hookを明示的に定義してください。`context.incomingCall.show` で `incomingCalls` に定義した着信を表示できます。通話完了時はコアが表示中の着信を閉じ、その後 `incoming_call_completed` eventをhookへ渡します。デモの `schedule_demo_call` と `show_demo_call` が最小例です。

`schedule.after` のschedule IDは、一度の予約を識別する使い切りIDです。完了したIDの再予約は保存モードをまたいで保証されないため、同じ処理をもう一度予約するときは新しいIDを使ってください。

作品固有UIから `ProjectStageContext.dispatchScenarioEvent` で呼ぶイベントだけは、シナリオ最上位の `clientCallableEvents` へtargetを指定します。許可はイベント単位で、同じtargetに対応する `scenario_event` hookはすべて通常どおり評価されます。音声再生完了、音声cue、着信完了、破損リンク通知はコアUIの標準イベントなので指定不要です。予約イベント、メッセージ内リンク、フォーム送信にも指定は不要です。

```json
{
  "clientCallableEvents": ["chat_auth_link_requested"]
}
```

音声完了、音声cue到達、通話完了などの背景eventと、予定時刻の状態取得は、一時的な通信失敗時に限定回数だけ再送されます。予定eventは失敗時に同じ行を再利用して待機へ戻り、実行中のまま5分以上経過した場合も再実行対象になります。

一度だけ行う処理には専用の状態変数を用意し、hookの `cond` が実行後に偽になるようにしてください。会話追加、予定登録、生成音声準備などの副作用も同じhook内で行います。外部providerの処理は再実行される可能性があるため、同じ入力を冪等に扱ってください。再送に失敗した場合はゲーム外エラー画面からリロードして復旧します。

## 検証

```sh
npm run scenario:validate
npm run scenario:build
```

LLMを無効にしたシナリオへ自然文criteriaやmatch抽出を書いた場合も、ここでエラーになります。
通常の `npm run check` では、未到達本文を持つWorkerシナリオがクライアントのimport経路へ入っていないことも検査します。
