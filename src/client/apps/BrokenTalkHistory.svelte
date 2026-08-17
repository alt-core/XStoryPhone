<script lang="ts">
  import { TriangleAlert } from "@lucide/svelte";
</script>

<div class="broken-talk-history" role="status">
  <TriangleAlert size={16} strokeWidth={2.1} aria-hidden="true" />
  <span>履歴データが破損しています</span>
</div>

<style>
  .broken-talk-history {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    min-height: 42px;
    margin: 7px 2px;
    padding: 8px 12px;
    overflow: hidden;
    border: 1px solid rgba(255, 214, 104, 0.28);
    border-radius: 12px;
    background:
      repeating-linear-gradient(0deg, rgba(255, 255, 255, 0.045) 0 1px, transparent 1px 5px),
      linear-gradient(90deg, rgba(255, 214, 104, 0.08), rgba(255, 255, 255, 0.035), rgba(255, 214, 104, 0.08)),
      rgba(5, 8, 12, 0.86);
    color: rgba(255, 226, 122, 0.9);
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
    font-size: 0.72rem;
    font-weight: 720;
    letter-spacing: 0.02em;
  }

  .broken-talk-history::after {
    content: "";
    position: absolute;
    inset: 0;
    background: linear-gradient(90deg, transparent 0 30%, rgba(255, 255, 255, 0.1) 46%, transparent 62%);
    opacity: 0.34;
    pointer-events: none;
  }

  .broken-talk-history :global(svg),
  .broken-talk-history span {
    position: relative;
    z-index: 1;
  }
</style>
