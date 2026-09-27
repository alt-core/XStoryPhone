<script lang="ts">
  import { FileLock2, Unlock } from "@lucide/svelte";
  import type { LockedAttachment, MediaAttachment } from "../scenario-runtime/types";
  import TalkMediaAttachment from "./TalkMediaAttachment.svelte";

  export let attachment: LockedAttachment;
  export let playbackId: string;
  export let canOpenAlbum = false;
  export let onOpenAlbum: () => void = () => {};
  export let onComplete: (media: MediaAttachment) => void = () => {};
  export let onUnlock: (contentId: string, password: string) => Promise<{ ok: boolean; error?: string }>;
  let password = "";
  let pending = false;
  let error = "";

  async function unlock() {
    if (!password.trim() || pending) return;
    pending = true;
    error = "";
    try {
      const result = await onUnlock(attachment.contentId, password.trim());
      if (result.ok) password = "";
      else error = result.error ?? "開けません。";
    } catch {
      error = "開けません。通信状態を確認して、もう一度お試しください。";
    } finally {
      pending = false;
    }
  }
</script>

<div class="locked-title">
  {#if attachment.locked}<FileLock2 size={16} strokeWidth={2.1} />{:else}<Unlock size={16} strokeWidth={2.1} />{/if}
  <strong>{attachment.locked ? attachment.title ?? "ロックファイル" : attachment.unlockedTitle ?? attachment.title ?? "開封済みファイル"}</strong>
</div>
{#if attachment.locked}
  <form on:submit|preventDefault={unlock}>
    <input bind:value={password} type="text" autocomplete="off" placeholder="パスワード" disabled={pending} />
    <button type="submit" disabled={pending || !password.trim()}>開く</button>
  </form>
  {#if error}<p class="unlock-error" role="alert">{error}</p>{/if}
{:else}
  {#if attachment.unlockedMedia}
    <TalkMediaAttachment media={attachment.unlockedMedia} {playbackId} {canOpenAlbum} {onOpenAlbum} {onComplete} />
  {/if}
  <p>{attachment.unlockedBody ?? ""}</p>
{/if}

<style>
  .locked-title { display: grid; grid-template-columns: 18px minmax(0, 1fr); align-items: center; gap: 7px; color: var(--attachment-color, #d8fff4); }
  strong { overflow: hidden; font-size: 0.74rem; text-overflow: ellipsis; white-space: nowrap; }
  form { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 7px; }
  input { min-width: 0; height: 32px; border: 1px solid var(--ap-border); border-radius: 10px; padding: 0 9px; background: rgba(255, 255, 255, 0.08); color: var(--ap-text); font: inherit; outline: none; }
  button { min-width: 48px; height: 32px; border: 0; border-radius: 10px; background: #5cc8a7; color: #061914; cursor: pointer; font-weight: 820; }
  button:disabled { cursor: default; opacity: 0.46; }
  p { margin: 0; font-size: 0.83rem; line-height: 1.52; white-space: pre-wrap; overflow-wrap: anywhere; }
  .unlock-error { color: #ffb4b4; }
</style>
