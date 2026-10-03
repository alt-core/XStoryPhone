<script lang="ts">
  export let title: string;
  export let caption = "";
</script>

<header class="app-list-header">
  <h2>{title}</h2>
  {#if caption}
    <span>{caption}</span>
  {/if}
</header>

<style>
  .app-list-header {
    display: flex;
    align-items: baseline;
    gap: 9px;
    min-width: 0;
    min-height: 46px;
    padding: 0 2px;
  }

  h2 {
    margin: 0;
    overflow: hidden;
    font-size: 1.32rem;
    font-weight: 820;
    letter-spacing: 0.01em;
    line-height: 1.12;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  span {
    flex: 0 0 auto;
    color: rgba(255, 255, 255, 0.54);
    font-size: 0.7rem;
    font-weight: 740;
    font-variant-numeric: tabular-nums;
  }
</style>
