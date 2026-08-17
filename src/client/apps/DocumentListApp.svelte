<script lang="ts">
  import type { Component } from "svelte";
  import ContentTags from "../system/ContentTags.svelte";
  import { corruptionNoiseStyle } from "../system/corruptionNoise";
  import ScrollHint from "../system/ScrollHint.svelte";
  import AppShell from "./AppShell.svelte";

  type DocumentMetadata = {
    label: string;
    value: string;
  };

  type DocumentItem = {
    id: string;
    contentId?: string;
    title: string;
    body: string;
    tags?: string[];
    listDate?: string;
    metadata?: DocumentMetadata[];
    corrupted?: boolean;
  };

  export let appTitle: string;
  export let subtitle: string;
  export let indexLabel: string;
  export let accent: string;
  export let countColor = accent;
  export let indexIcon: Component;
  export let documents: DocumentItem[] = [];
  export let focusContentId = "";
  export let focusContentRequestId = 0;
  export let onContentOpen: (contentId: string) => void = () => {};
  export let onBlockedContentOpen: (contentId: string) => void = () => {};

  let selectedDocumentId = documents[0]?.id ?? "";
  let lastReportedContentId = "";
  let lastAppliedFocusContentId = "";
  let lastAppliedFocusContentRequestId = focusContentRequestId;

  function documentCorruptionNoiseStyle(document: DocumentItem) {
    return corruptionNoiseStyle(document.contentId ?? document.id);
  }

  $: if (!focusContentId) {
    lastAppliedFocusContentId = "";
    lastAppliedFocusContentRequestId = focusContentRequestId;
  } else if (focusContentId !== lastAppliedFocusContentId || focusContentRequestId !== lastAppliedFocusContentRequestId) {
    const focused = documents.find((document) => document.contentId === focusContentId || document.id === focusContentId);
    if (focused) {
      lastAppliedFocusContentId = focusContentId;
      lastAppliedFocusContentRequestId = focusContentRequestId;
      selectedDocumentId = focused.id;
      if (focused.corrupted) {
        onBlockedContentOpen(focused.contentId ?? focused.id);
      }
    }
  }
  $: selectedDocument = documents.find((document) => document.id === selectedDocumentId) ?? documents[0];
  $: selectedDocumentContentId = selectedDocument && !selectedDocument.corrupted
    ? selectedDocument.contentId ?? selectedDocument.id
    : "";
  $: if (selectedDocumentContentId && selectedDocumentContentId !== lastReportedContentId) {
    lastReportedContentId = selectedDocumentContentId;
    onContentOpen(selectedDocumentContentId);
  }

  function selectDocument(document: DocumentItem) {
    selectedDocumentId = document.id;
    if (document.corrupted) {
      onBlockedContentOpen(document.contentId ?? document.id);
    }
  }
</script>

