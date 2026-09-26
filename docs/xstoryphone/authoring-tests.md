# シナリオの制作確認

シナリオの原本を検証するコマンドと、文章・分岐を確認する道具は用途が異なります。いずれも生成ファイルを手で修正せず、選択中シナリオの原本へ修正を戻してください。

## 構造と文章を確認する

```sh
npm run scenario:validate
npm run scenario:talk-flow:path-dump -- --talk=guide
npm run scenario:talk-flow:writer-review -- --talk=guide --group-by-from
node scripts/scenario-talk-flow-criteria-audit.mjs
```

path dumpは現在地点の最後の発話、example、返答の順を確認するものです。writer reviewは代表到達経路、repeat、独立blockをまとめて読めます。Quick Reply、検索・入力制御commandも表示します。

criteria auditは、判定条件へ返答内容・進行説明が混ざっていないか、場面説明やgame overの境界が曖昧でないかを調べる任意のlintです。日本語の目印による助言であり、文章が正しいかどうかの判定器ではありません。通常のbuildはこの助言で停止しません。AIを使わない場面にはLLM用の場面説明を要求しません。

- `--json`: 診断をJSONで出力。
- `--limit=0`: 診断を省略せず表示。
- `--strict`: errorまたはwarnがあれば終了コードを1にする。

## 原本のexampleを確認する

```sh
npm run scenario:talk-flow:examples:test
```

各ruleのexampleを使い、現在の状態条件、match/secretの選択順、LLMの候補と応答schemaを確認します。text・contextのtemplateは、試験stateの値で本番と同様に展開します。

試験stateはシナリオの初期値を基に、condを満たす値で上書きします。プレイ中に入力・更新された名前などまでは再現しないため、初期値が仮の値なら、その値で台詞や判定基準が展開されます。テンプレートを使う地点の実API評価には、下の会話caseで本番に近い`stateValues`と必要な`recentMessages`を指定してください。

会話地点ごとの条件状態パターン上限は既定16です。必要な作品では`--cond-pattern-limit=40`のように正の整数で変更できます。`--dry-run`で対象を確認してから実行してください。上限を増やすと試験数が増え、liveではAPI利用・費用も増え得ます。

`--live`で`LLM_TALK_SELECTOR=typesafe`の場合は、本番と同じrequest・再試行・閾値でJevを呼び、reportの各行と失敗詳細へ応答したmodel版と確率分布を加えます。`TYPESAFE_MIN_CONFIDENCE`等を変えて再実行すれば、閾値の影響を比べられます。

OpenAI互換経路のlive実行も本番と同じproviderと選択器を使います。接続先・model・timeout・推論強度・JSON Schema・出力上限は本番設定に従い、`--retries=0`だけは評価時の再試行を止められます。接続先やmodelを省略して、評価側だけ別の既定modelへ補完することはありません。

既定のmockではLLMの期待応答を与えるため、自然文を実LLMが正しく分類することまでは検証しません。また、このコマンドはrule選択の確認であり、後続の抽出値・hook・プレイ全体を実行するものではありません。

## 一入力の選択と抽出を一緒に確認する

複数の言い回しや抽出値を継続的に確認したい場合は、任意のコードfixtureを用意します。本編の台本や分岐をfixtureへ複製せず、原本の意図名を参照します。

```js
// 作品側の tests/talk-cases.mjs。talk・from・意図名・stateは作品の原本へ合わせる。
export const cases = [{
  id: "名前を伝える",
  talkId: "guide",
  from: "ask_name",
  input: "田中です",
  stateValues: { introduction_finished: true },
  expectedIntent: "名前を伝えた",
  expectedMatch: { name: "田中" }
}];
```

```sh
node scripts/scenario-talk-flow-cases-test.mjs --fixture=scenario/my-story/tests/talk-cases.mjs
```

これは本番の選択・抽出resolverを呼び、選択した分岐と抽出した文字列を比較します。set、hook、DB保存、演出は実行しません。fixtureは通常のJavaScript moduleなので、信頼できる自分のファイルだけを指定してください。

