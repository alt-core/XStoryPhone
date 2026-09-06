# AWSへの公開

AWS版は、CloudFront、非公開S3、API Gateway HTTP API、Lambda、DynamoDB On-DemandをAWS SAMで作成します。VPC、NAT Gateway、常駐サーバーは使用しません。Cloudflare版と同じクライアント、API、シナリオ処理を使います。

## 前提

- Node.js 22.18以降
- AWS CLI
- AWS SAM CLI
- デプロイ先アカウントでCloudFormation、Lambda、API Gateway、DynamoDB、S3、CloudFront、IAM、CloudWatch Logsを作成できる認証情報

初期設定は次のとおりです。

- リージョン: `ap-northeast-1`
- 公開URL: CloudFront標準ドメイン
- プレイヤー入力ログ: 無効
- DynamoDBとS3: スタック削除時も保持
- Lambdaログ: devは7日、stg/prodは14日

## ローカル検証

クラウドへ接続せず、テンプレートとビルドを確認できます。

```sh
npm run check
npm test
npm run build:aws
npm run aws:validate
npm run aws:build
```

`npm run aws:validate` と `npm run aws:build` はローカルのSAM CLIを使います。これらはデプロイしません。

## デプロイ

運営レビュー画面を保護する十分に長い秘密値を、コマンド履歴へ直接書かず環境変数に設定します。

```sh
export ADMIN_REVIEW_SECRET='十分に長いランダム値'
npm run deploy:aws:dev
```

`playerMode: "browser"` の場合は、進行tokenへ署名する秘密値も環境変数で渡します。デプロイスクリプトはbrowserモードで未設定なら処理を止めます。

```sh
export BROWSER_STATE_SECRET='十分に長いランダム値'
export ADMIN_REVIEW_SECRET='十分に長いランダム値'
npm run deploy:aws:dev
```

