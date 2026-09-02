<script lang="ts">
  export let replies: string[] = [];
  export let accent = "#8fd2ff";
  export let onSelect: (reply: string) => void | Promise<void> = () => {};

  const DRAG_START_PX = 6;

  let pointerId: number | undefined;
  let pointerStartX = 0;
  let scrollStartX = 0;
  let dragScaleX = 1;
  let dragging = false;
  let suppressClick = false;

  function startDrag(event: PointerEvent) {
    const scroller = event.currentTarget as HTMLDivElement;
    if (event.pointerType !== "mouse"
      || event.button !== 0
      || scroller.scrollWidth <= scroller.clientWidth) {
      return;
    }

    pointerId = event.pointerId;
    pointerStartX = event.clientX;
    scrollStartX = scroller.scrollLeft;
    dragScaleX = scroller.clientWidth > 0
      ? scroller.getBoundingClientRect().width / scroller.clientWidth
      : 1;
    if (!Number.isFinite(dragScaleX) || dragScaleX <= 0) dragScaleX = 1;
    dragging = false;
  }

  function moveDrag(event: PointerEvent) {
    if (pointerId !== event.pointerId) return;
    const scroller = event.currentTarget as HTMLDivElement;

    const distance = event.clientX - pointerStartX;
    if (!dragging && Math.abs(distance) < DRAG_START_PX) return;
    if (!dragging) {
      dragging = true;
      scroller.setPointerCapture(event.pointerId);
    }

    event.preventDefault();
    scroller.scrollLeft = scrollStartX - distance / dragScaleX;
  }

  function finishDrag(event: PointerEvent) {
    if (pointerId !== event.pointerId) return;
    const dragged = dragging;
    pointerId = undefined;
    dragging = false;

    if (dragged) {
      suppressClick = true;
      window.setTimeout(() => (suppressClick = false), 0);
    }
  }

  function cancelPendingDrag(event: PointerEvent) {
    if (!dragging && pointerId === event.pointerId) pointerId = undefined;
  }

  function selectReply(event: MouseEvent, reply: string) {
    if (suppressClick) {
      event.preventDefault();
      return;
    }
    void onSelect(reply);
  }
</script>

{#if replies.length}
  <div
    class="quick-replies"
    class:dragging
    role="group"
    aria-label="返信候補"
    style={`--quick-reply-accent: ${accent}`}
    on:pointerdown={startDrag}
    on:pointermove={moveDrag}
    on:pointerup={finishDrag}
    on:pointercancel={finishDrag}
    on:pointerleave={cancelPendingDrag}
  >
    {#each replies as reply, index (`${index}:${reply}`)}
      <button type="button" on:click={(event) => selectReply(event, reply)}>{reply}</button>
    {/each}
  </div>
{/if}

<style>
  .quick-replies {
    display: flex;
    gap: 7px;
    min-width: 0;
    overflow-x: auto;
    padding: 2px 1px 4px;
    scrollbar-width: thin;
    scrollbar-color: color-mix(in srgb, var(--quick-reply-accent) 42%, transparent) transparent;
    overscroll-behavior-inline: contain;
  }

  .quick-replies.dragging,
  .quick-replies.dragging button {
    cursor: grabbing;
  }

  button {
    flex: 0 0 auto;
    min-height: 32px;
    padding: 6px 12px;
    border: 1px solid color-mix(in srgb, var(--quick-reply-accent) 42%, transparent);
    border-radius: 999px;
    background: color-mix(in srgb, var(--quick-reply-accent) 13%, rgba(10, 15, 21, 0.92));
    color: color-mix(in srgb, var(--quick-reply-accent) 72%, white);
    font: inherit;
    font-size: 0.72rem;
    font-weight: 760;
    line-height: 1.25;
    white-space: nowrap;
    cursor: pointer;
  }

  button:active {
    transform: translateY(1px);
  }

</style>