対象は一つの論理会話入力です。画面操作、公開IDの受理・認可、画像や共有を送るAPIそのものの試験とは分けます。`photo:内部ID`等の固定コマンドでAIへ渡す説明文も指定したい場合は、`semanticPlayerInput`へ明示します。通常テキスト入力では不要です。

- `stateValues`はシナリオの初期値への上書きです。
- `expectedIntent`は意図名、または許容する意図名の配列です。`"default"`は現在地点の既定分岐を表します。現在地点と共通分岐から、caseのstate・入力でcondを満たす候補だけを探します。該当なし、または同じ意図名で結果の異なる複数候補がある場合は、APIを呼ぶ前にそのcaseを設定エラーにします。
- 意図指定では、意図名や判定基準が違っても、`next`全体・`mode`・`set`・`extract`が一致する分岐を同等の正解として扱います。比較にはnextの命令・順序・遷移先・`/load`も含め、抽出JSONのkey順や空白だけの差は無視します。これは宣言された分岐結果の比較です。分岐IDに依存するhookまで同じ動作になることは保証しません。
- 分岐を厳密に指定する場合は`expectedRuleId`を使います。`expectedIntent`との併用はできず、同等の別分岐も不一致になります。実際のIDは生成済みscenarioの`rule_...`形式で、判定基準などを変更すると変わります。
- `forbiddenMode: "game_over"`で禁止するmodeを指定できます。値は`advance / stay / game_over`で、通常の期待値と併用するか、禁止条件だけを検査できます。期待値と禁止条件が矛盾するcaseは設定エラーです。
- `recentMessages`には任意の`{ speaker, body }`配列を書けます。現在地点の末尾2発話と、直近履歴の末尾2発話を文脈にします。
- `expectedMatch`は省略可能です。指定した場合は最終的に利用する抽出文字列のkey集合全体を比較し、各値は文字列なら完全一致、`RegExp`なら一致を検査します。例えば`{ name: /^(あさ|よる)さん$/u, category: "受付" }`のように混在できます。採用されたnullは値なしとしてkeyを含めません。
- mockの既定応答は期待する分岐と抽出値です。`mockSelection`へrule選択応答、`mockExtractions`へ抽出応答の配列を明示すると、抽出不成立や複数標本のケースも試せます。
- 正規表現の期待値からAI抽出のmock応答は生成しません。AI抽出をmockするcaseは`mockExtractions: [{ name: "あささん", category: "受付" }]`のように実際の応答値を指定してください。実LLMで抽出する場合、正規表現で抽出する場合、`--selection-only`の場合には不要です。正規表現は毎回先頭から検査し、`g`/`y`の照合位置をcase間で持ち越しません。
- 複数の意図を許容するmockでは、先頭の意図から解決した最初の分岐を返します。禁止条件だけのcaseでも、正規表現などで分岐が確定する場合やAI候補がなくdefaultになる場合は`mockSelection`不要です。AI選択まで進むmockケースには、検査したい応答を`mockSelection`で明示してください。
- `--case=ID`で一件に絞れます。`--report=保存先.json`で結果を保存できます。報告には抽出値が含まれるため、公開配信先へ置かないでください。

正規表現の選択はmockで置き換えず実際に判定します。mockが通ることは、LLMによる意味分類の品質保証ではありません。

### 実LLMで確認する場合

環境変数で通常のLLM設定を渡し、`--live`と課金確認flagを明示します。fixture指定だけでは外部APIを呼びません。APIの利用・課金は作者が許可した場合だけ行ってください。

```sh
node scripts/scenario-talk-flow-cases-test.mjs \
  --fixture=scenario/my-story/tests/talk-cases.mjs \
  --live \
  --i-understand-this-test-calls-a-paid-llm-api-and-requires-user-confirmation
```

既存providerを使うため、model・timeout・限定retry・観測ログの設定は本番と共通です。`LLM_TALK_SELECTOR=typesafe`を渡すとrule選択は本番と同じJevの経路と閾値で行い、`LLM_API_KEY`はAI抽出を含むcaseだけに必要です。このコマンドは`.dev.vars`を自動読込みせず、プロセスの環境変数を使用します。成功結果には選択・抽出それぞれの呼出し数を表示します。失敗をdefault成功として握りつぶさず、case失敗として非ゼロ終了します。

