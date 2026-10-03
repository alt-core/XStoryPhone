<script lang="ts">
  import { onDestroy, tick } from "svelte";
  import { ArrowLeft, Globe2 } from "@lucide/svelte";
  import type { BrowserTabItem } from "../scenario-runtime/types";
  import {
    browserDocumentKey,
    browserTabContentId,
    browserUrlAllowed,
    currentBrowserPageUrl,
    initialBrowserPage,
    navigateBrowserPage,
    normalizeBrowserDisplayUrl,
    replaceBrowserPageUrl,
    sameBrowserDocument,
    stepBackBrowserPage
  } from "../system/browserPages.ts";
  import { corruptionNoiseStyle } from "../system/corruptionNoise";
  import type { BrowserPageHistory } from "../system/phoneHistory.ts";
  import AppListButton from "./AppListButton.svelte";
  import AppListHeader from "./AppListHeader.svelte";
  import AppShell from "./AppShell.svelte";

  export let tabs: BrowserTabItem[] = [];
  // タブごとのページ履歴はAppが持つ。アプリを離れても、タブ一覧から開き直しても保たれる。
  export let pages: Record<string, BrowserPageHistory> = {};
  export let focusContentId = "";
  export let focusContentRequestId = 0;
  export let onNavigate: (contentId: string) => void = () => {};
  export let onNavigatePage: (contentId: string, page: BrowserPageHistory, mode: "push" | "replace") => void = () => {};
  export let onDisplayedContentChange: (contentId: string) => void = () => {};
  export let onContentOpen: (contentId: string) => void = () => {};
  export let onBlockedContentOpen: (contentId: string) => void = () => {};
  export let onNoise: (durationMs?: number) => void = () => {};

  // 空ならタブ一覧。Appの表示指定は要求ごとに1回だけ適用する。
  let openTabId = "";
  let lastOpenedTabId = "";
  let appliedFocusRequestId: number | undefined;
  let lastReportedDisplayedContentId: string | undefined;
  let frameElement: HTMLIFrameElement | undefined;
  let frameDocument: Document | undefined;
  let frameSourceUrl = "";
  let frameRequestId = 0;
  let frameTabId = "";
  let frameUrl = "";
  let pageTitle = "";
  let tabListElement: HTMLDivElement | undefined;

  $: applyFocus(focusContentId, focusContentRequestId);
  $: openTab = openTabId ? tabs.find((tab) => tab.id === openTabId) : undefined;
  // condで消えたタブや開けなくなったタブを表示し続けない。
  $: if (openTabId && (!openTab || !usableTab(openTab))) {
    showTabList();
  }
  $: openContentId = openTab && usableTab(openTab) ? browserTabContentId(openTab) : "";
  $: openPage = openTab && openContentId ? pages[openContentId] ?? initialBrowserPage(openTab) : undefined;
  $: openUrl = openPage ? currentBrowserPageUrl(openPage) : "";
  $: syncFrame(openTab, openUrl);
  $: reportDisplayedContent(openContentId);
  $: canGoBack = Boolean(openPage && openPage.index > 0);

  onDestroy(removeFrameLinkHandler);

  function usableTab(tab: BrowserTabItem) {
    return !tab.corrupted && Boolean(tab.url);
  }

  function applyFocus(contentId: string, requestId: number) {
    if (requestId === appliedFocusRequestId) {
      return;
    }
    appliedFocusRequestId = requestId;
    const focused = contentId ? tabs.find((tab) => tab.contentId === contentId || tab.id === contentId) : undefined;
    if (!focused || !usableTab(focused)) {
      showTabList();
      if (focused) onBlockedContentOpen(browserTabContentId(focused));
      return;
    }
    enterTab(focused);
  }

  // 詳細に入るたびに開封を報告する。タブ一覧を挟んだ同じタブの再表示も1回の開封。
  function enterTab(tab: BrowserTabItem) {
    openTabId = tab.id;
    lastOpenedTabId = tab.id;
    onContentOpen(browserTabContentId(tab));
  }

  function showTabList() {
    if (!openTabId) {
      return;
    }
    openTabId = "";
    removeFrameLinkHandler();
    frameTabId = "";
    frameUrl = "";
    void tick().then(() => tabListElement?.querySelector(`[data-tab-id="${CSS.escape(lastOpenedTabId)}"]`)?.scrollIntoView({ block: "nearest" }));
  }

  function reportDisplayedContent(contentId: string) {
    if (contentId === lastReportedDisplayedContentId) {
      return;
    }
    lastReportedDisplayedContentId = contentId;
    onDisplayedContentChange(contentId);
  }

  function selectTab(tab: BrowserTabItem) {
    if (!usableTab(tab)) {
      onBlockedContentOpen(browserTabContentId(tab));
      return;
    }
    onNavigate(browserTabContentId(tab));
    enterTab(tab);
  }

  function returnToTabList() {
    onNavigate("");
    showTabList();
  }

  // 表示するタブ・ページが変わった時だけ読み込む。同じタブ内は履歴を増やさず文書だけ差し替える。
  function syncFrame(tab: BrowserTabItem | undefined, url: string) {
    if (!tab || !url) {
      return;
    }
    // ページ履歴は許可済みの移動だけで作られる。万一の不正値は読み込まない。
    if (!browserUrlAllowed(tab, url)) {
      onNoise();
      return;
    }
    if (tab.id === frameTabId && sameBrowserDocument(url, frameUrl)) {
      return;
    }
    const sameTab = tab.id === frameTabId && Boolean(frameElement);
    const sameDocument = sameTab && browserDocumentKey(url) === browserDocumentKey(frameUrl);
    frameTabId = tab.id;
    frameUrl = url;
    if (!sameDocument) pageTitle = tab.title;
    if (sameTab) {
      replaceFrameDocument(url, sameDocument);
    } else {
      loadFrame(url);
    }
  }

  function loadFrame(url: string) {
    removeFrameLinkHandler();
    frameSourceUrl = url;
    frameRequestId += 1;
  }

  function replaceFrameDocument(url: string, sameDocument: boolean) {
    // hashだけの移動ではloadが来ないため、同じ文書のクリック捕捉を保つ。
    if (!sameDocument) removeFrameLinkHandler();
    try {
      frameElement?.contentWindow?.location.replace(new URL(url, window.location.origin).href);
    } catch {
      loadFrame(url);
    }
  }

  function navigateWithinTab(tab: BrowserTabItem, targetUrl: string) {
    if (!browserUrlAllowed(tab, targetUrl) || !openPage) {
      onNoise();
      return;
    }
    const next = navigateBrowserPage(openPage, normalizeBrowserDisplayUrl(targetUrl));
    if (next !== openPage) {
      onNavigatePage(browserTabContentId(tab), next, "push");
    }
  }

  // アプリ内の戻るボタンはタブ内のページ履歴を戻る。端末の戻る操作とは別に、1回の移動として扱う。
  function navigateBack() {
    const previous = openTab && openPage ? stepBackBrowserPage(openPage) : undefined;
    if (!openTab || !previous) {
      onNoise();
      return;
    }
    onNavigatePage(browserTabContentId(openTab), previous, "push");
  }

  function handleFrameLoad() {
    removeFrameLinkHandler();
    if (!frameElement || !openTab || !openPage) {
      return;
    }
    try {
      const document = frameElement.contentDocument;
      if (!document) {
        return;
      }
      const loadedUrl = normalizeBrowserDisplayUrl(document.location.href);
      if (!browserUrlAllowed(openTab, loadedUrl)) {
        onNoise();
        return;
      }
      // 転送などで表示中のページが変わった時は、その段を実際のページに合わせる。
      if (!sameBrowserDocument(currentBrowserPageUrl(openPage), loadedUrl)) {
        frameUrl = loadedUrl;
        onNavigatePage(browserTabContentId(openTab), replaceBrowserPageUrl(openPage, loadedUrl), "replace");
      }
      frameDocument = document;
      pageTitle = document.title.trim() || openTab.title;
      document.addEventListener("click", handleFrameLink, true);
    } catch {
      onNoise();
    }
  }

  function handleFrameLink(event: MouseEvent) {
    const target = event.target as { closest?: (selector: string) => Element | null } | null;
    const anchor = target?.closest?.("a[href]") as HTMLAnchorElement | null;
    if (!anchor || !openTab) {
      return;
    }
    event.preventDefault();
    if (anchor.target && anchor.target !== "_self" || anchor.hasAttribute("download")) {
      onNoise();
      return;
    }
    navigateWithinTab(openTab, anchor.href);
  }

  function removeFrameLinkHandler() {
    frameDocument?.removeEventListener("click", handleFrameLink, true);
    frameDocument = undefined;
  }

  function tabNoiseStyle(tab: BrowserTabItem) {
    return corruptionNoiseStyle(browserTabContentId(tab));
  }

