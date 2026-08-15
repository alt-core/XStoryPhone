# 運営レビュー

会話分岐レビューは、実プレイでどのruleへ分類されたかを確認し、試行入力と監修指示を残すための画面です。

`/api/admin/talk-branch-review` を開きます。localhost上のdevelopment・stagingでは、トークンを空欄のまま読み込めます。公開したdev・stg・prodでは `ADMIN_REVIEW_SECRET` が必要です。`APP_ENV` はデプロイスクリプトが対象に合わせて設定します。

## 画面でできること

- talk/fromごとの台本と分岐条件の確認
- 共通分岐、代表到達経路、複数返信、2回目以降の返信、添付の確認
- 台本行の出典色と更新日による絞り込み
- 実プレイ入力の分岐別集計
- 任意入力を使った分岐シミュレーション
- 入力を別分岐へ移す、新規分岐を作る、保留する、といった監修指示の保存
- セリフ、分類条件、入力単位のコメント
- MarkdownまたはJSONの監修レポート出力

シミュレーターの入力は監修用ストレージへ保存され、実プレイログとは区別されます。プレイヤーの進行状態も変更しません。

## 入力集計

画面は未集計の実プレイ入力も黄色の仮グループとしてすぐに表示します。意味の近い入力をまとめ、分岐との適合度を青・黄・赤で保存する場合はLLM集計を実行します。

```sh
npm run review:analyze -- --list-groups
npm run review:analyze -- --i-understand-this-sends-player-inputs-to-paid-llm
```

1つ目は入力件数だけを確認し、LLMへ送信しません。2つ目はJSONを `.wrangler/talk-branch-review-clusters.json` へ作るdry-runです。内容を確認してから、次のコマンドで監修APIへ反映します。

```sh
npm run review:analyze -- --apply-file=.wrangler/talk-branch-review-clusters.json
```

集計元と反映先はD1やDynamoDBへ直接接続せず、認証済みの監修APIを使用します。ローカル開発環境以外を対象にする場合は、URLとレビュー用secretを環境変数で指定します。

```sh
export REVIEW_BASE_URL='https://example.com'
export ADMIN_REVIEW_SECRET='設定済みのレビュー用secret'
npm run review:analyze -- --list-groups
```

集計処理は実プレイヤー入力を設定済みの外部LLMへ送るため、長い確認フラグを必須にしています。確認済みJSONの反映だけを行う `--apply-file` ではLLMへ送信しません。`--talk=...`、`--from=...`、`--rule=...`、`--limit-groups=...` で対象を絞れます。分岐先は実際の会話エンジンが記録したrule IDを使います。Cloudflare版とAWS版で同じ手順です。

## レポート

認証headerを付けて次へアクセスします。

- Markdown: `/api/admin/talk-branch-review/report`
- JSON: `/api/admin/talk-branch-review/report?format=json`

ステータスは `open`、`reported`、`applied`、`dismissed` です。

## 保存情報への注意

`PLAYER_INPUT_LOGGING=true` の場合、検索語と会話入力を監修集計用の入力ログへ保存します。未設定または `false` では新しい実プレイ入力を追加しませんが、既存ログは自動削除されず、引き続き集計へ表示されます。監修画面の試行入力と監修指示は設定にかかわらず利用できます。serverモードの会話・検索履歴はDBへ、browserモードの履歴はプレイヤーのlocalStorageだけへ保存されます。開始前画面とプライバシーポリシーで利用目的を明示し、個人情報を入力しないよう案内してください。レビューAPIをトークンなしで公開しないでください。