### 分岐の選択だけを評価する

Jevと既存LLMの分岐選択を比べる場合は、同じfixtureを`--selection-only`で実行します。本番と共通の候補絞り込み・match/secret優先選択・確信度の閾値判定までを行い、抽出前で停止します。AI抽出と正規表現抽出はどちらも実行せず、`expectedMatch`の比較と`mockExtractions`の使用もしません。抽出不成立でdefaultに戻った結果を、選択器の正解と取り違えません。

```sh
LLM_TALK_SELECTOR=typesafe node scripts/scenario-talk-flow-cases-test.mjs \
  --fixture=scenario/my-story/tests/talk-cases.mjs \
  --selection-only --live \
  --report=/tmp/talk-selection-typesafe.json \
  --i-understand-this-test-calls-a-paid-llm-api-and-requires-user-confirmation
```

この例では環境変数に`TYPESAFE_API_KEY`を設定します。抽出のある分岐でも`LLM_API_KEY`や抽出mockは不要です。既存LLMと比較するときは`LLM_TALK_SELECTOR=openai-compatible`と通常の`LLM_*`を指定し、別のreportへ保存します。`--selection-only`だけならmockで動き、外部APIは呼びません。

例えば`expectedIntent: ["協力する", "手伝い方を尋ねる"]`は複数の意図を許容します。`forbiddenMode: "game_over"`だけのliveケースは「ゲームオーバーにしないこと」を検査し、分岐正解率の母数には含めません。

reportには実行範囲の`scope`、シナリオ版、設定したモデルと閾値、ケースごとの所要時間・呼出し数を保存します。成功・失敗のどちらでも、取得できた`selection`（抽出前の分岐）、`actual`（評価対象の最終分岐）、`reviewSelection`（選択器の判断・確信度・退避理由・hash、Jevでは応答モデル版と確率分布）を残します。選択失敗時は分岐情報を捏造せず、抽出エラー時は取得済みの`selection`だけを残します。

OpenAI互換経路のreportには、接続先・timeout・推論強度、応答したmodelと成功応答のtoken使用量も残します。キーは記録しません。HTTP 401/403は後続caseの実行を止め、認証設定の修正後に再実行します。`summary.planned`と`summary.attempted`で予定数と実行数を確認できます。

