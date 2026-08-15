<script lang="ts">
  import { afterUpdate, onMount, tick } from "svelte";
  import { ChevronDown, ChevronUp } from "@lucide/svelte";

  export let enabled = false;
  export let step = 120;

  let root: HTMLDivElement;
  let scrollElement: HTMLElement | null = null;
  let canScrollUp = false;
  let canScrollDown = false;
  let resizeObserver: ResizeObserver | undefined;
  let updateQueued = false;

  $: if (!enabled) {
    canScrollUp = false;
    canScrollDown = false;
  } else {
    queueUpdate();
  }

  function getSlottedElement() {
    if (!root) {
      return null;
    }

    return Array.from(root.children).find((element) => !element.classList.contains("scroll-hint-button")) as HTMLElement | undefined ?? null;
  }

  function bindScrollElement() {
    const nextElement = getSlottedElement();
    if (nextElement === scrollElement) {
      return;
    }

    if (scrollElement) {
      scrollElement.removeEventListener("scroll", updateScrollState);
      resizeObserver?.unobserve(scrollElement);
    }

    scrollElement = nextElement;

    if (scrollElement) {
      scrollElement.addEventListener("scroll", updateScrollState, { passive: true });
      resizeObserver?.observe(scrollElement);
    }
  }

  function updateScrollState() {
    if (!enabled || !scrollElement) {
      canScrollUp = false;
      canScrollDown = false;
      return;
    }

    const scrollTop = scrollElement.scrollTop;
    const maxScrollTop = scrollElement.scrollHeight - scrollElement.clientHeight;
    canScrollUp = scrollTop > 2;
    canScrollDown = maxScrollTop - scrollTop > 2;
  }

  function queueUpdate() {
    if (updateQueued) {
      return;
    }

    updateQueued = true;
    void tick().then(() => {
      updateQueued = false;
      bindScrollElement();
      updateScrollState();
    });
  }

  function scrollByPage(direction: 1 | -1) {
    if (!scrollElement) {
      return;
    }

    scrollElement.scrollBy({ top: step * direction, behavior: "smooth" });
    window.setTimeout(updateScrollState, 180);
  }

  afterUpdate(queueUpdate);

  onMount(() => {
    resizeObserver = new ResizeObserver(queueUpdate);
    resizeObserver.observe(root);
    queueUpdate();
    window.addEventListener("resize", queueUpdate);

    return () => {
      window.removeEventListener("resize", queueUpdate);
      scrollElement?.removeEventListener("scroll", updateScrollState);
      resizeObserver?.disconnect();
    };
  });
</script>

<div class="scroll-hint-shell" bind:this={root}>
  <slot />
  {#if enabled && canScrollUp}
    <button class="scroll-hint-button up" type="button" aria-label="上の項目へスクロール" title="上へ" on:click={() => scrollByPage(-1)}>
      <ChevronUp size={15} strokeWidth={2.35} />
    </button>
  {/if}
  {#if enabled && canScrollDown}
    <button class="scroll-hint-button down" type="button" aria-label="下の項目へスクロール" title="下へ" on:click={() => scrollByPage(1)}>
      <ChevronDown size={15} strokeWidth={2.35} />
    </button>
  {/if}
</div>

<style>
  .scroll-hint-shell {
    position: relative;
    min-width: 0;
  }

  .scroll-hint-button {
    position: absolute;
    right: 8px;
    z-index: 3;
    display: grid;
    place-items: center;
    width: 25px;
    height: 25px;
    padding: 0;
    border: 1px solid rgba(255, 255, 255, 0.16);
    border-radius: 50%;
    background:
      linear-gradient(180deg, rgba(255, 255, 255, 0.13), rgba(255, 255, 255, 0.055)),
      rgba(8, 12, 18, 0.78);
    color: rgba(255, 255, 255, 0.86);
    cursor: pointer;
    line-height: 0;
    box-shadow:
      0 8px 18px rgba(0, 0, 0, 0.28),
      var(--ap-shadow-inset);
    backdrop-filter: blur(14px);
  }

  .scroll-hint-button.up {
    top: 8px;
  }

  .scroll-hint-button.down {
    bottom: 8px;
  }

  .scroll-hint-button:active {
    transform: translateY(1px);
  }

  .scroll-hint-button :global(svg) {
    display: block;
  }
</style>
