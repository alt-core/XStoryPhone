<script lang="ts">
  import { Mail } from "@lucide/svelte";
  import type { MailItem } from "../scenario-runtime/types";
  import DocumentListApp from "./DocumentListApp.svelte";

  export let mails: MailItem[] = [];
  export let focusContentId = "";
  export let focusContentRequestId = 0;
  export let onContentOpen: (contentId: string) => void = () => {};
  export let onBlockedContentOpen: (contentId: string) => void = () => {};

  $: documents = mails.map((mail) => ({
    id: mail.id,
    contentId: mail.contentId,
    title: mail.subject,
    body: mail.body,
    listDate: mail.corrupted ? "" : mail.date,
    metadata: mail.corrupted
      ? []
      : [
          { label: "From", value: mail.from },
          { label: "To", value: mail.to },
          ...(mail.cc ? [{ label: "Cc", value: mail.cc }] : []),
          { label: "日付", value: mail.date }
        ],
    corrupted: mail.corrupted
  }));
</script>

<DocumentListApp
  appTitle="メール"
  subtitle={`${mails.length}件・端末内`}
  indexLabel="メール"
  accent="#aebcff"
  countColor="#dbe0ff"
  indexIcon={Mail}
  {documents}
  {focusContentId}
  {focusContentRequestId}
  {onContentOpen}
  {onBlockedContentOpen}
/>
