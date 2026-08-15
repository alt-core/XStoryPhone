<script lang="ts">
  import { onMount } from "svelte";
  import { Delete } from "@lucide/svelte";
  import type { DeviceState } from "../scenario-runtime/types";
  import NotificationCard from "./NotificationCard.svelte";

  export let deviceState: DeviceState;
  export let onUnlock: (serialCode: string) => Promise<{ ok: boolean; error?: string }> = async () => ({ ok: false });
  export let onOpenNotification: (notificationId: string) => void = () => {};
  export let pinLength = 8;
  export let browserMode = false;

  let digits = "";
  let pulse = false;
  let busy = false;
  let errorMessage = "";
  let delayedNotificationVisible = false;
  let pressedKey = "";

  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "delete"];
  $: delayedNotificationId = deviceState.notifications[0]?.id ?? "";
  $: lockNotifications = deviceState.notifications.filter(
    (notification) => notification.id !== delayedNotificationId || delayedNotificationVisible
  );

  onMount(() => {
    const timer = window.setTimeout(() => {
      delayedNotificationVisible = true;
    }, 3000);

    return () => window.clearTimeout(timer);
  });

  function errorLabel(error: string | undefined) {
    if (error === "browser_progress_too_large") {
      return "進行データエラー（AP-PROGRESS-SIZE）";
    }

    if (error === "server_unavailable") {
      return "回線が不安定です";
    }

    if (error === "rate_limited") {
      return "少し待ってから入力してください";
    }

    if (browserMode && error !== "unauthorized" && error !== "invalid") {
      return "回線が不安定です";
    }

    return "コードを確認してください";
  }

  function pressKey(key: string) {
    if (key === "" || busy) {
      return;
    }

    if (key === "delete") {
      digits = digits.slice(0, -1);
      errorMessage = "";
      return;
    }

    if (digits.length >= pinLength) {
      return;
    }

    digits += key;
    errorMessage = "";

    if (digits.length === pinLength) {
      void submitCode(digits);
    }
  }

  function startKeyPress(event: PointerEvent, key: string) {
    if (key === "" || busy || event.button !== 0) {
      return;
    }

    pressedKey = key;
    (event.currentTarget as HTMLButtonElement).setPointerCapture(event.pointerId);
  }

  function endKeyPress() {
    pressedKey = "";
  }

  async function submitCode(serialCode: string) {
    busy = true;
    pressedKey = "";
    const result = await onUnlock(serialCode);

    if (result.ok) {
      pulse = true;
      return;
    }

    errorMessage = errorLabel(result.error);
    digits = "";
    busy = false;
  }

  function openDevice() {
    if (!busy) void submitCode("");
  }
</script>

