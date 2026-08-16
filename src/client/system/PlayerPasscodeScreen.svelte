<script lang="ts">
  import { ArrowRight, Hash, Smartphone } from "@lucide/svelte";

  export let passcodeLength = 8;
  export let onSubmit: (passcode: string) => Promise<{ ok: boolean; error?: string }> = async () => ({ ok: false });

  let passcode = "";
  let busy = false;
  let errorMessage = "";

  $: ready = passcode.length === passcodeLength;

  function updatePasscode(event: Event) {
    passcode = (event.currentTarget as HTMLInputElement).value.replace(/\D/gu, "").slice(0, passcodeLength);
    errorMessage = "";
  }

  function errorLabel(error: string | undefined) {
    if (error === "rate_limited") return "少し待ってから入力してください。";
    if (error === "server_unavailable") return "通信できませんでした。もう一度お試しください。";
    return "パスコードを確認してください。";
  }

  async function submit() {
    if (!ready || busy) return;
    busy = true;
    errorMessage = "";
    const result = await onSubmit(passcode);
    if (result.ok) return;
    errorMessage = errorLabel(result.error);
    passcode = "";
    busy = false;
  }
</script>

<section class="start-confirmation-screen passcode-entry-screen" aria-labelledby="passcode-entry-title">
  <div class="confirmation-header">
    <h1 id="passcode-entry-title">パスコードを入力</h1>
  </div>

  <div class="confirmation-panel passcode-entry-panel">
    <section class="confirmation-block">
      <Smartphone size={20} strokeWidth={2.1} aria-hidden="true" />
      <p>プレイデータを開くため、案内されたパスコードを入力してください。同じパスコードで別の端末から続きをプレイできます。</p>
    </section>

    <form class="passcode-form" on:submit|preventDefault={submit}>
      <label for="player-passcode"><Hash size={18} strokeWidth={2.1} /> パスコード</label>
      <input
        id="player-passcode"
        type="password"
        inputmode="numeric"
        autocomplete="off"
        value={passcode}
        maxlength={passcodeLength}
        aria-describedby={errorMessage ? "player-passcode-error" : undefined}
        on:input={updatePasscode}
      />
      <p class="passcode-length">数字{passcodeLength}桁</p>
      {#if errorMessage}
        <p id="player-passcode-error" class="passcode-entry-error" role="alert">{errorMessage}</p>
      {/if}
    </form>
  </div>

  <footer class="confirmation-actions">
    <button class="confirm-button" type="button" disabled={!ready || busy} on:click={submit}>
      <ArrowRight size={20} strokeWidth={2.4} />
      <span>{busy ? "確認中…" : "続ける"}</span>
    </button>
  </footer>
</section>