Bedrockの設定例と確認済みモデルは[Amazon Bedrockを使う](conversation.md#amazon-bedrockを使う)を参照してください。環境別の設定ファイルはGit管理外へ置き、例えば`node --env-file=.env.bedrock scripts/scenario-talk-flow-cases-test.mjs ...`のように読み込みます。シェルですでに定義された同名の環境変数はNodeのenvファイルより優先されるため、切り替え時にはreportの設定欄で実際の接続先とmodelを確認してください。

`expectationMatch`は`exact / equivalent / mismatch`です。`summary`では分岐一致・禁止mode・抽出値を別々に集計し、分岐一致は厳密一致と同等扱いも分けます。設定・通信などの失敗は`failureStage`と別集計に残り、未評価の検査は正解率の母数に含めません。consoleには失敗の概要と確信度・退避理由を表示し、全候補の確率分布などはJSON reportで確認します。

## hookの結果をケースごとに確認する

フォームや作品イベントなど、会話の選択・抽出以外から呼ばれるhookは、hook用のcaseで確認します。選択中のシナリオの`hooks.tsv`から本番と同じhandlerを生成し、同じhook実行系・LLM判定へ渡します。別シナリオの生成済みファイルを読んだり、fixtureへhook本文を複製したりする必要はありません。

```js
// ID・状態名・LLM task名は自分の原本へ合わせる。
export const cases = [{
  id: "受付可能な入力",
  event: { eventId: "form_submitted", formId: "input_form", fields: { text: "こんにちは" } },
  stateValues: { accepted: false },
  expectedOutcome: "completed",
  expectedState: { accepted: true },
  expectedAudio: { announcement: /こんにちは/u },
  mockLlm: { check_input: { allowed: true } }
}];
```

```sh
npm run scenario:hooks:cases:test -- --fixture=scenario/my-story/tests/hook-cases.mjs

# 一件だけ実LLMで確認し、報告を非公開の場所へ保存する場合
npm run scenario:hooks:cases:test -- \
  --fixture=scenario/my-story/tests/hook-cases.mjs --case=受付可能な入力 \
  --report=.projects/hook-case-report.json --live \
  --i-understand-this-test-calls-a-paid-llm-api-and-requires-user-confirmation
```

既定は外部APIを呼ばないmockです。`--live`では通常の`LLM_*`環境変数を使い、hookのprofile・標本数・限定再試行を変更しません。`.dev.vars`は自動読込みしません。hookのLLMは分岐選択器とは別なので、`LLM_TALK_SELECTOR`では切り替わりません。LLMが無効なシナリオを、試験側だけ有効化することもありません。

| case項目 | 意味 |
|---|---|
| `id` / `event` | 一意のcase IDと、APIの前処理後にhookへ渡る`ScenarioEventPayload`。IDは内部IDを使う |
| `stateValues` | 宣言済み状態の初期値への上書き。型やenumも本番の検査に従う |
| `loadedParts` | 取得済みpart。省略時はbaseだけ。part取得や`part_loaded`の連鎖を自動実行する指定ではない |
| `repairedAppIds` / `repairedContentIds` / `unlockedContentIds` | 必要な場合だけ、修復・開錠済みの前提を内部IDの配列で指定 |
| `expectedOutcome` | `completed`（通常完了）、`rejected`（入力拒否）、`game_over`、`all_clear`、`skipped`（発火なし）、または許容する結果の配列 |
| `expectedState` | 検査したい状態だけを指定。文字列・数値・booleanは厳密一致、`RegExp`は文字列への一致 |
| `expectedAudio` | 検査したい生成音声IDと台本。文字列は全文一致、`RegExp`は一致。音声生成を使わない場合は不要 |
| `mockLlm` | task IDごとの応答object。複数標本を変えたい場合は応答objectの配列。末尾到達後は最後の応答を使う。mockで要求されたtaskの未指定、または指定したtaskの未使用は設定エラー。liveでは使用しない |

`expectedState`・`expectedAudio`は任意ですが、指定した期待は結果種類にかかわらず常に検査します。数値を暗黙に文字列へ変換して正規表現へ渡すことはありません。対象のhookが発火しなかった場合は`completed`とせず`skipped`になるので、targetやcondの取り違えによる見かけの成功を見つけられます。

`mockLlm`には、そのcaseで呼ばれるtaskだけを書きます。例えば入力拒否で後続taskへ進まないcaseでは、後続taskのmockは省きます。標本の配列は全部使い切る必要はなく、途中で合意が成立して余った標本は正常です。hookが発火しないことを検査する場合は`expectedOutcome: "skipped"`とし、使われないmockは指定しません。

`event`は送信APIのリクエストbodyではありません。フォームなら内部`formId`と、hookが読む場合は`contentId`・`fields.appId`も指定します。公開IDの変換や入力の文字数制限は、この試験では自動実行しません。APIの前処理自体を検査する場合はAPI側のテストで確認してください。

報告には拒否理由、終端演出の指定、生成音声の台本、指定した状態値、実行したhandler、LLM taskごとの`ready / fallback / unavailable`・呼出し数・使用量・モデル・所要時間を残します。fallbackで期待どおりの結果になっても、LLMの品質試験としては失敗にし、`summary.fallback`へ別集計します。401/403では後続caseも止めます。設定誤りやその他の失敗は記録して次のcaseへ進み、一件でも失敗すると非ゼロ終了します。認証情報は報告しませんが、入力・台本・状態は含むため、reportは公開配信先へ置かないでください。

各caseは初期状態から独立して、指定した一eventだけを実行します。DB保存、実際の音声生成、予約イベントの後続実行、画面での演出やAPI認可までは検査しません。予定・会話・ToDoなどのeffect自体は本番のhook実行系で計算しますが、このコマンドの期待値指定は結果種類・状態・音声台本に絞っています。fixtureとhookは作者のコードとして実行するため、信頼できる原本だけを使用してください。
