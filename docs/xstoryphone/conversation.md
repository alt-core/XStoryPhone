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
| `sender` | `talk_people.tsv` の `id` |
| `body` | 本文。`{{name}}` 形式で状態値や抽出値を参照可能 |
| `attachment` | `attachments.tsv` の `id` |
| `time` | 初期履歴に表示する時刻 |
| `delay_ms` | 相手側発話を順に表示する待ち時間 |
| `quick_replies` | 改行区切りの返信候補。NPC側blockの最後の発話だけに指定可能 |
| `updated_at` | 監修画面で使う更新日（`YYYY-MM-DD`） |
| `source` | `human`、`ai`、`ai_edited`。省略時は未分類 |

`talk_people.role`は`owner`、`npc`、`system`を指定できます。`system`は`npc`と同じ相手側の発話として表示し、専用のシステム通知UIにはなりません。

本文には `[表示名](open:notes:content_id)` のような内部リンクと、HTTPSの外部リンクを書けます。内部リンクへhookを結び付ける場合は、`open:app_id:content_id;action:action_id` とし、`message_link_opened`のtargetへaction IDを指定します。`{{state_id}}` templateは通常の本文で使い、リンクの表示名には使用しないでください。リンク表示名はtemplate展開されません。

内部リンクは表示済みであることを確認してからhookを実行し、その結果で遷移先の利用可否を判定します。hookで対象を解放してから開くことができます。hookが成立しても対象が開けない場合は、状態更新と演出だけを適用して現在の画面に留まります。`form.deny`による拒否ではhookの変更を保存しません。

`attachments.tsv` の `lock` を `password` にすると、メッセージアプリ内にパスワード入力付きの添付を表示できます。答えは `passwords.tsv` の `password`に、引用符付き候補を改行して書きます。`content`で対象を、`load_part`で正解後の追加取得先を指定します。server/browserではAPI側で判定し、staticでは部分hashと回答JSONを使います。正答原文はプレイヤーへ配布しません。

`quick_replies`はセル内改行で選択肢を並べます。表示文字列がそのままプレイヤー発話として送信され、通常の会話ruleで判定されます。本文と同じ`{{state_id}}` templateを使用できます。Quick Reply固有の個数・20文字制限は設けず、空の選択肢、同一message内の重複、定義時点で既存プレイヤー入力上限を超える文字列を拒否します。template展開結果は正規化後に同じ上限へ収めます。

### talk全体の修復

`message_items.tsv` または `chat_items.tsv` の `initial` を指定すると、ルーム全体を検索・修復対象にできます。空欄は通常表示です。例えば `id=damaged_room`、`name=調査担当`、`initial=repairable`、`repair_label=調▚▐▀▜当` とし、`search` へ検索語、`start` へ初期block名をセル内改行で並べます。`avatar` は任意の素材pathです。

- `repairable`: 壊れた名称と履歴を持つルームとして一覧に表示し、検索結果を開くと本来の名称・全初期履歴・投稿状態をまとめて復元します。
- `hidden`: 修復前はルームの存在自体を一覧へ出さず、検索結果を開いた後に表示します。
- `normal`: 通常表示です。

正解の検索語へ到達する前に、本来の名称、avatar URL、初期発話、添付、リンクはクライアントへ送りません。`content_repaired` と `content_opened` のhook targetにはtalk IDを指定できます。`content_repaired`は修復時、`content_opened`は修復hookがeffect sequenceで後続処理を終了した場合を除き、利用可能なtalkを開くたびにシナリオで定義したtalk IDで発火します。talk全体の修復と、次項の初期履歴block修復は同じtalkで併用できません。

