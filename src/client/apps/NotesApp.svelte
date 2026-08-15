<script lang="ts">
  import { Folder } from "@lucide/svelte";
  import type { NoteItem } from "../scenario-runtime/types";
  import { corruptionNoiseStyle } from "../system/corruptionNoise";
  import ScrollHint from "../system/ScrollHint.svelte";
  import AppShell from "./AppShell.svelte";

  export let notes: NoteItem[] = [];
  export let focusContentId = "";
  export let focusContentRequestId = 0;
  export let onContentOpen: (contentId: string) => void = () => {};
  export let onBlockedContentOpen: (contentId: string) => void = () => {};

  let selectedNoteId = notes[0]?.id ?? "";
  let lastReportedContentId = "";
  let lastAppliedFocusContentId = "";
  let lastAppliedFocusContentRequestId = focusContentRequestId;

  function noteCorruptionNoiseStyle(note: NoteItem) {
    return corruptionNoiseStyle(note.contentId ?? note.id);
  }

  $: if (!focusContentId) {
    lastAppliedFocusContentId = "";
    lastAppliedFocusContentRequestId = focusContentRequestId;
  } else if (focusContentId !== lastAppliedFocusContentId || focusContentRequestId !== lastAppliedFocusContentRequestId) {
    const focused = notes.find((note) => note.contentId === focusContentId || note.id === focusContentId);
    if (focused) {
      lastAppliedFocusContentId = focusContentId;
      lastAppliedFocusContentRequestId = focusContentRequestId;
      selectedNoteId = focused.id;
      if (focused.corrupted) {
        onBlockedContentOpen(focused.contentId ?? focused.id);
      }
    }
  }
  $: selectedNote = notes.find((note) => note.id === selectedNoteId) ?? notes[0];
  $: selectedNoteContentId = selectedNote && !selectedNote.corrupted ? selectedNote.contentId ?? selectedNote.id : "";
  $: if (selectedNoteContentId && selectedNoteContentId !== lastReportedContentId) {
    lastReportedContentId = selectedNoteContentId;
    onContentOpen(selectedNoteContentId);
  }

  function selectNote(note: NoteItem) {
    selectedNoteId = note.id;
    if (note.corrupted) {
      onBlockedContentOpen(note.contentId ?? note.id);
    }
  }
</script>

