<script lang="ts">
  export let src = "";
  export let alt = "";

  let currentSrc = "";
  let imageRatio = "1 / 1";

  $: if (src !== currentSrc) {
    currentSrc = src;
    imageRatio = "1 / 1";
  }

  $: frameStyle = `--attachment-image-ratio: ${imageRatio};`;

  function updateFrameRatio(event: Event) {
    const image = event.currentTarget as HTMLImageElement;
    if (image.naturalWidth > image.naturalHeight) {
      imageRatio = `${image.naturalWidth} / ${image.naturalHeight}`;
      return;
    }
    imageRatio = "1 / 1";
  }
</script>

<span class="attachment-image-frame" style={frameStyle}>
  <img {src} {alt} on:load={updateFrameRatio} />
</span>

<style>
  .attachment-image-frame {
    width: 100%;
    aspect-ratio: var(--attachment-image-ratio, 1 / 1);
    overflow: hidden;
    border-radius: 10px;
    background: rgba(255, 255, 255, 0.08);
  }

  .attachment-image-frame img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: contain;
  }
</style>
