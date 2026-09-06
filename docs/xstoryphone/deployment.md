# Cloudflareへの公開

XStoryPhoneは、Cloudflare Workers、Static Assets、D1を使います。

## 環境

ゲームAPIは `wrangler.jsonc` の `env.dev`、`env.stg`、`env.prod` に分けています。top-levelは誤デプロイ防止用Workerであり、ゲームAPIやD1を含みません。

| 環境 | Worker名 | D1 database | `APP_ENV` | テストプレイ用リセット |
|---|---|---|---|---|
| dev | `xstoryphone-dev` | `xstoryphone-dev` | `development` | 有効 |
| stg | `xstoryphone-stg` | `xstoryphone-stg` | `staging` | 有効 |
| prod | `xstoryphone` | `xstoryphone` | `production` | 無効 |

通常の `npm run build` と `npm run build:cloudflare` はdevを選びます。`npm run deploy` は環境未指定として停止するため、必ず `deploy:cloudflare:dev`、`deploy:cloudflare:stg`、`deploy:cloudflare:prod` のいずれかを実行してください。リモートmigrationも同様に環境名が必要です。

## 1. D1を作る

使う環境のD1を作ります。prodの例は次のとおりです。

```sh
npx wrangler d1 create xstoryphone
```

devとstgも使う場合は、それぞれ `xstoryphone-dev`、`xstoryphone-stg` を作ります。表示された `database_id` を `wrangler.jsonc` の対応する環境の仮IDと置き換えてください。D1 database IDは認証情報ではありませんが、API keyやsecretは設定ファイルへ書かないでください。

## 2. migrationを適用する

```sh
npm run db:migrate:remote:dev
npm run db:migrate:remote:stg
npm run db:migrate:remote:prod
```

必要な環境のコマンドだけを実行します。`npm run db:migrate:remote` は対象未指定として停止します。

## 3. secretと任意設定を登録する

レビュー画面のsecretを環境ごとに登録します。prodの例は次のとおりです。

```sh
npx wrangler secret put ADMIN_REVIEW_SECRET --env prod
```

`playerMode: "browser"` の場合は、進行tokenの署名用secretも同じ環境へ登録します。`server` では不要です。

```sh
npx wrangler secret put BROWSER_STATE_SECRET --env prod
```

`BROWSER_STATE_SECRET` は公開後も環境ごとに同じ値を維持してください。通常の再デプロイやシナリオ更新のたびに生成し直す値ではありません。変更すると、その環境で保存済みの進行tokenを検証できなくなります。誤って変更した場合は元の値へ戻してください。クライアントは401で保存を自動削除せず、`AP-BROWSER-STATE` を表示するため、設定復旧後にリロードして再開できます。プレイヤーへサイトデータの削除を案内しないでください。サポート用の明示初期化は[保存モードの運用説明](player-modes.md#サポート用のログアウトとローカル初期化)を参照してください。

LLMを使う場合は `LLM_API_KEY` もsecretへ登録し、model、base URL、timeoutを対象環境のvarsへ設定します。

serverモードで発行済みの8桁アクセスコードだけを受理する場合は、コード生成と同じ秘密値を登録します。人数限定を行わない場合は不要です。

```sh
npx wrangler secret put ACCESS_CODE_SECRET --env prod
```

コードは手元で発行します。連番は `0000` から `9999` までです。

```sh
ACCESS_CODE_SECRET='登録した値' npm run access-code -- 0001
```

LLM providerが推論強度の指定に対応している場合だけ、対象環境のvarsへ `LLM_REASONING_EFFORT` も設定できます。未設定時はGemini 2.5系またはFlash-Lite系の非Proへ`none`、その他のGemini 3系へ`minimal`を既定値として送り、それ以外のmodelには送りません。

hookで`fast / super / ultra`を使う場合は、必要なprofileだけ次のvarsを設定します。fastはmodel未設定時に`LLM_MODEL`を使います。super/ultraは専用model未設定時に利用不能として扱います。

```text
LLM_PROFILE_FAST_MODEL / REASONING_EFFORT / TIMEOUT_MS
LLM_PROFILE_SUPER_MODEL / REASONING_EFFORT / TIMEOUT_MS
LLM_PROFILE_ULTRA_MODEL / REASONING_EFFORT / TIMEOUT_MS
```

`LLM_ANALYTICS_ENABLED=true`は本文を含まないusage logを有効にします。`LLM_DEBUG_LOGS=true`は入力と応答を含むため、調査中だけ有効にし、調査後はfalseへ戻してください。hook LLM cacheの保持日数は`LLM_RESULT_RETENTION_DAYS`で指定し、未指定時は30日です。D1は期限切れ行を少数ずつbest-effort削除します。

GA4による任意の計測を使う場合だけ、ビルド実行時の環境変数へ `VITE_XSTORYPHONE_GA4_MEASUREMENT_ID` を設定します。未設定なら外部スクリプトを読み込みません。有効にする場合は、実際の送信内容に合わせてプライバシーポリシーを更新してください。

実プレイ入力を分岐監修へ利用する場合だけ、対象環境のvarsへ `PLAYER_INPUT_LOGGING=true` を設定します。未設定または`false`では、検索語・会話入力を追加しません。既存ログは自動削除されません。ゲーム進行と監修画面の試行入力・監修指示には影響しません。

認証sessionは、新しい認証時にプレイヤーごとの直近5件だけを残します。通常は設定不要です。6台目以降の古い端末では再認証が必要になります。

serverモードのパスコードは、localhost上のdevelopment・stagingでは4桁または8桁、それ以外では8桁です。公開されたdev・stgもlocalhostではないため、8桁を使います。

## 4. 確認して公開する

```sh
npm run audit:public
npm run check
npm test
npm run deploy:cloudflare:prod
```

Cloudflare Vite pluginでは、Cloudflare Environmentをビルド時の `CLOUDFLARE_ENV` で選びます。各デプロイスクリプトは環境を明示してビルドし、deploy時にも同じ環境名を `--env` で渡して、生成済み設定との不一致を検査します。deploy時の `--env` だけでは環境を選べないため、`wrangler deploy --env ...` を手作業で直接実行しないでください。詳しくは[Cloudflare公式の環境設定](https://developers.cloudflare.com/workers/vite-plugin/reference/cloudflare-environments/)と[移行資料](https://developers.cloudflare.com/workers/vite-plugin/reference/migrating-from-wrangler-dev/)を参照してください。

デプロイスクリプトは、対象環境のsecret名を事前確認します。`ADMIN_REVIEW_SECRET`、およびbrowserモードの `BROWSER_STATE_SECRET` が未登録なら、ビルドやデプロイを開始せず停止します。

## 公開前チェック

- `public/privacy-policy.html` を実運用に合わせた
- prodの `database_id` を置き換え、migrationを適用した
- prodの `APP_ENV` が `production` になっている
- prodへ `ADMIN_REVIEW_SECRET` を登録した
- browserモードの場合はprodへ `BROWSER_STATE_SECRET` を登録した
- 人数限定アクセスコードを使う場合はprodへ `ACCESS_CODE_SECRET` を登録し、同じ値でコードを発行した
- 実プレイ入力を保存する場合だけprodへ `PLAYER_INPUT_LOGGING=true` を設定した
- デモ素材とデモ文言を置き換えた
- 実プレイ入力の保存期間と削除方法を決めた
- `npm run audit:public` が成功した
