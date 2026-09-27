<script lang="ts">
  import type { MediaAttachment } from "../scenario-runtime/types";
  import AttachmentImageFrame from "../system/AttachmentImageFrame.svelte";
  import AudioPlaybackButton from "../system/AudioPlaybackButton.svelte";
  import VideoPlayback from "../system/VideoPlayback.svelte";
  import VideoStillFrame from "../system/VideoStillFrame.svelte";

  export let media: MediaAttachment;
  export let playbackId: string;
  export let canOpenAlbum = false;
  export let onOpenAlbum: () => void = () => {};
  export let onComplete: (media: MediaAttachment) => void = () => {};
</script>

{#if media.kind === "image" && media.imageUrl}
  {#if canOpenAlbum}
    <button class="media-attachment-button" type="button" title="アルバムで開く" aria-label="画像をアルバムで開く" on:click={onOpenAlbum}>
      <AttachmentImageFrame src={media.imageUrl} alt="" />
    </button>
  {:else}
    <AttachmentImageFrame src={media.imageUrl} alt="" />
  {/if}
{:else if media.kind === "audio" && media.audioUrl}
  {#if canOpenAlbum}
    <button class="media-attachment-button" type="button" title="アルバムで開く" aria-label="動画をアルバムで開く" on:click={onOpenAlbum}>
      <VideoStillFrame src={media.imageUrl} />
    </button>
  {:else}
    <VideoStillFrame src={media.imageUrl} />
  {/if}
  <AudioPlaybackButton {playbackId} src={media.audioUrl} label="再生" onComplete={() => onComplete(media)} />
{:else if media.kind === "video" && media.videoUrl}
  <VideoPlayback src={media.videoUrl} poster={media.imageUrl ?? ""} label="添付動画" onComplete={() => onComplete(media)} />
  {#if canOpenAlbum}
    <button class="shared-link-card" type="button" on:click={onOpenAlbum}><span>アルバムで表示</span></button>
  {/if}
{/if}

<style>
  .media-attachment-button { display: block; width: 100%; min-width: 0; height: auto; padding: 0; border: 0; border-radius: 10px; background: transparent; color: inherit; text-align: inherit; cursor: pointer; }
  .media-attachment-button:focus-visible { outline: 2px solid var(--attachment-focus, rgba(92, 200, 167, 0.72)); outline-offset: 2px; }
  .shared-link-card { display: grid; place-items: start; width: 100%; min-width: 0; min-height: 34px; padding: 8px 9px; border: 1px solid var(--attachment-border, rgba(92, 200, 167, 0.2)); border-radius: 10px; background: var(--attachment-background, rgba(92, 200, 167, 0.1)); color: var(--attachment-color, #d8fff4); text-align: left; cursor: pointer; }
  .shared-link-card span { overflow: hidden; max-width: 100%; font-size: 0.76rem; font-weight: 780; text-overflow: ellipsis; white-space: nowrap; }
</style>
