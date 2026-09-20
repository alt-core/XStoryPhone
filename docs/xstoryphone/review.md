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

固定の`search_agent`も通常のtalkとして一覧に含まれます。検索AIの案内block、ヒント分岐、`/search` stepを、メッセージやチャットと同じ監修手順で確認できます。

発話にQuick Replyがある場合は、台詞と一緒に返信候補を確認できます。`/input show / hide / enable / disable`もnextのstepとして表示されるため、自由入力composerと選択肢の切り替わりを台本順に監修できます。

シミュレーターの入力は監修用ストレージへ保存され、実プレイログとは区別されます。検索AIでは、入力時に選ばれる条件blockと検索結果件数も表示します。検索は監修用の状態presetに対して評価し、プレイヤーの進行状態や発見済み情報は変更しません。

試行レコードには、setと抽出値を反映した返信本文、添付、Quick Reply、入力、抽出結果、選択根拠を保存します。LLMを使った場合はdecision/confidence/reasonと照合用hashも含みます。長いpromptやHTTP応答全体を通常のDB記録へ複製しません。後から確認する場合は、認証付きの`/api/admin/talk-branch-review/from?talkId=...&fromId=...`の`branches[].trialInputs[].responseSnapshot`、または指示のJSONレポートの`sourceInputs[].responseSnapshot`を参照してください。これは監修時の条件presetに基づく試行結果で、任意の本番プレイヤーの状態やhook副作用を再現するものではありません。

## 実プレイ入力の一覧

`PLAYER_INPUT_LOGGING=true` で保存した検索語と会話入力を、そのまま確認する軽量な一覧画面もあります。

```text
/api/admin/player-input-review
```

player ID、会話ID、状態、入力・返答本文、開始日時・終了日時で絞り込み、CSVで保存できます。日時は`2026-09-01T00:00:00Z`のようなタイムゾーン付きISO日時を指定します。開始日時を含み、終了日時を含まない範囲です。「次の古い入力」で続きを取得でき、同じ時刻の入力も取りこぼしません。CSVは現在の絞込み・ページの範囲を出力します。

この一覧にfrom ID・rule ID専用の絞込み欄はありません。会話・期間等を絞ったうえでCSVの`from_id`・`rule_id`を確認してください。必要な期間が複数ページにまたがる場合は、各ページのCSVを取得します。

JSON APIは`/api/admin/player-input-review/events`です。`after`、`before`、`status`、`playerId`、`talkId`、`q`、`limit`を指定でき、返された`nextCursor`を同じ条件の`cursor`へ渡すと続きになります。cursorは配信先固有の継続位置なので、環境を跨いで使いません。認証方法は会話分岐レビューと同じです。この画面は入力の見落とし確認と検索語の改善用で、会話分岐のシミュレーションや監修指示は従来の会話分岐レビューで行います。

## 入力集計

画面は未集計の実プレイ入力も黄色の仮グループとしてすぐに表示します。意味の近い入力をまとめ、分岐との適合度を青・黄・赤で保存する場合はLLM集計を実行します。

分岐の件数は保存済みの全実入力を数えます。未集計入力のプレビューは会話地点ごとの直近1000件ですが、保存済みクラスタや監修指示の根拠はIDを指定して取得するため、その範囲より古くてもDBに残る本文を確認できます。運用方針で実際に削除した本文は復元せず、代表入力で代用もしません。DynamoDBでは会話地点のGSIをQueryして集計するため、件数が大きいほど管理画面の読取り負荷が増えます。全件集計を高頻度に自動実行する想定ではありません。

直近1000件は分岐ごとの枠ではないため、入力の少ない分岐では件数があっても未集計プレビューが0件になる場合があります。表示件数自体は全件分です。

分岐定義の変更により現行rule IDと一致しなくなった未対応の監修指示は、同じtalk/fromの詳細に「現行分岐に対応しない指示」として分けて表示します。保存済みの根拠入力・試行本文を確認し、既存の編集・削除操作を利用できます。新しい分岐へ自動で付け替えることはありません。talk/from自体を削除した場合は詳細画面の対象外なので、保存済み指示のレポートで確認してください。

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

集計する入力数は分岐ごとに`--limit-events=...`で指定します（既定500件、最大500件、直近順）。件数表示と実際に分析する範囲を分けて表示し、他の分岐が多いため少数の分岐が取得対象から消えることを避けています。LLMへは場面context、criteria、mode、返答を渡し、代表文は実入力から選びます。

シナリオ更新後の入力は、保存rule IDと現行rule IDが一致したものだけを現在の分岐に含めます。nextや返信が同じでも推定で付け替えません。一致しない古い入力は削除せず、件数を別に示し、実入力一覧と保存済み指示のレポートに保持します。

## レポート

認証headerを付けて次へアクセスします。

- Markdown: `/api/admin/talk-branch-review/report`
- JSON: `/api/admin/talk-branch-review/report?format=json`

ステータスは `open`、`reported`、`applied`、`dismissed` です。

Markdownには日本語の指示種別、talk/from/rule IDと監修者別件数を含め、修正依頼へそのまま渡せます。通常の編集と削除は`open`の指示だけを変更します。適用済み等へ移した後、古い画面から編集しても書き換わりません。ステータスの明示変更APIは、引き続き各状態への変更を受け付けます。

## 保存情報への注意

`PLAYER_INPUT_LOGGING=true` の場合、検索語と会話入力を監修集計用の入力ログへ保存します。未設定または `false` では新しい実プレイ入力を追加しませんが、既存ログは自動削除されず、引き続き集計へ表示されます。監修画面の試行入力と監修指示は設定にかかわらず利用できます。serverモードの会話・検索履歴はサーバーDBへ、browserモードの履歴はプレイヤー端末のIndexedDBだけへ保存されます。browserモードでも入力ログを有効にした場合は、その検索語と会話入力だけが監修用DBへ送られます。開始前画面とプライバシーポリシーで利用目的を明示し、個人情報を入力しないよう案内してください。レビューAPIをトークンなしで公開しないでください。
