<script lang="ts">
  import type { MessageSegment } from "../scenario-runtime/types";

  export let body = "";
  export let segments: MessageSegment[] | undefined = undefined;
  export let onOpenLink: (segmentIndex: number) => void = () => {};

  $: displaySegments = segments?.length ? segments : [{ kind: "text" as const, text: body }];
</script>

<p class="message-body">
  {#each displaySegments as segment, index}
    {#if segment.kind === "link"}
      {#if "externalUrl" in segment}
        <a class="message-link" href={segment.externalUrl} target="_blank" rel="noopener noreferrer">{segment.text}</a>
      {:else}
        <button type="button" class="message-link" on:click={() => onOpenLink(index)}>{segment.text}</button>
      {/if}
    {:else}
      {segment.text}
    {/if}
  {/each}
</p>

<style>
  .message-body {
    margin: 0;
    color: inherit;
    font-size: 0.83rem;
    line-height: 1.52;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    word-break: break-word;
  }

  .message-link {
    display: inline;
    border: 0;
    padding: 0;
    background: transparent;
    color: #c5f7ff;
    cursor: pointer;
    font: inherit;
    font-weight: 760;
    text-decoration: underline;
    text-decoration-thickness: 1px;
    text-underline-offset: 3px;
  }

  .message-link:active {
    opacity: 0.72;
  }
</style>
