<script lang="ts">
  import { stopAudioPlayback } from "./audioEngine";

  export let src: string;
  export let poster = "";
  export let label = "動画";
  export let onComplete: () => void = () => {};

  function handlePlay(event: Event) {
    stopAudioPlayback("native_video_started");
    const current = event.currentTarget as HTMLVideoElement;
    for (const video of document.querySelectorAll("video")) {
      if (video !== current) video.pause();
    }
  }
</script>

<!-- svelte-ignore a11y_media_has_caption 動画の字幕データは作品設定上任意として扱う。 -->
<video
  class="video-playback"
  controls
  playsinline
  preload="metadata"
  {src}
  {poster}
  aria-label={label}
  on:play={handlePlay}
  on:ended={onComplete}
></video>

<style>
  .video-playback {
    display: block;
    width: 100%;
    height: auto;
    aspect-ratio: 16 / 9;
    border: 0;
    border-radius: inherit;
    background: #03070b;
    object-fit: contain;
  }
</style>
