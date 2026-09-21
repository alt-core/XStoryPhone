# 作品固有の拡張

汎用コアを肥大化させないため、作品固有機能には生成音声provider、API、Stage、project appの4つの差し込み口だけを用意しています。

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

次に `gen_audio` シートの `provider` を同じIDへ変更します。serverモードのhookから `context.genAudio.prepare(id, { inputText })` を呼ぶと、CloudflareではD1、AWSではDynamoDBを使う共通ジョブ管理へ接続されます。browserモードは外部生成ジョブを保存せず、`staticUrl` の音声だけを使います。

ラジオ投稿などの入力を作品固有hookで審査するときは、受理できない入力を`context.form.deny("message_rejected")`で返せます。成立した処理をゲームオーバー演出へ進める場合は`context.effectSequence.gameOver()`、生成音声を準備する受理経路は`context.genAudio.prepare()`を使います。単発の全画面演出には`context.effect.noise()`、`flash(options?)`、`blackout(options?)`を利用できます。フラッシュと暗転のoptionsには`fadeInMs`、`holdMs`、`fadeOutMs`、`intensity`を指定でき、フラッシュだけは6桁HEXの`color`も指定できます。フォームUIと共通APIを保ったまま、LLM審査や外部で生成した音声を使う処理だけを作品側へ置けます。

外部の音声生成サービスに固有の認証、payload、polling、音声保存はprovider内だけに置けます。

組み込みの`static` providerは固定音声を返すため、完了済みjobがあっても現在のシナリオ定義の音声URLを使います。外部providerのプレイヤー固有の完了済み音声URLは、そのjobの成果物を維持します。

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

`context` には、プレイヤー開始済みかを示す `playerReady`、PlayerState、明示公開された `projectState`、読み取り専用の端末表示状態 `deviceView` と、`dispatchScenarioEvent`、`unlockContent` が渡されます。`playerReady` は認証tokenではなく、作品側で表示可否を判断するbooleanです。作品固有Stageから進行eventを送る場合は、APIを直接呼ばず `context.dispatchScenarioEvent(eventId, fields)` を使います。成功後のPlayerStateはコアと同じ経路で適用されます。呼び出すeventは `project_constants` の `event.client_callable` へセル内改行で列挙してください。

Stage表示に必要な状態変数だけ、`state_vars` シートの該当行の `public` を `true` にします。例えば `presentation_started` 行に指定します。指定していない状態変数はクライアントへ公開されません。

### Stageの入力装置からpasswordを判定する

`context.unlockContent(contentId, password)`は、添付の解錠と同じ判定・part取得・hook・状態適用を使います。server/browser/static共通です。作品アプリの入力口は`project_items`へ1件として定義し、`passwords.content`にそのIDを指定してください。`src/project/apps.ts`に登録した作品アプリが対象で、添付行は不要です。例:

| id | app | initial | record |
|---|---|---|---|
| keypad | case_files | normal | `{"title":"入力装置","body":"番号を入力してください"}` |

`passwords`では`content=keypad`、`password`に引用符付きの正答候補、`load_part`に正答後の取得先を書きます。複数候補・追加取得なしの空欄も、添付と同じ仕様です。

```ts
const result = await context.unlockContent("keypad", enteredValue);
if (!result.ok) {
  // 入力を残し、invalid（誤答）等に応じて作品側の文面を表示する。
  rejection = result.error;
}
```

作品アプリではTSVのID、またはPlayerState上の公開IDを渡せます。入力口とpassword入口は取得済みにし、アプリとコンテンツが利用可能で、condを満たしている必要があります。repairableな入力口は先に修復してください。会話に登場させる必要はありません。従来の鍵付き添付は、引き続き会話内で表示済みであることが必要です。

成功時は`{ ok: true }`、不受理時は`{ ok: false, error }`です。誤答・利用不能・着信中断・hook拒否は致命エラーへ倒さず、応答のPlayerStateがあればコアへ適用してから返します。通信失敗は`unlock_unavailable`で返し、Stageは二重送信を抑止しながら再操作を案内してください。自動再送は行いません。実際の認証失効・保存障害等は既存の共通処理に従います。

