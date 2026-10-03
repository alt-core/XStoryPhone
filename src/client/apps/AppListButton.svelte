<script lang="ts">
  import { List } from "@lucide/svelte";

  export let label: string;
  export let unread = false;
  export let onClick: () => void = () => {};
</script>

<button class="app-list-button" type="button" aria-label={label} title={label} on:click={onClick}>
  <List size={18} strokeWidth={2.2} />
  {#if unread}
    <span class="unread-dot" aria-hidden="true"></span>
  {/if}
</button>

<style>
  .app-list-button {
    position: relative;
    display: grid;
    flex: 0 0 auto;
    place-items: center;
    width: 36px;
    height: 36px;
    padding: 0;
    border: 1px solid var(--ap-border);
    border-radius: var(--ap-radius-control);
    background: var(--ap-surface-2);
    color: #fff;
    cursor: pointer;
    box-shadow: var(--ap-shadow-inset);
    transition: background-color 140ms ease, transform 90ms ease;
  }

  .app-list-button:hover {
    background: rgba(255, 255, 255, 0.13);
  }

  .app-list-button:active {
    transform: translateY(1px) scale(0.98);
  }

  .app-list-button:focus-visible {
    outline: 2px solid color-mix(in srgb, var(--accent, #fff) 72%, white);
    outline-offset: 2px;
  }

  .unread-dot {
    position: absolute;
    top: 6px;
    right: 6px;
    width: 8px;
    height: 8px;
    border: 1px solid rgba(10, 14, 20, 0.92);
    border-radius: 999px;
    background: #ff4d5a;
    box-shadow: 0 0 0 1px rgba(255, 77, 90, 0.26);
    pointer-events: none;
  }
</style>
