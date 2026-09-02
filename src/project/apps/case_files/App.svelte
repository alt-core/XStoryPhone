<script lang="ts">
  import type { ProjectAppContent, ProjectAppProps } from "../../../client/system/projectAppTypes";

  export let items: ProjectAppProps["items"] = [];
  export let context: ProjectAppProps["context"];
  export let focusContentId = "";
  export let focusContentRequestId = 0;
  export let onContentOpen: ProjectAppProps["onContentOpen"] = () => {};
  export let onBlockedContentOpen: ProjectAppProps["onBlockedContentOpen"] = () => {};
  export let onNoise: ProjectAppProps["onNoise"] = () => {};

  let selectedId = "";
  $: if (focusContentRequestId && focusContentId) selectedId = focusContentId;
  $: selected = items.find((item) => item.contentId === selectedId) as ProjectAppContent | undefined;

  function open(item: ProjectAppContent) {
    if (item.corrupted) {
      onNoise();
      onBlockedContentOpen(item.contentId);
      return;
    }
    selectedId = item.contentId;
    onContentOpen(item.contentId);
  }
</script>

<section class="project-app" aria-label="事件資料" data-session-ready={context.playerReady ? "true" : "false"}>
  {#if selected}
    <header><button type="button" on:click={() => (selectedId = "")}>戻る</button><strong>{String(selected.title ?? "資料")}</strong></header>
    <div class="detail">{String(selected.body ?? "")}</div>
  {:else}
    <header><strong>事件資料</strong></header>
    <div class="list">
      {#each items as item}
        <button type="button" on:click={() => open(item)}>{String(item.title ?? item.repairLabel ?? "資料")}</button>
      {/each}
    </div>
  {/if}
</section>

<style>
  .project-app { display: grid; grid-template-rows: auto minmax(0, 1fr); height: 100%; background: #f7f7f5; color: #202126; }
  header { display: flex; gap: 12px; align-items: center; min-height: 52px; padding: 0 16px; border-bottom: 1px solid #d9dad7; }
  header button { border: 0; background: transparent; color: #345f9d; }
  .list, .detail { min-height: 0; overflow-y: auto; padding: 14px; }
  .list { display: grid; align-content: start; gap: 8px; }
  .list button { padding: 12px; border: 1px solid #d6d7d4; border-radius: 10px; background: #fff; text-align: left; }
  .detail { white-space: pre-wrap; line-height: 1.7; }
</style>
