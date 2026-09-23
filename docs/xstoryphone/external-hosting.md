# 外部静的ホスト・サブパスへの配置

ゲーム画面と公開素材を外部の静的ホストへ置き、CloudflareまたはAWS上のXStoryPhone APIへ接続できます。APIと画面を同じoriginへ置く従来の構成も、そのまま利用できます。静的ホストにはビルド済みファイルを配置し、シナリオ処理・判定・署名・DBはAPI側に残します。

以下では、画面を `https://static.example/works/story/`、APIを `https://api.example` として説明します。実際の配置先へ置き換えてください。

## 配置先の条件と信頼境界

- HTTPSで静的ファイルを配信でき、配置pathをビルド前に確定できること。
- JavaScript、CSS、画像・音声・動画を適切なContent-Typeで配信でき、APIとの通信と必要なiframeがホストのCSP等で禁止されていないこと。
- 作品のブラウザアプリで読むHTMLを、ゲーム画面と同じ静的originへ置けること。別originのHTMLのDOM読取りは、APIのCORS設定では許可できません。
- 公開ファイルの一覧や、配布ファイルをまとめたZIPを閲覧者へ公開しないこと。未到達素材のURLを一覧で知らせない運用が必要です。
- persistentを使う場合は必要なブラウザー保存機能を利用できること。memoryにはIndexedDB等を要求しませんが、通常reloadで進行を失います。

originはscheme・host・portの組合せです。同じ `https://static.example` の別pathも、保存とCORSの信頼境界は同じです。`ALLOWED_ORIGINS` で `/works/story/` だけを許可することはできません。同一originに置かれる他作者のコードも信頼できる運用か、配置前に確認してください。