</script>

<AppShell title="ブラウザ" accent="#79b9ff">
  <div class="browser-app">
    {#if openTab && openContentId}
      <section class="browser-detail" aria-label={pageTitle || openTab.title}>
        <nav class="browser-toolbar" aria-label="ブラウザ操作">
          <AppListButton label="タブ一覧" onClick={returnToTabList} />
          {#if canGoBack}
            <button class="toolbar-back" type="button" aria-label="前のページへ戻る" title="戻る" on:click={navigateBack}>
              <ArrowLeft size={18} strokeWidth={2.35} />
            </button>
          {/if}
          <button class="page-title" type="button" title={pageTitle || openTab.title} on:click={() => onNoise()}>
            <Globe2 size={14} strokeWidth={2.15} />
            <span>{pageTitle || openTab.title}</span>
          </button>
        </nav>

        <div class="browser-page">
          {#key frameRequestId}
            <iframe
              bind:this={frameElement}
              src={frameSourceUrl}
              title={pageTitle || openTab.title}
              sandbox="allow-same-origin"
              referrerpolicy="no-referrer"
              on:load={handleFrameLoad}
            ></iframe>
          {/key}
        </div>
      </section>
    {:else}
      <section class="tab-index" aria-label="タブ一覧">
        <AppListHeader title="タブ" caption={`${tabs.length}件`} />
        {#if tabs.length}
          <div class="tab-list" bind:this={tabListElement}>
            {#each tabs as tab (tab.id)}
              <button
                data-tab-id={tab.id}
                class:recent={tab.id === lastOpenedTabId && usableTab(tab)}
                class:corrupted={tab.corrupted}
                style={tab.corrupted ? tabNoiseStyle(tab) : ""}
                type="button"
                on:click={() => selectTab(tab)}
              >
                <span class="tab-icon" aria-hidden="true"><Globe2 size={17} strokeWidth={2.05} /></span>
                <strong>{tab.title}</strong>
              </button>
            {/each}
          </div>
        {:else}
          <div class="tabs-empty" role="status">
            <Globe2 size={30} strokeWidth={1.7} />
            <span>開いているタブはありません</span>
          </div>
        {/if}
      </section>
    {/if}
  </div>
</AppShell>

<style>
  .browser-app {
    position: relative;
    min-height: 0;
    height: 100%;
    padding: 8px 12px 92px;
    background: #0d141d;
  }

  .browser-detail,
  .tab-index {
    display: grid;
    min-height: 0;
    height: 100%;
    animation: view-in 140ms cubic-bezier(0.2, 0.8, 0.2, 1) both;
  }

  .browser-detail {
    grid-template-rows: auto minmax(0, 1fr);
    gap: 8px;
  }

  .tab-index {
    grid-template-rows: auto minmax(0, 1fr);
    gap: 8px;
  }

  button {
    color: inherit;
    cursor: pointer;
  }

  .browser-toolbar {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    min-height: 46px;
  }

  .toolbar-back {
    display: grid;
    flex: 0 0 auto;
    place-items: center;
    width: 36px;
    height: 36px;
    padding: 0;
    border: 1px solid var(--ap-border);
    border-radius: var(--ap-radius-control);
    background: var(--ap-surface-2);
    box-shadow: var(--ap-shadow-inset);
    animation: control-in 140ms ease-out both;
  }

  .toolbar-back:active {
    transform: translateY(1px) scale(0.98);
  }

  .page-title {
    display: flex;
    flex: 1 1 auto;
    align-items: center;
    justify-content: center;
    gap: 7px;
    min-width: 0;
    height: 36px;
    padding: 0 14px;
    border: 1px solid rgba(121, 185, 255, 0.2);
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.065);
    color: rgba(255, 255, 255, 0.84);
    box-shadow: var(--ap-shadow-inset);
  }

  .page-title :global(svg) {
    flex: 0 0 auto;
    color: #9fcbff;
  }

  .page-title span {
    min-width: 0;
    overflow: hidden;
    font-size: 0.75rem;
    font-weight: 740;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .browser-page {
    min-height: 0;
    overflow: hidden;
    border: 1px solid rgba(255, 255, 255, 0.11);
    border-radius: 15px;
    background: #fff;
    box-shadow: 0 14px 30px rgba(0, 0, 0, 0.3);
  }

  iframe {
    display: block;
    width: 100%;
    height: 100%;
    border: 0;
    background: #fff;
  }

  .tab-list {
    display: grid;
    grid-auto-rows: max-content;
    align-content: start;
    gap: 6px;
    min-height: 0;
    overflow: auto;
    padding: 4px;
    border: 1px solid var(--ap-border);
    border-radius: var(--ap-radius-panel);
    background: rgba(255, 255, 255, 0.035);
    overscroll-behavior: contain;
    scrollbar-width: none;
  }

  .tab-list::-webkit-scrollbar {
    display: none;
  }

  .tab-list button {
    position: relative;
    display: grid;
    grid-template-columns: 32px minmax(0, 1fr);
    gap: 10px;
    align-items: center;
    min-height: 54px;
    overflow: hidden;
    padding: 8px 12px 8px 9px;
    border: 1px solid transparent;
    border-radius: 13px;
    background: rgba(255, 255, 255, 0.05);
    text-align: left;
    transition: background-color 140ms ease;
  }

  .tab-list button:hover {
    background: rgba(255, 255, 255, 0.08);
  }

  .tab-list button.recent {
    border-color: rgba(121, 185, 255, 0.35);
    background: linear-gradient(145deg, rgba(121, 185, 255, 0.16), rgba(255, 255, 255, 0.04));
  }

  .tab-icon {
    display: grid;
    place-items: center;
    width: 32px;
    height: 32px;
    border-radius: 10px;
    background: linear-gradient(145deg, rgba(121, 185, 255, 0.26), rgba(121, 185, 255, 0.1));
    color: #cfe5ff;
  }

  .tab-list button.corrupted {
    border-color: rgba(255, 214, 104, 0.26);
    background:
      linear-gradient(90deg, rgba(3, 8, 13, 0.82), rgba(3, 8, 13, 0.5)),
      var(--corruption-noise, url("/system/album-corruption-noise-01.webp")) center / cover no-repeat,
      #03080d;
    cursor: default;
  }

  .tab-list button.corrupted .tab-icon {
    background: rgba(255, 214, 104, 0.12);
    color: rgba(255, 226, 122, 0.88);
  }

  .tab-list button.corrupted strong {
    color: rgba(255, 226, 122, 0.92);
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
    font-size: 0.76rem;
  }

  .tab-list strong {
    min-width: 0;
    overflow: hidden;
    font-size: 0.84rem;
    font-weight: 720;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .tabs-empty {
    display: grid;
    place-content: center;
    justify-items: center;
    gap: 10px;
    border: 1px solid var(--ap-border);
    border-radius: var(--ap-radius-panel);
    background:
      radial-gradient(circle at 50% 32%, rgba(121, 185, 255, 0.14), transparent 40%),
      rgba(255, 255, 255, 0.035);
    color: var(--ap-text-soft);
    font-size: 0.78rem;
    font-weight: 700;
  }

  .tabs-empty :global(svg) {
    color: #9fcbff;
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

  @keyframes control-in {
    from {
      opacity: 0;
      transform: scale(0.9);
    }

    to {
      opacity: 1;
      transform: scale(1);
    }
  }
</style>
