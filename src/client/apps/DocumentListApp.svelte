<script lang="ts">
  import { tick } from "svelte";
  import { ChevronRight } from "@lucide/svelte";
  import type { Component } from "svelte";
  import ContentTags from "../system/ContentTags.svelte";
  import { corruptionNoiseStyle } from "../system/corruptionNoise";
  import ScrollHint from "../system/ScrollHint.svelte";
  import UserAvatar from "../system/UserAvatar.svelte";
  import AppDetailBar from "./AppDetailBar.svelte";
  import AppListHeader from "./AppListHeader.svelte";
  import AppShell from "./AppShell.svelte";

  type DocumentItem = {
    id: string;
    contentId?: string;
    title: string;
    body: string;
    tags?: string[];
    sender?: string;
    recipients?: Array<{ label: string; value: string }>;
    date?: string;
    corrupted?: boolean;
  };

  export let appTitle: string;
  export let accent: string;
  export let emptyIcon: Component;
  export let emptyLabel: string;
  export let documents: DocumentItem[] = [];
  export let mailLayout = false;
  export let focusContentId = "";
  export let focusContentRequestId = 0;
  export let onNavigate: (contentId: string) => void = () => {};
  export let onContentOpen: (contentId: string) => void = () => {};
  export let onDisplayedContentChange: (contentId: string) => void = () => {};
  export let onBlockedContentOpen: (contentId: string) => void = () => {};

  // 空なら一覧。Appの表示指定は要求ごとに1回だけ適用する。
  let openDocumentId = "";
  let lastOpenedDocumentId = "";
  let appliedFocusRequestId: number | undefined;
  let lastReportedDisplayedContentId: string | undefined;
  let listElement: HTMLDivElement | undefined;
  let listScrollTop = 0;

  $: applyFocus(focusContentId, focusContentRequestId);
  $: openDocument = openDocumentId ? documents.find((document) => document.id === openDocumentId) : undefined;
  // condで消えた項目を表示し続けない。
  $: if (openDocumentId && (!openDocument || openDocument.corrupted)) {
    showList();
  }
  $: reportDisplayedContent(openDocument && !openDocument.corrupted ? documentContentId(openDocument) : "");

  function documentContentId(document: DocumentItem) {
    return document.contentId ?? document.id;
  }

  function applyFocus(contentId: string, requestId: number) {
    if (requestId === appliedFocusRequestId) {
      return;
    }
    appliedFocusRequestId = requestId;
    const focused = contentId ? documents.find((document) => document.contentId === contentId || document.id === contentId) : undefined;
    if (!focused || focused.corrupted) {
      showList();
      if (focused) onBlockedContentOpen(documentContentId(focused));
      return;
    }
    enterDocument(focused);
  }

  // 詳細に入るたびに開封を報告する。一覧を挟んだ同じ項目の再表示も1回の開封。
  function enterDocument(document: DocumentItem) {
    openDocumentId = document.id;
    lastOpenedDocumentId = document.id;
    onContentOpen(documentContentId(document));
  }

  function showList() {
    if (!openDocumentId) {
      return;
    }
    openDocumentId = "";
    void restoreListPosition();
  }

  async function restoreListPosition() {
    await tick();
    if (!listElement) {
      return;
    }
    listElement.scrollTop = listScrollTop;
    listElement.querySelector(`[data-document-id="${CSS.escape(lastOpenedDocumentId)}"]`)?.scrollIntoView({ block: "nearest" });
  }

  function reportDisplayedContent(contentId: string) {
    if (contentId === lastReportedDisplayedContentId) {
      return;
    }
    lastReportedDisplayedContentId = contentId;
    onDisplayedContentChange(contentId);
  }

  function selectDocument(document: DocumentItem) {
    if (document.corrupted) {
      onBlockedContentOpen(documentContentId(document));
      return;
    }
    onNavigate(documentContentId(document));
    enterDocument(document);
  }

  function returnToList() {
    onNavigate("");
    showList();
  }
