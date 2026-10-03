<script lang="ts">
  import { NotebookPen } from "@lucide/svelte";
  import type { NoteItem } from "../scenario-runtime/types";
  import DocumentListApp from "./DocumentListApp.svelte";

  export let notes: NoteItem[] = [];
  export let focusContentId = "";
  export let focusContentRequestId = 0;
  export let onNavigate: (contentId: string) => void = () => {};
  export let onContentOpen: (contentId: string) => void = () => {};
  export let onDisplayedContentChange: (contentId: string) => void = () => {};
  export let onBlockedContentOpen: (contentId: string) => void = () => {};
</script>

<DocumentListApp
  appTitle="メモ"
  accent="#8fd2ff"
  emptyIcon={NotebookPen}
  emptyLabel="メモはありません"
  documents={notes}
  {focusContentId}
  {focusContentRequestId}
  {onNavigate}
  {onContentOpen}
  {onDisplayedContentChange}
  {onBlockedContentOpen}
/>
