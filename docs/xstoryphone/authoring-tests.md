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
- `expectedMatch`は省略可能です。指定した場合は最終的に利用する抽出文字列のobject全体を比較します。採用されたnullは値なしとしてkeyを含めません。
- mockの既定応答は期待する分岐と抽出値です。`mockSelection`へrule選択応答、`mockExtractions`へ抽出応答の配列を明示すると、抽出不成立や複数標本のケースも試せます。
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
