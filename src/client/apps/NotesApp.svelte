<script lang="ts">
  import { Folder } from "@lucide/svelte";
  import type { NoteItem } from "../scenario-runtime/types";
  import DocumentListApp from "./DocumentListApp.svelte";

  export let notes: NoteItem[] = [];
  export let focusContentId = "";
  export let focusContentRequestId = 0;
  export let onContentOpen: (contentId: string) => void = () => {};
  export let onBlockedContentOpen: (contentId: string) => void = () => {};
</script>

<DocumentListApp
  appTitle="メモ"
  subtitle={`${notes.length}件・端末内`}
  indexLabel="メモ"
  accent="#8fd2ff"
  countColor="#d7f0ff"
  indexIcon={Folder}
  documents={notes}
  {focusContentId}
  {focusContentRequestId}
  {onContentOpen}
  {onBlockedContentOpen}
/>
