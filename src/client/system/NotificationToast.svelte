<script lang="ts">
  import type { NotificationItem } from "../scenario-runtime/types";
  import NotificationCard from "./NotificationCard.svelte";

  export let notification: NotificationItem;
  export let onOpen: () => void = () => {};
</script>

<div class="toast-shell" aria-live="polite">
  <NotificationCard {notification} variant="shade" onSelect={() => onOpen()} />
</div>

<style>
  .toast-shell {
    position: absolute;
    top: 48px;
    left: 16px;
    right: 16px;
    z-index: 20;
    --ap-surface-2: #17202a;
    --ap-surface-3: #121923;
    --ap-border: rgba(255, 255, 255, 0.18);
    animation: toast-in 180ms cubic-bezier(0.2, 0.9, 0.2, 1) both;
    filter: drop-shadow(0 16px 24px rgba(0, 0, 0, 0.28));
  }

  @keyframes toast-in {
    from {
      opacity: 0;
      transform: translateY(-18px);
    }

    to {
      opacity: 1;
      transform: translateY(0);
    }
  }
</style>
