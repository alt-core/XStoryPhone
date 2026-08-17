# 作品固有の拡張

汎用コアを肥大化させないため、作品固有機能には3つの差し込み口だけを用意しています。

## 生成音声provider

`src/project/generatedAudioProviders.ts` の配列へproviderを追加します。

```ts
import type { GeneratedAudioProvider } from "../worker/providers/generatedAudio";

const myTtsProvider: GeneratedAudioProvider = {
  id: "my_tts",
  async enqueue({ definition, inputText }) {
    // 外部ジョブを開始し、externalJobIdを返す。
    return { status: "queued", externalJobId: "job-id" };
  },
  async reconcile({ job }) {
    // 完了時は、ブラウザから取得できるURLをoutputKeyへ返す。
    return { status: "ready", outputKey: "/api/project/audio/example.wav" };
  }
};

export const projectGeneratedAudioProviders = [myTtsProvider];
```

次に `scenario.json` の `generatedAudio[].provider` を同じIDへ変更します。serverモードのhookから `context.genAudio.prepare(id, { inputText })` を呼ぶと、CloudflareではD1、AWSではDynamoDBを使う共通ジョブ管理へ接続されます。browserモードは外部生成ジョブを保存せず、`staticUrl` の音声だけを使います。

ラジオ投稿などの入力を作品固有hookで審査するときは、受理できない入力を `context.form.reject("message_rejected")` で返せます。ゲームオーバーにする入力は `context.form.gameOver()`、生成音声を準備する受理経路は `context.genAudio.prepare()` を使います。フォームUIと共通APIを保ったまま、LLM審査や外部で生成した音声を使う処理だけを作品側へ置けます。

外部の音声生成サービスに固有の認証、payload、polling、音声保存はprovider内だけに置けます。

## 作品固有API

`src/project/routes.ts` の `registerProjectRoutes` へHono routeを追加します。外部処理のcallbackや、作品固有データの取得などに使えます。

汎用APIと衝突しないよう、`/api/project/` 以下を推奨します。

## 作品固有Stage

`src/project/ProjectStage.svelte` はゲーム内画面の構成親です。標準実装は受け取った `phone` snippetを一度だけ表示するため、従来のスマートフォン体験は変わりません。端末外の画面が必要な作品では、このファイルへPhoneStageと同格の作品固有Stageを追加します。

PhoneStageの表示は次の3種類です。

- `focused`: 通常表示。端末内部を操作できます。
- `embedded`: 端末フレームを含めて表示を維持しますが、端末内部は `inert` になり操作できません。
- `hidden`: DOMの状態を維持したまま非表示にします。

作品側は `{@render phone({ mode: "embedded" })}` のように表示方法を指定し、配置と大きさは外側のコンテナで決めます。phone snippetは同時に一度だけ描画してください。読み取り用の安定したDOM参照には `data-phone-stage`、`data-phone-shell`、`data-phone-screen` を使い、`PhoneFrame`の内部classやPlayerStateの適用処理へ直接依存しないでください。

`context` には現在のsession、PlayerState、明示公開された `projectState` と、`dispatchScenarioEvent` が渡されます。作品固有Stageから進行eventを送る場合は、APIを直接呼ばず `context.dispatchScenarioEvent(eventId, fields)` を使います。成功後のPlayerStateはコアと同じ経路で適用されます。呼び出すeventは従来どおり `clientCallableEvents` へ明示してください。

Stage表示に必要な状態変数だけを、scenario最上位の `publicStateVariables` へ列挙します。指定していない状態変数はクライアントへ公開されません。

```json
{
  "publicStateVariables": ["presentation_started"]
}
```

作品固有Stageで復旧不能な例外が起きた場合は、PhoneStageだけへ戻さず、既存のゲーム外エラー画面を表示します。

この3点は、必要な作品だけが固有コードを追加し、汎用コアを小さく保つための境界です。

## 予約イベントと着信

作品固有hookから、汎用の予約イベントと着信UIを利用できます。

```ts
context.schedule.after("scheduled_call", 30_000, "show_scheduled_call");
context.incomingCall.show("scheduled_call");
```

`scenario.json` の `incomingCalls` へ表示名と任意の音声URLを定義します。`transcript` に音声開始からのミリ秒と本文を並べると、通話中の字幕として同期表示されます。電話アプリの履歴で音声と全文書き起こしを提供する場合は、別途 `phone` コンテンツの `record.audioUrl` と `record.transcript` に同じ形式で定義します。

初回ログインからの相対時間で開始するものは `initialSchedules` に定義できます。作品固有の発火条件はhookに置き、予約処理と着信UIはコアを再利用します。
