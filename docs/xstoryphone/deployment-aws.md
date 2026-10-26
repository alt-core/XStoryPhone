# AWSへの公開

AWS版は、CloudFront、非公開S3、Lambda Web Functions、DynamoDB On-DemandをAWS SAMで作成します。静的ファイルはS3、`/api/*`はCloudFrontのOrigin Access Control（OAC）を通してWeb Functionへ配信します。API Gateway、VPC、NAT Gatewayは使用しません。Cloudflare版と同じクライアント、API、シナリオ処理を使います。

## 前提

- Node.js 22.18以降（AWS上のAPI実行環境はNode.js 24）
- `lambda-web`に対応するAWS CLI（2.38.1で動作確認）
- Web Functionsに対応するAWS SAM CLI（1.169.0で動作確認）と、対応するリソース定義を持つcfn-lint
- デプロイ先アカウントでCloudFormation、Lambda Web Functions、DynamoDB、S3、CloudFront、IAM、CloudWatch Logsを作成・更新できる認証情報

cfn-lintがWeb Functionのリソースやプロパティを認識しない場合は、`cfn-lint --update-specs`で定義を更新してください。この更新にはネットワーク接続が必要です。認証・認可エラーが出た場合は、別アカウントや別の認証経路へ切り替えず、認証情報と権限を確認してください。

Homebrewで導入したSAM CLIに同梱されたcfn-lintは、次のコマンドで更新できます。

```sh
"$(brew --prefix aws-sam-cli)/libexec/bin/cfn-lint" --update-specs
```

初期設定は次のとおりです。

- リージョン: `ap-northeast-1`
- 公開URLとAPIの接続先: CloudFront標準ドメイン
- プレイヤー入力ログ: 無効
- DynamoDBと静的ファイル用S3: スタック削除時も保持
- コード用S3とその読取policy: 独立したartifactsスタックで管理し、削除時も保持
- Web Functionの中央・ローカルログ: devは7日、stg/prodは14日

Web FunctionのoriginはIAM認証とCloudFrontの呼出policyで保護し、署名なしの直接アクセスを拒否します。アプリのAuthorizationはOAC署名と別に維持し、API応答は正常・エラーともCloudFrontでキャッシュしません。クライアントや監修画面の接続先に、private originのURLを指定しないでください。

API配信には`CachingDisabled`と`AllViewerExceptHostHeader`を使い、viewerのHostはoriginへ渡しません。API用OACは`lambda`・`always-amz-auth`・`sigv4`を指定します。アプリのBearer認証をOAC署名へ置き換えたり、認証転送のためにAPIキャッシュを有効にしたりしないでください。

## ローカル検証

クラウドへ接続せず、テンプレートとビルドを確認できます。

```sh
npm run check
npm test
npm run build:aws
npm run aws:validate
npm run aws:build
```

`npm run aws:validate` はローカルのSAM CLIでテンプレートを検証します。`npm run build:aws` は静的クライアントを、`npm run aws:build` はAPIのbundleとZIPを作り、AWS API用の成果物を `.aws-sam/web-api/` に出力します。これらはデプロイしません。Web FunctionのZIPは独自のビルド処理で作るため、`sam build`や`sam package`でローカルCodeUriを処理する手順は使いません。

SAMは生成したEndpointからRevisionを`GetAtt`で参照し、同じRevisionを`DependsOn`にも列挙します。依存関係は正しく保たれますが、cfn-lintはこの重複を`W3005`として警告し、`sam validate --lint`は警告だけでも失敗します。そのため、`AppWebFunction`のresource Metadataで、この警告だけを除外しています。lint時は同じWeb Functionから生成される本体・Revision・Endpointの3資源へ適用され、他資源の`W3005`や、それ以外の検査は維持されます。SAM側の重複生成が解消されたら、この限定除外を削除してください。

