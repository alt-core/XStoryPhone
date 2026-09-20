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

criteria auditは、判定条件へ返答内容・進行説明が混ざっていないか、場面説明やgame overの境界が曖昧でないかを調べる任意のlintです。日本語の目印による助言であり、文章が正しいかどうかの判定器ではありません。通常のbuildはこの助言で停止しません。正規表現だけの場面にはLLM用の場面説明を要求しません。

- `--json`: 診断をJSONで出力。
- `--limit=0`: 診断を省略せず表示。
- `--strict`: errorまたはwarnがあれば終了コードを1にする。

## 原本のexampleを確認する

```sh
npm run scenario:talk-flow:examples:test
```

各ruleのexampleを使い、現在の状態条件、正規表現の選択順、LLMの候補と応答schemaを確認します。criteria・場面説明のtemplateは、試験stateの値で本番と同様に展開します。

既定のmockではLLMの期待応答を与えるため、自然文を実LLMが正しく分類することまでは検証しません。また、このコマンドはrule選択の確認であり、後続の抽出値・hook・プレイ全体を実行するものではありません。

## 一入力の選択と抽出を一緒に確認する

複数の言い回しや抽出値を継続的に確認したい場合は、任意のコードfixtureを用意します。本編の台本や分岐をfixtureへ複製せず、原本の分岐IDを参照します。

```js
// 作品側の tests/talk-cases.mjs。IDはその作品の原本へ合わせる。
export const cases = [{
  id: "名前を伝える",
  talkId: "guide",
  from: "ask_name",
  input: "田中です",
  stateValues: { introduction_finished: true },
  expectedRuleId: "name_received",
  expectedMatch: { name: "田中" }
}];
```

```sh
node scripts/scenario-talk-flow-cases-test.mjs --fixture=scenario/my-story/tests/talk-cases.mjs
```

これは本番の選択・抽出resolverを呼び、選択した分岐IDと抽出した文字列を比較します。set、hook、DB保存、演出は実行しません。fixtureは通常のJavaScript moduleなので、信頼できる自分のファイルだけを指定してください。

対象は一つの論理会話入力です。画面操作、公開IDの受理・認可、画像や共有を送るAPIそのものの試験とは分けます。`photo:内部ID`等の固定コマンドでAIへ渡す説明文も指定したい場合は、`semanticPlayerInput`へ明示します。通常テキスト入力では不要です。

- `stateValues`はシナリオの初期値への上書きです。
- `recentMessages`には任意の`{ speaker, body }`配列を書けます。現在地点の末尾2発話と、直近履歴の末尾2発話を文脈にします。
- `expectedMatch`は省略可能です。指定した場合は最終的に利用する抽出文字列のobject全体を比較します。採用されたnullは値なしとしてkeyを含めません。
- mockの既定応答は期待する分岐と抽出値です。`mockSelection`へrule選択応答、`mockExtractions`へ抽出応答の配列を明示すると、抽出不成立や複数標本のケースも試せます。
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

既存providerを使うため、model・timeout・限定retry・観測ログの設定は本番と共通です。このコマンドは`.dev.vars`を自動読込みせず、プロセスの環境変数を使用します。成功結果には選択・抽出それぞれの呼出し数を表示します。失敗をdefault成功として握りつぶさず、case失敗として非ゼロ終了します。
