<script lang="ts">
  import { tick } from "svelte";
  import { Image, X } from "@lucide/svelte";
  import type { PhotoItem } from "../scenario-runtime/types";
  import AudioPlaybackButton from "../system/AudioPlaybackButton.svelte";
  import { corruptionNoiseStyle } from "../system/corruptionNoise";
  import ScrollHint from "../system/ScrollHint.svelte";
  import VideoStillFrame from "../system/VideoStillFrame.svelte";
  import AppShell from "./AppShell.svelte";

  export let photos: PhotoItem[] = [];
  export let focusContentId = "";
  export let focusContentRequestId = 0;
  export let onContentOpen: (contentId: string) => void = () => {};
  export let onBlockedContentOpen: (contentId: string) => void = () => {};

  const selectionScrollGuard = 36;

  let selectedPhotoId = photos[0]?.id ?? "";
  let lastReportedContentId = "";
  let lastAppliedFocusContentId = "";
  let photoGrid: HTMLDivElement;
  let photoButtons: Record<string, HTMLButtonElement> = {};
  let selectionScrollToken = 0;
  let enlargedPhotoId = "";
  let lastAppliedFocusContentRequestId = focusContentRequestId;
  let lightboxFrame: HTMLDivElement;
  let lightboxFrameWidth = 0;
  let lightboxFrameHeight = 0;
  let lightboxImageRatio = 1;
  let lightboxOffsetX = 0;
  let lightboxPointerId: number | null = null;
  let lightboxDragStartX = 0;
  let lightboxDragStartOffsetX = 0;

  function isVideoContent(photo: PhotoItem | undefined) {
    return photo?.mediaKind === "still_video" && Boolean(photo.audioUrl);
  }

  function canEnlargePhoto(photo: PhotoItem | undefined): photo is PhotoItem & { imageUrl: string } {
    return Boolean(photo && !photo.corrupted && photo.imageUrl && !isVideoContent(photo));
  }

  function photoLabel(photo: PhotoItem) {
    return photo.title ?? (isVideoContent(photo) ? "動画" : "写真");
  }

  function photoCorruptionNoiseStyle(photo: PhotoItem) {
    return corruptionNoiseStyle(photo.contentId ?? photo.id);
  }

  function trackPhotoButton(node: HTMLButtonElement, photoId: string) {
    photoButtons[photoId] = node;

    return {
      update(nextPhotoId: string) {
        if (nextPhotoId === photoId) {
          return;
        }
        if (photoButtons[photoId] === node) {
          delete photoButtons[photoId];
        }
        photoId = nextPhotoId;
        photoButtons[photoId] = node;
      },
      destroy() {
        if (photoButtons[photoId] === node) {
          delete photoButtons[photoId];
        }
      }
    };
  }

  function keepSelectedPhotoVisible(photoId: string) {
    const token = ++selectionScrollToken;

    void tick().then(() => {
      if (token !== selectionScrollToken || selectedPhotoId !== photoId) {
        return;
      }

      const button = photoButtons[photoId];
      if (!photoGrid || !button) {
        return;
      }

      const cursorTop = button.offsetTop;
      const cursorBottom = cursorTop + button.offsetHeight;
      const visibleTop = photoGrid.scrollTop + selectionScrollGuard;
      const visibleBottom = photoGrid.scrollTop + photoGrid.clientHeight - selectionScrollGuard;
      const maxScrollTop = Math.max(0, photoGrid.scrollHeight - photoGrid.clientHeight);
      let nextScrollTop = photoGrid.scrollTop;

      if (cursorTop < visibleTop) {
        nextScrollTop = cursorTop - selectionScrollGuard;
      } else if (cursorBottom > visibleBottom) {
        nextScrollTop = cursorBottom - photoGrid.clientHeight + selectionScrollGuard;
      }

      photoGrid.scrollTo({ top: Math.min(Math.max(0, nextScrollTop), maxScrollTop), behavior: "auto" });
    });
  }

  $: if (!focusContentId) {
    lastAppliedFocusContentId = "";
    lastAppliedFocusContentRequestId = focusContentRequestId;
  } else if (focusContentId !== lastAppliedFocusContentId || focusContentRequestId !== lastAppliedFocusContentRequestId) {
    const requestChanged = focusContentRequestId !== lastAppliedFocusContentRequestId;
    if (requestChanged) {
      closeExpandedPhoto();
    }
    const focused = photos.find((photo) => photo.contentId === focusContentId || photo.id === focusContentId);
    if (focused) {
      lastAppliedFocusContentId = focusContentId;
      lastAppliedFocusContentRequestId = focusContentRequestId;
      selectedPhotoId = focused.id;
      keepSelectedPhotoVisible(focused.id);
      if (focused.corrupted) {
        onBlockedContentOpen(focused.contentId ?? focused.id);
      }
    }
  }
  $: selectedPhoto = photos.find((photo) => photo.id === selectedPhotoId) ?? photos[0];
  $: selectedPhotoContentId = selectedPhoto && !selectedPhoto.corrupted ? selectedPhoto.contentId ?? selectedPhoto.id : "";
  $: enlargedPhoto = photos.find((photo) => photo.id === enlargedPhotoId);
  $: lightboxMaxOffsetX = Math.max(0, (lightboxFrameHeight * lightboxImageRatio - lightboxFrameWidth) / 2);
  $: lightboxPannable = lightboxMaxOffsetX > 1;
  $: lightboxPanValue = lightboxMaxOffsetX > 0 ? Math.round((lightboxOffsetX / lightboxMaxOffsetX) * 100) : 0;
  $: if (enlargedPhotoId) {
    void tick().then(syncLightboxMetrics);
  }
  $: if (selectedPhotoContentId && selectedPhotoContentId !== lastReportedContentId) {
    lastReportedContentId = selectedPhotoContentId;
    onContentOpen(selectedPhotoContentId);
  }

  function selectPhoto(photo: PhotoItem) {
    selectedPhotoId = photo.id;
    keepSelectedPhotoVisible(photo.id);
    if (photo.corrupted) {
      onBlockedContentOpen(photo.contentId ?? photo.id);
    }
  }

  function notifyAudioPlaybackComplete(photo: PhotoItem) {
    if (!photo.audioUrl && !photo.attachmentId) {
      return;
    }

    window.dispatchEvent(
      new CustomEvent("xstoryphone:audio-playback-complete", {
        detail: {
          contentId: photo.contentId ?? photo.id,
          ...(photo.attachmentId ? { attachmentId: photo.attachmentId } : {})
        }
      })
    );
  }

  function openExpandedPhoto(photo: PhotoItem | undefined) {
    if (!canEnlargePhoto(photo)) {
      return;
    }
    resetLightboxPan();
    enlargedPhotoId = photo.id;
  }

  function closeExpandedPhoto() {
    enlargedPhotoId = "";
    resetLightboxPan();
  }

  function handleWindowKeydown(event: KeyboardEvent) {
    if (event.key === "Escape" && enlargedPhotoId) {
      closeExpandedPhoto();
    }
  }

  function handleWindowResize() {
    if (!enlargedPhotoId) {
      return;
    }
    syncLightboxMetrics();
  }

  function resetLightboxPan() {
    lightboxFrameWidth = 0;
    lightboxFrameHeight = 0;
    lightboxImageRatio = 1;
    lightboxOffsetX = 0;
    lightboxPointerId = null;
  }

  function syncLightboxMetrics() {
    if (!lightboxFrame) {
      return;
    }
    lightboxFrameWidth = lightboxFrame.clientWidth;
    lightboxFrameHeight = lightboxFrame.clientHeight;
    setLightboxOffset(lightboxOffsetX);
  }

  function currentLightboxMaxOffsetX() {
    return Math.max(0, (lightboxFrameHeight * lightboxImageRatio - lightboxFrameWidth) / 2);
  }

  function setLightboxOffset(nextOffsetX: number) {
    const maxOffsetX = currentLightboxMaxOffsetX();
    lightboxOffsetX = Math.min(maxOffsetX, Math.max(-maxOffsetX, nextOffsetX));
  }

  function updateLightboxImageRatio(event: Event) {
    const image = event.currentTarget as HTMLImageElement;
    lightboxImageRatio = image.naturalHeight > 0 ? image.naturalWidth / image.naturalHeight : 1;
    syncLightboxMetrics();
  }

  function startLightboxDrag(event: PointerEvent) {
    syncLightboxMetrics();
    if (currentLightboxMaxOffsetX() <= 1) {
      return;
    }
    lightboxPointerId = event.pointerId;
    lightboxDragStartX = event.clientX;
    lightboxDragStartOffsetX = lightboxOffsetX;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  function dragLightbox(event: PointerEvent) {
    if (lightboxPointerId !== event.pointerId) {
      return;
    }
    setLightboxOffset(lightboxDragStartOffsetX + event.clientX - lightboxDragStartX);
    event.preventDefault();
  }

  function stopLightboxDrag(event: PointerEvent) {
    if (lightboxPointerId !== event.pointerId) {
      return;
    }
    if ((event.currentTarget as HTMLElement).hasPointerCapture(event.pointerId)) {
      (event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId);
    }
    lightboxPointerId = null;
  }

  function handleLightboxKeydown(event: KeyboardEvent) {
    if (!lightboxPannable) {
      return;
    }
    const step = Math.max(24, lightboxFrameWidth * 0.12);
    if (event.key === "ArrowLeft") {
      setLightboxOffset(lightboxOffsetX + step);
    } else if (event.key === "ArrowRight") {
      setLightboxOffset(lightboxOffsetX - step);
    } else if (event.key === "Home") {
      setLightboxOffset(lightboxMaxOffsetX);
    } else if (event.key === "End") {
      setLightboxOffset(-lightboxMaxOffsetX);
    } else {
      return;
    }
    event.preventDefault();
  }
</script>

<svelte:window on:keydown={handleWindowKeydown} on:resize={handleWindowResize} />

<AppShell title="アルバム" subtitle={`${photos.length}件・端末内`} accent="#f0b35d">
  <div class="photo-layout">
    {#if selectedPhoto}
      <section class="photo-view" aria-label={photoLabel(selectedPhoto)} title={photoLabel(selectedPhoto)}>
        {#if selectedPhoto.corrupted}
          <div class="photo-error-panel" style={photoCorruptionNoiseStyle(selectedPhoto)}>
            <span class="repair-label">&lt;ERROR コンテンツへのリンクが破損しています&gt;</span>
          </div>
        {:else if canEnlargePhoto(selectedPhoto)}
          <button
            class="photo-expand-button"
            type="button"
            title="拡大表示"
            aria-label={`${photoLabel(selectedPhoto)}を拡大表示`}
            on:click={() => openExpandedPhoto(selectedPhoto)}
          >
            <span class="photo-art large hasImage">
              <img src={selectedPhoto.imageUrl} alt="" />
            </span>
          </button>
        {:else}
          <div class="photo-art large" class:hasImage={Boolean(selectedPhoto.imageUrl)} class:video-art={isVideoContent(selectedPhoto)}>
            {#if selectedPhoto.imageUrl}
              {#if isVideoContent(selectedPhoto)}
                <VideoStillFrame src={selectedPhoto.imageUrl} square />
              {:else}
                <img src={selectedPhoto.imageUrl} alt="" />
              {/if}
            {:else}
              <span class="land-mark"></span>
            {/if}
            {#if isVideoContent(selectedPhoto)}
              <div class="video-playback-overlay">
                <AudioPlaybackButton
                  playbackId={`album-video:${selectedPhoto.id}`}
                  src={selectedPhoto.audioUrl ?? ""}
                  label="再生"
                  onComplete={() => notifyAudioPlaybackComplete(selectedPhoto)}
                />
              </div>
            {/if}
          </div>
        {/if}
      </section>
    {:else}
      <section class="photo-view" aria-label="アルバムは空です">
        <div class="photo-empty" role="status">
          <Image size={34} strokeWidth={1.7} />
          <span>写真や動画はありません</span>
        </div>
      </section>
    {/if}

    <div class="library-head">
      <span><Image size={15} strokeWidth={2.1} /> ライブラリ</span>
      <strong>{photos.length}</strong>
    </div>

    <ScrollHint enabled={photos.length > 6} step={118}>
      <div class="photo-grid" class:scrolling={photos.length > 6} bind:this={photoGrid}>
        {#each photos as photo}
          <button
            use:trackPhotoButton={photo.id}
            class:active={photo.id === selectedPhoto?.id}
            type="button"
            title={photoLabel(photo)}
            aria-label={photoLabel(photo)}
            on:click={() => selectPhoto(photo)}
          >
            <span
              class="photo-art"
              class:hasImage={Boolean(photo.imageUrl) && !photo.corrupted}
              class:corrupted={photo.corrupted}
              style={photo.corrupted ? photoCorruptionNoiseStyle(photo) : ""}
            >
              {#if isVideoContent(photo) && !photo.corrupted}
                <VideoStillFrame src={photo.imageUrl} square compact />
              {:else if photo.imageUrl && !photo.corrupted}
                <img src={photo.imageUrl} alt="" />
              {:else if !photo.corrupted}
                <span class="land-mark"></span>
              {/if}
            </span>
          </button>
        {/each}
      </div>
    </ScrollHint>
  </div>

  <svelte:fragment slot="overlay">
    {#if enlargedPhoto && canEnlargePhoto(enlargedPhoto)}
      <div class="photo-lightbox" role="presentation">
        <button class="photo-lightbox-scrim" type="button" aria-label="閉じる" on:click={closeExpandedPhoto}></button>
        <div class="photo-lightbox-dialog" role="dialog" aria-modal="true" aria-label={`${photoLabel(enlargedPhoto)}の拡大表示`}>
          <button class="photo-lightbox-close" type="button" aria-label="閉じる" title="閉じる" on:click={closeExpandedPhoto}>
            <X size={18} strokeWidth={2.3} />
          </button>
          <div
            class="photo-lightbox-frame"
            class:pannable={lightboxPannable}
            class:dragging={lightboxPointerId !== null}
            role="slider"
            aria-label={`${photoLabel(enlargedPhoto)}の表示位置`}
            aria-orientation="horizontal"
            aria-valuemin="-100"
            aria-valuemax="100"
            aria-valuenow={lightboxPanValue}
            tabindex={lightboxPannable ? 0 : -1}
            bind:this={lightboxFrame}
            on:pointerdown={startLightboxDrag}
            on:pointermove={dragLightbox}
            on:pointerup={stopLightboxDrag}
            on:pointercancel={stopLightboxDrag}
            on:keydown={handleLightboxKeydown}
          >
            <img
              src={enlargedPhoto.imageUrl}
              alt=""
              draggable="false"
              style={`--lightbox-offset-x: ${lightboxOffsetX}px`}
              on:load={updateLightboxImageRatio}
            />
          </div>
        </div>
      </div>
    {/if}
  </svelte:fragment>
</AppShell>

<style>
  .photo-layout {
    display: grid;
    gap: 10px;
  }

  .photo-view {
    display: grid;
    gap: 10px;
  }

  .photo-empty {
    display: grid;
    place-content: center;
    justify-items: center;
    gap: 10px;
    aspect-ratio: 1 / 1;
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: var(--ap-radius-panel);
    background: rgba(8, 13, 19, 0.32);
    color: rgba(255, 255, 255, 0.48);
    font-size: 0.76rem;
    font-weight: 700;
  }

  .photo-art {
    position: relative;
    display: block;
    aspect-ratio: 1 / 1;
    overflow: hidden;
    border-radius: var(--ap-radius-card);
    background:
      linear-gradient(145deg, #2f4357, #8290a0),
      linear-gradient(180deg, rgba(255, 255, 255, 0.18), rgba(0, 0, 0, 0.18));
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.18),
      0 14px 28px rgba(0, 0, 0, 0.2);
  }

  .photo-art::before {
    content: "";
    position: absolute;
    left: -15%;
    right: -15%;
    bottom: -10%;
    height: 46%;
    border-radius: 50% 50% 0 0;
    background: color-mix(in srgb, #d6e7f6 86%, white 4%);
    opacity: 0.84;
  }

  .photo-art::after {
    content: "";
    position: absolute;
    top: 14%;
    right: 16%;
    width: 22%;
    aspect-ratio: 1;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.72);
    box-shadow: 0 0 28px rgba(255, 255, 255, 0.4);
  }

  .land-mark {
    position: absolute;
    left: 16%;
    bottom: 20%;
    width: 72%;
    height: 16%;
    border-radius: 999px;
    background: rgba(15, 18, 24, 0.26);
    transform: rotate(-5deg);
  }

  .photo-art.large {
    aspect-ratio: 1 / 1;
    border-radius: var(--ap-radius-panel);
  }

  .photo-expand-button {
    display: block;
    width: 100%;
    min-width: 0;
    padding: 0;
    border: 0;
    border-radius: var(--ap-radius-panel);
    background: transparent;
    color: inherit;
    cursor: zoom-in;
    text-align: inherit;
  }

  .photo-expand-button:focus-visible {
    outline: 2px solid rgba(240, 179, 93, 0.9);
    outline-offset: 3px;
  }

  .photo-error-panel {
    position: relative;
    display: grid;
    place-items: center;
    aspect-ratio: 1 / 1;
    border: 1px solid rgba(255, 214, 104, 0.34);
    border-radius: var(--ap-radius-panel);
    overflow: hidden;
    background:
      linear-gradient(180deg, rgba(0, 0, 0, 0.12), rgba(0, 0, 0, 0.58)),
      var(--corruption-noise, url("/system/album-corruption-noise-01.webp")) center / cover no-repeat,
      #03080d;
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.12),
      inset 0 -20px 38px rgba(0, 0, 0, 0.4);
  }

  .photo-error-panel::before,
  .photo-error-panel::after {
    content: "";
    position: absolute;
    inset: 0;
    pointer-events: none;
  }

  .photo-error-panel::before {
    background:
      linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.16), transparent),
      repeating-linear-gradient(
        0deg,
        rgba(255, 255, 255, 0.1) 0 1px,
        transparent 1px 6px
      );
    mix-blend-mode: screen;
    opacity: 0.2;
  }

  .photo-error-panel::after {
    inset: auto 0 0;
    height: 38%;
    background: linear-gradient(180deg, transparent, rgba(0, 0, 0, 0.48));
  }

  .photo-art.hasImage {
    background: #111821;
  }

  .photo-art.hasImage::before,
  .photo-art.hasImage::after {
    display: none;
  }

  .photo-art img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .photo-art :global(.video-still-frame) {
    width: 100%;
    height: 100%;
    border-radius: var(--ap-radius-card);
  }

  .photo-art.large :global(.video-still-frame) {
    border: 0;
    border-radius: var(--ap-radius-panel);
    box-shadow: none;
  }

  .photo-art.video-art {
    isolation: isolate;
  }

  .video-playback-overlay {
    position: absolute;
    right: 10px;
    bottom: 10px;
    left: 10px;
    z-index: 2;
    color: rgba(255, 255, 255, 0.92);
  }

  .video-playback-overlay :global(.audio-playback-button) {
    border-color: rgba(255, 255, 255, 0.18);
    background: rgba(4, 8, 12, 0.64);
    box-shadow: 0 12px 28px rgba(0, 0, 0, 0.34);
    backdrop-filter: blur(10px);
  }

  .library-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    color: rgba(255, 255, 255, 0.68);
    font-size: 0.72rem;
    font-weight: 760;
  }

  .library-head span {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }

  .library-head strong {
    color: #fff;
  }

  .photo-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 8px;
  }

  .photo-grid.scrolling {
    max-height: 236px;
    overflow: auto;
    overscroll-behavior: contain;
    padding-bottom: 12px;
    scroll-padding: 36px 0;
    scrollbar-width: none;
    mask-image: linear-gradient(180deg, #000 0, #000 calc(100% - 20px), rgba(0, 0, 0, 0.18));
  }

  .photo-grid.scrolling::-webkit-scrollbar {
    display: none;
  }

  .photo-grid button {
    position: relative;
    display: grid;
    min-width: 0;
    aspect-ratio: 1;
    box-sizing: border-box;
    padding: 4px;
    border: 0;
    border-radius: calc(var(--ap-radius-card) + 5px);
    background: transparent;
    color: #fff;
    cursor: pointer;
    text-align: left;
    scroll-margin: 36px 0;
  }

  .photo-grid button::after {
    content: "";
    position: absolute;
    inset: 1px;
    border: 2px solid transparent;
    border-radius: calc(var(--ap-radius-card) + 5px);
    pointer-events: none;
  }

  .photo-grid button.active::after {
    border-color: #f0b35d;
    box-shadow:
      0 0 0 1px rgba(240, 179, 93, 0.22),
      0 0 18px rgba(240, 179, 93, 0.16);
  }

  .photo-art.corrupted {
    background:
      linear-gradient(180deg, rgba(255, 255, 255, 0.04), rgba(0, 0, 0, 0.32)),
      var(--corruption-noise, url("/system/album-corruption-noise-01.webp")) center / cover no-repeat,
      #03080d;
    filter: saturate(0.86) contrast(1.1);
  }

  .photo-art.corrupted::before {
    inset: 0;
    height: auto;
    border-radius: inherit;
    background:
      repeating-linear-gradient(
        0deg,
        rgba(255, 255, 255, 0.12) 0 1px,
        transparent 1px 6px
      );
    mix-blend-mode: screen;
    opacity: 0.12;
  }

  .photo-art.corrupted::after {
    display: block;
    inset: auto 0 0;
    width: auto;
    height: 42%;
    border-radius: 0;
    background: linear-gradient(180deg, transparent, rgba(0, 0, 0, 0.42));
    box-shadow: none;
  }

  .repair-label {
    z-index: 2;
    width: min(86%, 280px);
    padding: 10px 11px;
    border: 1px solid rgba(255, 214, 104, 0.36);
    border-radius: 8px;
    background: rgba(4, 4, 2, 0.86);
    color: rgba(255, 226, 122, 0.96);
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
    font-size: 0.7rem;
    font-weight: 760;
    line-height: 1.45;
    text-align: left;
    box-shadow: 0 12px 22px rgba(0, 0, 0, 0.34);
  }

  .photo-lightbox {
    position: absolute;
    inset: 0;
    z-index: 42;
    display: grid;
    place-items: center;
    padding: 12px 12px 78px;
  }

  .photo-lightbox-scrim {
    position: absolute;
    inset: 0;
    border: 0;
    background:
      radial-gradient(circle at 50% 35%, rgba(240, 179, 93, 0.16), transparent 42%),
      rgba(3, 6, 10, 0.78);
    cursor: zoom-out;
    backdrop-filter: blur(12px);
  }

  .photo-lightbox-dialog {
    position: relative;
    z-index: 1;
    display: grid;
    grid-template-rows: 36px minmax(0, 1fr);
    gap: 10px;
    width: 100%;
    height: 100%;
    min-height: 0;
  }

  .photo-lightbox-close {
    justify-self: end;
    display: grid;
    place-items: center;
    width: 36px;
    height: 36px;
    padding: 0;
    border: 1px solid rgba(255, 255, 255, 0.14);
    border-radius: 12px;
    background: rgba(255, 255, 255, 0.08);
    color: rgba(255, 255, 255, 0.86);
    cursor: pointer;
    box-shadow: var(--ap-shadow-inset);
    backdrop-filter: blur(12px);
  }

  .photo-lightbox-close:focus-visible {
    outline: 2px solid rgba(240, 179, 93, 0.88);
    outline-offset: 2px;
  }

  .photo-lightbox-frame {
    position: relative;
    display: grid;
    place-items: center;
    min-height: 0;
    overflow: hidden;
    border: 1px solid rgba(240, 179, 93, 0.16);
    border-radius: 18px;
    background:
      linear-gradient(180deg, rgba(255, 255, 255, 0.06), rgba(0, 0, 0, 0.16)),
      rgba(7, 10, 15, 0.88);
    box-shadow:
      var(--ap-shadow-inset),
      0 24px 48px rgba(0, 0, 0, 0.46);
    touch-action: none;
    user-select: none;
  }

  .photo-lightbox-frame.pannable {
    cursor: grab;
  }

  .photo-lightbox-frame.dragging {
    cursor: grabbing;
  }

  .photo-lightbox-frame img {
    position: absolute;
    top: 0;
    left: 50%;
    display: block;
    width: auto;
    height: 100%;
    max-width: none;
    max-height: 100%;
    transform: translateX(calc(-50% + var(--lightbox-offset-x, 0px)));
    will-change: transform;
    pointer-events: none;
  }
</style>
