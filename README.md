# XStoryPhone

XStoryPhoneは、仮想スマートフォンを舞台に物語を作るための完成テンプレートです。デモを残したまま、作品用のシナリオディレクトリを追加して制作を始められます。

端末内には、ノイズに覆われて開けないアプリやコンテンツがあります。プレイヤーは画面右下の検索AIへ語句を入力し、検索結果から対象を開くことでデータを修復します。検索AIは独立したアプリではなく、どの画面からも呼び出せるオーバーレイです。

## 主な機能

- 電話、メッセージ、メール、メモ、アルバム、スケジュール、ラジオ、チャット、ブラウザの各UI
- 検索AIオーバーレイと、検索結果を開いた時だけ行うデータ修復
- Google Sheetsを正本に、取得した全表TSVからシナリオを生成
- 状態条件によるアプリ、コンテンツ、会話、通知、検索AIの台本の出し分け
- 語句・正規表現で運用できる会話分岐と、任意のLLM provider
- 全talk共通の入力欄制御とQuick Reply
- 状態変数、ToDo、通知、シナリオhook
- 実プレイ入力の確認、分岐試行、監修指示、レポート出力を行う運営レビュー画面
- 認証・DB保存型、APIで判定するブラウザー保存型、サーバーなしのstatic実行
- 外部で生成した音声、作品固有API、Stageを追加するための薄い拡張口

検索AIの標準キャラクター「ナビ」は、画像生成物ではなく、ビルド時に作るオレンジ色の円だけのSVGスプライトです。

## クイックスタート

Node.js 22.18以降を用意してください。

以下はAPIを使う構成の開発手順です。ゲームサーバーを置かない場合は[static実行の手順](docs/xstoryphone/static.md)を使ってください。

```sh
npm install
npm run db:migrate:local
npm run dev
```

- ゲーム: `http://127.0.0.1:5173/`
- 会話分岐レビュー: `http://127.0.0.1:5173/api/admin/talk-branch-review`
- 実プレイ入力一覧: `http://127.0.0.1:5173/api/admin/player-input-review`

既定のserverモードでは、localhost上は4桁または8桁、公開環境は8桁のパスコードを使います。初回入力で匿名プレイデータを作り、同じコードを入力すると続きから再開できます。browserモードはこのブラウザーへ進行を保存し、既定ではコード不要です。任意のアクセスコードによる入場制限も設定できますが、進行の引き継ぎには使いません。

## 最初に編集する場所

1. `scenario/demo/` を `scenario/my-story/` などの作品用ディレクトリへ複製します。
2. 作品用の `scenario.source.json` に、SheetとローカルTSVの対応・取得先を設定します。本文やコンテンツをJSONへ二重に書きません。
3. Google Sheetsの `project_constants`、`home_items`、`note_items`、`photo_items` などで端末設定とコンテンツを制作します。デモは取得済みTSVを同梱しているため、接続設定なしでもローカル起動できます。
4. `talk_blocks` で会話本文・添付・Quick Reply・表示間隔を、`talk_flow` で分岐を、`hooks.script` で進行処理を編集します。
5. 明示的にpullしたTSVを検証・ビルドします。ローカル修正のcompare/putを含む手順は[Google Sheetsでの制作](docs/xstoryphone/spreadsheet-authoring.md)を参照してください。buildやdeployはSheetを上書きしません。
6. 端末外の画面が必要な作品では、`src/project/ProjectStage.svelte` に作品固有Stageを追加します。
7. 作品固有アプリが必要なら、`src/project/apps.ts`へ1エントリ追加し、規約pathへcomponentを置きます。
8. `public/demo/` のデモ素材を作品の素材へ置き換えます。
9. `index.html`、`public/manifest.webmanifest`、`public/icons/` のPWA名とアイコンを作品に合わせます。
10. `public/privacy-policy.html` を実際の運用内容へ書き換えます。

作品用シナリオの既定値は、`package.json` の `"xstoryphone": { "scenarioDir": "scenario/my-story" }` で指定できます。一時的に別のシナリオを選ぶ場合は、環境変数で上書きします。選択順は環境変数 → package.json → `scenario/demo` です。

```sh
XSTORYPHONE_SCENARIO_DIR=scenario/my-story npm run dev
XSTORYPHONE_SCENARIO_DIR=scenario/my-story npm run check
```

`npm test` はエンジンの動作確認用に、温存したデモシナリオを一時的に生成して実行します。終了時には`src/generated/`と`src/client/generated/`を実行前の内容へ戻すため、選択中の作品シナリオの生成物は残ります。

編集後は次を実行します。

```sh
npm run scenario:validate
npm run audit:client
npm run check
npm test
```

`src/generated/` と `src/client/generated/` は自動生成物です。直接編集しないでください。

公開先はdev・stg・prodから明示します。Cloudflareの `npm run deploy` は対象未指定として停止し、prodへ公開する場合だけ `npm run deploy:cloudflare:prod` を使います。詳しくは公開手順を参照してください。

## XStoryPhoneのドキュメント

- [シナリオ作成](docs/xstoryphone/scenario.md)
- [Google Sheetsでの制作・同期](docs/xstoryphone/spreadsheet-authoring.md)
- [プレイヤー進行の保存モード](docs/xstoryphone/player-modes.md)
- [会話エンジン](docs/xstoryphone/conversation.md)
- [運営レビュー](docs/xstoryphone/review.md)
- [作品固有の拡張](docs/xstoryphone/extensions.md)
- [Cloudflareへの公開](docs/xstoryphone/deployment.md)
- [AWSへの公開](docs/xstoryphone/deployment-aws.md)
- [外部静的ホスト・サブパスへの配置](docs/xstoryphone/external-hosting.md)
- [サーバーなしのstatic実行とpart](docs/xstoryphone/static.md)

## ライセンス

XStoryPhone本体と、特記のないプロジェクト制作アセットには[MIT License](LICENSE)を適用します。

- [外部OSSのライセンス表示](THIRD_PARTY_NOTICES.md)
- [画像・音声・CSS意匠の権利情報](ASSET_CREDITS.md)