`BROWSER_STATE_SECRET` は公開後も環境ごとに同じ値を維持し、毎回のデプロイで同じ値を渡してください。通常の再デプロイやシナリオ更新のたびに生成し直す値ではありません。変更すると、その環境で保存済みの進行tokenを検証できなくなります。誤って変更した場合は元の値で再デプロイしてください。クライアントは401で保存を自動削除せず、`AP-BROWSER-STATE` を表示するため、設定復旧後にリロードして再開できます。プレイヤーへサイトデータの削除を案内しないでください。サポート用の明示初期化は[保存モードの運用説明](player-modes.md#サポート用のログアウトとローカル初期化)を参照してください。

環境ごとのコマンドは次のとおりです。

```sh
npm run deploy:aws:dev
npm run deploy:aws:stg
npm run deploy:aws:prod
```

スクリプトは公開境界監査、静的ビルド、SAM build/deploy、S3同期、CloudFront invalidation、ヘルスチェックを順番に行います。リソース定義の正本は `infra/aws/template.yaml` です。

## 環境設定

環境名、スタック名、同時実行上限、ログ保持日数は `scripts/deploy-aws.mjs` で管理します。`infra/aws/samconfig.toml` はリージョン、変更確認、CloudFormation用S3の解決など、SAM CLIの設定を持ちます。秘密値はどちらのファイルにも記録しません。

実プレイ入力を分岐監修へ保存する場合だけ、デプロイ時に `PLAYER_INPUT_LOGGING=true` を設定してください。未設定または `false` の場合は保存しません。入力本文をCloudWatch Logsへ出力する処理はありません。

browserモードでは、これを無効にしている限り、通常プレイによるDynamoDB書込みはありません。DynamoDB自体は運営レビュー画面の試行入力と監修指示に使うため残ります。

```sh
export PLAYER_INPUT_LOGGING=true
npm run deploy:aws:prod
```

serverモードで発行済みの8桁アクセスコードだけを受理する場合は、コード生成とデプロイへ同じ秘密値を渡します。人数限定を行わない場合は不要です。

```sh
export ACCESS_CODE_SECRET='十分に長い秘密値'
npm run access-code -- 0001
npm run deploy:aws:prod
```

LLMを使うシナリオでは、Cloudflare版と同じ項目を環境変数で渡します。`LLM_API_KEY` と `LLM_MODEL` は必須、base URL、timeout、providerが対応する推論強度は任意です。デプロイスクリプトは値が設定された項目だけをSAMへ渡し、API keyはCloudFormation上で非表示にします。

```sh
export LLM_API_KEY='providerのAPI key'
export LLM_MODEL='利用するモデル名'
export LLM_BASE_URL='https://api.openai.com/v1' # 任意
export LLM_TIMEOUT_MS='15000'                  # 任意
export LLM_REASONING_EFFORT='low'              # 任意
npm run deploy:aws:prod
```

このリポジトリの `infra/aws/template.yaml` では、Lambdaの実行時間を30秒に設定しています。`LLM_TIMEOUT_MS` とprofileごとのtimeoutはLLMの1試行に対する制限であり、リクエスト全体の制限ではありません。既定の15秒を初回と1回の再試行で使い切ると、250msの待機も加わり30秒を超えます。会話のrule選択後にmatch抽出を行う経路では、抽出の初回2標本を並列実行し、合意できなければ最大3標本をさらに順次取得します。加えて同じリクエスト内のhookがLLMを呼ぶ場合もあります。

再試行の待機、会話選択、複数標本のmatch抽出、hook、保存などを含めたリクエスト全体を30秒以内に収める必要があります。1試行を10秒以下へ設定しても、成功応答が重なるだけで全体が30秒を超えることがあり、完了の保証にはなりません。LLMを使う作品は必要な経路を実環境で確認し、作品側の処理と各timeoutを調整してください。この注意は本リポジトリのLambda設定に基づくもので、AWS全体の上限を示すものではありません。

hookのprofileを使う場合は`LLM_PROFILE_FAST_* / SUPER_* / ULTRA_*`のうち必要な項目だけを設定します。`LLM_ANALYTICS_ENABLED=true`は本文なしのusage log、`LLM_DEBUG_LOGS=true`は入力・prompt・応答を含む調査用logです。debugは調査後にfalseへ戻してください。`LLM_RESULT_RETENTION_DAYS`はserver hook LLM cacheの保持日数で、未指定時は30日です。DynamoDBのcache itemは同じplayer partitionに保存され、期限判定に加えてTTLで遅延削除されます。

GA4による任意の計測を使う場合だけ、デプロイ実行時の環境変数へ `VITE_XSTORYPHONE_GA4_MEASUREMENT_ID` を設定します。未設定なら外部スクリプトを読み込みません。有効にする場合は、実際の送信内容に合わせてプライバシーポリシーを更新してください。

## 更新とロールバック

通常の更新は同じ環境のデプロイコマンドを再実行します。LambdaやCloudFormationの更新に問題がある場合は、CloudFormationの直前の正常なテンプレート／コードへGitを戻し、同じコマンドで再デプロイします。

静的ファイルだけを戻す場合は、正常なコミットで `npm run build:aws` を行い、対象バケットへ再同期してCloudFront invalidationを作成します。

## 削除

CloudFormationスタックはSAM CLIで削除できます。

```sh
sam delete --stack-name xstoryphone-dev --config-file infra/aws/samconfig.toml --config-env dev
```

DynamoDBテーブルとS3バケットは誤消去防止のため保持されます。完全に削除する場合は、必要なバックアップを確認したうえで、それぞれを明示的に削除してください。この操作は復元困難なので、対象の環境名とAWSアカウントを必ず確認してください。

## 初期範囲外

- 既存D1データの移行
- カスタムドメイン、Route 53、ACM
- Bedrock、Polly
- Lambda Function URL
- DynamoDB PITR
- D1とDynamoDBの同期、マルチクラウド自動切替

必要になった機能だけを後から追加します。
