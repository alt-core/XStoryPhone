# 会話エンジン

メッセージ、チャット、検索AIは同じ会話エンジンを使います。本文は `talk_blocks.tsv`、分岐は `talk_flow.tsv` に記述し、台本と分類条件を分けて監修できます。

serverモードの会話履歴は、プレイヤー入力だけを本文として保存し、シナリオ発話は展開済み本文ではなくblock ID、blockが参照したtemplate値、表示時刻を保存します。PlayerState生成時に現在の `talk_blocks.tsv` から発話を復元するため、固定台詞をプレイヤーごとに複製しません。初期blockは履歴eventへ保存せず、scenarioから直接表示します。

templateから参照した文字列・数値・boolean・enumは、発話時の表示値を文字列としてeventへ保存します。serverモードでは会話本文と復元規則から作るtranscript revisionが変わると端末側の会話cacheを再取得し、現在の台本で復元し直します。browserモードはprivate台本を端末へ渡さないため、到達時に展開された表示cacheをそのまま維持します。

browserモードでは、発話blockを追加した同じAPI処理で、そのtalkを`cond`により非表示へ変えないでください。同時に期限到来eventを処理する場合も、一つのAPI処理として扱います。非表示中の本文を先にクライアントへ渡さず、後から再表示した時の履歴も欠落させないため、実行時にもこの組み合わせを拒否します。talkを閉じる必要がある場合は、発話を表示した後の別eventで状態を変えてください。発話を伴わない一時的な非表示と再表示は利用できます。

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
| `quick_replies` | 改行区切りの返信候補。NPC側blockの最後の発話だけに指定可能 |
| `updated_at` | 監修画面で使う更新日（`YYYY-MM-DD`） |
| `source` | `human`、`ai`、`ai_edited`。省略時は未分類 |

本文には `[表示名](open:notes:content_id)` のような内部リンクと、HTTPSの外部リンクを書けます。内部リンクへhookを結び付ける場合は、`open:app_id:content_id;action:action_id` とし、`message_link_opened`のtargetへaction IDを指定します。`{{state_id}}` templateは通常の本文で使い、リンクの表示名には使用しないでください。リンク表示名はtemplate展開されません。

`attachments` で `lock: "password"` を指定すると、会話内にパスワード入力付きの添付を表示できます。答えは対象contentの `record.unlockCode` に書きますが、生成されるクライアントデータからは自動的に除外されます。

`quick_replies`はセル内改行で選択肢を並べます。表示文字列がそのままプレイヤー発話として送信され、通常の会話ruleで判定されます。本文と同じ`{{state_id}}` templateを使用できます。Quick Reply固有の個数・20文字制限は設けず、空の選択肢、同一message内の重複、定義時点で既存プレイヤー入力上限を超える文字列を拒否します。template展開結果は正規化後に同じ上限へ収めます。

### talk全体の修復

`talks[]` に `initialState` を指定すると、メッセージまたはチャットのルーム全体を検索・修復対象にできます。省略時は `normal` です。

```json
{
  "id": "damaged_room",
  "kind": "sms",
  "appId": "messages",
  "label": "調査担当",
  "avatarUrl": "/avatars/investigator.svg",
  "initialState": "repairable",
  "repairLabel": "調▚▐▀▜当",
  "search": ["調査担当", "壊れた連絡"],
  "startBlocks": ["old_messages", "start"]
}
```

- `repairable`: 壊れた名称と履歴を持つルームとして一覧に表示し、検索結果を開くと本来の名称・全初期履歴・投稿状態をまとめて復元します。
- `hidden`: 修復前はルームの存在自体を一覧へ出さず、検索結果を開いた後に表示します。
- `normal`: 通常表示です。

正解の検索語へ到達する前に、本来の名称、avatar URL、初期発話、添付、リンクはクライアントへ送りません。`content_repaired` と `content_opened` のhook targetにはtalk IDを指定できます。`content_repaired`は修復時、`content_opened`は修復hookがeffect sequenceで後続処理を終了した場合を除き、利用可能なtalkを開くたびにシナリオで定義したtalk IDで発火します。talk全体の修復と、次項の初期履歴block修復は同じtalkで併用できません。

`cond` が偽の間は破損ルームと検索結果のどちらも出ません。`cond` を満たしても親アプリが未修復なら検索候補だけを提示でき、ルームを開く操作は親アプリが利用可能になるまで拒否します。

`startBlocks` はblock IDの配列です。初期block単位の `cond` は仕様にありません。talk全体の表示条件には `talks[].cond` を使います。

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

通常の分岐とは別のeventから台本を追加する場合は、hookで `context.talk.addBlock("guide", "block_id")` を呼びます。本文をコードへ重複させず、同じblockを監修画面でも確認できます。指定できるのは、そのtalkに属する非repeat blockのうち、repeat派生を含む全表示でtemplateを状態変数だけから解決できるものです。template値は、この呼出時点で固定されます。別talkのblockや、会話入力から抽出したmatch値を必要とするblockは`npm run check`の型検査で拒否されます。

