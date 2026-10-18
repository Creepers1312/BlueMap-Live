<template>
  <div class="world-clock" :title="tooltip">
    <svg viewBox="0 0 30 30" class="world-clock-icon" :class="'weather-' + icon">
      <g v-if="icon === 'sun'">
        <circle cx="15" cy="15" r="5.5"/>
        <g stroke-width="2.2" stroke-linecap="round">
          <line x1="15" y1="3" x2="15" y2="6"/><line x1="15" y1="24" x2="15" y2="27"/>
          <line x1="3" y1="15" x2="6" y2="15"/><line x1="24" y1="15" x2="27" y2="15"/>
          <line x1="6.5" y1="6.5" x2="8.6" y2="8.6"/><line x1="21.4" y1="21.4" x2="23.5" y2="23.5"/>
          <line x1="6.5" y1="23.5" x2="8.6" y2="21.4"/><line x1="21.4" y1="8.6" x2="23.5" y2="6.5"/>
        </g>
      </g>
      <path v-else-if="icon === 'moon'" d="M17.011,19.722c-3.778-1.613-5.533-5.982-3.921-9.76c0.576-1.348,1.505-2.432,2.631-3.204
        c-3.418-0.243-6.765,1.664-8.186,4.992c-1.792,4.197,0.159,9.053,4.356,10.844c3.504,1.496,7.462,0.377,9.717-2.476
        C20.123,20.465,18.521,20.365,17.011,19.722z"/>
      <g v-else>
        <path d="M22.5,10.5c-0.3,0-0.6,0-0.9,0.1C20.6,7.9,18,6,15,6c-3.6,0-6.6,2.8-6.9,6.3C5.8,12.7,4,14.6,4,17c0,2.8,2.2,5,5,5h13.5
          c3,0,5.5-2.5,5.5-5.75S25.5,10.5,22.5,10.5z"/>
        <g v-if="icon === 'rain'" stroke-width="1.8" stroke-linecap="round">
          <line x1="10" y1="24" x2="9" y2="27"/><line x1="15" y1="24" x2="14" y2="27"/><line x1="20" y1="24" x2="19" y2="27"/>
        </g>
        <polygon v-else points="16,21 12,26.5 15,26.5 13.5,30 19,24 16,24 17.5,21" class="bolt"/>
      </g>
    </svg>
    <span class="world-clock-time">{{ worldTime.clock }}</span>
  </div>
</template>

<script>
// BlueMap Live: the time and weather of the Minecraft world (from live/players.json, see WorldTimeLighting)
export default {
  name: "WorldClock",
  data() {
    return {
      worldTime: this.$bluemap.appState.worldTime
    }
  },
  computed: {
    icon() {
      if (this.worldTime.weather === "thunder") return "thunder";
      if (this.worldTime.weather === "rain") return "rain";
      return this.worldTime.day ? "sun" : "moon";
    },
    tooltip() {
      let text = this.$t("worldClock.tooltip") + " · " + this.$t("worldClock.weather." + this.worldTime.weather);
      if (!this.worldTime.day) text += " · " + this.$t("worldClock.moon.p" + this.worldTime.moonPhase);
      return text;
    }
  }
}
</script>

<style lang="scss">
  .world-clock {
    display: flex;
    align-items: center;
    gap: 0.25em;
    padding: 0 0.5em;
    min-height: 2em;
    user-select: none;
    pointer-events: auto;

    background-color: var(--theme-bg);
    color: var(--theme-fg);

    .world-clock-icon {
      width: 1.5em;
      height: 1.5em;
      fill: var(--theme-fg-light);
      stroke: var(--theme-fg-light);
      stroke-width: 0;

      .bolt {
        fill: #e8c440;
      }
    }

    .world-clock-time {
      font-variant-numeric: tabular-nums;
    }
  }
</style>