`load_part`の取得、`part_loaded`、`content_unlocked`は既存の順序で実行されます。新しいpartに置いた`content_unlocked`も呼ばれます。入力文字列を会話履歴へ追加しません。staticでは正答をStageやhookへ直書きせず、`passwords`の回答JSON方式を使ってください。入力口のrecordは判定前にも公開されるため、隠したい本文・素材は取得先partへ置きます。

解錠済みかは既存の`context.playerState.contentStates`で、対象の公開IDと`state === "unlocked"`を確認できます。TSV IDで表示を管理したい場合は、`content_unlocked`で公開状態変数を立てる方法も使えます。解錠の再送でhookが呼ばれることはあるため、一度だけの演出は状態変数で守ってください。

### イベントが受理されなかった場合

`dispatchScenarioEvent` は成功時に `{ ok: true }`、不受理時に `{ ok: false, error: string }` を返します。Stageからの送信では、次の正常な不受理はゲーム外エラー画面へ移らず、応答のPlayerStateをコアへ適用してから、元の理由を作品側へ返します。

- 着信中、または先に適用した期限到来済み予約で着信が始まった場合の `incoming_call_active`。作品eventのhookは実行されません。
- hookの `context.form.deny(reason)` または `context.genAudio.reject(reason)`。拒否したhookの変更は採用されませんが、先に適用した予約などの進行は保持されます。

コアは実際のHTTP応答でこれらを識別するため、hookが `conflict` や `unauthorized` を拒否理由にしても、保存競合や認証失効として再試行・停止しません。作品側はHTTP statusを扱う必要がありません。通信障害、実際の認証失効、未許可eventなどは従来の明示エラー処理を維持します。

不受理の作品eventを、コアが通話終了後などに自動再送することはありません。入力の保持、理由の表示、再操作の案内は作品側で行ってください。送信を試しただけでイベントを消費済みにせず、`ok: true` と必要な `projectState` を確認して完了扱いにします。

### 端末の表示状態を使って待機する

`context.deviceView` は次のsnapshotです。UIだけが変わった場合も更新され、DBやtokenには保存されません。

```ts
type DeviceView = Readonly<{
  screen: "lock" | "home" | "app" | "search_agent"
    | "notification_shade" | "incoming_call" | "effect";
  appId: AppId | null;
}>;
```

`screen` は端末の最前面の画面を表します。重なりがあるときは、着信／通話、コア演出、ロック、展開中の検索パネル、通知シェード、アプリ／ホームの順で判定します。`appId` は `screen: "app"` のときだけ表示中アプリのIDを返し、それ以外は `null` です。`effect` は開始待ちを含むコア演出を示し、作品Stage自身の演出は含めません。検索アイコン・小さい吹き出しや通知トーストは独立した閲覧画面として扱いません。

`home` は標準の閲覧画面が閉じているという意味で、無音・読了・進行確定を保証しません。ラジオはホームでも再生を継続できます。また、通話UIは完了eventの応答より先に閉じるため、ホーム復帰だけを進行確定通知として使わないでください。詳細コンテンツの開閉や音声再生状態は公開しません。

たとえばホーム復帰後に作品演出を始める場合は、公開した待機フラグと `deviceView.screen` を組み合わせます。次は `presentation_waiting` と `presentation_started` の `state_vars.public` を `true` にし、`start_presentation` のhookが開始済みフラグを立てる作品の、待機判定部分の例です。既存のphone snippetの描画は残して組み込んでください。

