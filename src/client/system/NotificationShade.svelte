<script lang="ts">
  import { BatteryMedium, Moon, Radio, ShieldCheck, Signal } from "@lucide/svelte";
  import type { NotificationItem } from "../scenario-runtime/types";
  import NotificationCard from "./NotificationCard.svelte";

  export let notifications: NotificationItem[] = [];
  export let batteryLevel = 0;
  export let signalLabel = "";
  export let open = false;
  export let onLock: () => void | Promise<void> = () => {};
  export let onOpenNotification: (notificationId: string) => void = () => {};
</script>

{#if open}
  <section class="shade" aria-label="通知一覧">
    <div class="shade-header">
      <div>
        <strong>通知</strong>
      </div>
    </div>
    <div class="quick-grid" aria-label="クイック状態">
      <div class="quick-tile">
        <Signal size={17} strokeWidth={2.1} />
        <span>{signalLabel}</span>
      </div>
      <button class="quick-tile" type="button" aria-label="ロック画面に戻る" title="ロック画面に戻る" on:click={onLock}>
        <ShieldCheck size={17} strokeWidth={2.1} />
        <span>保護中</span>
      </button>
      <div class="quick-tile">
        <Moon size={17} strokeWidth={2.1} />
        <span>夜間</span>
      </div>
      <div class="quick-tile">
        <BatteryMedium size={17} strokeWidth={2.1} />
        <span>{batteryLevel}%</span>
      </div>
      <div class="quick-tile wide">
        <Radio size={17} strokeWidth={2.1} />
        <span>保存済み</span>
      </div>
    </div>
    <div class="notification-list">
      {#each notifications as notification}
        <NotificationCard {notification} variant="shade" onSelect={() => onOpenNotification(notification.id)} />
      {/each}
    </div>
    <nav class="shade-utility-links" aria-label="システム情報">
      <a href="/privacy-policy.html#contact" target="_blank" rel="noreferrer">システムへのお問い合わせ</a>
      <span aria-hidden="true">／</span>
      <a href="/privacy-policy.html#privacy" target="_blank" rel="noreferrer">プライバシーポリシー</a>
    </nav>
  </section>
{/if}

<style>
  .shade {
    position: absolute;
    inset: 0;
    z-index: 5;
    display: grid;
    grid-template-rows: auto auto minmax(0, 1fr) auto;
    gap: 14px;
    padding: 18px 18px 68px;
    background:
      linear-gradient(180deg, rgba(255, 255, 255, 0.06), transparent 28%),
      rgba(9, 13, 20, 0.86);
    backdrop-filter: blur(28px) saturate(1.18);
    animation: shade-in 120ms ease-out both;
  }

  .shade-header {
    display: grid;
    padding: 10px 2px 0;
  }

  .shade-header div {
    display: grid;
    gap: 2px;
  }

  .shade-header strong {
    font-size: 1.45rem;
    line-height: 1;
  }

  .quick-grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 8px;
  }

  .quick-tile {
    display: grid;
    place-items: center;
    gap: 5px;
    min-height: 62px;
    padding: 8px 6px;
    border: 1px solid var(--ap-border);
    border-radius: var(--ap-radius-card);
    background: var(--ap-surface-1);
    color: rgba(255, 255, 255, 0.78);
    font: inherit;
  }

  button.quick-tile {
    cursor: pointer;
  }

  button.quick-tile:active {
    transform: translateY(1px);
  }

  .quick-grid .wide {
    grid-column: span 4;
    grid-template-columns: auto minmax(0, 1fr);
    justify-items: start;
    min-height: 42px;
    padding-inline: 12px;
  }

  .quick-grid span {
    overflow: hidden;
    max-width: 100%;
    font-size: 0.68rem;
    font-weight: 760;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .notification-list {
    display: grid;
    align-content: start;
    gap: 10px;
    overflow: auto;
  }

  .shade-utility-links {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 2px 12px 4px;
    color: rgba(255, 255, 255, 0.28);
    font-size: 0.66rem;
    line-height: 1.2;
  }

  .shade-utility-links a {
    color: inherit;
    text-decoration: none;
  }

  .shade-utility-links a:focus-visible {
    outline: 1px solid rgba(255, 255, 255, 0.42);
    outline-offset: 3px;
    border-radius: 4px;
  }

  .shade-utility-links a:hover {
    color: rgba(255, 255, 255, 0.48);
  }

  @keyframes shade-in {
    from {
      opacity: 0;
      transform: translateY(-7px);
    }

    to {
      opacity: 1;
      transform: translateY(0);
    }
  }
</style>