<AppShell title={appTitle} {subtitle} {accent}>
  <div class="documents-layout" style={`--document-accent: ${accent}; --document-count-color: ${countColor}`}>
    {#if selectedDocument}
      <article
        class="document-paper"
        class:corrupted={selectedDocument.corrupted}
        style={selectedDocument.corrupted ? documentCorruptionNoiseStyle(selectedDocument) : ""}
      >
        {#if selectedDocument.corrupted}
          <p class="content-error">{selectedDocument.body}</p>
        {:else}
          <div class="document-heading">
            <h3>{selectedDocument.title}</h3>
            {#if selectedDocument.metadata?.length}
              <dl class="document-metadata">
                {#each selectedDocument.metadata as field}
                  <dt>{field.label}</dt>
                  <dd>{field.value}</dd>
                {/each}
              </dl>
            {/if}
            <ContentTags tags={selectedDocument.tags ?? []} />
          </div>
          <p>{selectedDocument.body}</p>
        {/if}
      </article>
    {/if}

    <div class="documents-index-head" aria-label={`${indexLabel}一覧`}>
      <span><svelte:component this={indexIcon} size={15} strokeWidth={2.1} /> {indexLabel}</span>
      <strong>{documents.length}件</strong>
    </div>

    <ScrollHint enabled={documents.length > 2} step={70}>
      <div class="document-list" class:scrolling={documents.length > 2}>
        {#each documents as document}
          <button
            class:active={document.id === selectedDocument?.id}
            type="button"
            on:click={() => selectDocument(document)}
          >
            <strong>{document.title}</strong>
            {#if document.listDate}
              <time>{document.listDate}</time>
            {/if}
          </button>
        {/each}
      </div>
    </ScrollHint>
  </div>
</AppShell>

<style>
  .documents-layout {
    display: grid;
    grid-template-rows: 300px auto minmax(0, 1fr);
    gap: 10px;
    min-height: 0;
    height: 100%;
    padding: 14px 14px 88px;
    overflow: hidden;
  }

  .documents-layout :global(.scroll-hint-shell) {
    min-height: 0;
    height: 100%;
  }

  .documents-index-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 0 2px;
    color: var(--ap-text-soft);
    font-size: 0.72rem;
    font-weight: 760;
  }

  .documents-index-head span {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }

  .documents-index-head strong {
    color: var(--document-count-color);
  }

  .document-list {
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

  .document-list.scrolling {
    overscroll-behavior: contain;
    padding-bottom: 12px;
    scrollbar-width: none;
    mask-image: linear-gradient(180deg, #000 0, #000 calc(100% - 20px), rgba(0, 0, 0, 0.18));
  }

  .document-list.scrolling::-webkit-scrollbar {
    display: none;
  }

  .document-list button {
    position: relative;
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: 10px;
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

  .document-list button.active {
    border-color: color-mix(in srgb, var(--document-accent) 34%, transparent);
    background:
      linear-gradient(180deg, color-mix(in srgb, var(--document-accent) 18%, transparent), rgba(255, 255, 255, 0.055));
  }

  .document-list strong {
    overflow: hidden;
    font-size: 0.82rem;
    line-height: 1.25;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .document-list time {
    color: var(--ap-text-soft);
    font-size: 0.67rem;
    font-weight: 680;
    white-space: nowrap;
  }

  .document-paper {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    gap: 12px;
    min-height: 0;
    height: 100%;
    overflow: hidden;
    padding: 18px;
    border: 1px solid color-mix(in srgb, var(--document-accent) 14%, transparent);
    border-radius: var(--ap-radius-panel);
    background:
      linear-gradient(rgba(17, 23, 32, 0) 31px, color-mix(in srgb, var(--document-accent) 16%, transparent) 32px),
      linear-gradient(90deg, color-mix(in srgb, var(--document-accent) 14%, transparent) 0 1px, transparent 1px 100%),
      rgba(246, 242, 232, 0.08);
    background-size: 100% 32px, 26px 100%, auto;
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.08);
  }

  h3 {
    margin: 0;
    font-size: 1.28rem;
  }

  .document-heading {
    display: grid;
    gap: 9px;
    min-width: 0;
    --content-tag-accent: var(--document-accent);
  }

  .document-metadata {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: 4px 9px;
    min-width: 0;
    margin: 0;
    color: rgba(255, 255, 255, 0.66);
    font-size: 0.72rem;
    line-height: 1.35;
  }

  .document-metadata dt {
    color: color-mix(in srgb, var(--document-accent) 82%, white);
    font-weight: 760;
  }

  .document-metadata dd {
    min-width: 0;
    overflow: hidden;
    margin: 0;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .document-paper > p {
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

  .document-paper.corrupted {
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

  .document-paper.corrupted::before,
  .document-paper.corrupted::after {
    content: "";
    position: absolute;
    inset: 0;
    pointer-events: none;
  }

  .document-paper.corrupted::before {
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

  .document-paper.corrupted::after {
    inset: auto 0 0;
    height: 40%;
    background: linear-gradient(180deg, transparent, rgba(0, 0, 0, 0.5));
  }

  .document-paper > p.content-error {
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