`addBlock`は既定で、talk flowの通常遷移と同じく、履歴へblockを追加してから`from`をそのblockへ進め、`turnKey`を更新します。その後もプレイヤーの返信を受け付ける場合は、追加先blockを`from`にしたdefault ruleを書いてください。talk flowの`mode=stay`と同じく現在位置を保つ場合は、`context.talk.addBlock("guide", "block_id", { mode: "stay" })`とします。

複数のhookから同じblockを使う場合も、それぞれの追加を履歴へ保存し、表示回数に応じたrepeat本文を使います。一度だけ実行するhookは、実行後に`cond`が偽になる状態変数で制御してください。

## 入力欄とQuick Reply

メッセージ／チャットの下書き（本文・写真・共有）と送信エラーは会話ごとに保持します。同じアプリ内で会話を切り替えても、送信に失敗した内容が別の相手の入力欄へ移ることはありません。下書きは表示中アプリのメモリだけに置くため、ホーム・別アプリ・ロック画面への移動やリロードで破棄されます。

各talkには、自由入力composerの表示と、talkへの入力許可を独立して設定できます。省略時はどちらも`true`です。

```json
{
  "inputVisible": false,
  "inputEnabled": true
}
```

- `inputVisible`: テキスト、写真・動画、共有、送信buttonを含むcomposer一式を表示するか。Quick Replyには影響しません。
- `inputEnabled`: 通常入力、添付、共有、Quick Replyを受理するか。

`visible=false / enabled=true`ではcomposerを隠し、Quick Replyだけで進行できます。`enabled=false`ではQuick Replyを消し、composerがvisibleならdisabled表示にします。enableへ戻すと、最新メッセージに付いたQuick Replyが再表示されます。enableしても、未修復talk、チャット再認証中、現在fromに有効ruleがないtalkは投稿可能になりません。

`talk_flow.tsv`の`next`では、全talkで次を使用できます。

```text
/input hide
案内block
/input show
```

```text
/input disable
案内block
/input enable
```

show／enableは直前までの遅延発話が表示された後に反映します。hide／disableは応答反映時に即時適用します。hookから変更する場合は`context.talk.showInput / hideInput / enableInput / disableInput`を使います。入力制御だけではfromとturnKeyを変更しません。

`mode=game_over`の返信は通常履歴へ保存しない一時表示なので、`/input`とは併用できません。game over後も入力状態を変える必要がある場合は、その前の通常ruleまたはhookで明示してください。

Quick Replyはそのtalkの最新itemに付いたものだけを、対応する発話の直後へ横スクロール可能なbuttonとして表示します。タッチ、トラックパッド、スクロールバーに加え、PCでは候補列をマウスで左右へドラッグできます。新しいowner発話、NPC発話、検索結果cardが届くと以前の候補は消えます。最新のQuick Reply付き発話がdelay待機中なら、その発話が表示されるまで候補も表示しません。reload時は履歴から復元し、専用の消費済みstateやDBは持ちません。

