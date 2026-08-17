# 会話エンジン

メッセージとチャットは同じ会話エンジンを使います。本文は `talk_blocks.tsv`、分岐は `talk_flow.tsv` に記述し、台本と分類条件を分けて監修できます。

## 会話block

`talk_blocks.tsv` では、`*talk_id` でtalkを開始し、名前を書いた行でblockを開始します。空の`comment`セルを持つ行が発話です。1つのblockへ複数の発話を書けます。

`---` の後に書いた発話は、直前blockの2回目以降の表示に使います。繰り返しが複数あれば順に使い、最後の差分まで到達した後は最後を繰り返します。

| 列 | 内容 |
|---|---|
| `sender` | `scenario.json` の `talkPeople[].id` |
| `body` | 本文。`{{name}}` 形式で状態値や抽出値を参照可能 |
| `attachment` | `scenario.json` の `attachments[].id` |
| `time` | 初期履歴に表示する時刻 |
| `delay_ms` | 相手側発話を順に表示する待ち時間 |
| `updated_at` | 監修画面で使う更新日（`YYYY-MM-DD`） |
| `source` | `human`、`ai`、`ai_edited`。省略時は未分類 |

本文には `[表示名](open:notes:content_id)` のような内部リンクと、HTTPSの外部リンクを書けます。内部リンクへscenario eventを結び付ける場合は、`open:app_id:content_id;action:action_id` とします。

`attachments` で `lock: "password"` を指定すると、会話内にパスワード入力付きの添付を表示できます。答えは対象contentの `record.unlockCode` に書きますが、生成されるクライアントデータからは自動的に除外されます。

### 初期履歴blockの修復

`messages` または `chat` のtalkでは、`startBlocks` に含まれるblockをメールやメモと同じ `contents` の修復対象として定義できます。未修復のblock本文、送信者、添付、リンクはクライアントへ送りません。連続する未修復blockは、会話履歴内で一つの「履歴データが破損しています」表示へまとまります。

```json
{
  "id": "damaged_history",
  "appId": "messages",
  "initialState": "repairable",
  "repairLabel": "破損した履歴",
  "search": ["過去の連絡"],
  "record": {
    "talk": "guide",
    "block": "old_history"
  }
}
```

`record.talk` は対象talkのID、`record.block` はそのtalkの `startBlocks` に一度だけ含まれるblock名です。一つのblockを複数のcontentから修復することはできません。過去履歴として同じ時刻へ復元できるよう、対象blockの全メッセージで `time` を指定してください。

検索結果から開くとblock内のメッセージを元の位置へ復元し、対象talkを開いて復元blockの先頭を表示します。途中の分岐で追加されるblockとrepeat blockは修復対象にできません。

写真や動画を会話分岐へ使う場合は、シナリオ最上位の `photoDescriptions` に `content id: 説明` を定義します。この説明は会話判定と監修UIだけで使われ、アルバム表示やクライアントデータには含まれません。未定義時は写真タイトルを使った一般的な添付説明になります。

通常の分岐とは別のscenario eventから台本を追加する場合は、hookで `context.talk.addBlock("guide", "block_id")` を呼びます。本文をコードへ重複させず、同じblockを監修画面でも確認できます。

## 選択順序

1. `from` が現在地点または `*` で、`cond` を満たすruleだけに絞る。
2. `/.../flags` 形式の `criteria` を上から正規表現照合する。
3. 自然文criteriaが残っている場合だけ、semantic selectorへ問い合わせる。
4. どれにも一致しなければ、そのfromのdefault ruleを選ぶ。

`features.llm` が `false` なら、非default ruleをすべて正規表現で書けます。外部APIキーは不要です。

## TSVの列

| 列 | 内容 |
|---|---|
| `talk` | `scenario.json` のtalk ID |
| `from` | 現在のblock。`*` は全地点で使う共通分岐 |
| `cond` | 状態変数による条件 |
| `intent` | 監修画面で見る分岐名 |
| `criteria` | 正規表現、またはLLMへ渡す自然文条件 |
| `match` | LLMで抽出する値のJSON object |
| `next` | 表示するblock。複数はセル内で改行し、最後のblockが次のfromになる |
| `set` | `;` 区切りの状態更新 |
| `mode` | 空欄、`stay`、`game_over` |
| `notes` | 監修用メモ |
| `example` | 代表入力 |

`intent` と `match` がともに空の行がdefault ruleです。各fromにはdefault ruleがちょうど1件必要です。`stay` はfromを動かさず、`game_over` は返信blockを一時表示してゲームオーバーUIへ移ります。

`photo:content_id` と `share:content_id` は、アルバム添付とラジオ項目共有の入力です。正規表現ruleにはこの内部ID形式を渡し、LLMへは写真の `photoDescriptions` または共有項目のタイトルを使った説明文を渡します。

### matchによる値抽出

`match` の最小形は、抽出値IDをrule本文へ対応させたJSON objectです。

```json
{ "name": "プレイヤーが名乗った人名。推測できない場合はnull" }
```

同じ値が複数回の抽出で一致した時だけ採用するのが既定です。表記揺れを許容し、複数候補のうち合意が多い値を採る項目はobject形式で指定できます。

```json
{
  "name": { "rule": "名乗った人名", "pick": "same", "null": "no" },
  "reading": { "rule": "名前の読み", "pick": "best", "null": "weak" }
}
```

`pick` は `same` または `best`、`null` は `no`、`ok`、`weak` です。抽出は最初の2回を並行実行し、合意しなければ最大5回まで確認します。全応答が壊れていればprovider障害、正常な候補間で合意できなければその地点のdefault ruleとして扱います。`set` から参照する値が確定できない場合もdefaultへ倒れます。

## LLMを使う場合

`scenario.json` の `features.llm` を `true` にし、ローカルでは `.dev.vars`、公開時はデプロイ先の環境変数またはsecretへ次を設定します。

```dotenv
LLM_API_KEY=...
LLM_MODEL=...
LLM_BASE_URL=https://api.openai.com/v1
LLM_TIMEOUT_MS=15000
LLM_REASONING_EFFORT=low
```

`LLM_REASONING_EFFORT` は利用する互換providerが対応している場合だけ設定します。未設定なら送信しません。

provider境界は `completeJson` だけです。会話エンジンは、その上に「自然文criteriaの選択」と「matchの抽出」を載せています。別providerへ切り替える場合は `src/worker/providers/structuredOutput.ts` の生成部分だけを差し替えます。

自然文criteriaの判定には現在の入力に加えて直前4件までの会話を渡し、短い肯定・否定や指示語の文脈だけを補います。confidenceが0.65未満ならdefaultへ倒し、`game_over` は誤判定を避けるため0.9以上を必要とします。providerの一時的な通信失敗は1回だけ再試行し、長い再試行で送信画面を止め続けない設計です。

正規表現ruleはLLMより先に評価されるため、確実に判定できる入力は正規表現へ寄せると、速度と再現性を保てます。
