<script lang="ts">
  const defaultVideoStillUrl = "/system/audio-only-video-thumbnail.png";

  export let src = "/system/audio-only-video-thumbnail.png";
  export let square = false;
  export let compact = false;

  $: resolvedSrc = src || defaultVideoStillUrl;
</script>

<span class="video-still-frame" class:square class:compact role="img" aria-label="動画">
  <img src={resolvedSrc} alt="" loading="lazy" />
</span>

<style>
  .video-still-frame {
    position: relative;
    display: block;
    width: 100%;
    aspect-ratio: 1 / 1;
    overflow: hidden;
    border-radius: 10px;
    border: 1px solid rgba(255, 255, 255, 0.14);
    background: #071014;
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.12),
      inset 0 -24px 44px rgba(0, 0, 0, 0.34);
  }

  img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .video-still-frame.compact {
    border-radius: 8px;
  }
</style>
