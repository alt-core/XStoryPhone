<script lang="ts">
  import { BatteryMedium, ChevronLeft, Signal } from "@lucide/svelte";
  import type { DeviceState } from "../scenario-runtime/types";

  export let deviceState: DeviceState;
  export let shadeOpen = false;
  export let backLinkLabel = "";
  export let onToggleShade: () => void = () => {};
  export let onBackLink: () => void = () => {};
</script>

<header class="status-bar" class:shade-open={shadeOpen}>
  <div class="left-zone">
    {#if backLinkLabel}
      <button class="app-back-link" type="button" aria-label={`${backLinkLabel}へ戻る`} title={`${backLinkLabel}へ戻る`} on:click={onBackLink}>
        <ChevronLeft size={14} strokeWidth={2.6} />
        <span>{backLinkLabel}</span>
      </button>
    {/if}
  </div>
  <div class="time">{deviceState.currentTimeLabel}</div>
  <button class="signals" type="button" aria-label={`${deviceState.signalLabel} ${deviceState.batteryLevel}% 通知センターを開く`} title="通知センター" on:click={onToggleShade}>
    <Signal class="signal-icon" size={16} strokeWidth={2.25} />
    <span class="network">{deviceState.signalLabel}</span>
    <BatteryMedium class="battery-icon" size={19} strokeWidth={2.1} />
    <span class="battery-level">{deviceState.batteryLevel}%</span>
  </button>
</header>

<style>
  .status-bar {
    position: relative;
    z-index: 4;
    display: grid;
    grid-template-columns: 104px minmax(0, 1fr) 104px;
    align-items: center;
    min-height: 40px;
    padding: 0 13px;
    font-size: 0.8rem;
    color: rgba(255, 255, 255, 0.88);
    user-select: none;
    background:
      linear-gradient(180deg, rgba(5, 8, 12, 0.34), rgba(5, 8, 12, 0)),
      rgba(8, 11, 17, 0.08);
    backdrop-filter: blur(18px);
  }

  .status-bar.shade-open {
    background:
      linear-gradient(180deg, rgba(5, 8, 12, 0.42), rgba(5, 8, 12, 0.02)),
      rgba(8, 11, 17, 0.12);
  }

  .left-zone {
    position: relative;
    z-index: 2;
    grid-column: 1;
    display: flex;
    align-items: center;
    height: 100%;
    min-width: 0;
  }

  .app-back-link {
    display: inline-flex;
    align-items: center;
    max-width: 100%;
    min-width: 0;
    min-height: 34px;
    gap: 1px;
    padding: 0 4px 0 0;
    border: 0;
    background: transparent;
    color: rgba(156, 191, 255, 0.9);
    cursor: pointer;
    font-size: 0.76rem;
    font-weight: 760;
    line-height: 1;
    letter-spacing: 0;
    text-shadow: 0 0 10px rgba(118, 169, 255, 0.18);
  }

  .app-back-link :global(svg) {
    flex: 0 0 auto;
    margin-left: -4px;
  }

  .app-back-link span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .app-back-link:active {
    color: rgba(190, 210, 255, 0.98);
    transform: translateY(1px);
  }

  .time {
    position: absolute;
    left: 50%;
    z-index: 2;
    transform: translateX(-50%);
    font-weight: 740;
    letter-spacing: 0;
    font-variant-numeric: tabular-nums;
    line-height: 1;
    pointer-events: none;
  }

  .signals {
    position: relative;
    z-index: 2;
    grid-column: 3;
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 5px;
    min-height: 34px;
    min-width: 0;
    padding: 0;
    border: 0;
    background: transparent;
    color: inherit;
    cursor: pointer;
    font-size: 0.79rem;
    font-weight: 740;
    font-variant-numeric: tabular-nums;
    line-height: 1;
  }

  .signals :global(svg) {
    flex: 0 0 auto;
    opacity: 0.74;
  }

  .signals span {
    min-width: 0;
    text-align: right;
  }

  .network {
    min-width: 20px;
    margin-right: 2px;
  }

  .battery-level {
    min-width: 28px;
  }
</style>
