# XStoryPhone

XStoryPhoneは、仮想スマートフォンを舞台に物語を作るための完成テンプレートです。リポジトリをcloneし、デモシナリオを書き換えて制作を始めます。

端末内には、ノイズに覆われて開けないアプリやコンテンツがあります。プレイヤーは画面右下の検索AIへ語句を入力し、検索結果から対象を開くことでデータを修復します。検索AIは独立したアプリではなく、どの画面からも呼び出せるオーバーレイです。

## 主な機能

- 電話、メッセージ、メモ、アルバム、スケジュール、ラジオ、チャットの各UI
- 検索AIオーバーレイと、検索結果を開いた時だけ行うデータ修復
- JSONとTSVによるシナリオ作成
- 状態条件によるアプリ、コンテンツ、会話、通知、検索応答の出し分け
- 正規表現だけでも運用できる会話分岐と、任意のLLM provider
- 状態変数、ToDo、通知、シナリオhook
- 実プレイ入力の確認、分岐試行、監修指示、レポート出力を行う運営レビュー画面
- 認証・DB保存型と、無料公開向けのブラウザー保存型
- 外部で生成した音声、作品固有API、Stageを追加するための薄い拡張口

検索AIの標準キャラクター「ナビ」は、画像生成物ではなく、ビルド時に作るオレンジ色の円だけのSVGスプライトです。

## クイックスタート

Node.js 22.18以降を用意してください。

```sh
npm install
npm run db:migrate:local
npm run dev
```

- ゲーム: `http://127.0.0.1:5173/`
- 会話分岐レビュー: `http://127.0.0.1:5173/api/admin/talk-branch-review`

既定のserverモードでは、localhost上は4桁または8桁、公開環境は8桁のパスコードを使います。初回入力で匿名プレイデータを作り、同じコードを入力すると続きから再開できます。browserモードではパスコードを使わず、このブラウザーへ進行を保存します。

## 最初に編集する場所

1. `scenario/demo/scenario.json` で、作品名、OS名、アプリ、コンテンツ、通知、hookを編集します。
2. `scenario/demo/authoring/talk_blocks.tsv` で会話本文、添付、表示間隔を編集します。
3. `scenario/demo/authoring/talk_flow.tsv` で会話分岐を編集します。
4. `src/project/hooks.ts` に作品固有の状態変化を書きます。
5. 端末外の画面が必要な作品では、`src/project/ProjectStage.svelte` に作品固有Stageを追加します。
6. `public/demo/` のデモ素材を作品の素材へ置き換えます。
7. `index.html`、`public/manifest.webmanifest`、`public/icons/` のPWA名とアイコンを作品に合わせます。
8. `public/privacy-policy.html` を実際の運用内容へ書き換えます。

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
- [プレイヤー進行の保存モード](docs/xstoryphone/player-modes.md)
- [会話エンジン](docs/xstoryphone/conversation.md)
- [運営レビュー](docs/xstoryphone/review.md)
- [作品固有の拡張](docs/xstoryphone/extensions.md)
- [Cloudflareへの公開](docs/xstoryphone/deployment.md)
- [AWSへの公開](docs/xstoryphone/deployment-aws.md)

## ライセンス

XStoryPhone本体と、特記のないプロジェクト制作アセットには[MIT License](LICENSE)を適用します。

- [外部OSSのライセンス表示](THIRD_PARTY_NOTICES.md)
- [画像・音声・CSS意匠の権利情報](ASSET_CREDITS.md)
