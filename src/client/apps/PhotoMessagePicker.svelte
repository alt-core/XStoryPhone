<script lang="ts">
  import { Check, Image, X } from "@lucide/svelte";
  import type { PhotoItem } from "../scenario-runtime/types";
  import ScrollHint from "../system/ScrollHint.svelte";
  import VideoStillFrame from "../system/VideoStillFrame.svelte";

  export let open = false;
  export let photos: PhotoItem[] = [];
  export let selectedPhotoId = "";
  export let accent = "#5cc8a7";
  export let onSelect: (photoId: string) => void = () => {};
  export let onClose: () => void = () => {};

  $: selectablePhotos = photos.filter((photo) => (photo.imageUrl || photo.audioUrl) && !photo.corrupted);

  function isVideoPhoto(photo: PhotoItem) {
    return photo.mediaKind === "still_video" && Boolean(photo.audioUrl);
  }
</script>

{#if open}
  <div class="photo-picker-backdrop" role="presentation">
    <button class="backdrop-button" type="button" aria-label="閉じる" on:click={onClose}></button>
    <section class="photo-picker" style={`--picker-accent: ${accent}`} aria-label="写真選択">
      <header>
        <div>
          <h3>写真・動画</h3>
          <span>{selectablePhotos.length}件</span>
        </div>
        <button class="close-button" type="button" aria-label="閉じる" title="閉じる" on:click={onClose}>
          <X size={17} strokeWidth={2.2} />
        </button>
      </header>

      {#if selectablePhotos.length}
        <ScrollHint enabled={selectablePhotos.length > 6} step={104}>
          <div class="photo-grid">
            {#each selectablePhotos as photo}
              <button
                type="button"
                class:selected={photo.id === selectedPhotoId}
                aria-label={isVideoPhoto(photo) ? "動画を選択" : "写真を選択"}
                on:click={() => {
                  onSelect(photo.id);
                  onClose();
                }}
              >
                {#if isVideoPhoto(photo)}
                  <VideoStillFrame src={photo.imageUrl} square compact />
                {:else if photo.imageUrl}
                  <img src={photo.imageUrl} alt="" />
                {/if}
                {#if photo.id === selectedPhotoId}
                  <span class="check-mark"><Check size={14} strokeWidth={2.4} /></span>
                {/if}
              </button>
            {/each}
          </div>
        </ScrollHint>
      {:else}
        <div class="empty-picker">
          <Image size={24} strokeWidth={2.1} />
          <strong>添付なし</strong>
        </div>
      {/if}
    </section>
  </div>
{/if}

<style>
  .photo-picker-backdrop {
    position: absolute;
    inset: 0;
    z-index: 12;
    display: grid;
    align-items: end;
    padding: 14px 10px 52px;
    background:
      radial-gradient(circle at 50% 100%, color-mix(in srgb, var(--picker-accent) 22%, transparent), transparent 46%),
      rgba(3, 6, 10, 0.56);
    backdrop-filter: blur(10px);
  }

  .backdrop-button {
    position: absolute;
    inset: 0;
    border: 0;
    background: transparent;
    cursor: default;
  }

  .photo-picker {
    position: relative;
    z-index: 1;
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    gap: 10px;
    min-height: 0;
    max-height: min(372px, 72%);
    padding: 12px;
    border: 1px solid color-mix(in srgb, var(--picker-accent) 28%, rgba(255, 255, 255, 0.12));
    border-radius: 18px;
    background:
      linear-gradient(180deg, color-mix(in srgb, var(--picker-accent) 13%, transparent), transparent 44%),
      rgba(10, 15, 21, 0.92);
    box-shadow: 0 22px 48px rgba(0, 0, 0, 0.42);
  }

  header {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: 10px;
  }

  header div {
    display: grid;
    gap: 2px;
    min-width: 0;
  }

  h3 {
    margin: 0;
    color: #fff;
    font-size: 0.98rem;
    line-height: 1.1;
  }

  header span {
    color: rgba(255, 255, 255, 0.52);
    font-size: 0.66rem;
    font-weight: 760;
  }

  .close-button {
    display: grid;
    place-items: center;
    width: 34px;
    height: 34px;
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 12px;
    background: rgba(255, 255, 255, 0.08);
    color: rgba(255, 255, 255, 0.86);
    cursor: pointer;
  }

  .photo-picker :global(.scroll-hint-shell) {
    min-height: 0;
    height: 100%;
  }

  .photo-grid {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-content: flex-start;
    min-height: 0;
    height: 100%;
    padding-bottom: 2px;
    overflow: auto;
    overscroll-behavior: contain;
    scrollbar-width: none;
  }

  .photo-grid::-webkit-scrollbar {
    display: none;
  }

  .photo-grid button {
    position: relative;
    display: block;
    flex: 0 0 calc((100% - 16px) / 3);
    aspect-ratio: 1;
    min-width: 0;
    padding: 0;
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 13px;
    background: rgba(255, 255, 255, 0.06);
    overflow: hidden;
    cursor: pointer;
  }

  .photo-grid button.selected {
    border-color: color-mix(in srgb, var(--picker-accent) 70%, white 10%);
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--picker-accent) 24%, transparent);
  }

  .photo-grid img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .photo-grid button :global(.video-still-frame) {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    border: 0;
    border-radius: 0;
  }

  .check-mark {
    position: absolute;
    right: 6px;
    bottom: 6px;
    z-index: 1;
    display: grid;
    place-items: center;
    width: 22px;
    height: 22px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--picker-accent) 82%, black 8%);
    color: #07100b;
    box-shadow: 0 6px 14px rgba(0, 0, 0, 0.34);
  }

  .empty-picker {
    display: grid;
    place-items: center;
    gap: 8px;
    min-height: 168px;
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 14px;
    background: rgba(255, 255, 255, 0.05);
    color: rgba(255, 255, 255, 0.58);
    font-size: 0.76rem;
  }
</style>
