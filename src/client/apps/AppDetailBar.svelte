<script lang="ts">
  import AppListButton from "./AppListButton.svelte";

  export let listLabel: string;
  export let title = "";
  export let titleLines: 1 | 2 = 1;
  export let onList: () => void = () => {};
</script>

<header class="app-detail-bar">
  <AppListButton label={listLabel} onClick={onList} />
  <div class="app-detail-title">
    <slot>
      {#if title}
        <h3 class:two-lines={titleLines === 2} {title}>{title}</h3>
      {/if}
    </slot>
  </div>
</header>

<style>
  .app-detail-bar {
    display: flex;
    align-items: center;
    gap: 9px;
    min-width: 0;
    min-height: 46px;
  }

  .app-detail-title {
    display: flex;
    flex: 1 1 auto;
    align-items: center;
    min-width: 0;
  }

  h3 {
    margin: 0;
    overflow: hidden;
    color: var(--ap-text);
    font-size: 1rem;
    font-weight: 800;
    letter-spacing: 0.01em;
    line-height: 1.22;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  h3.two-lines {
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    white-space: normal;
    overflow-wrap: anywhere;
  }
</style>
