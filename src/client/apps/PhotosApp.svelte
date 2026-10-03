<script lang="ts">
  import { tick } from "svelte";
  import { Image, Play, X } from "@lucide/svelte";
  import type { PhotoItem } from "../scenario-runtime/types";
  import AudioPlaybackButton from "../system/AudioPlaybackButton.svelte";
  import ContentTags from "../system/ContentTags.svelte";
  import { corruptionNoiseStyle } from "../system/corruptionNoise";
  import ScrollHint from "../system/ScrollHint.svelte";
  import VideoPlayback from "../system/VideoPlayback.svelte";
  import VideoStillFrame from "../system/VideoStillFrame.svelte";
  import { resourceUrl } from "../system/resourceUrls";
  import AppDetailBar from "./AppDetailBar.svelte";
  import AppListHeader from "./AppListHeader.svelte";
  import AppShell from "./AppShell.svelte";

  const STILL_VIDEO_FALLBACK_IMAGE = "/system/audio-only-video-thumbnail.png";
  const ZOOM_TAP_TOLERANCE_PX = 6;

  export let photos: PhotoItem[] = [];
  export let focusContentId = "";
  export let focusContentRequestId = 0;
  export let onNavigate: (contentId: string) => void = () => {};
  export let onContentOpen: (contentId: string) => void = () => {};
  export let onDisplayedContentChange: (contentId: string) => void = () => {};
  export let onBlockedContentOpen: (contentId: string) => void = () => {};

  // 空なら一覧。Appの表示指定は要求ごとに1回だけ適用する。
  let openPhotoId = "";
  let lastOpenedPhotoId = "";
  let appliedFocusRequestId: number | undefined;
  let lastReportedDisplayedContentId: string | undefined;
  let gridElement: HTMLDivElement | undefined;
  let gridScrollTop = 0;

  let zoomed = false;
  let zoomFrame: HTMLButtonElement | undefined;
  let zoomImage: HTMLImageElement | undefined;
  let zoomFrameWidth = 0;
  let zoomFrameHeight = 0;
  let zoomNaturalWidth = 0;
  let zoomNaturalHeight = 0;
  let zoomOffsetX = 0;
  let zoomOffsetY = 0;
  let zoomPointerId: number | null = null;
  let zoomDragStartX = 0;
  let zoomDragStartY = 0;
  let zoomDragStartOffsetX = 0;
  let zoomDragStartOffsetY = 0;
  let zoomDragDistance = 0;

  $: applyFocus(focusContentId, focusContentRequestId);
  $: openPhoto = openPhotoId ? photos.find((photo) => photo.id === openPhotoId) : undefined;
  // condで消えた項目を表示し続けない。
  $: if (openPhotoId && (!openPhoto || openPhoto.corrupted)) {
    showList();
  }
  $: reportDisplayedContent(openPhoto && !openPhoto.corrupted ? photoContentId(openPhoto) : "");
  $: if (zoomed && !canZoom(openPhoto)) {
    closeZoom();
  }
  // 縦横の一方を枠いっぱいにし、他方をはみ出させる。
  $: zoomScale = zoomNaturalWidth && zoomNaturalHeight && zoomFrameWidth && zoomFrameHeight
    ? Math.max(zoomFrameWidth / zoomNaturalWidth, zoomFrameHeight / zoomNaturalHeight)
    : 0;
  $: zoomImageWidth = zoomNaturalWidth * zoomScale;
  $: zoomImageHeight = zoomNaturalHeight * zoomScale;
  $: zoomMaxOffsetX = Math.max(0, (zoomImageWidth - zoomFrameWidth) / 2);
  $: zoomMaxOffsetY = Math.max(0, (zoomImageHeight - zoomFrameHeight) / 2);
  $: zoomPannable = zoomMaxOffsetX > 1 || zoomMaxOffsetY > 1;

  function photoContentId(photo: PhotoItem) {
    return photo.contentId ?? photo.id;
  }

  function isStillVideoContent(photo: PhotoItem | undefined) {
    return photo?.mediaKind === "still_video" && Boolean(photo.audioUrl);
  }

  function isNativeVideoContent(photo: PhotoItem | undefined) {
    return photo?.mediaKind === "video" && Boolean(photo.videoUrl);
  }

  function isVideoContent(photo: PhotoItem | undefined) {
    return isStillVideoContent(photo) || isNativeVideoContent(photo);
  }

  function canZoom(photo: PhotoItem | undefined): photo is PhotoItem & { imageUrl: string } {
    return Boolean(photo && !photo.corrupted && photo.imageUrl && !isVideoContent(photo));
  }

  function photoLabel(photo: PhotoItem) {
    return photo.title ?? (isVideoContent(photo) ? "動画" : "写真");
  }

  function applyFocus(contentId: string, requestId: number) {
    if (requestId === appliedFocusRequestId) {
      return;
    }
    appliedFocusRequestId = requestId;
    const focused = contentId ? photos.find((photo) => photo.contentId === contentId || photo.id === contentId) : undefined;
    if (!focused || focused.corrupted) {
      showList();
      if (focused) onBlockedContentOpen(photoContentId(focused));
      return;
    }
    enterPhoto(focused);
  }

  // 詳細に入るたびに開封を報告する。一覧を挟んだ同じ項目の再表示も1回の開封。
  function enterPhoto(photo: PhotoItem) {
    closeZoom();
    openPhotoId = photo.id;
    lastOpenedPhotoId = photo.id;
    onContentOpen(photoContentId(photo));
  }

  function showList() {
    closeZoom();
    if (!openPhotoId) {
      return;
    }
    openPhotoId = "";
    void restoreGridPosition();
  }

  async function restoreGridPosition() {
    await tick();
    if (!gridElement) {
      return;
    }
    gridElement.scrollTop = gridScrollTop;
    gridElement.querySelector(`[data-photo-id="${CSS.escape(lastOpenedPhotoId)}"]`)?.scrollIntoView({ block: "nearest" });
  }

  function reportDisplayedContent(contentId: string) {
    if (contentId === lastReportedDisplayedContentId) {
      return;
    }
    lastReportedDisplayedContentId = contentId;
    onDisplayedContentChange(contentId);
  }

  function selectPhoto(photo: PhotoItem) {
    if (photo.corrupted) {
      onBlockedContentOpen(photoContentId(photo));
      return;
    }
    onNavigate(photoContentId(photo));
    enterPhoto(photo);
  }

  function returnToList() {
    onNavigate("");
    showList();
  }

  function notifyMediaPlaybackComplete(photo: PhotoItem) {
    if (!photo.audioUrl && !photo.videoUrl && !photo.attachmentId) {
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

  function openZoom() {
    if (!canZoom(openPhoto)) {
      return;
    }
    zoomNaturalWidth = 0;
    zoomNaturalHeight = 0;
    zoomOffsetX = 0;
    zoomOffsetY = 0;
    zoomPointerId = null;
    zoomed = true;
    void tick().then(() => {
      // 読み込み済みの画像ではloadが先に済んでいることがある。
      if (zoomImage?.complete && zoomImage.naturalWidth) {
        zoomNaturalWidth = zoomImage.naturalWidth;
        zoomNaturalHeight = zoomImage.naturalHeight;
      }
      syncZoomFrame();
      zoomFrame?.focus({ preventScroll: true });
    });
  }

  function closeZoom() {
    zoomed = false;
    zoomPointerId = null;
  }

  function syncZoomFrame() {
    if (!zoomFrame) {
      return;
    }
    zoomFrameWidth = zoomFrame.clientWidth;
    zoomFrameHeight = zoomFrame.clientHeight;
    void tick().then(() => setZoomOffset(zoomOffsetX, zoomOffsetY));
  }

  function handleZoomImageLoad(event: Event) {
    const image = event.currentTarget as HTMLImageElement;
    zoomNaturalWidth = image.naturalWidth;
    zoomNaturalHeight = image.naturalHeight;
    syncZoomFrame();
  }

  function clampZoomOffset(value: number, max: number) {
    return Math.min(max, Math.max(-max, value)) || 0;
  }

  function setZoomOffset(nextX: number, nextY: number) {
    zoomOffsetX = clampZoomOffset(nextX, zoomMaxOffsetX);
    zoomOffsetY = clampZoomOffset(nextY, zoomMaxOffsetY);
  }

  function startZoomDrag(event: PointerEvent) {
    zoomPointerId = event.pointerId;
    zoomDragStartX = event.clientX;
    zoomDragStartY = event.clientY;
    zoomDragStartOffsetX = zoomOffsetX;
    zoomDragStartOffsetY = zoomOffsetY;
    zoomDragDistance = 0;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  function dragZoom(event: PointerEvent) {
    if (zoomPointerId !== event.pointerId) {
      return;
    }
    const deltaX = event.clientX - zoomDragStartX;
    const deltaY = event.clientY - zoomDragStartY;
    zoomDragDistance = Math.max(zoomDragDistance, Math.hypot(deltaX, deltaY));
    setZoomOffset(zoomDragStartOffsetX + deltaX, zoomDragStartOffsetY + deltaY);
    event.preventDefault();
  }

  function endZoomDrag(event: PointerEvent) {
    if (zoomPointerId !== event.pointerId) {
      return;
    }
    const target = event.currentTarget as HTMLElement;
    if (target.hasPointerCapture(event.pointerId)) {
      target.releasePointerCapture(event.pointerId);
    }
    zoomPointerId = null;
  }

  // 動かさずに離したタップ(とEnter・Space)は全体表示へ戻す。
  function handleZoomClick() {
    if (zoomDragDistance < ZOOM_TAP_TOLERANCE_PX) {
      closeZoom();
    }
    zoomDragDistance = 0;
  }

  // 閉じるボタンなどへフォーカスが移っても、Escapeで拡大表示を閉じる。
  function handleWindowKeydown(event: KeyboardEvent) {
    if (zoomed && event.key === "Escape") {
      closeZoom();
      event.preventDefault();
    }
  }

  function handleZoomKeydown(event: KeyboardEvent) {
    const stepX = Math.max(24, zoomFrameWidth * 0.12);
    const stepY = Math.max(24, zoomFrameHeight * 0.12);
    if (event.key === "ArrowLeft") {
      setZoomOffset(zoomOffsetX + stepX, zoomOffsetY);
    } else if (event.key === "ArrowRight") {
      setZoomOffset(zoomOffsetX - stepX, zoomOffsetY);
    } else if (event.key === "ArrowUp") {
      setZoomOffset(zoomOffsetX, zoomOffsetY + stepY);
    } else if (event.key === "ArrowDown") {
      setZoomOffset(zoomOffsetX, zoomOffsetY - stepY);
    } else {
      return;
    }
    event.preventDefault();
  }
</script>

<svelte:window on:keydown={handleWindowKeydown} on:resize={() => zoomed && syncZoomFrame()} />

<AppShell title="アルバム" subtitle={`${photos.length}件・端末内`} accent="#f0b35d">
  <div class="album-app">
    {#if openPhoto && !openPhoto.corrupted}
      <section class="photo-detail" class:with-tag-row={Boolean(openPhoto.title && openPhoto.tags?.length)} aria-label={photoLabel(openPhoto)}>
        {#if openPhoto.title}
          <AppDetailBar listLabel="アルバム一覧" title={openPhoto.title} onList={returnToList} />
          {#if openPhoto.tags?.length}
            <div class="detail-tags">
              <ContentTags tags={openPhoto.tags} />
            </div>
          {/if}
        {:else}
          <AppDetailBar listLabel="アルバム一覧" onList={returnToList}>
            <div class="bar-tags">
              <ContentTags tags={openPhoto.tags ?? []} />
            </div>
          </AppDetailBar>
        {/if}

        <div class="media-stage" class:native-video={isNativeVideoContent(openPhoto)}>
          {#if isNativeVideoContent(openPhoto)}
            <div class="native-video-frame">
              <VideoPlayback
                src={openPhoto.videoUrl ?? ""}
                poster={openPhoto.imageUrl ?? ""}
                label={photoLabel(openPhoto)}
                onComplete={() => openPhoto && notifyMediaPlaybackComplete(openPhoto)}
              />
            </div>
          {:else if isStillVideoContent(openPhoto)}
            <div class="still-video">
              <img src={resourceUrl(openPhoto.imageUrl || STILL_VIDEO_FALLBACK_IMAGE)} alt="" />
              <div class="still-video-control">
                <AudioPlaybackButton
                  playbackId={`album-video:${openPhoto.id}`}
                  src={openPhoto.audioUrl ?? ""}
                  label="再生"
                  onComplete={() => openPhoto && notifyMediaPlaybackComplete(openPhoto)}
                />
              </div>
            </div>
          {:else if canZoom(openPhoto)}
            <button class="zoom-trigger" type="button" aria-label={`${photoLabel(openPhoto)}を拡大表示`} title="拡大表示" on:click={openZoom}>
              <img src={resourceUrl(openPhoto.imageUrl)} alt="" />
            </button>
          {:else}
            <div class="photo-placeholder" aria-hidden="true">
              <Image size={38} strokeWidth={1.6} />
            </div>
          {/if}
        </div>
      </section>
    {:else}
      <section class="photo-library" aria-label="アルバム一覧">
        <AppListHeader title="アルバム" caption={`${photos.length}件`} />
        {#if photos.length}
          <ScrollHint enabled={photos.length > 12} step={180}>
            <div class="photo-grid" bind:this={gridElement} on:scroll={() => (gridScrollTop = gridElement?.scrollTop ?? 0)}>
              {#each photos as photo (photo.id)}
                <button
                  data-photo-id={photo.id}
                  class:recent={photo.id === lastOpenedPhotoId && !photo.corrupted}
                  class:corrupted={photo.corrupted}
                  style={photo.corrupted ? corruptionNoiseStyle(photoContentId(photo)) : ""}
                  type="button"
                  title={photo.corrupted ? undefined : photoLabel(photo)}
                  aria-label={photo.corrupted ? "破損した項目" : photoLabel(photo)}
                  on:click={() => selectPhoto(photo)}
                >
                  {#if photo.corrupted}
                    <span class="tile-noise" aria-hidden="true"></span>
                  {:else if isVideoContent(photo)}
                    <VideoStillFrame src={photo.imageUrl} square compact />
                    <span class="tile-badge" aria-hidden="true"><Play size={10} strokeWidth={2.6} fill="currentColor" /></span>
                  {:else if photo.imageUrl}
                    <img src={resourceUrl(photo.imageUrl)} alt="" loading="lazy" />
                  {:else}
                    <span class="tile-placeholder" aria-hidden="true"><Image size={20} strokeWidth={1.7} /></span>
                  {/if}
                </button>
              {/each}
            </div>
          </ScrollHint>
        {:else}
          <div class="photo-empty" role="status">
            <Image size={30} strokeWidth={1.7} />
            <span>写真や動画はありません</span>
          </div>
        {/if}
      </section>
    {/if}
  </div>

  <svelte:fragment slot="overlay">
    {#if zoomed && canZoom(openPhoto)}
      <div class="photo-zoom" role="dialog" aria-modal="true" aria-label={`${photoLabel(openPhoto)}の拡大表示`}>
        <button
          class="zoom-frame"
          class:pannable={zoomPannable}
          class:dragging={zoomPointerId !== null}
          type="button"
          aria-label="全体表示へ戻る。ドラッグや矢印キーで表示位置を動かせます"
          bind:this={zoomFrame}
          on:pointerdown={startZoomDrag}
          on:pointermove={dragZoom}
          on:pointerup={endZoomDrag}
          on:pointercancel={endZoomDrag}
          on:click={handleZoomClick}
          on:keydown={handleZoomKeydown}
        >
          <img
            bind:this={zoomImage}
            src={resourceUrl(openPhoto.imageUrl)}
            alt=""
            draggable="false"
            style={zoomScale
              ? `width: ${zoomImageWidth}px; height: ${zoomImageHeight}px; transform: translate(calc(-50% + ${zoomOffsetX}px), calc(-50% + ${zoomOffsetY}px));`
              : "visibility: hidden;"}
            on:load={handleZoomImageLoad}
          />
        </button>
        <button class="zoom-close" type="button" aria-label="閉じる" title="閉じる" on:click={closeZoom}>
          <X size={18} strokeWidth={2.3} />
        </button>
      </div>
    {/if}
  </svelte:fragment>
</AppShell>

<style>
  .album-app {
    position: relative;
    min-height: 0;
    height: 100%;
    padding: 8px 12px 42px;
  }

  .photo-library,
  .photo-detail {
    display: grid;
    min-height: 0;
    height: 100%;
    animation: view-in 140ms cubic-bezier(0.2, 0.8, 0.2, 1) both;
  }

  .photo-library {
    grid-template-rows: auto minmax(0, 1fr);
    gap: 8px;
  }

  .photo-library :global(.scroll-hint-shell) {
    min-height: 0;
    height: 100%;
  }

  /* overflow: hiddenのタイルは行の高さを決められないため、行をタイルの高さに固定してスクロールさせる。 */
  .photo-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    grid-auto-rows: max-content;
    align-content: start;
    gap: 4px;
    min-height: 0;
    height: 100%;
    overflow: auto;
    padding-bottom: 12px;
    overscroll-behavior: contain;
    scrollbar-width: none;
    scroll-padding: 8px 0;
  }

  .photo-grid::-webkit-scrollbar {
    display: none;
  }

  .photo-grid button {
    position: relative;
    display: block;
    min-width: 0;
    aspect-ratio: 1;
    overflow: hidden;
    padding: 0;
    border: 0;
    border-radius: 9px;
    background: rgba(255, 255, 255, 0.06);
    color: #fff;
    cursor: pointer;
    scroll-margin: 8px 0;
    transition: transform 120ms ease, filter 140ms ease;
  }

  .photo-grid button:active {
    transform: scale(0.97);
    filter: brightness(0.92);
  }

  .photo-grid button:focus-visible {
    outline: 2px solid rgba(240, 179, 93, 0.9);
    outline-offset: 2px;
  }

  .photo-grid button.recent::after {
    content: "";
    position: absolute;
    inset: 0;
    border: 2px solid #f0b35d;
    border-radius: inherit;
    box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.35);
    pointer-events: none;
  }

  .photo-grid img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .photo-grid :global(.video-still-frame) {
    width: 100%;
    height: 100%;
    border: 0;
    border-radius: 0;
  }

  .tile-badge {
    position: absolute;
    right: 5px;
    bottom: 5px;
    display: grid;
    place-items: center;
    width: 20px;
    height: 20px;
    border-radius: 999px;
    background: rgba(4, 8, 12, 0.62);
    color: rgba(255, 255, 255, 0.95);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.35);
    backdrop-filter: blur(8px);
  }

  .tile-placeholder {
    display: grid;
    place-items: center;
    width: 100%;
    height: 100%;
    background: linear-gradient(145deg, #2f4357, #6c7b8c);
    color: rgba(255, 255, 255, 0.7);
  }

  .photo-grid button.corrupted {
    background:
      linear-gradient(180deg, rgba(255, 255, 255, 0.04), rgba(0, 0, 0, 0.32)),
      var(--corruption-noise, url("/system/album-corruption-noise-01.webp")) center / cover no-repeat,
      #03080d;
    filter: saturate(0.86) contrast(1.1);
    cursor: default;
  }

  .tile-noise {
    position: absolute;
    inset: 0;
    background: repeating-linear-gradient(0deg, rgba(255, 255, 255, 0.12) 0 1px, transparent 1px 6px);
    mix-blend-mode: screen;
    opacity: 0.14;
  }

  .photo-empty {
    display: grid;
    place-content: center;
    justify-items: center;
    gap: 10px;
    border: 1px solid var(--ap-border);
    border-radius: var(--ap-radius-panel);
    background:
      radial-gradient(circle at 50% 32%, rgba(240, 179, 93, 0.14), transparent 40%),
      rgba(255, 255, 255, 0.035);
    color: var(--ap-text-soft);
    font-size: 0.78rem;
    font-weight: 700;
  }

  .photo-empty :global(svg) {
    color: #f6c98a;
  }

  .photo-detail {
    grid-template-rows: auto minmax(0, 1fr);
    gap: 8px;
  }

  .photo-detail.with-tag-row {
    grid-template-rows: auto auto minmax(0, 1fr);
  }

  .detail-tags,
  .bar-tags {
    min-width: 0;
    --content-tag-accent: #f0b35d;
  }

  .detail-tags {
    padding: 0 2px;
  }

  .bar-tags {
    flex: 1 1 auto;
  }

  /* 表示枠の大きさを子の上限(max-height: 100%)の基準にし、縦長の画像も全体を収める。 */
  .media-stage {
    position: relative;
    display: grid;
    grid-template: minmax(0, 1fr) / minmax(0, 1fr);
    place-items: center;
    min-height: 0;
    overflow: hidden;
    border-radius: 18px;
    background:
      radial-gradient(circle at 50% 42%, rgba(240, 179, 93, 0.08), transparent 58%),
      rgba(3, 6, 10, 0.55);
    box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.06);
  }

  .zoom-trigger {
    display: grid;
    grid-template: minmax(0, 1fr) / minmax(0, 1fr);
    place-items: center;
    width: 100%;
    height: 100%;
    min-height: 0;
    padding: 10px;
    border: 0;
    background: transparent;
    cursor: zoom-in;
  }

  .zoom-trigger:focus-visible {
    outline: 2px solid rgba(240, 179, 93, 0.88);
    outline-offset: -4px;
    border-radius: 18px;
  }

  .zoom-trigger img,
  .still-video img {
    display: block;
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
    border-radius: 12px;
    box-shadow: 0 18px 36px rgba(0, 0, 0, 0.42);
  }

  .still-video {
    position: relative;
    display: grid;
    grid-template: minmax(0, 1fr) / minmax(0, 1fr);
    place-items: center;
    width: 100%;
    height: 100%;
    min-height: 0;
    padding: 10px 10px 64px;
  }

  .still-video-control {
    position: absolute;
    right: 12px;
    bottom: 12px;
    left: 12px;
    color: rgba(255, 255, 255, 0.92);
  }

  .still-video-control :global(.audio-playback-button) {
    border-color: rgba(255, 255, 255, 0.18);
    background: rgba(4, 8, 12, 0.64);
    box-shadow: 0 12px 28px rgba(0, 0, 0, 0.34);
    backdrop-filter: blur(10px);
  }

  .native-video-frame {
    display: grid;
    place-items: center;
    width: 100%;
    height: 100%;
    min-height: 0;
    background: #03070b;
  }

  .native-video-frame :global(.video-playback) {
    width: 100%;
    height: 100%;
    aspect-ratio: auto;
    border-radius: 0;
  }

  .photo-placeholder {
    display: grid;
    place-items: center;
    width: min(70%, 240px);
    aspect-ratio: 1;
    border-radius: 16px;
    background: linear-gradient(145deg, #2f4357, #6c7b8c);
    color: rgba(255, 255, 255, 0.72);
  }

  .photo-zoom {
    position: absolute;
    inset: 0;
    z-index: 42;
    background: #000;
    animation: zoom-in 160ms cubic-bezier(0.2, 0.8, 0.2, 1) both;
  }

  /* 拡大はホームボタンとナビの上で止め、画像の下端を隠さない。 */
  .zoom-frame {
    position: absolute;
    top: 0;
    left: 0;
    display: block;
    width: 100%;
    height: calc(100% - 78px);
    overflow: hidden;
    padding: 0;
    border: 0;
    background: transparent;
    cursor: zoom-out;
    touch-action: none;
    user-select: none;
    outline: none;
  }

  .zoom-frame.pannable {
    cursor: grab;
  }

  .zoom-frame.dragging {
    cursor: grabbing;
  }

  .zoom-frame img {
    position: absolute;
    top: 50%;
    left: 50%;
    display: block;
    max-width: none;
    max-height: none;
    will-change: transform;
    pointer-events: none;
  }

  .zoom-close {
    position: absolute;
    top: max(12px, env(safe-area-inset-top));
    right: 12px;
    z-index: 1;
    display: grid;
    place-items: center;
    width: 36px;
    height: 36px;
    padding: 0;
    border: 1px solid rgba(255, 255, 255, 0.16);
    border-radius: 999px;
    background: rgba(12, 16, 22, 0.56);
    color: rgba(255, 255, 255, 0.92);
    cursor: pointer;
    box-shadow: 0 8px 22px rgba(0, 0, 0, 0.4);
    backdrop-filter: blur(14px);
  }

  .zoom-close:focus-visible {
    outline: 2px solid rgba(240, 179, 93, 0.88);
    outline-offset: 2px;
  }

  @keyframes view-in {
    from {
      opacity: 0;
      transform: translateY(5px);
    }

    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  @keyframes zoom-in {
    from {
      opacity: 0;
    }

    to {
      opacity: 1;
    }
  }
</style>