```svelte
<script lang="ts">
  import type { ProjectStageContext } from "./projectStage";

  export let context: ProjectStageContext;
  let sending = false;
  let accepted = false;
  let started = false;
  let rejection: string | null = null;

  $: homeReady = context.playerReady && context.deviceView.screen === "home";
  $: if (homeReady && context.projectState.presentation_waiting === true
    && !sending && !accepted && !started && rejection === null) {
    void requestStart();
  }

  async function requestStart() {
    sending = true;
    try {
      const result = await context.dispatchScenarioEvent("start_presentation");
      if (result.ok) accepted = true;
      else rejection = result.error;
    } finally {
      sending = false;
    }
  }

  $: if (homeReady && accepted && !started
    && context.projectState.presentation_started === true) {
    started = true;
  }
</script>

{#if started}
  <section>作品固有の演出</section>
{:else if rejection !== null}
  <p>演出の開始は受理されませんでした。作品側で再操作を案内します。</p>
{/if}
```

この例では不受理後に `rejection` を自動解除せず、contextが更新されても勝手に再送しません。再試行を提供する場合は、作品側で理由に応じた明示操作を用意してください。`sending`・`accepted`・`started` は同じStage内での重複を防ぐローカルガードです。再読込後の再開方針や演出を一度だけ行う条件は、作品の進行状態とhookで定義します。PhoneStageの `focused`／`embedded`／`hidden` は作品側から指定する表示方法であり、このsnapshotには含めません。

作品固有Stageで復旧不能な例外が起きた場合は、PhoneStageだけへ戻さず、既存のゲーム外エラー画面を表示します。

これらは、必要な作品だけが固有コードを追加し、汎用コアを小さく保つための境界です。

## アプリregistryの境界

標準アプリのIDと既定アイコンは `src/shared/appRegistry.ts` に集約しています。作品固有appは`src/project/apps.ts`へ1エントリ追加し、`src/project/apps/<app-id>/App.svelte`を置きます。

manifestではID、Lucide icon名、record validator、到達後に公開してよいfieldを返す`publicRecord()`を定義します。シナリオ側は `home_items` と `project_items` を使い、後者の `record` セルに作品固有fieldのJSONを書きます。normal / repairable / hidden、検索、通知、badge、履歴、hookをそのまま利用できます。修復前のrecordは`publicRecord()`へ渡しません。

componentは共通のitems、ProjectStage context、focus要求、open／blocked／noise handlerだけを受けます。app固有APIが必要なら従来どおり`src/project/routes.ts`へ追加し、registryへroute lifecycleやDI基盤は追加しません。built-in appもregistryへ合わせて書き直しません。

`src/project/apps/*/App.svelte`とそこからimportするmoduleは、選択中シナリオで未使用でもclient配布物へ入ります。未到達の本文、答え、ヒント、asset URLをcomponentへ直書きせず、シナリオとserver側のrecordに置き、到達後に`publicRecord()`から受け取って表示してください。

## 予約イベントと着信

作品固有hookから、汎用の予約イベントと着信UIを利用できます。

```ts
context.schedule.after("show_scheduled_call", 30_000);
context.incoming.start("scheduled_call");
```

`incoming_calls` シートへ表示名と任意の `audio`（attachmentsの音声ID）を定義します。`transcript` セルに音声開始からのミリ秒と本文のJSON配列を書くと、通話中の字幕として同期表示されます。電話アプリの履歴で音声と全文書き起こしを提供する場合は、別途 `call_items` の `audio / transcript` に同じ形式で定義します。留守番電話として表示する場合は `kind` に `voicemail` を指定します。

初回ログインからの相対時間で開始するものは `schedules` シートに定義できます。serverモードでは新規プレイヤー作成と同じ保存操作で登録され、既存プレイヤーへの再認証では追加されません。AWS版のserverモードはDynamoDB transactionの上限により98件以下にしてください。`npm run build:aws`がserverモードの件数と過大なfieldsを事前検査します。browserモードはDynamoDBへ保存せず、既存の署名tokenサイズ上限を使います。作品固有の発火条件はhookに置き、予約処理と着信UIはコアを再利用します。

予定イベントのhookが例外で失敗した場合、イベントを成功扱いや破棄にはせず、限定再試行後に明示エラーを表示します。handlerや設定を修正して再配備すると、保持していた同じイベントから再実行します。物語上必要なイベントを黙って飛ばす試行回数上限は設けていません。