<section class="lock-screen" class:pulse aria-label="ロック画面">
  <div class="lock-top">
    <p>{deviceState.currentDateLabel}</p>
    <h1>{deviceState.currentTimeLabel}</h1>
  </div>

  <div class="lock-panel">
    {#if browserMode}
      <button class="open-device" type="button" disabled={busy} on:click={openDevice}>
        {busy ? "接続中…" : "端末を開く"}
      </button>
    {:else}
      <div class="keypad">
        {#each keys as key}
          {#if key === ""}
            <div class="key-spacer"></div>
          {:else}
            <button
              class="key"
              class:pressed={pressedKey === key}
              type="button"
              aria-label={key === "delete" ? "削除" : `${key}を入力`}
              title={key === "delete" ? "削除" : key}
              on:pointerdown={(event) => startKeyPress(event, key)}
              on:pointerup={endKeyPress}
              on:pointercancel={endKeyPress}
              on:pointerleave={endKeyPress}
              on:lostpointercapture={endKeyPress}
              on:blur={endKeyPress}
              on:click={() => pressKey(key)}
            >
              {#if key === "delete"}
                <Delete size={19} strokeWidth={2} />
              {:else}
                {key}
              {/if}
            </button>
          {/if}
        {/each}
      </div>
      <div class="dots" aria-label="入力桁数">
        {#each Array(pinLength) as _, index}
          <span class:filled={index < digits.length}></span>
        {/each}
      </div>
    {/if}
    {#if errorMessage}
      <p class="lock-error">{errorMessage}</p>
    {/if}
  </div>

  <section class="lock-notifications" aria-label="ロック画面の通知">
    <header>
      <strong>通知</strong>
      <span>{lockNotifications.length}件</span>
    </header>
    {#each lockNotifications.slice(0, 2) as notification}
      <NotificationCard {notification} variant="lock" onSelect={() => onOpenNotification(notification.id)} />
    {/each}
  </section>
</section>

<style>
  .lock-screen {
    position: relative;
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    gap: 10px;
    height: 100%;
    padding: 20px 22px 26px;
    background:
      linear-gradient(180deg, rgba(255, 255, 255, 0.074), transparent 27%),
      linear-gradient(180deg, rgba(5, 8, 12, 0.05), rgba(5, 8, 12, 0.34));
  }

  .lock-screen.pulse {
    animation: unlock-pulse 180ms ease-out;
  }

  .lock-top {
    display: grid;
    justify-items: center;
    text-align: center;
    transform: translateY(27px);
  }

  .lock-top p {
    margin: 0;
    color: rgba(255, 255, 255, 0.84);
    font-size: 0.98rem;
    font-weight: 650;
    text-shadow: 0 1px 7px rgba(0, 0, 0, 0.46);
  }

  .lock-top h1 {
    margin: 4px 0 0;
    font-size: 4.45rem;
    line-height: 0.95;
    font-weight: 760;
    letter-spacing: 0;
  }

  .lock-panel {
    position: absolute;
    top: calc(49% + 26px);
    left: 50%;
    z-index: 2;
    display: grid;
    gap: 14px;
    justify-items: center;
    transform: translate(-50%, -50%);
  }

  .dots {
    display: flex;
    align-items: center;
    gap: 9px;
    height: 12px;
  }

  .dots span {
    width: 9px;
    height: 9px;
    border: 1px solid rgba(255, 255, 255, 0.5);
    border-radius: 50%;
    background: transparent;
  }

  .dots span.filled {
    background: #f6f2e8;
  }

  .lock-error {
    position: absolute;
    top: calc(100% + 4px);
    left: 50%;
    min-height: 1rem;
    width: max-content;
    max-width: 220px;
    margin: 0;
    color: #ffb5bd;
    font-size: 0.72rem;
    font-weight: 760;
    text-align: center;
    text-shadow: 0 1px 6px rgba(0, 0, 0, 0.46);
    transform: translateX(-50%);
  }

  .keypad {
    display: grid;
    grid-template-columns: repeat(3, 68px);
    gap: 12px 16px;
  }

  .open-device {
    min-width: 190px;
    padding: 15px 24px;
    border: 1px solid rgba(255, 255, 255, 0.34);
    border-radius: 999px;
    background: rgba(7, 11, 17, 0.64);
    backdrop-filter: blur(8px);
    color: #fff;
    font: inherit;
    font-weight: 760;
    letter-spacing: 0.04em;
    cursor: pointer;
  }

  .open-device:disabled {
    opacity: 0.68;
    cursor: wait;
  }

  .key,
  .key-spacer {
    width: 68px;
    height: 68px;
  }

  .key {
    display: grid;
    place-items: center;
    border: 1px solid rgba(255, 255, 255, 0.24);
    border-radius: 50%;
    background:
      radial-gradient(circle at 34% 18%, rgba(255, 255, 255, 0.2), transparent 33%),
      rgba(7, 11, 17, 0.58);
    backdrop-filter: blur(8px) saturate(0.9);
    color: #fff;
    font-size: 1.58rem;
    font-weight: 720;
    cursor: pointer;
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.18),
      0 10px 22px rgba(0, 0, 0, 0.3);
    text-shadow: 0 1px 8px rgba(0, 0, 0, 0.5);
  }

  .key:active,
  .key.pressed {
    transform: translateY(1px) scale(0.98);
    background: rgba(246, 242, 232, 0.25);
  }

  .lock-notifications {
    align-self: end;
    display: grid;
    gap: 8px;
    min-width: 0;
  }

  .lock-notifications header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding-inline: 2px;
    color: rgba(255, 255, 255, 0.68);
  }

  .lock-notifications header strong {
    color: rgba(255, 255, 255, 0.88);
    font-size: 0.76rem;
  }

  .lock-notifications header span {
    font-size: 0.68rem;
    font-weight: 760;
  }

  @keyframes unlock-pulse {
    0% {
      transform: scale(1);
    }

    100% {
      transform: scale(1.012);
    }
  }
</style>
