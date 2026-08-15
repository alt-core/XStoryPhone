<script lang="ts">
  export let title: string;
  export let subtitle = "";
  export let accent = "#5cc8a7";
  export let immersive = false;
</script>

<section class="app-shell" class:immersive style={`--accent: ${accent}`} aria-label={subtitle ? `${title} ${subtitle}` : title}>
  <div class="app-body">
    <slot />
  </div>
  <slot name="overlay" />
</section>

<style>
  .app-shell {
    position: relative;
    display: grid;
    grid-template-rows: minmax(0, 1fr);
    height: 100%;
    overflow: hidden;
    background:
      radial-gradient(circle at 78% -4%, color-mix(in srgb, var(--accent) 18%, transparent), transparent 34%),
      linear-gradient(180deg, color-mix(in srgb, var(--accent) 12%, transparent), transparent 38%),
      #101720;
  }

  .app-body {
    min-height: 0;
    overflow: auto;
    padding: 14px 14px 118px;
    scrollbar-width: thin;
    scrollbar-color: rgba(255, 255, 255, 0.18) transparent;
  }

  .app-shell.immersive .app-body {
    height: 100%;
    overflow: hidden;
    padding: 0;
  }
</style>
