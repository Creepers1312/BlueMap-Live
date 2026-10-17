<template>
  <div class="live-indicator" :class="'live-' + live.connection" :title="$t('liveIndicator.' + live.connection)">
    <span class="live-dot"></span>
    <span class="live-label">{{ $t("liveIndicator.label") }}</span>
  </div>
</template>

<script>
// BlueMap Live: the state of the live-data (age of the last live/players.json, see LiveConnection)
export default {
  name: "LiveIndicator",
  data() {
    return {
      live: this.$bluemap.appState.live
    }
  }
}
</script>

<style lang="scss">
  .live-indicator {
    display: flex;
    align-items: center;
    gap: 0.35em;
    padding: 0 0.5em;
    min-height: 2em;
    user-select: none;
    pointer-events: auto;

    background-color: var(--theme-bg);
    color: var(--theme-fg-light);
    font-size: 0.8em;
    font-weight: bold;

    .live-dot {
      width: 0.7em;
      height: 0.7em;
      border-radius: 50%;
      background-color: #888;
    }

    &.live-live .live-dot {
      background-color: #3c3;
      box-shadow: 0 0 0.4em #3c3;
    }

    &.live-delayed .live-dot {
      background-color: #e8b020;
    }

    &.live-offline .live-dot {
      background-color: #d33;
    }
  }
</style>
