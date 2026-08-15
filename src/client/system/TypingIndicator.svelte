<script lang="ts">
  export let owner = false;
  export let variant: "messages" | "chat" = "messages";
  export let ariaLabel = "入力中";
</script>

<div class="typing-indicator" class:owner class:chat={variant === "chat"} aria-label={ariaLabel}>
  <span></span>
  <span></span>
  <span></span>
</div>

<style>
  .typing-indicator {
    display: inline-flex;
    align-items: center;
    align-self: start;
    gap: 4px;
    width: max-content;
    min-height: 26px;
    max-width: 86%;
    padding: 9px 12px;
    border: 1px solid rgba(214, 255, 243, 0.12);
    border-radius: 17px 17px 17px 6px;
    background:
      linear-gradient(145deg, rgba(255, 255, 255, 0.12), rgba(92, 200, 167, 0.12)),
      rgba(4, 11, 14, 0.38);
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.08),
      0 8px 18px rgba(0, 0, 0, 0.12);
    backdrop-filter: blur(10px);
    animation: message-in 150ms ease-out both;
  }

  .typing-indicator.owner {
    align-self: end;
    border-radius: 17px 17px 6px 17px;
    background:
      linear-gradient(145deg, rgba(92, 200, 167, 0.36), rgba(92, 200, 167, 0.2)),
      rgba(4, 11, 14, 0.24);
  }

  .typing-indicator.chat {
    max-width: 87%;
    border-color: rgba(218, 255, 225, 0.12);
    border-radius: 16px 16px 16px 6px;
    background:
      linear-gradient(145deg, rgba(255, 255, 255, 0.12), rgba(126, 224, 147, 0.12)),
      rgba(4, 11, 14, 0.38);
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.08);
  }

  .typing-indicator.chat.owner {
    border-radius: 16px 16px 6px 16px;
    background:
      linear-gradient(145deg, rgba(126, 224, 147, 0.3), rgba(126, 224, 147, 0.16)),
      rgba(4, 11, 14, 0.24);
  }

  .typing-indicator span {
    width: 5px;
    height: 5px;
    border-radius: 999px;
    background: #a8ffe7;
    box-shadow: 0 0 8px rgba(92, 200, 167, 0.48);
    animation: typing-dot 820ms ease-in-out infinite;
  }

  .typing-indicator.chat span {
    background: #c6ffd1;
    box-shadow: 0 0 8px rgba(126, 224, 147, 0.42);
  }

  .typing-indicator span:nth-child(2) {
    animation-delay: 120ms;
  }

  .typing-indicator span:nth-child(3) {
    animation-delay: 240ms;
  }

  @keyframes message-in {
    from {
      opacity: 0;
      transform: translateY(5px);
    }

    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  @keyframes typing-dot {
    0%,
    80%,
    100% {
      opacity: 0.36;
      transform: translateY(0);
    }

    40% {
      opacity: 1;
      transform: translateY(-2px);
    }
  }
</style>