APIのZIPにはシナリオや非公開の判定処理を含みます。`.aws-sam/`を静的ホストへ置いたり、静的ファイル用S3へアップロードしたりしないでください。

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

スクリプトは公開境界監査、シナリオと静的クライアントのビルド、APIのbundle・ZIP作成、非公開コード用S3への配置、SAM deploy、Web Functionの呼出policy確認、CloudFrontの配備待機とヘルスチェックを行います。APIの確認を通ってから静的S3同期・CloudFront invalidationを行い、最後にヘルスチェックを再実行します。失敗した段階で停止し、後続の静的公開工程へ進みません。リソース定義の正本は、mainスタックの `infra/aws/template.yaml` とコード保管用の `infra/aws/artifacts.yaml` です。

コード保管用スタックはmainスタック名に`-artifacts`を付けた名前です。ZIPは内容hashを使う`releases/`配下へ置き、S3のBucket・Key・Versionを指定して配備します。CloudFormationのテンプレート用ファイルは同じ非公開バケットの`cloudformation/`配下へ分けます。既存のSAM管理バケットの権限や内容は変更しません。

### API Gateway構成からの初回切替

既存のAPI Gateway・従来Lambda構成から切り替える場合は、通常の再配備とは分けて扱います。切替前に既知正常のコード、テンプレート、必要な設定・秘密値と復旧用資材を確保してください。

`--no-execute-changeset`を付けると、APIコードの作成・非公開S3への配置までは行い、mainスタックの変更セットを作成した時点で停止します。変更セットは実行せず、health確認・静的S3同期・invalidationも行いません。`--api-only`と併用できます。

```sh
npm run deploy:aws:dev -- --no-execute-changeset
```

方式移行時は未実行変更セットを使い、実行前に人が次を確認してください。

- `AppTable`、`StaticBucket`、`Distribution`のlogical IDと物理資源を維持し、置換しないこと。
- 既存の実行roleの権限と、旧ログの保持を意図せず失わないこと。
- 進行データの移行・初期化や、署名秘密値の再生成を行わないこと。

旧ログ資源を削除する場合は、削除差分を適用する前に、その資源の`DeletionPolicy`を`Retain`へ先行更新してください。資源を削除するテンプレートへ後から保持方針を追加しても、旧ログは保護できません。

確認前に変更セットを実行しないでください。確認後は、レビューした変更セットそのものをCloudFormationコンソールまたは`aws cloudformation execute-change-set`で実行します。`UPDATE_COMPLETE`を確認してから、`--no-execute-changeset`を外して同じ配備コマンドを再実行し、呼出policy・health確認・静的公開を完了してください。`--api-only`を使った場合は再実行でも維持します。同じ内容のAPI ZIPは既存のobject versionを再利用するため、不要なuploadやrevisionを作りません。

初回はCloudFrontのorigin切替後にWeb Functionの呼出policyを設定するため、一時的に403になる期間があります。必要なメンテナンス時間を確保してください。無停止や復旧時間は保証しません。通常のWeb Function更新にはこの事前確認操作は不要で、旧新の実行方式を切り替える設定もありません。

### 外部静的ホストを使う場合

ゲーム画面を別のホストへ置く場合は、[外部静的ホスト・サブパスへの配置](external-hosting.md)に従って `dist/static` を作成します。API側へは静的ホストのoriginを `ALLOWED_ORIGINS` で渡します。次は既存の秘密値等を設定済みのdev環境で、静的公開工程を省略する例です。

```sh
ALLOWED_ORIGINS=https://static.example npm run deploy:aws:dev -- --api-only
```

`--api-only` は静的クライアントのビルド、静的S3同期、CloudFront invalidationを省略し、シナリオ生成、AWS用シナリオ監査、クライアントのソース境界監査、APIのbundle・ZIP作成と配備を維持します。ヘルスチェックは通常配備と同じCloudFrontの `/api/health` を使います。`SiteUrl` と `ApiEndpoint` は公開URLを返し、独自ドメインを設定した場合はそちらを使います。既存の静的S3・CloudFront資源は削除せず、外部ホストへのアップロードも行いません。stg・prodでも同じオプションを使えます。

