# Google Sheetsでシナリオを制作する

シナリオ制作の原本はGoogle Sheetsです。取得したTSVをローカルで検証・ビルドし、公開可能な初期表示と、サーバー専用の本文・条件・hookへ分けて生成します。プレイ中のエンジンはGoogle Sheetsへ接続しません。

```text
Google Sheets → pull → authoring/*.tsv → 検証・生成 → 実行・監修
                         ↕ compare
                 明示的なputでSheetへ反映
```

ローカルでTSVを編集して差分をレビューすることもできます。Sheets側と同時編集した場合はcompareで差を確認してから反映してください。自動マージはしません。

## 原本と生成物

- `scenario/<作品>/scenario.source.json`: Sheet ID、表名の対応、TSVの配置先だけを持つ接続設定。
- `scenario/<作品>/authoring/*.tsv`: 取得・編集する制作データ。メモ、画像定義、状態、通知、hookも含みます。
- `public/` の作品素材: TSVが参照する画像・音声・動画・HTMLの実ファイル。
- `src/generated/`、`src/client/generated/`: `scenario:build`が作る出力。手で編集しません。

別の`scenario.json`や`hooks.ts`を制作原本として併用しません。hook本文は`hooks`表の`script`セルに書き、同期handlerへそのまま生成します。作品固有の画面・API・音声providerは引き続き`src/project/`のコードで実装できます。

## 作品とSheetの指定

デモのディレクトリを作品用へ複製し、`XSTORYPHONE_SCENARIO_DIR`で選択します。

```sh
XSTORYPHONE_SCENARIO_DIR=scenario/my-story npm run scenario:build
```

接続設定の`scenarioAuthoring`は次の形です。`tables`にはデモの設定にある表一覧を維持してください。ここでは一部だけを示します。

```json
{
  "scenarioAuthoring": {
    "sourceMode": "tsv-export-first",
    "spreadsheetId": "作品のSpreadsheet ID",
    "exportDir": "authoring",
    "tables": {
      "note_items": "メモ",
      "photo_items": "アルバム"
    }
  }
}
```

`exportDir`はこの設定ファイルのあるディレクトリを基準に解決します。論理表名と実際のSheet名は別に指定でき、上の例では`authoring/メモ.tsv`を読みます。Sheet名の重複やファイルpathになる名前は拒否します。

`talk_flow`、`talk_blocks`を含む標準表は空でもheaderを残します。メール、ブラウザ、部分履歴、初期予約、作品独自itemの追加表は、使わない作品では設定から省略できます。デモは全表を同梱しています。検索AIの本文・分岐は会話表へ統合されており、検索AI専用の旧応答表はありません。

## 取得・照合・投入

利用するSheetへアクセスできるservice accountのcredentialファイルを、リポジトリの外、またはignore対象の`.secrets/`へ置きます。credential自体は公開しません。下の環境変数はshellで設定します。同期scriptは`.env`や他のcredentialを自動探索しません。

```sh
export XSTORYPHONE_SCENARIO_DIR=scenario/my-story
export GOOGLE_APPLICATION_CREDENTIALS='/path/to/service-account.json'
export XSTORYPHONE_SCENARIO_SPREADSHEET_ID='対象のSpreadsheet ID'
npm run scenario:sheets:pull
npm run scenario:build
```

Sheet IDは `--spreadsheet-id`、環境変数、manifestの順に優先します。credentialは `--credentials`、`GOOGLE_APPLICATION_CREDENTIALS`の順です。別のmanifestは`--scenario path/to/scenario.source.json`で指定できます。

作品のリポジトリを公開する場合は、実運用のSheet IDをmanifestへ記録せず、環境変数または引数で渡すことを推奨します。Sheet ID自体は認証情報ではありませんが、共有先の公開範囲も確認してください。service accountの秘密鍵は別に管理します。

必要な表だけ取得する場合、論理表名をカンマ区切りで指定できます。

```sh
npm run scenario:sheets:pull -- --tables note_items,photo_items
npm run scenario:sheets:compare
```

pullは選択した全Sheetの取得に成功してから、ローカルTSVを書き換えます。compareは値と余剰セルの差を報告するだけで、Sheetへ書き込みません。認証・権限エラー時は停止し、別アカウント等へ切り替えません。

