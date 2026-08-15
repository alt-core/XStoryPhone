<script lang="ts">
  import type { AppId, DeviceState } from "../scenario-runtime/types";
  import type { AppCatalogItem } from "./appCatalog";
  import NotificationCard from "./NotificationCard.svelte";

  export let apps: AppCatalogItem[] = [];
  export let deviceState: DeviceState;
  export let unreadAppIds: AppId[] = [];
  export let onOpenApp: (app: AppCatalogItem) => void = () => {};
  export let onOpenNotification: (notificationId: string) => void = () => {};

  const APPS_PER_PAGE = 20;

  let currentPage = 0;

  $: totalPages = Math.max(1, Math.ceil(apps.length / APPS_PER_PAGE));
  $: if (currentPage >= totalPages) {
    currentPage = totalPages - 1;
  }
  $: currentPageApps = apps.slice(currentPage * APPS_PER_PAGE, (currentPage + 1) * APPS_PER_PAGE);
  $: unreadAppIdSet = new Set(unreadAppIds);
  $: todoItems = deviceState.todos ?? [];
  $: notificationItems = deviceState.notifications ?? [];
  $: hasTodoItems = notificationItems.length > 0 || todoItems.length > 0;

  function selectPage(pageIndex: number) {
    currentPage = pageIndex;
  }
</script>

