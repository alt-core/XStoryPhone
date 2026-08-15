<script lang="ts">
  export let name = "";
  export let src = "";
  export let size = 32;
  export let tone: "messages" | "chat" | "neutral" = "neutral";

  let failedSrc = "";

  $: usableSrc = src && src !== failedSrc ? src : "";
  $: initial = name.trim().slice(0, 1) || "・";
</script>

<span class={`user-avatar ${tone}`} style={`--avatar-size:${size}px`} aria-label={name ? `${name}のアイコン` : "ユーザーアイコン"}>
  {#if usableSrc}
    <img src={usableSrc} alt="" on:error={() => (failedSrc = usableSrc)} />
  {:else}
    <span>{initial}</span>
  {/if}
</span>

<style>
  .user-avatar {
    display: grid;
    flex: 0 0 auto;
    place-items: center;
    width: var(--avatar-size);
    height: var(--avatar-size);
    border: 1px solid rgba(0, 0, 0, 0.7);
    border-radius: 999px;
    background:
      linear-gradient(145deg, rgba(255, 255, 255, 0.08), rgba(255, 255, 255, 0.02)),
      rgba(18, 26, 31, 0.92);
    box-shadow:
      0 0 0 1px rgba(255, 255, 255, 0.035),
      0 5px 10px rgba(0, 0, 0, 0.26);
    color: rgba(255, 255, 255, 0.86);
    font-size: calc(var(--avatar-size) * 0.4);
    font-weight: 820;
    line-height: 1;
    overflow: hidden;
  }

  .user-avatar.messages {
    background: linear-gradient(145deg, #67c9b5, #3b8f7b);
    color: #092019;
  }

  .user-avatar.chat {
    background: linear-gradient(145deg, #78cb8a, #378b4c);
    color: #06200d;
  }

  .user-avatar img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .user-avatar span {
    transform: translateY(-1px);
  }
</style>
