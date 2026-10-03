<script lang="ts">
  import { Inbox } from "@lucide/svelte";
  import type { MailItem } from "../scenario-runtime/types";
  import DocumentListApp from "./DocumentListApp.svelte";

  export let mails: MailItem[] = [];
  export let focusContentId = "";
  export let focusContentRequestId = 0;
  export let onNavigate: (contentId: string) => void = () => {};
  export let onContentOpen: (contentId: string) => void = () => {};
  export let onDisplayedContentChange: (contentId: string) => void = () => {};
  export let onBlockedContentOpen: (contentId: string) => void = () => {};

  $: documents = mails.map((mail) => ({
    id: mail.id,
    contentId: mail.contentId,
    title: mail.subject,
    body: mail.body,
    sender: mail.from,
    recipients: mail.corrupted
      ? []
      : [
          { label: "To", value: mail.to },
          ...(mail.cc ? [{ label: "Cc", value: mail.cc }] : [])
        ],
    date: mail.corrupted ? "" : mail.date,
    corrupted: mail.corrupted
  }));
</script>

<DocumentListApp
  mailLayout
  appTitle="メール"
  accent="#aebcff"
  emptyIcon={Inbox}
  emptyLabel="メールはありません"
  {documents}
  {focusContentId}
  {focusContentRequestId}
  {onNavigate}
  {onContentOpen}
  {onDisplayedContentChange}
  {onBlockedContentOpen}
/>