<AppShell title="メモ" subtitle={`${notes.length}件・端末内`} accent="#8fd2ff" immersive>
  <div class="notes-layout">
    {#if selectedNote}
      <article
        class="note-paper"
        class:corrupted={selectedNote.corrupted}
        style={selectedNote.corrupted ? noteCorruptionNoiseStyle(selectedNote) : ""}
      >
        {#if selectedNote.corrupted}
          <p class="content-error">{selectedNote.body}</p>
        {:else}
          <h3>{selectedNote.title}</h3>
          <p>{selectedNote.body}</p>
        {/if}
      </article>
    {/if}

    <div class="notes-index-head" aria-label="メモ一覧">
      <span><Folder size={15} strokeWidth={2.1} /> メモ</span>
      <strong>{notes.length}件</strong>
    </div>

    <ScrollHint enabled={notes.length > 2} step={70}>
      <div class="note-list" class:scrolling={notes.length > 2}>
        {#each notes as note}
          <button
            class:active={note.id === selectedNote?.id}
            type="button"
            on:click={() => selectNote(note)}
          >
            <strong>{note.title}</strong>
          </button>
        {/each}
      </div>
    </ScrollHint>
  </div>
</AppShell>

<style>
  .notes-layout {
    display: grid;
    grid-template-rows: clamp(380px, 66%, 430px) auto minmax(0, 1fr);
    gap: 10px;
    min-height: 0;
    height: 100%;
    padding: 14px 14px 88px;
    overflow: hidden;
  }

  .notes-layout :global(.scroll-hint-shell) {
    min-height: 0;
    height: 100%;
  }

  .notes-index-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 0 2px;
    color: var(--ap-text-soft);
    font-size: 0.72rem;
    font-weight: 760;
  }

  .notes-index-head span {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }

  .notes-index-head strong {
    color: #d7f0ff;
  }

  .note-list {
    display: grid;
    gap: 2px;
    min-height: 0;
    height: 100%;
    overflow: auto;
    padding: 4px;
    border: 1px solid var(--ap-border);
    border-radius: var(--ap-radius-panel);
    background: rgba(255, 255, 255, 0.045);
  }

  .note-list.scrolling {
    overscroll-behavior: contain;
    padding-bottom: 12px;
    scrollbar-width: none;
    mask-image: linear-gradient(180deg, #000 0, #000 calc(100% - 20px), rgba(0, 0, 0, 0.18));
  }

  .note-list.scrolling::-webkit-scrollbar {
    display: none;
  }

  .note-list button {
    position: relative;
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    align-items: center;
    min-height: 46px;
    min-width: 0;
    padding: 0 11px;
    border: 1px solid transparent;
    border-radius: 10px;
    background: transparent;
    color: #fff;
    text-align: left;
    cursor: pointer;
  }

  .note-list button.active {
    border-color: rgba(143, 210, 255, 0.34);
    background:
      linear-gradient(180deg, rgba(143, 210, 255, 0.18), rgba(255, 255, 255, 0.055));
  }

  .note-list strong {
    overflow: hidden;
    font-size: 0.82rem;
    line-height: 1.25;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .note-paper {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    gap: 12px;
    min-height: 0;
    height: 100%;
    overflow: hidden;
    padding: 18px;
    border: 1px solid rgba(143, 210, 255, 0.14);
    border-radius: var(--ap-radius-panel);
    background:
      linear-gradient(rgba(17, 23, 32, 0) 31px, rgba(143, 210, 255, 0.16) 32px),
      linear-gradient(90deg, rgba(143, 210, 255, 0.14) 0 1px, transparent 1px 100%),
      rgba(246, 242, 232, 0.08);
    background-size: 100% 32px, 26px 100%, auto;
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.08);
  }

  h3 {
    margin: 0;
    font-size: 1.28rem;
  }

  .note-paper > p {
    min-height: 0;
    overflow: auto;
    padding-right: 2px;
    margin: 0;
    color: rgba(255, 255, 255, 0.82);
    font-size: 0.92rem;
    line-height: 1.9;
    white-space: pre-wrap;
    scrollbar-width: thin;
    scrollbar-color: rgba(255, 255, 255, 0.18) transparent;
  }

  .note-paper.corrupted {
    position: relative;
    grid-template-rows: minmax(0, 1fr);
    place-items: center;
    align-content: center;
    border: 1px solid rgba(255, 214, 104, 0.34);
    overflow: hidden;
    background:
      linear-gradient(180deg, rgba(0, 0, 0, 0.1), rgba(0, 0, 0, 0.6)),
      var(--corruption-noise, url("/system/album-corruption-noise-01.webp")) center / cover no-repeat,
      #03080d;
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.1),
      inset 0 -20px 38px rgba(0, 0, 0, 0.42);
  }

  .note-paper.corrupted::before,
  .note-paper.corrupted::after {
    content: "";
    position: absolute;
    inset: 0;
    pointer-events: none;
  }

  .note-paper.corrupted::before {
    background:
      linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.14), transparent),
      repeating-linear-gradient(
        0deg,
        rgba(255, 255, 255, 0.1) 0 1px,
        transparent 1px 6px
      );
    mix-blend-mode: screen;
    opacity: 0.18;
  }

  .note-paper.corrupted::after {
    inset: auto 0 0;
    height: 40%;
    background: linear-gradient(180deg, transparent, rgba(0, 0, 0, 0.5));
  }

  .note-paper > p.content-error {
    position: relative;
    z-index: 1;
    max-width: min(86%, 280px);
    min-height: auto;
    padding: 10px 11px;
    border: 1px solid rgba(255, 214, 104, 0.36);
    border-radius: 8px;
    background: rgba(4, 4, 2, 0.86);
    margin: 0;
    color: rgba(255, 226, 122, 0.96);
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
    font-size: 0.74rem;
    line-height: 1.5;
    text-align: center;
  }
</style>
