<script lang="ts">
  import { onDestroy } from "svelte";
  import { ArrowLeft, Globe2, Layers3, Plus, X } from "@lucide/svelte";
  import type { BrowserTabItem } from "../scenario-runtime/types";
  import { corruptionNoiseStyle } from "../system/corruptionNoise";
  import AppShell from "./AppShell.svelte";

  export let tabs: BrowserTabItem[] = [];
  export let focusContentId = "";
  export let focusContentRequestId = 0;
  export let onContentOpen: (contentId: string) => void = () => {};
  export let onBlockedContentOpen: (contentId: string) => void = () => {};
  export let onNoise: (durationMs?: number) => void = () => {};

  let selectedTabId = tabs[0]?.id ?? "";
  let view: "page" | "tabs" = tabs.length ? "page" : "tabs";
  let historiesByTabId: Record<string, string[]> = {};
  let historyIndexByTabId: Record<string, number> = {};
  let frameElement: HTMLIFrameElement | undefined;
  let frameSourceUrl = "";
  let frameRequestId = 0;
  let pageTitle = "";
  let selectedFingerprint = "";
  let lastAppliedFocusRequestId = focusContentRequestId;
  let lastReportedContentId = "";
  let frameDocument: Document | undefined;

  $: selectedTab = tabs.find((tab) => tab.id === selectedTabId) ?? tabs[0];
  $: if (!selectedTab && view === "page") {
    view = "tabs";
  }
  $: if (selectedTab) {
    syncSelectedTab(selectedTab);
  }
  $: if (!focusContentId) {
    lastAppliedFocusRequestId = focusContentRequestId;
  } else if (focusContentRequestId !== lastAppliedFocusRequestId) {
    lastAppliedFocusRequestId = focusContentRequestId;
    const focused = tabs.find((tab) => tab.contentId === focusContentId || tab.id === focusContentId);
    if (focused) {
      selectTab(focused);
    }
  }
  $: selectedContentId = selectedTab && !selectedTab.corrupted && view === "page"
    ? selectedTab.contentId ?? selectedTab.id
    : "";
  $: if (selectedContentId && selectedContentId !== lastReportedContentId) {
    lastReportedContentId = selectedContentId;
    onContentOpen(selectedContentId);
  }

  onDestroy(removeFrameLinkHandler);

  function syncSelectedTab(tab: BrowserTabItem) {
    const fingerprint = `${tab.id}:${tab.corrupted === true}:${tab.url ?? ""}`;
    if (fingerprint === selectedFingerprint) {
      return;
    }
    selectedFingerprint = fingerprint;
    if (tab.corrupted || !tab.url) {
      view = "tabs";
      frameSourceUrl = "";
      pageTitle = tab.title;
      return;
    }
    ensureTabHistory(tab);
    pageTitle = tab.title;
    loadFrame(currentHistoryUrl(tab));
  }

  function ensureTabHistory(tab: BrowserTabItem) {
    if (historiesByTabId[tab.id]?.length || !tab.url) {
      return;
    }
    historiesByTabId = { ...historiesByTabId, [tab.id]: [normalizeDisplayUrl(tab.url)] };
    historyIndexByTabId = { ...historyIndexByTabId, [tab.id]: 0 };
  }

  function currentHistoryUrl(tab: BrowserTabItem) {
    ensureTabHistory(tab);
    const history = historiesByTabId[tab.id] ?? [];
    const index = historyIndexByTabId[tab.id] ?? 0;
    return history[index] ?? tab.url ?? "";
  }

  function selectTab(tab: BrowserTabItem) {
    if (tab.corrupted || !tab.url) {
      onBlockedContentOpen(tab.contentId ?? tab.id);
      return;
    }
    selectedTabId = tab.id;
    selectedFingerprint = "";
    view = "page";
    syncSelectedTab(tab);
  }

  function openTabList() {
    removeFrameLinkHandler();
    view = "tabs";
  }

  function restoreCurrentTab() {
    if (!selectedTab || selectedTab.corrupted || !selectedTab.url) {
      onNoise();
      return;
    }
    selectedFingerprint = "";
    view = "page";
    syncSelectedTab(selectedTab);
  }

  function navigateBack() {
    if (!selectedTab) {
      onNoise();
      return;
    }
    const index = historyIndexByTabId[selectedTab.id] ?? 0;
    if (index <= 0) {
      onNoise();
      return;
    }
    historyIndexByTabId = { ...historyIndexByTabId, [selectedTab.id]: index - 1 };
    pageTitle = selectedTab.title;
    replaceFrameDocument(currentHistoryUrl(selectedTab));
  }

  function navigateWithinTab(tab: BrowserTabItem, targetUrl: string) {
    const nextUrl = normalizeDisplayUrl(targetUrl);
    if (!browserUrlAllowed(tab, nextUrl)) {
      onNoise();
      return;
    }
    const history = historiesByTabId[tab.id] ?? [normalizeDisplayUrl(tab.url ?? "")];
    const index = historyIndexByTabId[tab.id] ?? 0;
    if (history[index] === nextUrl) {
      return;
    }
    historiesByTabId = {
      ...historiesByTabId,
      [tab.id]: [...history.slice(0, index + 1), nextUrl]
    };
    historyIndexByTabId = { ...historyIndexByTabId, [tab.id]: index + 1 };
    pageTitle = tab.title;
    replaceFrameDocument(nextUrl);
  }

  function loadFrame(url: string) {
    removeFrameLinkHandler();
    frameSourceUrl = url;
    frameRequestId += 1;
  }

  function replaceFrameDocument(url: string) {
    removeFrameLinkHandler();
    try {
      frameElement?.contentWindow?.location.replace(new URL(url, window.location.origin).href);
    } catch {
      loadFrame(url);
    }
  }

  function handleFrameLoad() {
    removeFrameLinkHandler();
    if (!frameElement || !selectedTab || selectedTab.corrupted) {
      return;
    }
    try {
      const document = frameElement.contentDocument;
      if (!document) {
        return;
      }
      const loadedUrl = normalizeDisplayUrl(document.location.href);
      if (!browserUrlAllowed(selectedTab, loadedUrl)) {
        onNoise();
        return;
      }
      const history = historiesByTabId[selectedTab.id] ?? [normalizeDisplayUrl(selectedTab.url ?? "")];
      const index = historyIndexByTabId[selectedTab.id] ?? 0;
      if (history[index] !== loadedUrl) {
        historiesByTabId = { ...historiesByTabId, [selectedTab.id]: [...history.slice(0, index + 1), loadedUrl] };
        historyIndexByTabId = { ...historyIndexByTabId, [selectedTab.id]: index + 1 };
      }
      frameDocument = document;
      pageTitle = document.title.trim() || selectedTab.title;
      document.addEventListener("click", handleFrameLink, true);
    } catch {
      onNoise();
    }
  }

  function handleFrameLink(event: MouseEvent) {
    const target = event.target as { closest?: (selector: string) => Element | null } | null;
    const anchor = target?.closest?.("a[href]") as HTMLAnchorElement | null;
    if (!anchor || !selectedTab) {
      return;
    }
    event.preventDefault();
    if (anchor.target && anchor.target !== "_self" || anchor.hasAttribute("download")) {
      onNoise();
      return;
    }
    navigateWithinTab(selectedTab, anchor.href);
  }

  function removeFrameLinkHandler() {
    frameDocument?.removeEventListener("click", handleFrameLink, true);
    frameDocument = undefined;
  }

  function browserUrlAllowed(tab: BrowserTabItem, value: string) {
    const targetKey = documentKey(value);
    return [tab.url, ...(tab.allowedUrls ?? [])]
      .filter((url): url is string => Boolean(url))
      .some((url) => documentKey(url) === targetKey);
  }

  function normalizeDisplayUrl(value: string) {
    const url = new URL(value, window.location.origin);
    return `${url.pathname}${url.search}${url.hash}`;
  }

  function documentKey(value: string) {
    const url = new URL(value, window.location.origin);
    return url.origin === window.location.origin ? `${url.pathname}${url.search}` : "";
  }

  function tabNoiseStyle(tab: BrowserTabItem) {
    return corruptionNoiseStyle(tab.contentId ?? tab.id);
  }

