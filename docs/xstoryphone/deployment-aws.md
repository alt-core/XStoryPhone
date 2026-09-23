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

`BROWSER_STATE_SECRET` は公開後も環境ごとに同じ値を維持し、毎回のデプロイで同じ値を渡してください。通常の再デプロイやシナリオ更新のたびに生成し直す値ではありません。変更すると、その環境で保持中の進行tokenを検証できなくなります。誤って変更した場合は元の値で再デプロイしてください。クライアントは401で状態を自動削除せず、`AP-BROWSER-STATE` を表示します。persistentでは設定復旧後にリロードして再開できますが、memoryではリロードすると進行を失います。プレイヤーへサイトデータの削除を案内しないでください。サポート用の明示初期化は[保存モードの運用説明](player-modes.md#サポート用のログアウトとローカル初期化)を参照してください。

環境ごとのコマンドは次のとおりです。

```sh
npm run deploy:aws:dev
npm run deploy:aws:stg
npm run deploy:aws:prod
```

スクリプトは公開境界監査、静的ビルド、SAM build/deploy、S3同期、CloudFront invalidation、ヘルスチェックを順番に行います。リソース定義の正本は `infra/aws/template.yaml` です。

### 外部静的ホストを使う場合

ゲーム画面を別のホストへ置く場合は、[外部静的ホスト・サブパスへの配置](external-hosting.md)に従って `dist/static` を作成します。API側へは静的ホストのoriginを `ALLOWED_ORIGINS` で渡します。次は既存の秘密値等を設定済みのdev環境で、静的公開工程を省略する例です。

```sh
ALLOWED_ORIGINS=https://static.example npm run deploy:aws:dev -- --api-only
```

`--api-only` は静的クライアントのビルド、S3同期、CloudFront invalidationを省略し、シナリオ生成、AWS用シナリオ監査、クライアントのソース境界監査、SAM build/deployを維持します。ヘルスチェックは `ApiEndpoint` の `/api/health` を使います。既存S3・CloudFront資源は削除せず、外部ホストへのアップロードも行いません。stg・prodでも同じオプションを使えます。

`ALLOWED_ORIGINS` は配備処理の開始前に検証し、SAMの `AllowedOrigins` へ渡します。未指定・空文字での配備は許可設定を空へ戻すため、継続して利用するoriginは毎回渡してください。クライアントを作らないAPI-onlyでは、クライアント用の保存設定や `VITE_XSTORYPHONE_API_BASE_URL` は使用・検証しません。初回導入や `clientRevision` が変わる更新はAPI-onlyだけでは完了しないため、[APIと画面を揃える更新手順](external-hosting.md#更新とclientrevision)も確認してください。

## 環境設定

環境名、スタック名、同時実行上限、ログ保持日数は `scripts/deploy-aws.mjs` で管理します。`infra/aws/samconfig.toml` はリージョン、変更確認、CloudFormation用S3の解決など、SAM CLIの設定を持ちます。秘密値はどちらのファイルにも記録しません。

作品ごとにAWS資源を分ける場合は、配備時に`XSTORYPHONE_PROJECT_NAME=my-story`を指定します。未指定は`xstoryphone`で、標準名を維持します。英小文字で始まる小文字英数字・ハイフンの1〜24文字とし、S3の予約prefixは使えません。24文字上限は、S3名へ環境・account・regionを付ける余裕を残すためです。stack名は`my-story-dev`等になります。名前変更は別stackへの配備であり、旧資源やデータを移行・削除しません。

既存のCloudFront用WAFv2 WebACLを関連付ける場合だけ、`WEB_ACL_ARN`へus-east-1の`global/webacl/...` ARNを渡します。WebACLやルールは自動作成しません。未指定では既存parameterを維持し、新規stackでは関連付けなしです。`WEB_ACL_ARN=''`を明示して再配備すると解除します。SAMの省略parameterは更新時に以前の値を使うため、空文字と未指定を区別してください。

コンソール等で直接設定した関連付けを自動で取り込む機能ではありません。本設定へ移す最初の配備では既存のARNを明示してください。

このWAF設定が保護するのはCloudFront経由だけです。公開される`ApiEndpoint`（execute-api）への直接アクセスは保護しません。アクセスコードの総当たりや外部生成費用の上限を、この関連付けだけで保証するものではありません。

プレイヤー画面の保存名には `VITE_XSTORYPHONE_STORAGE_PREFIX`、保持方式には `VITE_XSTORYPHONE_CLIENT_STORAGE=persistent|memory` を、クライアントをビルドする環境またはViteが読む `.env` 等で設定します。未指定は従来の保存を維持します。共有originのpersistent公開では重複しないprefixを指定してください。memoryはbrowser/staticで利用でき、serverとの組合せや不正値はクライアントビルドで拒否します。クラウドを変更しない `npm run build:aws` でも検証できます。prefix変更時の旧保存の扱い、memoryの寿命と保証範囲は[クライアント保存の設定](player-modes.md#クライアント保存の設定)を参照してください。

実プレイ入力を分岐監修へ保存する場合だけ、デプロイ時に `PLAYER_INPUT_LOGGING=true` を設定してください。未設定または `false` の場合は保存しません。入力本文をCloudWatch Logsへ出力する処理はありません。

browserモードでは、入力ログ・外部生成音声・アクセスコード管理を使わなければ通常プレイによるDynamoDB書込みはありません。外部生成音声を準備する作品では、非公開の元台本を含む補助jobを保存します。アクセスコードを必須にする場合は`ACCESS_CODE_SECRET`も渡してください。未設定ならデプロイ前に停止します。DynamoDB自体は運営レビュー画面の試行入力と監修指示にも使います。

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

一つのeventで解決するhook LLM要求の上限は `LLM_HOOK_MAX_REQUESTS`（既定5）です。変更する場合はデプロイ時の環境変数へ設定します。通信retryやmatchの標本数とは別であり、上限内でもLambda全体の実行時間以内に収まるとは限りません。

GA4による任意の計測を使う場合だけ、デプロイ実行時の環境変数へ `VITE_XSTORYPHONE_GA4_MEASUREMENT_ID` を設定します。未設定または `VITE_XSTORYPHONE_CLIENT_STORAGE=memory` なら外部スクリプトを読み込みません。有効にする場合は、実際の送信内容に合わせてプライバシーポリシーを更新してください。

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
