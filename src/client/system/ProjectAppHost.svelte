<script lang="ts">
  import type { Component } from "svelte";
  import type { ProjectAppId } from "../../generated/projectAppIds.generated";
  import type { ProjectAppProps } from "./projectAppTypes";

  export let appId: ProjectAppId;
  export let items: ProjectAppProps["items"] = [];
  export let context: ProjectAppProps["context"];
  export let focusContentId = "";
  export let focusContentRequestId = 0;
  export let onContentOpen: ProjectAppProps["onContentOpen"] = () => {};
  export let onBlockedContentOpen: ProjectAppProps["onBlockedContentOpen"] = () => {};
  export let onNoise: ProjectAppProps["onNoise"] = () => {};

  const modules = import.meta.glob("../../project/apps/*/App.svelte", { eager: true }) as Record<string, { default: Component }>;
  const components = Object.fromEntries(Object.entries(modules).map(([file, module]) => [file.match(/apps\/([^/]+)\/App\.svelte$/u)?.[1] ?? "", module.default]));
  $: component = components[appId];
</script>

{#if component}
  <svelte:component
    this={component}
    {items}
    {context}
    {focusContentId}
    {focusContentRequestId}
    {onContentOpen}
    {onBlockedContentOpen}
    {onNoise}
  />
{/if}
