<script lang="ts">
  import { Tag } from "@lucide/svelte";

  export let tags: readonly string[] = [];
  export let overlay = false;
</script>

{#if tags.length > 0}
  <div class="content-tags" class:overlay aria-label="タグ">
    <span class="tag-icon" aria-hidden="true">
      <Tag size={13} strokeWidth={2.2} />
    </span>
    <div class="tag-track" role="list">
      {#each tags as tag}
        <span class="tag-pill" role="listitem">{tag}</span>
      {/each}
    </div>
  </div>
{/if}

<style>
  .content-tags {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    color: color-mix(in srgb, var(--content-tag-accent, #fff) 78%, white);
  }

  .content-tags.overlay {
    padding: 5px 7px;
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 11px;
    background: rgba(4, 8, 12, 0.64);
    box-shadow: 0 8px 20px rgba(0, 0, 0, 0.24);
    backdrop-filter: blur(8px);
  }

  .tag-icon {
    display: inline-flex;
    flex: 0 0 auto;
    align-items: center;
    justify-content: center;
  }

  .tag-track {
    display: flex;
    min-width: 0;
    gap: 5px;
    overflow-x: auto;
    overscroll-behavior-inline: contain;
    padding-right: 5px;
    scrollbar-width: none;
  }

  .tag-track::-webkit-scrollbar {
    display: none;
  }

  .tag-pill {
    flex: 0 0 auto;
    padding: 3px 8px;
    border: 1px solid color-mix(in srgb, var(--content-tag-accent, #fff) 42%, transparent);
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.055);
    color: inherit;
    font-size: 0.67rem;
    font-weight: 720;
    line-height: 1.15;
    white-space: nowrap;
  }
</style>
