<script lang="ts">
  import { onMount, tick } from "svelte";
  import type { PhonePresentationMode } from "../../project/projectStage";
  import {
    PHONE_STAGE_SHELL_HEIGHT,
    PHONE_STAGE_SHELL_WIDTH,
    resolvePhoneStageLayout
  } from "./phoneStageLayout";

  export let mode: PhonePresentationMode = "focused";

  const zoomShortcutKeys = new Set(["+", "-", "=", "0"]);
  const touchEndGuardMs = 200;

  let hostElement: HTMLElement;
  let availableWidth = PHONE_STAGE_SHELL_WIDTH;
  let availableHeight = PHONE_STAGE_SHELL_HEIGHT;
  let viewportWidth = PHONE_STAGE_SHELL_WIDTH;
  let lastTouchEndAt = Number.NEGATIVE_INFINITY;
  let previousMode: PhonePresentationMode = mode;
  let suspendedFocus: HTMLElement | null = null;

  $: layout = resolvePhoneStageLayout(mode, viewportWidth, availableWidth, availableHeight);
  $: frameOnly = layout.frameOnly;
  $: viewportStyle = `width: ${layout.designWidth * layout.scale}px; height: ${layout.designHeight * layout.scale}px;`;
  $: contentStyle = `width: ${layout.designWidth}px; height: ${layout.designHeight}px; --phone-scale: ${layout.scale};`;
  $: if (hostElement && mode !== previousMode) {
    updateFocusOwnership(mode, previousMode);
    previousMode = mode;
  }

  function isTextEditingTarget(eventTarget: EventTarget | null) {
    return eventTarget instanceof Element && Boolean(eventTarget.closest("input, textarea, [contenteditable='true']"));
  }

  function updateFocusOwnership(nextMode: PhonePresentationMode, lastMode: PhonePresentationMode) {
    if (lastMode === "focused" && nextMode !== "focused" && document.activeElement instanceof HTMLElement && hostElement.contains(document.activeElement)) {
      suspendedFocus = document.activeElement;
      suspendedFocus.blur();
      return;
    }
    if (nextMode === "focused" && lastMode !== "focused" && suspendedFocus?.isConnected) {
      const target = suspendedFocus;
      suspendedFocus = null;
      void tick().then(() => target.focus({ preventScroll: true }));
    }
  }

  onMount(() => {
    const abortController = new AbortController();
    const listenerOptions = { passive: false, signal: abortController.signal };
    const preventBrowserDefault = (event: Event) => {
      if (layout.interactive) event.preventDefault();
    };
    const resizeObserver = new ResizeObserver(([entry]) => {
      if (!entry) return;
      availableWidth = entry.contentRect.width;
      availableHeight = entry.contentRect.height;
    });

    resizeObserver.observe(hostElement);
    for (const eventName of ["gesturestart", "gesturechange", "gestureend", "dragstart"]) {
      hostElement.addEventListener(eventName, preventBrowserDefault, listenerOptions);
    }
    hostElement.addEventListener("dblclick", preventBrowserDefault, { ...listenerOptions, capture: true });
    hostElement.addEventListener("touchstart", (event) => {
      if (layout.interactive && event.touches.length > 1) event.preventDefault();
    }, listenerOptions);
    hostElement.addEventListener("touchmove", (event) => {
      if (layout.interactive && event.touches.length > 1) event.preventDefault();
    }, listenerOptions);
    hostElement.addEventListener("touchend", (event) => {
      if (!layout.interactive) return;
      const now = window.performance.now();
      if (now - lastTouchEndAt < touchEndGuardMs) event.preventDefault();
      lastTouchEndAt = now;
    }, { ...listenerOptions, capture: true });
    hostElement.addEventListener("wheel", (event) => {
      if (layout.interactive && (event.ctrlKey || event.metaKey)) event.preventDefault();
    }, listenerOptions);
    hostElement.addEventListener("keydown", (event) => {
      if (layout.interactive && (event.ctrlKey || event.metaKey) && zoomShortcutKeys.has(event.key)) event.preventDefault();
    }, listenerOptions);
    hostElement.addEventListener("contextmenu", (event) => {
      if (layout.interactive && !isTextEditingTarget(event.target)) event.preventDefault();
    }, listenerOptions);
    hostElement.addEventListener("selectstart", (event) => {
      if (layout.interactive && !isTextEditingTarget(event.target)) event.preventDefault();
    }, listenerOptions);

    return () => {
      resizeObserver.disconnect();
      abortController.abort();
    };
  });
</script>

<svelte:window bind:innerWidth={viewportWidth} />

<div
  bind:this={hostElement}
  class="phone-stage"
  class:phone-stage-inactive={!layout.interactive}
  data-phone-stage
  data-phone-presentation={mode}
  hidden={layout.hidden}
  inert={!layout.interactive}
  aria-hidden={!layout.interactive ? "true" : undefined}
>
  <div class="phone-stage-viewport" style={viewportStyle}>
    <div class="phone-stage-content" style={contentStyle}>
      <slot {frameOnly} />
    </div>
  </div>
</div>

<style>
  .phone-stage {
    display: grid;
    width: 100%;
    height: 100%;
    min-height: 0;
    place-items: center;
    touch-action: pan-x pan-y;
    -webkit-user-select: none;
    user-select: none;
    -webkit-touch-callout: none;
  }

  .phone-stage[hidden] {
    display: none;
  }

  .phone-stage-inactive {
    pointer-events: none;
  }

  .phone-stage-viewport {
    position: relative;
    overflow: visible;
  }

  .phone-stage-content {
    transform: scale(var(--phone-scale));
    transform-origin: top left;
  }

  .phone-stage :global(img),
  .phone-stage :global(svg) {
    -webkit-user-drag: none;
    user-select: none;
  }

  .phone-stage :global(button),
  .phone-stage :global(a),
  .phone-stage :global([role="button"]),
  .phone-stage :global(input),
  .phone-stage :global(textarea) {
    touch-action: manipulation;
  }
</style>