</script>

<AppShell title="ブラウザ" accent="#79b9ff">
  <div class="browser-app">
    {#if view === "tabs"}
      <header class="tabs-header">
        <div>
          <span>タブ一覧</span>
          <strong>{tabs.length}件</strong>
        </div>
        <button type="button" aria-label="現在のタブへ戻る" title="閉じる" on:click={restoreCurrentTab}>
          <X size={20} strokeWidth={2.3} />
        </button>
      </header>

      <section class="tab-list" aria-label="開いているタブ">
        {#each tabs as tab}
          <button
            class:active={tab.id === selectedTab?.id}
            class:corrupted={tab.corrupted}
            style={tab.corrupted ? tabNoiseStyle(tab) : ""}
            type="button"
            on:click={() => selectTab(tab)}
          >
            <Globe2 size={18} strokeWidth={2.05} />
            <strong>{tab.title}</strong>
          </button>
        {/each}
        {#if !tabs.length}
          <p class="tabs-empty">開いているタブはありません</p>
        {/if}
      </section>

      <button class="add-tab" type="button" aria-label="新しいタブ" title="新しいタブ" on:click={() => onNoise()}>
        <Plus size={22} strokeWidth={2.35} />
      </button>
    {:else if selectedTab && selectedTab.url}
      <nav class="browser-toolbar" aria-label="ブラウザ操作">
        <button type="button" aria-label="タブ内の履歴を戻る" title="戻る" on:click={navigateBack}>
          <ArrowLeft size={19} strokeWidth={2.35} />
        </button>
        <button class="page-title" type="button" title={pageTitle} on:click={() => onNoise()}>
          <Globe2 size={14} strokeWidth={2.15} />
          <span>{pageTitle || selectedTab.title}</span>
        </button>
        <button class="tabs-open" type="button" aria-label="タブ一覧" title="タブ一覧" on:click={openTabList}>
          <Layers3 size={19} strokeWidth={2.2} />
          <span>{tabs.length}</span>
        </button>
      </nav>

      <div class="browser-page">
        {#key frameRequestId}
          <iframe
            bind:this={frameElement}
            src={frameSourceUrl}
            title={pageTitle || selectedTab.title}
            sandbox="allow-same-origin"
            referrerpolicy="no-referrer"
            on:load={handleFrameLoad}
          ></iframe>
        {/key}
      </div>
    {/if}
  </div>
</AppShell>

<style>
  .browser-app {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr) auto;
    gap: 10px;
    height: 100%;
    min-height: 0;
    padding: 12px 12px 92px;
    background: #0d141d;
  }

  button {
    color: inherit;
    cursor: pointer;
  }

  .browser-toolbar {
    display: grid;
    grid-template-columns: 42px minmax(0, 1fr) 42px;
    gap: 8px;
    align-items: center;
  }

  .browser-toolbar > button,
  .tabs-header button {
    display: grid;
    place-items: center;
    min-width: 0;
    height: 40px;
    border: 1px solid rgba(121, 185, 255, 0.22);
    border-radius: 14px;
    background: rgba(255, 255, 255, 0.065);
  }

  .browser-toolbar .page-title {
    display: flex;
    justify-content: center;
    gap: 7px;
    padding: 0 12px;
    border-radius: 999px;
    color: rgba(255, 255, 255, 0.82);
  }

  .page-title span {
    min-width: 0;
    overflow: hidden;
    font-size: 0.75rem;
    font-weight: 740;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .tabs-open {
    position: relative;
  }

  .tabs-open span {
    position: absolute;
    display: grid;
    place-items: center;
    min-width: 15px;
    height: 15px;
    padding: 0 3px;
    border-radius: 999px;
    background: #79b9ff;
    color: #08111b;
    font-size: 0.55rem;
    font-weight: 820;
    transform: translate(10px, -9px);
  }

  .browser-page {
    min-height: 0;
    overflow: hidden;
    border: 1px solid rgba(255, 255, 255, 0.11);
    border-radius: 15px;
    background: #fff;
  }

  iframe {
    display: block;
    width: 100%;
    height: 100%;
    border: 0;
    background: #fff;
  }

  .tabs-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    min-height: 44px;
  }

  .tabs-header div {
    display: flex;
    align-items: baseline;
    gap: 8px;
    padding-left: 3px;
  }

  .tabs-header span {
    font-size: 1.05rem;
    font-weight: 800;
  }

  .tabs-header strong {
    color: rgba(255, 255, 255, 0.5);
    font-size: 0.68rem;
  }

  .tabs-header button {
    width: 40px;
  }

  .tab-list {
    display: grid;
    align-content: start;
    gap: 7px;
    min-height: 0;
    overflow: auto;
    padding: 5px;
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 16px;
    background: rgba(255, 255, 255, 0.035);
    scrollbar-width: none;
  }

  .tab-list::-webkit-scrollbar {
    display: none;
  }

  .tab-list button {
    position: relative;
    display: grid;
    grid-template-columns: 28px minmax(0, 1fr);
    gap: 9px;
    align-items: center;
    min-height: 52px;
    overflow: hidden;
    padding: 8px 12px;
    border: 1px solid transparent;
    border-radius: 13px;
    background: rgba(255, 255, 255, 0.055);
    text-align: left;
  }

  .tab-list button.active {
    border-color: rgba(121, 185, 255, 0.35);
    background: rgba(121, 185, 255, 0.13);
  }

  .tab-list button.corrupted::before {
    position: absolute;
    inset: 0;
    background: var(--corruption-noise) center / cover;
    content: "";
    opacity: 0.52;
    pointer-events: none;
  }

  .tab-list button > * {
    position: relative;
  }

  .tab-list strong {
    min-width: 0;
    overflow: hidden;
    font-size: 0.82rem;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .tabs-empty {
    align-self: center;
    margin: 0;
    color: rgba(255, 255, 255, 0.48);
    font-size: 0.78rem;
    text-align: center;
  }

  .add-tab {
    display: grid;
    place-items: center;
    justify-self: center;
    width: 48px;
    height: 42px;
    padding: 0;
    border: 1px solid rgba(121, 185, 255, 0.28);
    border-radius: 15px;
    background: rgba(121, 185, 255, 0.13);
    color: #d9ecff;
  }
</style>