<section class="home-screen" aria-label="ホーム画面">
  <div class="app-page">
    <div class="app-grid">
      {#each currentPageApps as app}
        <button
          class="app-icon"
          class:disabled={!app.available}
          type="button"
          aria-label={`${app.label}を開く`}
          title={app.label}
          on:click={() => onOpenApp(app)}
        >
          <span class="icon-surface" style={`--accent: ${app.accent}`}>
            {#if app.available}
              <svelte:component this={app.icon} size={25} strokeWidth={2.1} />
              {#if unreadAppIdSet.has(app.id)}
                <span class="app-unread-dot" aria-hidden="true"></span>
              {/if}
            {:else}
              <img class="damage-icon-image" src="/system/broken-app-icon-noise.png" alt="" draggable="false" />
            {/if}
          </span>
          <span class="label">{app.label}</span>
        </button>
      {/each}
    </div>
  </div>

  <section class="todo-widget" aria-label="ToDo">
    <header class="todo-header">
      <span>ToDo</span>
    </header>
    {#if hasTodoItems}
      <ul class="todo-list">
        {#each notificationItems as notification}
          <li class="todo-notification">
            <NotificationCard {notification} variant="todo" onSelect={() => onOpenNotification(notification.id)} />
          </li>
        {/each}
        {#each todoItems as todo}
          <li class="todo-list-item">
            <span class="todo-marker"></span>
            <span class="todo-text">{todo.text}</span>
          </li>
        {/each}
      </ul>
    {:else}
      <div class="todo-empty">項目なし</div>
    {/if}
  </section>

  {#if totalPages > 1}
    <nav class="page-dots" aria-label="ホームページ切替">
      {#each Array(totalPages) as _, pageIndex}
        <button
          type="button"
          class:active={pageIndex === currentPage}
          aria-label={`${totalPages}ページ中${pageIndex + 1}ページ目を表示`}
          aria-current={pageIndex === currentPage ? "page" : undefined}
          title={`${pageIndex + 1}/${totalPages}`}
          on:click={() => selectPage(pageIndex)}
        ></button>
      {/each}
    </nav>
  {/if}
</section>

<style>
  .home-screen {
    position: relative;
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    gap: 10px;
    height: 100%;
    padding: 16px 20px 12px;
    background:
      linear-gradient(180deg, rgba(255, 255, 255, 0.052), transparent 22%),
      linear-gradient(180deg, rgba(5, 8, 12, 0.08), rgba(5, 8, 12, 0.26));
  }

  .app-page {
    min-height: 0;
    overflow: visible;
  }

  .app-grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    align-content: start;
    gap: 13px 9px;
    min-height: 0;
    overflow: visible;
    padding: 2px 2px 0;
  }

  .todo-widget {
    align-self: start;
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    width: 100%;
    height: min(390px, 100%);
    min-height: 0;
    min-width: 0;
    overflow: hidden;
    border: 1px solid rgba(255, 255, 255, 0.11);
    border-radius: 18px;
    background:
      linear-gradient(180deg, rgba(255, 255, 255, 0.026), rgba(255, 255, 255, 0.006)),
      linear-gradient(135deg, rgba(92, 200, 167, 0.025), transparent 54%),
      rgba(9, 14, 21, 0.23);
    box-shadow:
      0 10px 20px rgba(0, 0, 0, 0.08),
      inset 0 1px 0 rgba(255, 255, 255, 0.05);
    backdrop-filter: blur(2px);
  }

  .todo-header {
    display: flex;
    align-items: center;
    min-height: 42px;
    padding: 12px 14px 8px;
    color: rgba(255, 255, 255, 0.9);
    font-size: 0.82rem;
    font-weight: 780;
    letter-spacing: 0;
  }

  .todo-list {
    display: grid;
    align-content: start;
    gap: 7px;
    min-height: 0;
    margin: 0;
    padding: 2px 12px 14px;
    overflow: auto;
    list-style: none;
    scrollbar-width: none;
  }

  .todo-list::-webkit-scrollbar {
    display: none;
  }

  .todo-list-item {
    display: grid;
    grid-template-columns: 18px minmax(0, 1fr);
    gap: 8px;
    min-width: 0;
    padding: 9px 10px;
    border: 1px solid rgba(255, 255, 255, 0.105);
    border-radius: 12px;
    background:
      linear-gradient(180deg, rgba(255, 255, 255, 0.092), rgba(255, 255, 255, 0.035)),
      rgba(9, 14, 21, 0.46);
    box-shadow:
      0 10px 18px rgba(0, 0, 0, 0.12),
      inset 0 1px 0 rgba(255, 255, 255, 0.085);
  }

  .todo-notification {
    display: grid;
    min-width: 0;
  }

  .todo-marker {
    position: relative;
    width: 14px;
    height: 14px;
    margin-top: 2px;
    border: 1px solid rgba(139, 228, 189, 0.68);
    border-radius: 999px;
    background:
      radial-gradient(circle at 50% 50%, rgba(139, 228, 189, 0.28), transparent 48%),
      rgba(92, 200, 167, 0.12);
  }

  .todo-marker::after {
    content: "";
    position: absolute;
    top: 50%;
    left: 50%;
    width: 5px;
    height: 5px;
    border-radius: 999px;
    background: rgba(246, 242, 232, 0.86);
    transform: translate(-50%, -50%);
  }

  .todo-text {
    min-width: 0;
    color: rgba(255, 255, 255, 0.88);
    font-size: 0.76rem;
    font-weight: 690;
    line-height: 1.42;
    letter-spacing: 0;
    overflow-wrap: anywhere;
    word-break: normal;
  }

  .todo-empty {
    display: grid;
    place-items: center;
    min-height: 0;
    padding: 0 16px 18px;
    color: rgba(255, 255, 255, 0.5);
    font-size: 0.72rem;
    font-weight: 700;
    letter-spacing: 0;
  }

  .app-icon {
    position: relative;
    display: grid;
    justify-items: center;
    gap: 5px;
    align-content: start;
    min-height: 84px;
    min-width: 0;
    border: 0;
    background: transparent;
    color: #fff;
    cursor: pointer;
    transition: transform 120ms ease, opacity 120ms ease;
  }

  .app-icon:active {
    transform: translateY(1px) scale(0.98);
  }

  .app-icon.disabled {
    cursor: pointer;
  }

  .app-icon.disabled .icon-surface {
    border: 0;
    background: #061015;
    box-shadow: none;
  }

  .icon-surface {
    position: relative;
    box-sizing: border-box;
    display: grid;
    place-items: center;
    overflow: hidden;
    border: 1px solid rgba(255, 255, 255, 0.15);
    background:
      radial-gradient(circle at 24% 18%, rgba(255, 255, 255, 0.28), transparent 29%),
      linear-gradient(145deg, color-mix(in srgb, var(--accent) 88%, white 11%), color-mix(in srgb, var(--accent) 86%, black 16%));
    color: rgba(13, 17, 24, 0.88);
    box-shadow:
      0 10px 18px rgba(0, 0, 0, 0.2),
      inset 0 1px 0 rgba(255, 255, 255, 0.34);
  }

  .icon-surface {
    width: 61px;
    height: 61px;
    border-radius: 15px;
  }

  .icon-surface::after {
    content: "";
    position: absolute;
    inset: 1px;
    border-radius: inherit;
    box-shadow: inset 0 -12px 18px rgba(0, 0, 0, 0.12);
    pointer-events: none;
  }

  .app-icon.disabled .icon-surface::after {
    content: none;
  }

  .app-unread-dot {
    position: absolute;
    top: 7px;
    right: 7px;
    z-index: 2;
    width: 9px;
    height: 9px;
    border: 2px solid rgba(10, 14, 20, 0.92);
    border-radius: 999px;
    background: #ff4d5a;
    box-shadow: 0 0 0 1px rgba(255, 77, 90, 0.26);
    pointer-events: none;
  }

  .damage-icon-image {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
    pointer-events: none;
    user-select: none;
  }

  .label {
    display: -webkit-box;
    max-width: 82px;
    min-height: 1.58rem;
    overflow: hidden;
    color: rgba(255, 255, 255, 0.82);
    font-size: 0.62rem;
    font-weight: 650;
    line-height: 1.18;
    text-align: center;
    text-overflow: ellipsis;
    overflow-wrap: anywhere;
    word-break: break-all;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
  }

  .page-dots {
    position: absolute;
    left: 50%;
    bottom: 157px;
    z-index: 4;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 1px;
    min-width: 58px;
    min-height: 34px;
    padding: 6px 8px;
    transform: translateX(-50%);
  }

  .page-dots button {
    position: relative;
    width: 24px;
    height: 24px;
    padding: 0;
    border: 0;
    background: transparent;
    cursor: pointer;
  }

  .page-dots button::before {
    content: "";
    position: absolute;
    top: 50%;
    left: 50%;
    width: 7px;
    height: 7px;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.36);
    transform: translate(-50%, -50%);
    transition: width 140ms ease, height 140ms ease, background 140ms ease, opacity 140ms ease;
  }

  .page-dots button.active::before {
    width: 14px;
    height: 10px;
    background: rgba(255, 255, 255, 0.86);
  }

</style>