Quick Replyは入力補助であり、serverの選択肢allowlistではありません。composerをhideしても、enabledである限りtalk API自体は通常テキストを受理します。厳密な入力制限にはdisableと会話ruleを使ってください。UI文法はLINEの[クイックリプライ](https://developers.line.biz/ja/docs/messaging-api/using-quick-reply/)を参考にしていますが、LINE固有のaction種別や個数制限は実装しません。

ラジオなど別アプリの共有先一覧は、遅延発話の途中表示ではなく、応答後の最終`inputVisible`／`inputEnabled`に従います。選んだ共有内容はtalkへ移動した後も保持され、composerの表示境界へ到達するまで送信されません。

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
| `next` | 表示するblock、全talk共通の`/input`、または検索AI用command。複数はセル内で改行し、通常遷移では最後の無条件blockが次のfromになる |
| `set` | `;` 区切りの状態更新 |
| `mode` | 空欄、`stay`、`game_over` |
| `notes` | 監修用メモ |
| `example` | 代表入力 |

`intent` と `match` がともに空の行がdefault ruleです。各fromにはdefault ruleがちょうど1件必要です。default行の`criteria`は候補条件ではなく、LLMへ渡す現在場面の説明です。`{{state_id}}`を使えます。LLMを使うfromでは通常ruleの`intent / criteria / example`とdefaultの`example`を記述します。正規表現だけのfromではLLM用exampleを強制しません。`stay`はfromを動かさず、`game_over`は返信blockを履歴へ保存せず一時表示して、内部のgame-over effect sequenceへ移ります。

## 検索AI talk

検索AIは、`scenario.json`の`talks`へ固定IDのtalkを1件だけ定義します。名称と発話者は`project.assistantName`から生成されるため、`label`や`talkPeople`の`search_agent`は指定しません。

```json
{
  "id": "search_agent",
  "kind": "search_agent",
  "startSteps": ["/input hide", "intro", "/input show"]
}
```

本文は`talk_blocks.tsv`の`*search_agent`以下へ、分岐は通常どおり`talk_flow.tsv`へ書きます。検索AI発話は`sender=search_agent`の本文、`[表示名](open:app_id:content_id)`形式の内部リンク、Quick Replyを扱います。添付、HTTPSの外部リンク、固定の`time`は指定できません。内部リンクは実際に発話が表示された時だけ利用可能になり、同じblockを繰り返しても進行token内の権限は増殖しません。serverモードで公開後に表示済みのbase blockへリンクを追加した場合は、現在台本から本文を復元する既存契約に合わせて権限も補完します。後から追加・変更したrepeat variantと、到達済み本文をIndexedDBへ保持するbrowserモードのリンクは、未表示情報を与えないため再表示後に有効になります。`startSteps`ではblockと`/input`だけを使えます。

検索AIの`next`は、セル内で改行した次のstepを上から順に実行します。

| step | 内容 |
|---|---|
| `block_id` | 通常の発話blockを追加する |
| `/search {{player_input}}` | templateを展開した語で端末内検索し、結果カードを追加する |
| `/input show` / `hide` / `enable` / `disable` | composer表示と入力許可を変更する。全talk共通 |
| `/if (condition) block_id` | 条件を満たす場合だけ発話blockを追加する |

`/if`では、条件全体を囲む外側の括弧が必須です。その閉じ括弧より後ろをblock IDとして扱うため、条件内では通常どおり括弧、文字列、正規表現を使用できます。

一つの`next`で`/search`を使えるのは1回です。検索は表示順にかかわらず先に一度だけ評価され、同じ`next`の`/if`とblock templateでは`search_found`（boolean）と`search_result_count`（integer）を参照できます。これらは一時値であり、`stateVariables`には宣言せず、`/search`のない`next`からは参照できません。検索queryでは状態変数、抽出値、現在の入力を表す`player_input`をtemplateに使えます。

```text
/if (search_found) found
/if (!search_found) not_found
/search {{player_input}}
```

ヒントのように検索結果を出さない分岐は、通常の正規表現ruleで案内blockだけを返し、`mode=stay`にします。検索AIでは`mode=game_over`を使えません。`mode`を空欄にしてfromを進める場合は、`next`の最後を無条件のblockにしてください。`/`から始まるblock IDはcommandとの区別が付かないため使用できません。

検索入力もメッセージやチャットと同じtalk送信APIで処理します。検索専用APIと独立した検索履歴はなく、発話、入力、検索結果カードは固定の`search_agent` talkへ順番に追加されます。保存量が増え続けないよう、`search_agent`だけは入力・発話・結果カードを合わせた直近200表示項目を保持します。

hookから台本進行と無関係な検索結果を追加する場合は、`context.talk.search("search_agent", query)`を使います。検索結果は同じ`search_agent` talkへ追加され、台本発話や入力欄の状態は変更しません。

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

`LLM_REASONING_EFFORT` は利用する互換providerが対応している場合だけ明示設定します。未設定時は、Gemini 2.5系またはFlash-Lite系の非Proへ`none`、その他のGemini 3系へ`minimal`を安全な既定値として送り、それ以外のmodelには送りません。明示値はこの既定より優先されます。

provider境界は `completeJson` だけです。会話エンジンは、その上に「自然文criteriaの選択」と「matchの抽出」を載せています。別providerへ切り替える場合は `src/worker/providers/structuredOutput.ts` の生成部分だけを差し替えます。

自然文criteriaの判定には現在の入力に加えて直前4件までの会話を渡し、短い肯定・否定や指示語の文脈だけを補います。confidenceが0.65未満ならdefaultへ倒し、`game_over` は誤判定を避けるため0.9以上を必要とします。providerの一時的な通信失敗は1回だけ再試行し、長い再試行で送信画面を止め続けない設計です。

正規表現ruleはLLMより先に評価されるため、確実に判定できる入力は正規表現へ寄せると、速度と再現性を保てます。

hookの`llm.match`は`fast / super / ultra` profileと`stable / once`を選べます。`stable`は最初の2標本を並行取得して最大5標本から合意を探し、`once`は1標本ずつ評価して最初に採用可能な値を使います。いずれも壊れた応答だけなら障害として扱い、正常な候補が合意しない場合は、fallbackがあればそれを使い、なければエラーにします。fastだけ通常の`LLM_MODEL`へfallbackし、super/ultraは対応するprofile modelが未設定なら利用不能です。serverモードでは同じplayer・model・input・prompt・schemaの成功結果とfallbackを既定30日cacheし、browserモードでは同じHTTP request内だけ再利用します。

`LLM_ANALYTICS_ENABLED=true`では本文を含まないtoken usage・試行回数・hashを構造化logへ出します。`LLM_DEBUG_LOGS=true`では入力・prompt・schema・応答も出るため、調査中だけ有効にし、公開環境では調査後にfalseへ戻してください。API keyやAuthorization headerはdebugにも出しません。

## 制作確認コマンド

```sh
npm run scenario:talk-flow:path-dump -- --talk=guide
npm run scenario:talk-flow:writer-review -- --talk=guide
npm run scenario:talk-flow:examples:test
```

path dumpはfrom・example・nextの連結、writer reviewは全体の読み順とrepeat・独立block、example testは選択中scenarioの全exampleをlocal mockで確認します。実LLMを呼ぶ場合だけ、example testへ`--live`と表示される長い課金確認flagを明示します。
