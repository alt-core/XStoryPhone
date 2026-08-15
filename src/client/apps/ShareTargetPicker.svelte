<script lang="ts">
  import { MessageCircle, MessageSquareText, Radio, X } from "@lucide/svelte";
  import type { TalkShareTarget } from "../scenario-runtime/types";

  export let open = false;
  export let targets: TalkShareTarget[] = [];
  export let contentTitle = "";
  export let accent = "#f4c86a";
  export let onSelect: (target: TalkShareTarget) => void = () => {};
  export let onClose: () => void = () => {};

  $: messageTargets = targets.filter((target) => target.kind === "sms");
  $: chatTargets = targets.filter((target) => target.kind === "chat");
  $: targetGroups = [
    { id: "messages", label: "メッセージ", icon: MessageCircle, targets: messageTargets },
    { id: "chat", label: "チャット", icon: MessageSquareText, targets: chatTargets }
  ].filter((group) => group.targets.length > 0);
</script>

{#if open}
  <div class="share-picker-backdrop" role="presentation">
    <button class="backdrop-button" type="button" aria-label="閉じる" on:click={onClose}></button>
    <section class="share-picker" style={`--picker-accent: ${accent}`} aria-label="共有先選択">
      <header>
        <div>
          <h3>どこに送信しますか？</h3>
          <span><Radio size={13} strokeWidth={2.1} /> {contentTitle || "リンク情報"}</span>
        </div>
        <button class="close-button" type="button" aria-label="閉じる" title="閉じる" on:click={onClose}>
          <X size={17} strokeWidth={2.2} />
        </button>
      </header>

      {#if targetGroups.length}
        <div class="target-list">
          {#each targetGroups as group}
            <section class="target-group" aria-label={group.label}>
              <div class="group-title">
                <svelte:component this={group.icon} size={15} strokeWidth={2.2} />
                <strong>{group.label}</strong>
              </div>
              <div class="target-buttons">
                {#each group.targets as target}
                  <button type="button" on:click={() => onSelect(target)}>
                    <span>{target.label}</span>
                    <em>{target.appLabel}</em>
                  </button>
                {/each}
              </div>
            </section>
          {/each}
        </div>
      {:else}
        <div class="empty-picker">
          <MessageCircle size={24} strokeWidth={2.1} />
          <strong>送信先なし</strong>
        </div>
      {/if}
    </section>
  </div>
{/if}

<style>
  .share-picker-backdrop {
    position: absolute;
    inset: 0;
    z-index: 32;
    display: grid;
    align-items: end;
    padding: 14px 10px 52px;
    background:
      radial-gradient(circle at 50% 100%, color-mix(in srgb, var(--picker-accent) 22%, transparent), transparent 46%),
      rgba(3, 6, 10, 0.58);
    backdrop-filter: blur(10px);
  }

  .backdrop-button {
    position: absolute;
    inset: 0;
    border: 0;
    background: transparent;
    cursor: default;
  }

  .share-picker {
    position: relative;
    z-index: 1;
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    gap: 10px;
    min-height: 0;
    max-height: min(418px, 78%);
    padding: 12px;
    border: 1px solid color-mix(in srgb, var(--picker-accent) 30%, rgba(255, 255, 255, 0.12));
    border-radius: 18px;
    background:
      linear-gradient(180deg, color-mix(in srgb, var(--picker-accent) 13%, transparent), transparent 44%),
      rgba(10, 15, 21, 0.93);
    box-shadow: 0 22px 48px rgba(0, 0, 0, 0.44);
  }

  header {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: 10px;
  }

  header div {
    display: grid;
    gap: 4px;
    min-width: 0;
  }

  h3 {
    margin: 0;
    color: #fff;
    font-size: 0.98rem;
    line-height: 1.1;
  }

  header span {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    min-width: 0;
    overflow: hidden;
    color: rgba(255, 255, 255, 0.58);
    font-size: 0.66rem;
    font-weight: 760;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .close-button {
    display: grid;
    place-items: center;
    width: 34px;
    height: 34px;
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 12px;
    background: rgba(255, 255, 255, 0.08);
    color: rgba(255, 255, 255, 0.86);
    cursor: pointer;
  }

  .target-list {
    display: grid;
    align-content: start;
    gap: 10px;
    min-height: 0;
    overflow: auto;
    overscroll-behavior: contain;
    scrollbar-width: none;
  }

  .target-list::-webkit-scrollbar {
    display: none;
  }

  .target-group {
    display: grid;
    gap: 6px;
    min-width: 0;
  }

  .group-title {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    color: color-mix(in srgb, var(--picker-accent) 72%, white 18%);
    font-size: 0.7rem;
    font-weight: 820;
  }

  .target-buttons {
    display: grid;
    gap: 5px;
  }

  .target-buttons button {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: 10px;
    min-height: 48px;
    padding: 8px 10px;
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 13px;
    background: rgba(255, 255, 255, 0.055);
    color: #fff;
    text-align: left;
    cursor: pointer;
  }

  .target-buttons button:active {
    transform: translateY(1px);
  }

  .target-buttons span,
  .target-buttons em {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .target-buttons span {
    font-size: 0.84rem;
    font-weight: 800;
  }

  .target-buttons em {
    color: rgba(255, 255, 255, 0.54);
    font-size: 0.66rem;
    font-style: normal;
    font-weight: 740;
  }

  .empty-picker {
    display: grid;
    place-items: center;
    gap: 8px;
    min-height: 168px;
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 14px;
    background: rgba(255, 255, 255, 0.05);
    color: rgba(255, 255, 255, 0.58);
    font-size: 0.76rem;
  }
</style>