`ALLOWED_ORIGINS` は配備処理の開始前に検証し、SAMの `AllowedOrigins` へ渡します。未指定・空文字での配備は許可設定を空へ戻すため、継続して利用するoriginは毎回渡してください。クライアントを作らないAPI-onlyでは、クライアント用の保存設定や `VITE_XSTORYPHONE_API_BASE_URL` は使用・検証しません。初回導入や `clientRevision` が変わる更新はAPI-onlyだけでは完了しないため、[APIと画面を揃える更新手順](external-hosting.md#更新とclientrevision)も確認してください。

### 独自ドメイン

発行済みのACM証明書を使い、既存のCloudFrontへ `play.example.com` のような名前を一つ追加できます。DNSはRoute 53に限らず、Cloudflareなど外部のDNS事業者でも管理できます。証明書の発行とDNSレコードの作成は、この配備では自動化しません。独自ドメインを指定しない新規環境は、従来どおりCloudFront標準ドメインで公開します。

1. 新しい環境では、まず独自ドメインなしで一度配備します。CloudFormationの出力 `DistributionDomainName` から、公開CNAMEの向け先となるCloudFront標準ホスト名を確認します。この出力がまだない旧版の環境では、標準ドメインを使っている `SiteUrl` のホスト名を使えます。
2. 配備先と同じAWSアカウントの **us-east-1** に、公開する名前を含むACM証明書を用意します。証明書の対象名（SAN）が `play.example.com` を含むか、対応するワイルドカードで覆うことを確認してください。DNS検証の場合はACMが示す検証用CNAMEをDNSへ置き、証明書が `ISSUED` になってから進みます。このCNAMEは自動更新にも必要なので残します。Cloudflareではプロキシを切った **DNS only** にし、検証用CNAMEは平坦化せずCNAMEのまま応答させてください。
3. 公開する名前から `DistributionDomainName` へ向けるCNAMEを、配備より先に作成します。これは証明書の検証用CNAMEとは別のレコードです。Cloudflare等のプロキシは使わずDNS onlyにします。`example.com` 自体（apex）を使う場合は、DNS事業者のCNAME平坦化・ALIAS相当の機能が必要です。CloudFrontへ名前と証明書を設定するまでは、このURLを開いても正しい証明書で応答できないため、まだプレイヤーへ案内しないでください。
4. 必要な秘密値等を設定したうえで、二つの環境変数をshellから渡して配備します。次はdevの例です。stg・prodは対応するコマンドを明示してください。

```sh
CUSTOM_DOMAIN_NAME=play.example.com \
CUSTOM_DOMAIN_CERTIFICATE_ARN=arn:aws:acm:us-east-1:123456789012:certificate/00000000-0000-0000-0000-000000000000 \
npm run deploy:aws:dev
```

`SiteUrl` と `ApiEndpoint` は `https://play.example.com` になり、`DistributionDomainName` はDNSの向け先となる標準ホスト名を返します。ヘルスチェックも独自ドメインの `/api/health` へ直接接続し、別URLへのredirectを成功扱いにしません。DNSがまだ引けない場合など、最初の確認に失敗すると静的S3同期・invalidationの前で停止します。この時点ではAPI側は更新済みの場合があるため、DNS・証明書・DNS onlyの設定を確認し、同じ配備を再実行して揃えてください。標準ドメインへ迂回して配備完了とはしません。

追加後もCloudFront標準ドメインは利用できます。標準ドメインから独自ドメインへの自動転送は追加しません。同じ公開名を複数のdistributionへ重複設定することはできないため、dev・stg・prodで異なる名前を使ってください。Cloudflare等のプロキシを通すとCDNが二重になり、WAFのIP判定もプロキシ側のIPを見てしまうため、本手順ではDNS onlyを使います。CAAレコードで証明書の発行者を制限している場合は、`amazon.com` を許可してください。

独自ドメインを外す場合は、`CUSTOM_DOMAIN_NAME='' CUSTOM_DOMAIN_CERTIFICATE_ARN=''` を付けて同じ環境へ配備し、完了後に公開用CNAMEを削除します。証明書検証用のCNAMEは、証明書の利用・更新が不要と確認するまで削除しないでください。

画面のoriginが変わるとブラウザー内の保存は自動継承されません。serverモードは、同じDB・認証設定でパスコードが引き続き受理されるなら、同じパスコードの再入力で再開できます。browserのpersistent進行は旧originに残り、新originからは読めないため、中断再開させる公開URLは公開前に確定することを推奨します。転送しても保存は移りません。memoryは通常reloadで進行を失います。保存方式の詳細は[プレイヤーモード](player-modes.md)を参照してください。

同じoriginから画面とAPIを配信する通常構成では、独自ドメインを付けるためのCORS設定追加は不要です。外部静的ホストの画面originを保ちAPIのURLだけを変える場合は、保存を初期化せず、[外部静的ホストのAPI設定](external-hosting.md#aws)を更新してください。

## 環境設定

環境名、スタック名、最大環境数、1環境の同時要求上限、ログ保持日数は `scripts/deploy-aws.mjs` で管理します。`infra/aws/samconfig.toml` はリージョンや変更確認など、SAM CLIの設定を持ちます。テンプレートのupload先S3は配備スクリプトが明示します。秘密値はどちらのファイルにも記録しません。

| 環境 | 最大環境数 | 1環境の同時要求上限 | 通常時の積 |
|---|---:|---:|---:|
| dev | 2 | 2 | 4 |
| stg | 2 | 2 | 4 |
| prod | 2 | 5 | 10 |

最大環境数は常時確保する環境数ではありません。AWSによる調整や運用イベント時の一時超過があるため、表の積は厳密な同時実行数や料金上限を保証しません。待機環境の維持時間や費用削減率も保証しません。

作品ごとにAWS資源を分ける場合は、配備時に`XSTORYPHONE_PROJECT_NAME=my-story`を指定します。未指定は`xstoryphone`で、標準名を維持します。英小文字で始まる小文字英数字・ハイフンの1〜24文字とし、S3の予約prefixは使えません。24文字上限は、S3名へ環境・account・regionを付ける余裕を残すためです。stack名は`my-story-dev`等になります。名前変更は別stackへの配備であり、旧資源やデータを移行・削除しません。

既存のCloudFront用WAFv2 WebACLを関連付ける場合だけ、`WEB_ACL_ARN`へus-east-1の`global/webacl/...` ARNを渡します。WebACLやルールは自動作成しません。未指定では既存parameterを維持し、新規stackでは関連付けなしです。`WEB_ACL_ARN=''`を明示して再配備すると解除します。SAMの省略parameterは更新時に以前の値を使うため、空文字と未指定を区別してください。

コンソール等で直接設定した関連付けを自動で取り込む機能ではありません。本設定へ移す最初の配備では既存のARNを明示してください。

このWAF設定が保護するのはCloudFront経由の通信です。APIの接続先もCloudFrontであり、署名なしでprivate originへ直接アクセスする経路は許可しません。ただし、アクセスコードの総当たりや外部生成費用の上限を、この関連付けだけで保証するものではありません。

独自ドメインは、shell環境変数 `CUSTOM_DOMAIN_NAME` と `CUSTOM_DOMAIN_CERTIFICATE_ARN` を対で指定します。`.env` の編集だけでは配備設定へ反映されません。

| 二つの変数の指定 | 動作 |
|---|---|
| 両方未指定 | 既存の設定を維持。新規stackでは独自ドメインなし |
| 両方に値を指定 | 名前と発行済み証明書を設定 |
| 両方に空文字を指定 | 独自ドメインを解除 |
| 片方だけ指定、または片方だけ空文字 | ビルド・AWS呼出し前に拒否 |

名前は小文字のホスト名で指定し、URL、path、ワイルドカード、末尾の点は付けません。国際化ドメインは `xn--` の表記を使います。証明書ARNはus-east-1のACM証明書を指定します。値の形は配備前に検査しますが、証明書の状態・所有アカウント・対象名やDNSの実設定までは事前照会しないため、[独自ドメインの手順](#独自ドメイン)に従って確認してください。

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

このリポジトリの `infra/aws/template.yaml` では、Web Functionの要求timeoutを30秒に設定しています。AWSのHTTP入口は要求ごとに受付から27秒後を共通の締切とし、保存・応答に3秒の余裕を残します。Jev、回付先のLLM、抽出、hookが同じ締切を使い、各試行は `LLM_TIMEOUT_MS`・profileなどの設定上限と残り時間の小さい方で打ち切ります。並行要求の締切は共有しません。締切後は新しい通信を始めず、既存の再送可能なエラーに戻します。hookで明示したfallbackは従来どおりです。この内部値は環境変数ではなく、Cloudflareやローカルの制作試験には設定しません。

生成音声の投入・照会も同じ絶対期限を使います。予算不足なら保存済みintent/jobと確定した進行を保持してpendingを返し、次の通常の状態取得へ回します。受付済みの外部job IDを保存した後、照会にも残予算を適用します。作品providerにも残り時間・中断signalへの対応が必要です。投入後の受付不明は自動再投入せず、次回のprovider照合・既存のjob期限判定へ回します。契約と責務は[生成音声provider](extensions.md#要求の締切と生成の再開)を参照してください。

3秒は保存・応答のための余裕であり、DBの遅延や作品側の独自処理まで含めた完了保証ではありません。match抽出は初回2標本を並列実行し、必要なら追加標本を順次取得するため、LLMを使う作品は必要な経路を実環境で確認してください。この締切は本リポジトリのAWS構成に合わせた値で、AWS全体の上限を示すものではありません。

hookのprofileを使う場合は`LLM_PROFILE_FAST_* / SUPER_* / ULTRA_*`のうち必要な項目だけを設定します。`LLM_ANALYTICS_ENABLED=true`は本文なしのusage log、`LLM_DEBUG_LOGS=true`は入力・prompt・応答を含む調査用logです。debugは調査後にfalseへ戻してください。`LLM_RESULT_RETENTION_DAYS`はserver hook LLM cacheの保持日数で、未指定時は30日です。DynamoDBのcache itemは同じplayer partitionに保存され、期限判定に加えてTTLで遅延削除されます。

会話のrule選択にJevを使う場合は、`LLM_TALK_SELECTOR=typesafe` と `TYPESAFE_API_KEY` を環境変数で渡します。`TYPESAFE_MODEL`、`TYPESAFE_MIN_CONFIDENCE`、`TYPESAFE_ADVANCE_MIN_CONFIDENCE`、`TYPESAFE_GAME_OVER_MIN_CONFIDENCE`、`TYPESAFE_LOW_CONFIDENCE_FALLBACK` は任意です。`TYPESAFE_LOW_CONFIDENCE_FALLBACK=llm`では、LLMの設定も渡します。確信度の低い入力だけはJevとLLMの2回分の待ち時間になります。API keyはCloudFormation上で非表示にします。Jevの1試行は10秒で打ち切ります。意味は[会話エンジン](conversation.md#rule選択にjevを使う)を参照してください。

一つのeventで解決するhook LLM要求の上限は `LLM_HOOK_MAX_REQUESTS`（既定5）です。変更する場合はデプロイ時の環境変数へ設定します。通信retryやmatchの標本数とは別であり、上限内でも要求の処理時間以内に収まるとは限りません。

GA4による任意の計測を使う場合だけ、デプロイ実行時の環境変数へ `VITE_XSTORYPHONE_GA4_MEASUREMENT_ID` を設定します。未設定または `VITE_XSTORYPHONE_CLIENT_STORAGE=memory` なら外部スクリプトを読み込みません。有効にする場合は、実際の送信内容に合わせてプライバシーポリシーを更新してください。

## 更新とロールバック

通常の更新は同じ環境のデプロイコマンドを再実行します。復旧には、既知正常のコード・テンプレート・設定と、API ZIPのS3 Bucket・Key・Versionを使って再配備します。古いWeb Function revisionが残っていることを前提にせず、復旧用ZIPを保持してください。`clientRevision`が変わる復旧では静的クライアントも同じ版へ揃えます。

Web Functionは配備後もコードのobject versionを参照するため、使用中や復旧用のZIP、対応する読取policyを削除しないでください。日数だけを理由に削除する自動処理はありません。コードや読取権限の喪失でrevisionが永久にFailedとなった場合は、資材・権限を復元したうえで新しいrevisionを配備します。復旧のために進行データや署名秘密値を初期化しません。

静的ファイルだけを戻す場合は、正常なコミットで `npm run build:aws` を行い、対象バケットへ再同期してCloudFront invalidationを作成します。

### Web Functionの入口が置き換えになる場合

Web Functionの入口（`AppWebFunctionEndpoint`）は、環境名を入口名に使います。同じWeb Functionで入口名を維持したまま入口を置き換えると、CloudFormationは同じ名前の新しい入口を先に作ろうとして `AlreadyExists` で失敗します。テンプレートを変えていなくても、SAMの変換の更新で同じ置き換えが発生する場合があります。2026年10月の更新では、生成されるEndpointの`FunctionName`が関数名からARN参照へ変わるため、更新前の形式で作成した入口が該当する場合があります。該当するかは変更セットで確認してください。

このSAM変換の変更だけが原因で失敗し、ロールバックが正常に完了した場合は、従来の入口と公開中の版が維持されます。

1. `--no-execute-changeset` を付けて配備コマンドを実行し、作成された変更セットで `AppWebFunctionEndpoint` が置き換えになっていることと、その原因の項目を確認します。意図しないテンプレートの変更が原因なら、その変更を戻します。
2. `infra/aws/template.yaml` の `EndpointName` を一時的に別の名前（例: `!Sub ${EnvironmentName}-swap`）へ変えて配備します。新しい入口が作られ、CloudFrontの向き先が替わり、古い入口は削除されます。
3. `EndpointName` を元に戻し、もう一度配備します。

どちらの配備でも、配備コマンドが新しい入口へCloudFrontからの呼出policyを設定します。入口が替わってから設定が終わるまでの間、APIは403になります。prodでは必要なメンテナンス時間を確保してください。

## 削除

CloudFormationスタックはSAM CLIで削除できます。

```sh
sam delete --stack-name xstoryphone-dev --config-file infra/aws/samconfig.toml --config-env dev
```

DynamoDBテーブルと静的S3バケットは誤消去防止のため保持されます。コード保管用の`xstoryphone-dev-artifacts`スタックは別に管理され、mainスタックを削除しても残ります。そのスタックを削除する場合も、コード用S3と読取policyは保持されます。

完全に削除する場合は、必要なバックアップと使用中・復旧用revisionを確認したうえで、保持資源をそれぞれ明示的に削除してください。ZIPのobject versionを消すと、稼働中のWeb Functionも利用不能になる場合があります。この操作は復元困難なので、対象の環境名とAWSアカウントを必ず確認してください。

## 初期範囲外

- 既存D1データの移行
- Route 53のレコード管理とACM証明書発行の自動化（独自ドメインは発行済み証明書を利用）
- Bedrock、Polly
- Lambda Function URL
- DynamoDB PITR
- D1とDynamoDBの同期、マルチクラウド自動切替

必要になった機能だけを後から追加します。
