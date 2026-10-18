<template>
  <SvgButton class="world-time-switch" :active="worldTime.enabled" @action="action">
    <svg viewBox="0 0 30 30">
      <path d="M15,4.5C9.201,4.5,4.5,9.201,4.5,15S9.201,25.5,15,25.5S25.5,20.799,25.5,15S20.799,4.5,15,4.5z M15,22.875
        c-4.349,0-7.875-3.526-7.875-7.875S10.651,7.125,15,7.125s7.875,3.526,7.875,7.875S19.349,22.875,15,22.875z"/>
      <path d="M16.125,9.75h-2.25v6.034l4.466,3.35l1.35-1.8l-3.566-2.675V9.75z"/>
    </svg>
  </SvgButton>
</template>

<script>
import SvgButton from "./SvgButton.vue";

// BlueMap Live: the map-lighting follows the day-night-cycle of the Minecraft world
export default {
  name: "WorldTimeSwitch",
  components: {SvgButton},
  data() {
    return {
      worldTime: this.$bluemap.appState.worldTime
    }
  },
  methods: {
    action(evt) {
      evt.preventDefault();
      this.$bluemap.setWorldTimeLighting(!this.worldTime.enabled);
    }
  }
}
</script>