共有originでpersistentを公開する場合は、重複しない `VITE_XSTORYPHONE_STORAGE_PREFIX` を指定します。これは保存名の誤衝突防止であり、他の同一originコードからの隔離ではありません。memoryも悪意ある同一originコードからの完全な隔離機能ではありません。保存設定、保証範囲、ホストや作者コードによるCookie等の扱いは[クライアント保存の設定](player-modes.md#クライアント保存の設定)を参照してください。

## 静的ファイルをビルドする

APIと同じソース・シナリオを用意して実行します。次のコマンドはローカルの成果物を作るだけで、アップロードやAPI配備は行いません。

```sh
XSTORYPHONE_SCENARIO_DIR=scenario/my-story \
VITE_XSTORYPHONE_API_BASE_URL=https://api.example \
VITE_XSTORYPHONE_STORAGE_PREFIX=author-story-prod \
VITE_XSTORYPHONE_RESET_FOR_TESTING=false \
npm run build:static -- --base=/works/story/
```

`build:static` は素材生成、シナリオ生成、Viteによるクライアントビルド、生成物のクライアント境界監査を順に行います。出力は `dist/static` に固定され、Cloudflare pluginやAWS固有のシナリオ監査は使いません。AWSの監査はAPIのAWS配備側で実行します。

| 設定 | 指定方法・既定値 |
|---|---|
| 静的配置path | Viteの `--base=/works/story/`。未指定は `/` |
| APIの接続先 | `VITE_XSTORYPHONE_API_BASE_URL`。未指定は現在と同じ相対 `/api/...` |
| 保存名 | `VITE_XSTORYPHONE_STORAGE_PREFIX`。未指定は従来の保存名 |
| 保存方式 | `VITE_XSTORYPHONE_CLIENT_STORAGE=persistent\|memory`。既定はpersistent、memoryはbrowser/staticで利用可能 |

baseは `/` または `/works/story/` のような固定pathです。相対baseの `./`、静的originを含む絶対URL、query・fragment、相対階層は受け付けません。ビルド後に配置pathを変更する場合は、再ビルドしてください。

日本語・空白や `@` などを含む配置名は、生の文字でもURL符号化でも指定できます。空白を含むCLI引数は引用符で囲んでください。ただし、配置フォルダー名そのものに `#`・`?`・`%` を含む場合は、使用中のViteで正しいURLを生成できないためビルド時に拒否します（`%23`・`%3F`・`%25` と符号化しても不可）。素材ファイル一般を禁止する設定ではなく、`--base` の制約です。

追加引数は `--base` と `--mode` だけを受け付けます。例えば同じコマンドの末尾に `--mode=staging` を付けると、Viteが読む `.env.staging` 等を選べます。APIの配備環境を選ぶオプションではありません。`--outDir` 等で出力・監査対象を変更することはできません。

`VITE_` 設定はshell環境変数またはViteが読む `.env` 等で指定し、実際に解決された値を起動・ビルド時に検証します。API設定はoriginのみで、末尾に `/api` や任意のpathを付けません。HTTPSを使い、ローカル確認用HTTPは `localhost`、`127.0.0.1`、`[::1]` に限定します。認証情報、query、fragmentは指定できません。これらは公開クライアントへ含まれる設定であり、秘密値を入れないでください。

アップロードするのは、**`dist/static` の中身だけ**です。例の配置先なら、その中身をホストの `/works/story/` へ置きます。`dist` 全体、Worker bundle、`.aws-sam`、`scenario/`、非公開のソースや原稿、`.env`、秘密設定は置かないでください。作品HTMLや素材を含む `public/` の内容は公開物へ複製されるので、そこへ非公開原稿を入れないでください。

## API側で静的originを許可する

API側の `ALLOWED_ORIGINS` に、画面を配信するoriginをカンマ区切りで指定します。

```text
https://static.example,https://preview.example
```

`https://static.example/works/story/` のようなpath付きURL、`*`、`null`、認証情報、query・fragmentは拒否します。ローカル確認用HTTPはAPI接続先と同じlocalhost範囲に限定します。空の項目を含むCSVも拒否します。未指定・空文字ではCORS許可を付けず、従来の同一origin構成を維持します。

CORSは共通サーバーで適用し、GET・POST・OPTIONS、Authorization・Content-Typeを許可します。Cookie認証や `Access-Control-Allow-Credentials` は追加しません。`/api/admin` とその配下は対象外です。監修画面と監修APIはAPIサーバー自身のoriginで利用してください。

CORSは認証や利用人数制限ではありません。BearerやHMACの検証は従来どおりで、Originのない正規CLIも禁止しません。Lambdaの初期化失敗・timeout、GatewayやCloudflare側の制限など、共通サーバーに到達しない応答へのCORS付与は保証しません。API Gatewayへ別のCORS設定を重ねないでください。

### AWS

[AWSの既存配備手順](deployment-aws.md)に従い、同じシナリオ、必要な秘密値等を設定したうえで、shell環境変数として `ALLOWED_ORIGINS` を渡します。`.env` の編集だけではこの配備設定へ反映されません。

```sh
XSTORYPHONE_SCENARIO_DIR=scenario/my-story \
ALLOWED_ORIGINS=https://static.example \
npm run deploy:aws:dev -- --api-only
```

本番では `deploy:aws:prod`、stgでは `deploy:aws:stg` を明示します。上のコマンドはAWSへ実際に配備します。`--api-only` は「静的公開工程を省略する」という意味です。

- 維持する処理: 公開境界監査、シナリオ生成、AWS用シナリオ監査、クライアントのソース境界監査、SAM build/deploy。
- 省略する処理: クライアントビルド、S3同期、CloudFront invalidation。
- ヘルスチェック: CloudFormation出力の `ApiEndpoint` に対する `/api/health`。通常配備は従来どおり `SiteUrl` を使います。

S3・CloudFrontは既存スタックに残ります。既存の静的ファイルを更新・削除せず、外部ホストへもアップロードしません。未知・重複したオプションは処理開始前に拒否します。

`ALLOWED_ORIGINS` は配備開始前に検証し、SAMの `AllowedOrigins` parameterへ渡します。未指定・空文字では許可設定を空へ戻すので、継続して利用する値は毎回渡してください。API-onlyでは静的クライアント用の保存設定・API接続先設定を使わず、検証もしません。これらは別途 `build:static` で検証します。

### Cloudflare

`wrangler.jsonc` の対象環境の `env.dev.vars`、`env.stg.vars`、`env.prod.vars` にある `ALLOWED_ORIGINS` を設定します。例えば対象のvarsへ次の値を設定し、[Cloudflareの既存配備手順](deployment.md)で同じ環境を配備します。

```json
"ALLOWED_ORIGINS": "https://static.example"
```

外部画面は既存WorkerのAPIへ接続します。WorkerとStatic Assetsの一体配備、既存の静的画面、D1を維持し、純粋なAPI-only Workerは新設しません。外部画面を使うために既存Workerのassets設定を削除したり、assetsなしの設定で上書きしたりしないでください。

## サブパスの入口・manifest・素材

`build:static` は最終 `index.html` と同じ内容の `logout/index.html` を生成します。`VITE_XSTORYPHONE_RESET_FOR_TESTING=true` のときだけ `reset-for-testing/index.html` も生成します。本番の静的ビルドは明示的に `false` とし、API側もproductionではテスト用リセットを許可しません。

- directory indexがあるホスト: `/works/story/`、`/works/story/logout/`、テスト時の `/works/story/reset-for-testing/` を使えます。末尾slashなしの入口は、ホスト側のdirectory indexやslash redirect対応に従います。
- directory indexがないホスト: `/works/story/index.html`、`/works/story/logout/index.html`、テスト時の `/works/story/reset-for-testing/index.html` を明示します。操作後も `/works/story/index.html` へ戻ります。

通常の端末内移動にSPA rewriteは不要です。logoutの削除範囲、本番browser + persistentでの確認、memoryで永続保存に触れない契約は[サポート用のログアウト](player-modes.md#サポート用のログアウトとローカル初期化)と同じです。

`public/manifest.webmanifest` の原本は変更せず、配布側の `id`・`start_url`・`scope`・`icons.src` のroot相対URLをbaseへ合わせます。相対指定の `id` も配置pathを含む値へ補正し、名前・色等の作者設定は保ちます。`build:static` では、directory indexのないホストでもPWAを開始できるよう、配置ルートを指す `start_url` を `index.html` へ向けます。通常のAWS/Cloudflareのbaseが `/` の場合は元のmanifestをそのまま使います。Service Workerや全素材のprecacheは追加しません。

エンジンのURL境界では、通常のroot相対素材URLは静的baseへ、`/api/...` はAPI originへ解決します。生成音声の `/api/generated-audio/static/...` もAPI側です。明示的な外部URLやdata・blob URLは維持します。第三者配信先のCORS・認証・Range対応は、その配信先の責務です。

独自Stage・アプリのnativeなimg・audio・CSS等では、`src/client/system/resourceUrls.ts` の `resourceUrl` を描画・読込み直前に一度だけ使ってください。エンジン標準部品へ渡すpropsは未解決の原URLのままにし、部品側の入口で解決させます。解決済みかを文字列prefixから推測する仕組みではないため、二重に呼ぶとbaseが重複します。進行stateや任意の本文文字列を再帰的に置換しないでください。

ブラウザアプリの作品HTML内では、リンク・画像・CSS参照を `details.html` や `./images/photo.webp` のような文書相対にするのが基本です。任意のHTML・JavaScript・CSSを自動解析してroot固定URLを書き換える処理はありません。ラジオフォームは既存のsandboxと親画面の投稿処理を維持し、CORSで `null` originを許可する必要はありません。フォーム側でメッセージ送信先originを固定している場合は、APIではなく静的画面のoriginへ合わせてください。

## 更新とclientRevision

APIと、同じAPIへ接続するすべての画面を、互換性のある同じソース・シナリオから更新します。従来のCloudflare/AWS画面と外部画面を併用する場合は、外部画面だけでなく従来の画面の版も確認してください。

1. 公開するGit commit、選択シナリオと `playerMode`、`clientRevision`、静的base、API origin、保存prefix・保存方式を記録します。
2. 同じソース・シナリオからAPIと各静的画面を作ります。生成された `src/client/generated/demoProjectConstants.generated.ts` の `client.runtime_revision` がクライアントの照合値です。
3. 必要に応じてメンテナンス時間を取り、APIを配備し、各静的画面をそれぞれの配置先へアップロードします。
4. APIの `/api/health` が返す `clientRevision` と生成値を照合し、実際の静的画面から開始・再開・素材表示・操作入口を確認します。healthの成功だけではCORSや古い静的cacheまで確認できません。

配置base・API接続先・保存prefix・保存方式だけが異なる同じソース・シナリオの画面は、同じ互換revisionを共有します。`playerMode` はAPIと画面で一致させてください。

初回導入や `clientRevision` が変わる更新は、API-only配備だけでは完了しません。既存画面を据え置けるのは、API内部の更新等で `clientRevision` が変わらない場合です。静的アップロードとAPI配備を原子的には切り替えないため、API-onlyを含め無停止更新は保証しません。HTMLの長期cacheや、更新直後の旧hash素材の一斉削除は避けてください。

persistentはAPIと画面のrevision不一致で一度reloadし、それでも古い場合は `AP-UPDATE` で停止します。memoryは進行を失う自動reloadをせず、同じエラーで停止します。API接続やCORSを誤設定したときに、保存を削除して直そうとしないでください。

画面を別originへ移しても、ブラウザーの保存は自動移行しません。serverモードは同じAPIへ同じパスコードで再開できます。browserの保存やmemoryの寿命、prefix変更時の旧保存の扱いは[保存モード](player-modes.md)を確認してください。
