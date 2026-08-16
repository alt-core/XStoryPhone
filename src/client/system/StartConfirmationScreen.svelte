<script lang="ts">
  import { Check, CircleHelp, Fullscreen, Hash, Headphones, ShieldCheck, Smartphone } from "@lucide/svelte";

  export let variant: "confirmation" | "hold" = "confirmation";
  export let onConfirm: () => void | Promise<{ ok: boolean; error?: string }> = () => {};
  export let browserMode = false;

  let busy = false;
  let errorMessage = "";

  async function confirm() {
    if (busy) return;
    busy = true;
    errorMessage = "";
    const result = await onConfirm();
    if (result && !result.ok) {
      errorMessage = result.error === "rate_limited"
        ? "少し待ってから、もう一度お試しください。"
        : "通信できませんでした。もう一度お試しください。";
      busy = false;
    }
  }
</script>

<section
  class="start-confirmation-screen"
  class:start-confirmation-screen--hold={variant === "hold"}
  aria-labelledby={variant === "hold" ? undefined : "start-confirmation-title"}
>
  {#if variant === "hold"}
    <div class="hold-message" role="status">
      <p>アクセスいただき、ありがとうございます。</p>
      <p>現在はメンテナンス中です。<br>しばらくしてから、もう一度アクセスしてください。</p>
    </div>
  {:else}
    <div class="confirmation-header">
      <h1 id="start-confirmation-title">開始前のご確認</h1>
    </div>

    <div class="confirmation-panel">
      <section class="confirmation-block">
        <Headphones size={20} strokeWidth={2.1} aria-hidden="true" />
        <p>このゲームでは、<b>音声を聞く必要があります</b>。</p>
      </section>

      <section class="confirmation-block">
        <ShieldCheck size={20} strokeWidth={2.1} aria-hidden="true" />
        <p>{browserMode ? "検索語や会話入力は、判定のためサーバで処理します。" : "ゲームの進行や会話分岐の調整のため、入力内容をサーバで処理・保存します。"}個人を特定できる情報は入力しないようお願いします。</p>
      </section>

      <section class="confirmation-block">
        <Smartphone size={20} strokeWidth={2.1} aria-hidden="true" />
        <p>{browserMode ? "進行はこのブラウザーに保存されます。ブラウザーのデータを消すと最初からになります。" : "同じパスコードを入力することで、別の環境からプレイを再開できます。"}</p>
      </section>

      {#if !browserMode}
        <section class="confirmation-block">
          <Hash size={20} strokeWidth={2.1} aria-hidden="true" />
          <p>パスコードはプレイデータに紐づきます。公開・共有や、配信画面への映り込みにご注意ください。</p>
        </section>
      {/if}

      <section class="confirmation-block">
        <Fullscreen size={20} strokeWidth={2.1} aria-hidden="true" />
        <p>スマートフォンでは、全画面化すると快適です。iPhoneでは、URLの左隣のボタンからメニューを開き、「…」＞「ツールバーを非表示」。</p>
      </section>

      <section class="confirmation-block hint-block">
        <CircleHelp size={20} strokeWidth={2.1} aria-hidden="true" />
        <p>進行に困ったときは「ヒント」と検索してください。</p>
      </section>
    </div>

    <footer class="confirmation-actions">
      <button class="confirm-button" type="button" disabled={busy} on:click={confirm}>
        <Check size={20} strokeWidth={2.4} />
        <span>{busy ? "準備中…" : "確認して開始"}</span>
      </button>
      {#if errorMessage}
        <p class="confirmation-submit-error" role="alert">{errorMessage}</p>
      {/if}
      <a class="privacy-link" href="/privacy-policy.html" target="_blank" rel="noreferrer">プライバシーポリシー／お問い合わせ</a>
    </footer>
  {/if}
</section>