`cond` が偽の間は破損ルームと検索結果のどちらも出ません。既定では、`cond` を満たしても親アプリが未修復なら検索候補だけを提示でき、ルームを開く操作は親アプリが利用可能になるまで拒否します。作品設定の `content.repair_parent_app=true` を使うと、検索済みのルームを開く操作で親アプリも修復できます。条件とhookの順序は[検索語と修復の説明](scenario.md#検索語)を参照してください。

`start` はセル内改行でblock IDを並べます。空欄なら初期履歴と返答待ち位置を持ちません。初期block単位の `cond` は仕様にありません。talk全体の表示条件には同じitem行の `cond` を使います。

### 初期履歴blockの修復

`messages` または `chat` のtalkでは、`start` に含まれるblockを `talk_history.tsv` で修復対象にできます。未修復のblock本文、送信者、添付、リンクはクライアントへ送りません。連続する未修復blockは、会話履歴内で一つの「履歴データが破損しています」表示へまとまります。

例えば `id=damaged_history`、`talk=guide`、`block=old_history`、`initial=repairable`、`repair_label=破損した履歴`、`search=過去の連絡` とします。

`talk` は対象talkのID、`block` はそのtalkの `start` に一度だけ含まれるblock名です。一つのblockを複数のcontentから修復することはできません。過去履歴として同じ時刻へ復元できるよう、対象blockの全メッセージで `time` を指定してください。

検索結果から開くとblock内のメッセージを元の位置へ復元し、対象talkを開いて復元blockの先頭を表示します。途中の分岐で追加されるblockとrepeat blockは修復対象にできません。

写真や動画を会話分岐へ使う場合は、`photo_items.tsv` の `description` に説明を書きます。この説明は会話判定と監修UIだけで使われ、アルバム表示やクライアントデータには含まれません。未定義時は写真タイトルを使った一般的な添付説明になります。

通常の分岐とは別のeventから台本を追加する場合は、hookで `context.talk.addBlock("guide", "block_id")` を呼びます。本文をコードへ重複させず、同じblockを監修画面でも確認できます。指定できるのは、そのtalkに属する非repeat blockのうち、repeat派生を含む全表示でtemplateを状態変数だけから解決できるものです。template値は、この呼出時点で固定されます。別talkのblockや、会話入力から抽出したmatch値を必要とするblockは`npm run check`の型検査で拒否されます。

`addBlock`は既定で、talk flowの通常遷移と同じく、履歴へblockを追加してから`from`をそのblockへ進め、`turnKey`を更新します。その後もプレイヤーの返信を受け付ける場合は、追加先blockを`from`にしたdefault ruleを書いてください。talk flowの`mode=stay`と同じく現在位置を保つ場合は、`context.talk.addBlock("guide", "block_id", { mode: "stay" })`とします。

複数のhookから同じblockを使う場合も、それぞれの追加を履歴へ保存し、表示回数に応じたrepeat本文を使います。一度だけ実行するhookは、実行後に`cond`が偽になる状態変数で制御してください。

## 入力欄とQuick Reply

メッセージ／チャットの下書き（本文・写真・共有）と送信エラーは会話ごとに保持します。同じアプリ内で会話を切り替えても、送信に失敗した内容が別の相手の入力欄へ移ることはありません。下書きは表示中アプリのメモリだけに置くため、ホーム・別アプリ・ロック画面への移動やリロードで破棄されます。

各talkのitem行の `input_visible` と `input_enabled` で、自由入力composerの表示と、talkへの入力許可を独立して設定できます。空欄はどちらも`true`です。検索AIはproject_constantsの `search_agent.input_visible / search_agent.input_enabled` を使います。

- `input_visible`: テキスト、写真・動画、共有、送信buttonを含むcomposer一式を表示するか。Quick Replyには影響しません。
- `input_enabled`: 通常入力、添付、共有、Quick Replyを受理するか。

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
2. `type=match / secret`を相互の原本順で照合する。
3. 一致せず`type=ai`の候補がある場合だけ、AIへ問い合わせる。
4. どれにも一致しなければ、そのfromのdefault ruleを選ぶ。

`features.llm` が `false` でも、match・secret・正規表現抽出を使えます。外部APIキーは不要です。

## TSVの列

| 列 | 内容 |
|---|---|
| `talk` | `message_items / chat_items` のID、または固定ID `search_agent` |
| `from` | 現在のblock。`*` は全地点で使う共通分岐 |
| `cond` | 状態変数による条件 |
| `intent` | 監修画面で見る分岐名 |
| `type` | `context`、`match`、`secret`、`ai`、`default`。省略・継承しない |
| `text` | 場面説明または判定条件 |
| `extract` | 名前付き正規表現、またはAI抽出のJSON object |
| `next` | 表示するblock、全talk共通の`/input`、または検索AI用command。複数はセル内で改行し、通常遷移では最後の無条件blockが次のfromになる |
| `set` | `;` 区切りの状態更新 |
| `mode` | 空欄、`stay`、`game_over` |
| `notes` | 監修用メモ |
| `example` | 代表入力 |

各fromには`type=default`がちょうど1件必要です。defaultのtextは空欄にします。場面説明は同じtalk/fromの`type=context`行のtextへ書き、`{{state_id}}`を使えます。contextは0〜1行で、cond・intent・example・extract・next・mode・setは使いません。AIを使うfromでは通常AI ruleの`intent / text / example`とdefaultの`example`を記述します。AIを使わないfromへAI用exampleを強制しません。`stay`はfromを動かさず、`game_over`は返信blockを履歴へ保存せず一時表示して、内部のgame-over effect sequenceへ移ります。

ここでdefaultが必要なのは、`talk_flow`にfrom行を書く入力地点です。対応するfrom行を一つも書かないblockは、読み取り専用の終点にできます。その地点では投稿できず、Quick Replyも表示しません。後でhookから入力地点へ移すことは可能です。これはserver/browser/static、メッセージ・チャット・検索AIに共通の仕様です。`scenario:talk-flow:writer-review`は、初期位置と通常遷移から到達する終点を確認用に一覧します。会話を続けたい場合のdefault書き忘れに注意してください。

`match`のtextは、セル全体を`/pattern/flags`にするか、改行区切りの候補一覧にします。一覧は引用符なしが部分一致、`"鍵"`のようなJSON文字列が全文一致で、混在できます。`secret`は引用符付きの全文一致候補だけです。語句の照合はNFKC・前後trim・小文字化を共通に使い、内部空白とひらがな/カタカナは区別します。正規表現にはこの正規化やi flagを自動適用しません。

`extract`は`/名前は(?<name>.+)です/u`のような名前付き正規表現、または従来のAI抽出JSONをセル全体へ記述します。結果は`$extract.name`でsetから参照できます。rule選択と抽出は独立で、match＋AI抽出、ai＋正規表現抽出も可能です。正規表現抽出は一度だけ実行し、未捕獲の任意groupを空文字で上書きせず、setに必要な値がなければdefaultへ戻ります。AIの障害は誤答へ読み替えません。

secretのnext先頭では`/load part名`を一行ずつ指定できます。通常match/ai/defaultや途中stepでの/load、参照からの暗黙ロードはありません。[partの取得](static.md#正解による取得)も参照してください。

## 検索AI talk

検索AIは固定ID `search_agent` です。`project_constants.tsv` の `search_agent.name` で名称を、`search_agent.start` で初期stepを指定します。発話者も自動生成されるため `talk_people` へ重複定義しません。初期stepは、例えば一つのvalueセルに `/input hide`、`intro`、`/input show` を改行して書きます。

本文は`talk_blocks.tsv`の`*search_agent`以下へ、分岐は通常どおり`talk_flow.tsv`へ書きます。検索AI発話は`sender=search_agent`の本文、`[表示名](open:app_id:content_id)`形式の内部リンク、Quick Replyを扱います。添付、HTTPSの外部リンク、固定の`time`は指定できません。内部リンクは実際に発話が表示された時だけ利用可能になり、同じblockを繰り返しても進行token内の権限は増殖しません。serverモードで公開後に表示済みのbase blockへリンクを追加した場合は、現在台本から本文を復元する既存契約に合わせて権限も補完します。後から追加・変更したrepeat variantと、到達済み本文をIndexedDBへ保持するbrowserモードのリンクは、未表示情報を与えないため再表示後に有効になります。`search_agent.start`ではblockと`/input`だけを使えます。

検索AIの`next`は、セル内で改行した次のstepを上から順に実行します。

| step | 内容 |
|---|---|
| `block_id` | 通常の発話blockを追加する |
| `/search {{player_input}}` | templateを展開した語で端末内検索し、結果カードを追加する |
| `/input show` / `hide` / `enable` / `disable` | composer表示と入力許可を変更する。全talk共通 |
| `/if (condition) block_id` | 条件を満たす場合だけ発話blockを追加する |

`/if`では、条件全体を囲む外側の括弧が必須です。その閉じ括弧より後ろをblock IDとして扱うため、条件内では通常どおり括弧、文字列、正規表現を使用できます。

一つの`next`で`/search`を使えるのは1回です。検索は表示順にかかわらず先に一度だけ評価され、同じ`next`の`/if`とblock templateでは`search_found`（boolean）と`search_result_count`（integer）を参照できます。これらは一時値であり、`state_vars`には宣言せず、`/search`のない`next`からは参照できません。検索queryでは状態変数、抽出値、現在の入力を表す`player_input`をtemplateに使えます。

```text
/if (search_found) found
/if (!search_found) not_found
/search {{player_input}}
```

ヒントのように検索結果を出さない分岐は、通常の正規表現ruleで案内blockだけを返し、`mode=stay`にします。検索AIでは`mode=game_over`を使えません。`mode`を空欄にしてfromを進める場合は、`next`の最後を無条件のblockにしてください。`/`から始まるblock IDはcommandとの区別が付かないため使用できません。

検索入力もメッセージやチャットと同じtalk送信APIで処理します。検索専用APIと独立した検索履歴はなく、発話、入力、検索結果カードは固定の`search_agent` talkへ順番に追加されます。保存量が増え続けないよう、`search_agent`だけは入力・発話・結果カードを合わせた直近200表示項目を保持します。

hookから台本進行と無関係な検索結果を追加する場合は、`context.talk.search("search_agent", query)`を使います。検索結果は同じ`search_agent` talkへ追加され、台本発話や入力欄の状態は変更しません。

`photo:content_id` と `share:content_id` は、アルバム添付とラジオ項目共有の入力です。正規表現ruleにはこの内部ID形式を渡し、LLMへは写真の `photoDescriptions` または共有項目のタイトルを使った説明文を渡します。

### extractのAI抽出

`extract`へ書くAI抽出の最小形は、抽出値IDをrule本文へ対応させたJSON objectです。

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

`project_constants.tsv` の `features.llm` を `true` にし、ローカルでは `.dev.vars`、公開時はデプロイ先の環境変数またはsecretへ次を設定します。

```dotenv
LLM_API_KEY=...
LLM_MODEL=...
LLM_BASE_URL=https://api.openai.com/v1
LLM_TIMEOUT_MS=15000
LLM_REASONING_EFFORT=low
```

`LLM_REASONING_EFFORT` は利用する互換providerが対応している場合だけ明示設定します。未設定時は、Gemini 2.5系またはFlash-Lite系の非Proへ`none`、その他のGemini 3系へ`minimal`を安全な既定値として送り、それ以外のmodelには送りません。明示値はこの既定より優先されます。

providerの必須処理は `completeJson` だけです。会話エンジンは、その上に「type=aiの判定」と「extractのAI抽出」を載せています。任意の `observeResult` は検証後の採否を記録するための口で、別providerでは省略できます。別providerへ切り替える場合は `src/worker/providers/structuredOutput.ts` の生成部分だけを差し替えます。ただし「type=aiの判定」だけは、JSONを生成しない判定型のproviderも選べます([rule選択にJevを使う](#rule選択にjevを使う))。

AI判定には、現在のfrom blockの末尾2件と、表示履歴の直近2件を重複除去して渡します。stayの会話が続いても現在の問いを保持し、短い肯定・否定や指示語の文脈を補います。confidenceが0.65未満ならdefaultへ倒し、`game_over` は誤判定を避けるため0.9以上を必要とします。0〜1の範囲外や候補にないrule IDは、不正応答としてエラーにします。providerの一時的な通信失敗は1回だけ再試行し、長い再試行で送信画面を止め続けない設計です。

正規表現ruleはLLMより先に評価されるため、確実に判定できる入力は正規表現へ寄せると、速度と再現性を保てます。

hookの`llm.match`は`fast / super / ultra` profileと`stable / once`を選べます。`stable`は最初の2標本を並行取得して最大5標本から合意を探し、`once`は1標本ずつ評価して最初に採用可能な値を使います。いずれも壊れた応答だけなら障害として扱い、正常な候補が合意しない場合は、fallbackがあればそれを使い、なければエラーにします。fastだけ通常の`LLM_MODEL`へfallbackし、super/ultraは対応するprofile modelが未設定なら利用不能です。serverモードでは同じplayer・model・input・prompt・schemaの成功結果とfallbackを既定30日cacheし、browserモードでは同じHTTP request内だけ再利用します。

`LLM_ANALYTICS_ENABLED=true`では本文を含まないtoken usage・試行回数・hashを構造化logへ出します。`LLM_DEBUG_LOGS=true`では入力・prompt・schema・応答も出るため、調査中だけ有効にし、公開環境では調査後にfalseへ戻してください。API keyやAuthorization headerはdebugにも出しません。

通常logには、provider応答の取得結果に加えて検証後の採否・confidence・理由・標本番号を記録します。hookの保存結果とlogは同じ論理入力・指示・schemaのhashで照合でき、監修試行には選択結果とhashを保存します。生のHTTP payloadや長いprompt全体を監修DBへ複製するわけではありません。debugを無効にしていた期間の生応答は後から復元できません。

### rule選択にJevを使う

`type=ai`のrule選択だけは、TypeSafeのJev(文章を生成せず、型付きの質問へ確率付きで答えるmodel)へ切り替えられます。候補ruleをChoiceの選択肢として渡し、選ばれたruleと確率分布を受け取ります。`extract`のAI抽出、hookの`llm.*`、入力集計は値や文章を生成する処理なので、引き続き上の`LLM_*`を使います。

```dotenv
LLM_TALK_SELECTOR=typesafe
TYPESAFE_API_KEY=...
TYPESAFE_MODEL=jev-1.13.0              # 任意。既定値
TYPESAFE_MIN_CONFIDENCE=0.65           # 任意。既定値
TYPESAFE_GAME_OVER_MIN_CONFIDENCE=0.9  # 任意。既定値
```

- `TYPESAFE_API_KEY`を置くだけでは切り替わりません。`LLM_TALK_SELECTOR=typesafe`で明示します。
- rule選択だけなら`LLM_API_KEY`は不要です。AI抽出を持つruleが選ばれた時にLLM providerがなければ、既存と同じ`llm_unavailable`になります。
- keyがない、`LLM_TALK_SELECTOR`が未知の値、閾値が0〜1の数値でない、game over用の閾値が通常の閾値より小さい場合は、通信せず`llm_unavailable`にします。既存のLLMへ黙って戻しません。
- 閾値はJevの`confidence`へ適用し、判定規則は既存のLLM経路と同じです。通常の閾値未満ならdefaultへ戻し、`game_over`のruleはgame over用の閾値以上の時だけ選びます。
- `jev-latest`のような別名は新版へ自動で移り、調整した閾値の前提が変わります。閾値を調整したら`TYPESAFE_MODEL`を版IDで固定してください。
- Jevの主な学習言語は英語で、日本語の精度は下がると公開されています。作品のexampleと会話caseを実APIで確認してから使ってください。
- LLMに判断させるまでもない事前条件(特定の添付IDが必要、など)は、criteriaではなく`cond`に書きます。`cond`は`player_input`を参照でき、通らないruleは候補になりません。
- プレイヤー入力と直近の会話はTypeSafeへ送られます。公開時は、実際の送信先に合わせてプライバシーポリシーを更新してください。

通信は既存のLLMと同じく、通信例外と408・429・5xxだけを250ms後に1回再試行します。1試行のtimeoutは10秒です。`LLM_ANALYTICS_ENABLED` / `LLM_DEBUG_LOGS`のlogには`provider:"typesafe"`が付きます。監修試行の記録には、選択結果とhashに加えて、`selector`、応答したmodel版、全候補の確率分布が残ります。

### hook LLMの入力・出力制約

`llm.extract` / `llm.screen` の `schema` には `string` / `boolean` / `integer` / `number` / `null` に加え、次を指定できます。

- `string_max_N`: N文字以内の文字列。
- `hiragana_1_5`: ひらがな・長音1〜5文字。
- `safe_reading_text`: 240文字以内の文字列。内容の安全性を自動保証する指定ではありません。
- `string_max_20|null` のような `|` 区切り: いずれかを満たす値。

plain `string` には一律の500文字制限を付けません。長さを制限したい場合は `string_max_N` を明示してください。fallbackにも成功値と同じ検査が適用されます。`llm.match` のfallbackは、そのmatch定義の `null: "no"` 等も満たす必要があります。

入力は非空の `input` を優先し、空または省略なら明示した `source` を使います。`source: "player_message"` は現在のプレイヤー入力、それ以外はeventの文字列fieldを明示して参照します。未知のsourceはエラーです。input/sourceをどちらも指定しなければ空入力になり、event全体を暗黙に送ることはありません。入力・指示を文字数で黙って切り詰めません。

`maxTokens` を省略するとschemaの項目数・文字数から出力予算を見積もります。作者による明示指定も可能です。予算は常にその量を出力・課金する指定ではありませんが、長い出力が可能になる分、費用と待ち時間は増え得ます。

一つのeventで新たに解決できるhook LLM要求数は `LLM_HOOK_MAX_REQUESTS`（既定5）で設定します。同じ要求の再利用、各matchの標本数、通信retry、結果を使ってhookを最後まで実行する再評価は別です。上限を超える新しい要求を始める前に停止し、そのeventの途中effectは確定しません。既に行ったLLM呼出しの費用は取り消せません。

## 制作確認コマンド

```sh
npm run scenario:talk-flow:path-dump -- --talk=guide
npm run scenario:talk-flow:writer-review -- --talk=guide
npm run scenario:talk-flow:examples:test
```

path dumpはfrom・example・nextの連結、writer reviewは全体の読み順とrepeat・独立block、example testは選択中scenarioの全exampleをlocal mockで確認します。実LLMを呼ぶ場合だけ、example testへ`--live`と表示される長い課金確認flagを明示します。`LLM_TALK_SELECTOR=typesafe`ならJevで判定し、reportの各行へmodel版と確率分布を加えます。

分岐IDは定義内容から生成する21文字の内部IDです。行番号・notes・exampleの変更では維持し、条件・抽出・状態更新・返答先等の変更では別IDになります。変更前の入力を返信先から推定して新分岐へ混ぜません。並べ替えによる候補優先順や、台詞本文・モデル設定の変更まで同じであることを保証するIDではありません。

判定種別はsecretと候補一覧のmatchで、所属partはbase以外で、追加取得先は空でない場合にIDの材料へ含めます。baseの既存regex/defaultへ明示typeを付けただけではIDを変更しません。同じ定義の重複行は、重複内の出現順で区別します。

任意のcriteria診断と、抽出結果まで含めた追加試験は[制作テスト](authoring-tests.md)を参照してください。