ローカルで編集したTSVをSheetへ反映する場合だけ、次を実行します。

```sh
npm run scenario:sheets:put -- --yes-overwrite-google-sheets-with-local-tsv
```

**putは設定された全表をローカルTSVで上書きします。** Sheetの作成、行列サイズ・列幅の調整、既存セルのclear、RAW値の書込みを行います。セル単位の差分更新ではなく、元の数式や書式を完全に保持する同期でもありません。対象と差分を確認し、必要なバックアップを取ってください。pullの`--tables`はputには使いません。build・deployから自動でputすることはありません。

## セルの書き方

- A列は`comment`。空欄の行がデータで、コメントが入った行は生成しません。完全な空行は無視します。
- `talk_blocks`だけは、A列の`*talk_id`、block名、`---`を宣言として解釈します。
- 本文やscriptはセル内改行を使えます。取得時にTSVの引用符・改行を保ちます。
- ID・参照・enumは前後空白を除去します。ただし`project_constants`の`project.id`は保存先を識別する値のため、前後空白を自動除去せずエラーにします。本文の改行や途中の空白は保持します。
- PIN、時刻、先頭ゼロのある文字列はSheetsでプレーンテキストにします。取得はSheetの表示値です。
- `search`はセル内改行がOR、一行内の空白区切りがANDです。
- `hooks.script`へ非同期処理や外部通信を書きません。状態操作・予約・会話追加等の同期APIを使います。

hookのscriptは信頼する作者が書くコードであり、sandboxではありません。Sheetの編集者は、取得・ビルド・配備を経てWorker/Lambda上で実行されるコードを変更できます。同期APIの制限は、悪意あるscriptを安全に実行するための隔離機構ではありません。

`llm.extract`/`llm.screen`へ直接書いた文字列のschemaは、ビルド時にも実行時と同じ語彙・key規則で検査します。変数・spread等で組み立てたschemaや、eventに依存する`source`、fallbackの値は実行時の検査も必要です。該当eventを配備前にローカルで確認してください。作品独自のevent fieldを`source`へ指定する機能は維持しています。

空欄継承は次に限定します。継承値を明示的に空へ戻す場合は`-`です。

| 表 | 継承する列 |
|---|---|
| talk_flow | talk、from |
| hooks | event |
| attachments | type |
| calendar_items | date |

`-`は行を無効にする指定ではありません。解除結果が必須セルの空欄になれば検証エラーになります。行を無効にしたい場合はcomment欄を使います。

`project_constants`にはkey/value/exposureを記述します。`public`は初期clientへ配布してよい値だけにし、それ以外は`private`です。任意定数も扱えます。`client.runtime_revision`等の自動生成キーと固定PINの公開指定は拒否します。

標準設定には`project.*`、`device.*`、`search_agent.*`、`player.*`、`features.*`、`chat_auth.*`、`event.*`等を使います。未知のkeyは任意定数になり得るため、標準設定の誤記を全て検出するわけではありません。標準keyはデモと[端末設定](scenario.md#端末設定)を確認し、作品独自定数は区別できる名前にしてください。

作品名・OS名・背景等の初期画面に必要な標準設定は、表示用データにも使います。秘密情報を入れないでください。`search_agent.broken_link_tutorial_body`と`search_agent.broken_link_body`は初期clientで使う案内文なので、exposureに`public`を指定する必要があります。

列の用途は[シナリオ作成](scenario.md)、会話は[会話エンジン](conversation.md)、制作検査は[制作テスト](authoring-tests.md)を参照してください。分岐IDは定義内容から生成し、行の挿入やメモの変更では変えません。条件・返答先等の定義が変わると別IDになり、過去ログを推定で新分岐へ混ぜません。条件文字列の内部空白だけを変えた場合も別IDになることがあります。論理的に同じ式かを推定して統合する方式ではありません。

## ローカルで確認する範囲

```sh
npm run scenario:validate
npm run scenario:build
npm run scenario:talk-flow:writer-review
npm run scenario:talk-flow:examples:test
npm test
```

通常のtestやbuildはSheetsや実LLMへ接続しません。Sheets同期コマンドは実ネットワークを利用します。live LLMの制作試験は、別の明示的な課金確認flagを要求します。
