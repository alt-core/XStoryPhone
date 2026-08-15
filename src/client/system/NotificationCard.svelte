<script lang="ts">
  import { Bell } from "@lucide/svelte";
  import type { NotificationItem } from "../scenario-runtime/types";
  import { getAppById } from "./appCatalog";

  export let notification: NotificationItem;
  export let variant: "lock" | "shade" | "todo" = "shade";
  export let onSelect: (notification: NotificationItem) => void = () => {};

  $: app = getAppById(notification.appId);
</script>

<button
  type="button"
  class={`notification-card ${variant}`}
  style={`--accent: ${app?.accent ?? "#8fd2ff"}`}
  aria-label={notification.title}
  on:click={() => onSelect(notification)}
>
  <span class="notification-icon" aria-hidden="true">
    <svelte:component this={app?.icon ?? Bell} size={15} strokeWidth={2.1} />
  </span>
  <div class="notification-copy">
    <p>
      <strong>{notification.title}</strong>
    </p>
    <span>{notification.body}</span>
  </div>
</button>

<style>
  .notification-card {
    display: grid;
    grid-template-columns: 32px minmax(0, 1fr);
    align-items: center;
    gap: 10px;
    min-width: 0;
    width: 100%;
    border: 1px solid var(--ap-border);
    border-radius: var(--ap-radius-card);
    background:
      linear-gradient(90deg, color-mix(in srgb, var(--accent) 12%, transparent), transparent 40%),
      var(--ap-surface-3);
    color: inherit;
    cursor: pointer;
    font: inherit;
    text-align: left;
    box-shadow: var(--ap-shadow-inset);
  }

  .notification-card:active {
    transform: translateY(1px);
  }

  .notification-card.lock {
    min-height: 56px;
    padding: 10px 12px;
  }

  .notification-card.shade {
    min-height: 66px;
    padding: 12px 13px;
    background:
      linear-gradient(90deg, color-mix(in srgb, var(--accent) 10%, transparent), transparent 42%),
      var(--ap-surface-2);
  }

  .notification-card.todo {
    grid-template-columns: 30px minmax(0, 1fr);
    min-height: 58px;
    padding: 9px 10px;
    border-color: rgba(255, 255, 255, 0.105);
    border-radius: 12px;
    background:
      linear-gradient(180deg, rgba(255, 255, 255, 0.092), rgba(255, 255, 255, 0.035)),
      linear-gradient(90deg, color-mix(in srgb, var(--accent) 14%, transparent), transparent 46%),
      rgba(9, 14, 21, 0.46);
    box-shadow:
      0 10px 18px rgba(0, 0, 0, 0.12),
      inset 0 1px 0 rgba(255, 255, 255, 0.085);
  }

  .notification-icon {
    display: grid;
    place-items: center;
    width: 32px;
    height: 32px;
    border-radius: 9px;
    background: color-mix(in srgb, var(--accent) 24%, transparent);
    color: color-mix(in srgb, var(--accent) 78%, white);
  }

  .todo .notification-icon {
    width: 30px;
    height: 30px;
  }

  .notification-copy {
    display: grid;
    min-width: 0;
    gap: 3px;
  }

  .notification-copy p {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 10px;
    min-width: 0;
    margin: 0;
  }

  .notification-copy strong,
  .notification-copy > span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .notification-copy strong {
    color: var(--ap-text);
    font-size: 0.8rem;
    line-height: 1.25;
  }

  .shade .notification-copy strong {
    font-size: 0.86rem;
  }

  .notification-copy > span {
    color: var(--ap-text-muted);
    font-size: 0.7rem;
    line-height: 1.35;
  }

  .lock .notification-copy > span {
    display: -webkit-box;
    white-space: normal;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
  }

  .shade .notification-copy > span {
    font-size: 0.76rem;
  }

</style>
