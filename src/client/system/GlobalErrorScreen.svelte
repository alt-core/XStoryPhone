<script lang="ts">
  import { AlertTriangle, RotateCcw } from "@lucide/svelte";

  export let message = "";
  export let supportCode = "AP-CLIENT";

  function reload() {
    window.location.reload();
  }
</script>

<section class="out-game-error-screen" role="alert" aria-labelledby="global-error-title">
  <div class="out-game-error-panel">
    <div class="out-game-error-mark">
      <AlertTriangle size={24} strokeWidth={2.2} aria-hidden="true" />
    </div>
    <p class="out-game-kicker">ゲーム外のエラー</p>
    <h1 id="global-error-title">画面の表示に失敗しました</h1>
    {#if message}
      <p>{message}</p>
    {:else}
      <p>しばらくしてから、ページのリロードをお試しください。</p>
    {/if}
    <p class="out-game-support-code">エラーコード: {supportCode}</p>
    <div class="out-game-error-actions">
      <button class="out-game-primary-button" type="button" on:click={reload}>
        <RotateCcw size={18} strokeWidth={2.4} aria-hidden="true" />
        <span>リロード</span>
      </button>
    </div>
    <a class="privacy-link" href="/privacy-policy.html" target="_blank" rel="noreferrer">プライバシーポリシー</a>
  </div>
</section>