</script>

<AppShell title={appTitle} subtitle={`${documents.length}件・端末内`} {accent}>
  <div class="documents-app" style={`--document-accent: ${accent}`}>
    {#if openDocument && !openDocument.corrupted}
      <section class="document-detail" class:with-tags={Boolean(openDocument.tags?.length)} aria-label={openDocument.title}>
        <AppDetailBar listLabel={`${appTitle}一覧`} title={openDocument.title} titleLines={mailLayout ? 2 : 1} onList={returnToList} />
        {#if openDocument.tags?.length}
          <div class="detail-tags">
            <ContentTags tags={openDocument.tags} />
          </div>
        {/if}
        <div class="detail-scroll" class:with-header={mailLayout}>
          {#if mailLayout}
            <div class="mail-header">
              <UserAvatar name={openDocument.sender ?? ""} size={40} tone="mail" />
              <div class="mail-parties">
                <strong>{openDocument.sender}</strong>
                {#each openDocument.recipients ?? [] as recipient}
                  <span><em>{recipient.label}</em>{recipient.value}</span>
                {/each}
              </div>
              {#if openDocument.date}
                <time>{openDocument.date}</time>
              {/if}
            </div>
          {/if}
          <article class="document-body" class:mail-body={mailLayout}>
            <p>{openDocument.body}</p>
          </article>
        </div>
      </section>
    {:else}
      <section class="document-index" aria-label={`${appTitle}一覧`}>
        <AppListHeader title={appTitle} caption={`${documents.length}件`} />
        {#if documents.length}
          <ScrollHint enabled={documents.length > 6} step={mailLayout ? 140 : 110}>
            <div class="document-list" class:mail-list={mailLayout} bind:this={listElement} on:scroll={() => (listScrollTop = listElement?.scrollTop ?? 0)}>
              {#each documents as document (document.id)}
                <button
                  data-document-id={document.id}
                  class:recent={document.id === lastOpenedDocumentId && !document.corrupted}
                  class:corrupted={document.corrupted}
                  style={document.corrupted ? corruptionNoiseStyle(documentContentId(document)) : ""}
                  type="button"
                  on:click={() => selectDocument(document)}
                >
                  {#if mailLayout}
                    <UserAvatar name={document.corrupted ? "?" : document.sender ?? ""} size={34} tone={document.corrupted ? "neutral" : "mail"} />
                    <span class="row-copy">
                      <span class="row-line">
                        <strong>{document.sender}</strong>
                        {#if document.date && !document.corrupted}
                          <time>{document.date}</time>
                        {/if}
                      </span>
                      <span class="row-subject">{document.title}</span>
                    </span>
                  {:else}
                    <span class="row-copy">
                      <strong>{document.title}</strong>
                    </span>
                  {/if}
                  {#if !document.corrupted}
                    <ChevronRight class="row-chevron" size={16} strokeWidth={2.2} aria-hidden="true" />
                  {/if}
                </button>
              {/each}
            </div>
          </ScrollHint>
        {:else}
          <div class="document-empty" role="status">
            <svelte:component this={emptyIcon} size={30} strokeWidth={1.8} />
            <span>{emptyLabel}</span>
          </div>
        {/if}
      </section>
    {/if}
  </div>
</AppShell>

<style>
  .documents-app {
    position: relative;
    min-height: 0;
    height: 100%;
    padding: 8px 12px 42px;
  }

  .document-index,
  .document-detail {
    display: grid;
    min-height: 0;
    height: 100%;
    animation: view-in 140ms cubic-bezier(0.2, 0.8, 0.2, 1) both;
  }

  .document-index {
    grid-template-rows: auto minmax(0, 1fr);
    gap: 8px;
  }

  .document-index :global(.scroll-hint-shell) {
    min-height: 0;
    height: 100%;
  }

  .document-list {
    display: grid;
    grid-auto-rows: max-content;
    align-content: start;
    min-height: 0;
    height: 100%;
    overflow: auto;
    padding: 4px;
    border: 1px solid var(--ap-border);
    border-radius: var(--ap-radius-panel);
    background: rgba(255, 255, 255, 0.045);
    overscroll-behavior: contain;
    scrollbar-width: none;
  }

  .document-list::-webkit-scrollbar {
    display: none;
  }

  .document-list button {
    position: relative;
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: 10px;
    min-width: 0;
    min-height: 52px;
    padding: 8px 10px 8px 13px;
    border: 1px solid transparent;
    border-radius: 12px;
    background: transparent;
    color: var(--ap-text);
    text-align: left;
    cursor: pointer;
    transition: background-color 140ms ease;
  }

  .document-list.mail-list button {
    grid-template-columns: 34px minmax(0, 1fr) auto;
    min-height: 62px;
    padding-left: 9px;
  }

  /* 行間の区切り線は内側だけに引き、角丸の選択面とは重ねない。 */
  .document-list button + button::before {
    content: "";
    position: absolute;
    top: -1px;
    right: 12px;
    left: 13px;
    height: 1px;
    background: rgba(255, 255, 255, 0.07);
    pointer-events: none;
  }

  .document-list.mail-list button + button::before {
    left: 52px;
  }

  .document-list button:hover {
    background: rgba(255, 255, 255, 0.05);
  }

  .document-list button:active {
    background: rgba(255, 255, 255, 0.08);
  }

  .document-list button.recent {
    border-color: color-mix(in srgb, var(--document-accent) 30%, transparent);
    background: linear-gradient(145deg, color-mix(in srgb, var(--document-accent) 15%, transparent), rgba(255, 255, 255, 0.04));
  }

  .document-list button.recent::before,
  .document-list button.recent + button::before {
    opacity: 0;
  }

  .row-copy {
    display: grid;
    gap: 3px;
    min-width: 0;
  }

  .row-copy strong,
  .row-subject {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .row-copy strong {
    font-size: 0.88rem;
    font-weight: 720;
    line-height: 1.3;
  }

  .row-line {
    display: flex;
    align-items: baseline;
    gap: 8px;
    min-width: 0;
  }

  .row-line strong {
    flex: 1 1 auto;
    min-width: 0;
  }

  .row-line time {
    flex: 0 0 auto;
    color: var(--ap-text-soft);
    font-size: 0.64rem;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }

  .row-subject {
    color: rgba(255, 255, 255, 0.64);
    font-size: 0.76rem;
    line-height: 1.35;
  }

  .document-list :global(.row-chevron) {
    color: rgba(255, 255, 255, 0.3);
  }

  .document-list button.corrupted {
    overflow: hidden;
    border-color: rgba(255, 214, 104, 0.26);
    background:
      linear-gradient(90deg, rgba(3, 8, 13, 0.82), rgba(3, 8, 13, 0.5)),
      var(--corruption-noise, url("/system/album-corruption-noise-01.webp")) center / cover no-repeat,
      #03080d;
    cursor: default;
  }

  .document-list button.corrupted::after {
    content: "";
    position: absolute;
    inset: 0;
    background: repeating-linear-gradient(0deg, rgba(255, 255, 255, 0.08) 0 1px, transparent 1px 5px);
    mix-blend-mode: screen;
    opacity: 0.4;
    pointer-events: none;
  }

  .document-list button.corrupted::before,
  .document-list button.corrupted + button::before {
    opacity: 0;
  }

  .document-list button.corrupted .row-copy strong,
  .document-list button.corrupted .row-subject {
    color: rgba(255, 226, 122, 0.92);
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
    letter-spacing: 0.02em;
  }

  .document-list button.corrupted .row-copy strong {
    font-size: 0.78rem;
  }

  .document-list button.corrupted .row-subject {
    font-size: 0.7rem;
  }

  .document-empty {
    display: grid;
    place-content: center;
    justify-items: center;
    gap: 10px;
    border: 1px solid var(--ap-border);
    border-radius: var(--ap-radius-panel);
    background:
      radial-gradient(circle at 50% 32%, color-mix(in srgb, var(--document-accent) 14%, transparent), transparent 40%),
      rgba(255, 255, 255, 0.035);
    color: var(--ap-text-soft);
    font-size: 0.78rem;
    font-weight: 700;
  }

  .document-empty :global(svg) {
    color: color-mix(in srgb, var(--document-accent) 78%, white);
  }

  .document-detail {
    grid-template-rows: auto minmax(0, 1fr);
    gap: 8px;
  }

  .document-detail.with-tags {
    grid-template-rows: auto auto minmax(0, 1fr);
  }

  .detail-tags {
    min-width: 0;
    padding: 0 2px;
    --content-tag-accent: var(--document-accent);
  }

  .detail-scroll {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    gap: 10px;
    min-height: 0;
    overflow: auto;
    overscroll-behavior: contain;
    scrollbar-width: none;
  }

  .detail-scroll::-webkit-scrollbar {
    display: none;
  }

  .detail-scroll:not(.with-header) {
    grid-template-rows: minmax(0, 1fr);
  }

  .mail-header {
    display: grid;
    grid-template-columns: 40px minmax(0, 1fr) auto;
    align-items: start;
    gap: 11px;
    padding: 12px;
    border: 1px solid var(--ap-border);
    border-radius: var(--ap-radius-panel);
    background:
      linear-gradient(145deg, color-mix(in srgb, var(--document-accent) 12%, transparent), rgba(255, 255, 255, 0.035));
  }

  .mail-parties {
    display: grid;
    gap: 3px;
    min-width: 0;
    padding-top: 1px;
  }

  .mail-parties strong {
    overflow: hidden;
    font-size: 0.9rem;
    font-weight: 780;
    line-height: 1.3;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .mail-parties span {
    color: rgba(255, 255, 255, 0.62);
    font-size: 0.7rem;
    line-height: 1.4;
    overflow-wrap: anywhere;
  }

  .mail-parties em {
    margin-right: 6px;
    color: color-mix(in srgb, var(--document-accent) 80%, white);
    font-style: normal;
    font-weight: 760;
  }

  .mail-header time {
    padding-top: 3px;
    color: var(--ap-text-soft);
    font-size: 0.64rem;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  /* 紙面の罫線は本文の行送りと揃え、本文と一緒にスクロールする。 */
  .document-body {
    --line: calc(0.92rem * 1.9);
    min-height: 100%;
    margin: 0;
    padding: 14px 16px 18px 22px;
    border: 1px solid color-mix(in srgb, var(--document-accent) 16%, transparent);
    border-radius: var(--ap-radius-panel);
    background:
      linear-gradient(90deg, transparent 13px, color-mix(in srgb, var(--document-accent) 20%, transparent) 13px 14px, transparent 14px),
      linear-gradient(transparent calc(var(--line) - 1px), color-mix(in srgb, var(--document-accent) 13%, transparent) calc(var(--line) - 1px)) 0 14px / 100% var(--line) repeat-y,
      linear-gradient(180deg, rgba(246, 242, 232, 0.085), rgba(246, 242, 232, 0.05));
    box-shadow: var(--ap-shadow-inset);
  }

  .document-body.mail-body {
    min-height: auto;
    padding-left: 16px;
    background: rgba(255, 255, 255, 0.04);
    border-color: var(--ap-border);
  }

  .document-body p {
    margin: 0;
    color: rgba(255, 255, 255, 0.86);
    font-size: 0.92rem;
    line-height: 1.9;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .document-body.mail-body p {
    font-size: 0.88rem;
    line-height: 1.8;
  }

  @keyframes view-in {
    from {
      opacity: 0;
      transform: translateY(5px);
    }

    to {
      opacity: 1;
      transform: translateY(0);
    }
  }
</style>
