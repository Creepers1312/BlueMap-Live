<template>
  <div>
    <Group v-if="showViewControls" :title="$t('controls.title')" >
      <SimpleButton v-if="mapViewer.map.perspectiveView" :active="appState.controls.state === 'perspective'" @action="$bluemap.setPerspectiveView(500, appState.controls.state === 'free' ? 100 : 0)">{{$t('controls.perspective.button')}}</SimpleButton>
      <SimpleButton v-if="mapViewer.map.flatView" :active="appState.controls.state === 'flat'" @action="$bluemap.setFlatView(500, appState.controls.state === 'free' ? 100 : 0)">{{$t('controls.flatView.button')}}</SimpleButton>
      <SimpleButton v-if="mapViewer.map.freeFlightView" :active="appState.controls.state === 'free'" @action="$bluemap.setFreeFlight(500)">{{$t('controls.freeFlight.button')}}</SimpleButton>
    </Group>

    <Group :title="$t('lighting.title')">
      <Slider :value="mapViewer.uniforms.sunlightStrength.value" :min="0" :max="1" :step="0.01"
              @update="appState.worldTime.enabled && $bluemap.setWorldTimeLighting(false); mapViewer.uniforms.sunlightStrength.value = $event; $bluemap.mapViewer.redraw()">{{$t('lighting.sunlight')}}</Slider>
      <Slider :value="mapViewer.uniforms.ambientLight.value" :min="0" :max="1" :step="0.01"
              @update="mapViewer.uniforms.ambientLight.value = $event; $bluemap.mapViewer.redraw()">{{$t('lighting.ambientLight')}}</Slider>
      <SwitchButton v-if="appState.worldTime.available" :on="appState.worldTime.enabled" @action="$bluemap.setWorldTimeLighting(!appState.worldTime.enabled)">{{ $t("lighting.worldTime.button") }}</SwitchButton>
    </Group>

    <Group :title="$t('live.title')">
      <div class="bm-live-setting-label">{{ $t("live.smoothing") }}</div>
      <SimpleButton v-for="delay of playbackDelays" :key="delay"
                    :active="appState.live.delay === delay"
                    @action="$bluemap.setLivePlaybackDelay(delay); $bluemap.saveUserSettings()"
      >{{ delay === 0 ? $t("live.smoothingOff") : delay + " ms" }}</SimpleButton>
      <div class="bm-live-setting-label">{{ $t("live.fpsLimit") }}</div>
      <SimpleButton v-for="limit of fpsLimits" :key="limit"
                    :active="appState.live.fpsLimit === limit"
                    @action="$bluemap.setFpsLimit(limit); $bluemap.saveUserSettings()"
      >{{ limit === 0 ? $t("live.fpsUnlimited") : limit + " FPS" }}</SimpleButton>
    </Group>

    <Group :title="$t('live.displayTitle')">
      <Slider :value="appState.live.entityRadius === null ? appState.live.serverRadius : Math.min(appState.live.entityRadius, appState.live.serverRadius)"
              :min="0" :max="appState.live.serverRadius" :step="1" :formatter="blocksFormatter"
              @update="$bluemap.setLiveDisplay('entityRadius', $event >= appState.live.serverRadius ? null : $event)"
              @lazy="$bluemap.saveUserSettings()">{{ $t("live.entityRadius") }}</Slider>
      <Slider :value="appState.live.entityDistance" :min="entityDistanceMin" :max="entityDistanceMax" :step="50" :formatter="blocksFormatter"
              @update="$bluemap.setLiveDisplay('entityDistance', $event)"
              @lazy="$bluemap.saveUserSettings()">{{ $t("live.entityDistance") }}</Slider>
      <SwitchButton :on="appState.live.particles" @action="$bluemap.setLiveDisplay('particles', !appState.live.particles); $bluemap.saveUserSettings()">{{ $t("live.particles") }}</SwitchButton>
      <SwitchButton :on="appState.live.blockPreview" @action="$bluemap.setLiveDisplay('blockPreview', !appState.live.blockPreview); $bluemap.saveUserSettings()">{{ $t("live.blockPreview") }}</SwitchButton>
    </Group>

    <Group :title="$t('live.followTitle')">
      <SimpleButton v-for="mode of followModes" :key="mode"
                    :active="appState.live.followMode === mode"
                    @action="$bluemap.setLiveDisplay('followMode', mode); $bluemap.saveUserSettings()"
      >{{ $t("live.follow." + mode) }}</SimpleButton>
    </Group>

    <Group :title="$t('live.filterTitle')">
      <SwitchButton v-for="category of entityCategories" :key="category" :on="appState.live.categories[category]"
                    @action="$bluemap.setLiveDisplay('category.' + category, !appState.live.categories[category]); $bluemap.saveUserSettings()"
      >{{ $t("live.category." + category) }}</SwitchButton>
      <SwitchButton :on="appState.live.nameTags" @action="$bluemap.setLiveDisplay('nameTags', !appState.live.nameTags); $bluemap.saveUserSettings()">{{ $t("live.nameTags") }}</SwitchButton>
      <SwitchButton :on="appState.live.healthBars" @action="$bluemap.setLiveDisplay('healthBars', !appState.live.healthBars); $bluemap.saveUserSettings()">{{ $t("live.healthBars") }}</SwitchButton>
    </Group>

    <Group :title="$t('qualityPreset.title')">
      <SimpleButton v-for="preset of qualityPresets" :key="preset"
                    :active="activeQualityPreset === preset"
                    @action="$bluemap.applyQualityPreset(preset)"
      >{{ $t("qualityPreset." + preset) }}</SimpleButton>
    </Group>

    <Group :title="$t('resolution.title')">
      <SimpleButton v-for="stage of qualityStages" :key="stage.name"
                    :active="mapViewer.superSampling === stage.value"
                    @action="$bluemap.mapViewer.superSampling = stage.value; $bluemap.saveUserSettings(); $bluemap.mapViewer.redraw()"
      >{{stage.name}}</SimpleButton>
    </Group>

    <Group :title="$t('renderDistance.title')">
      <Slider :value="mapViewer.loadedHiresViewDistance" :min="settings.hiresSliderMin" :max="settings.hiresSliderMax" :step="10" :formatter="renderDistanceFormatter"
              @update="mapViewer.loadedHiresViewDistance = $event; $bluemap.mapViewer.updateLoadedMapArea()" @lazy="$bluemap.saveUserSettings()">{{ $t("renderDistance.hiresLayer") }}</Slider>
      <Slider :value="mapViewer.loadedLowresViewDistance" :min="settings.lowresSliderMin" :max="settings.lowresSliderMax" :step="100"
              @update="mapViewer.loadedLowresViewDistance = $event; $bluemap.mapViewer.updateLoadedMapArea()" @lazy="$bluemap.saveUserSettings()">{{ $t("renderDistance.lowersLayer") }}</Slider>
      <SwitchButton :on="!appState.controls.pauseTileLoading" @action="appState.controls.pauseTileLoading = !appState.controls.pauseTileLoading; $bluemap.saveUserSettings()">{{ $t("renderDistance.loadHiresWhileMoving") }}</SwitchButton>
    </Group>

    <Group :title="$t('mapControls.title')">
      <SwitchButton :on="appState.controls.showZoomButtons" @action="appState.controls.showZoomButtons = !appState.controls.showZoomButtons; $bluemap.saveUserSettings()">{{ $t("mapControls.showZoomButtons") }}</SwitchButton>
    </Group>

    <Group :title="$t('freeFlightControls.title')">
      <Slider :value="appState.controls.mouseSensitivity" :min="0.1" :max="5" :step="0.05"
              @update="appState.controls.mouseSensitivity = $event; $bluemap.updateControlsSettings();" @lazy="$bluemap.saveUserSettings()">{{ $t("freeFlightControls.mouseSensitivity") }}</Slider>
      <SwitchButton :on="appState.controls.invertMouse" @action="appState.controls.invertMouse = !appState.controls.invertMouse; $bluemap.updateControlsSettings(); $bluemap.saveUserSettings()">{{ $t("freeFlightControls.invertMouseY") }}</SwitchButton>
    </Group>

    <Group :title="$t('theme.title')">
      <SimpleButton v-for="theme of themes" :key="theme.name"
                    :active="appState.theme === theme.value"
                    @action="$bluemap.setTheme(theme.value); $bluemap.saveUserSettings();"
      >{{theme.name}}</SimpleButton>
    </Group>

    <Group :title="$t('screenshot.title')">
      <SwitchButton :on="appState.screenshot.clipboard" @action="appState.screenshot.clipboard = !appState.screenshot.clipboard; $bluemap.saveUserSettings()">{{ $t("screenshot.clipboard") }}</SwitchButton>
    </Group>

    <Group v-if="languages.length > 1" :title="$t('language.title')">
      <SimpleButton v-for="lang of languages" :key="lang.locale"
                    :active="lang.locale === $i18n.locale"
                    @action="changeLanguage(lang.locale);"
      >{{lang.name}}</SimpleButton>
    </Group>

    <SwitchButton :on="mapViewer.uniforms.chunkBorders.value" @action="switchChunkBorders(); $bluemap.saveUserSettings();">{{ $t("chunkBorders.button") }}</SwitchButton>

    <SwitchButton :on="appState.debug" @action="switchDebug(); $bluemap.saveUserSettings();">{{ $t("debug.button") }}</SwitchButton>

    <SimpleButton @action="$bluemap.resetSettings()">{{ $t("resetAllSettings.button") }}</SimpleButton>
  </div>
</template>

<script>
import Group from "./Group.vue";
import SimpleButton from "./SimpleButton.vue";
import Slider from "./Slider.vue";
import SwitchButton from "./SwitchButton.vue";
import {i18n, setLanguage} from "../../i18n";
import {PLAYBACK_DELAYS} from "../../js/markers/LivePlayback";
import {currentQualityPreset, QUALITY_PRESET_NAMES} from "../../js/QualityPresets";
import {FOLLOW_MODES} from "../../js/controls/FollowCamera";
import {ENTITY_CATEGORIES, ENTITY_DISTANCE_MAX, ENTITY_DISTANCE_MIN} from "../../js/markers/LiveDisplay";

const themes = [
  {get name(){ return i18n.t("theme.default")}, value: null},
  {get name(){ return i18n.t("theme.dark")}, value: 'dark'},
  {get name(){ return i18n.t("theme.light")}, value: 'light'},
  {get name(){ return i18n.t("theme.contrast")}, value: 'contrast'},
];

const qualityStages = [
  {get name(){ return i18n.t("resolution.high")}, value: 2},
  {get name(){ return i18n.t("resolution.normal")}, value: 1},
  {get name(){ return i18n.t("resolution.low")}, value: 0.5},
];

export default {
name: "SettingsMenu",
  components: {SwitchButton, Slider, SimpleButton, Group},
  data() {
    return {
      appState: this.$bluemap.appState,
      mapViewer: this.$bluemap.mapViewer.data,
      settings: {
        ...{
          hiresSliderMax: 500,
          hiresSliderMin: 50,
          lowresSliderMax: 10000,
          lowresSliderMin: 500
        },
        ...this.$bluemap.settings
      },
      languages: i18n.languages,

      qualityStages: qualityStages,
      themes: themes,
      playbackDelays: PLAYBACK_DELAYS,
      fpsLimits: [0, 60, 30],
      entityDistanceMin: ENTITY_DISTANCE_MIN,
      entityDistanceMax: ENTITY_DISTANCE_MAX,
      entityCategories: ENTITY_CATEGORIES,
      qualityPresets: QUALITY_PRESET_NAMES,
      followModes: FOLLOW_MODES,
    }
  },
  computed: {
    // BlueMap Live: the quality-preset the current settings match (none if changed by hand)
    activeQualityPreset() {
      return currentQualityPreset({
        superSampling: this.mapViewer.superSampling,
        hires: this.mapViewer.loadedHiresViewDistance,
        lowres: this.mapViewer.loadedLowresViewDistance,
        fpsLimit: this.appState.live.fpsLimit,
        entityDistance: this.appState.live.entityDistance,
        particles: this.appState.live.particles,
      }, this.settings);
    },
    showViewControls() {
      if (!this.mapViewer.map) return false;
      return this.mapViewer.map.views.length > 1;
    }
  },
  methods: {
    switchChunkBorders() {
      this.$bluemap.setChunkBorders(!this.mapViewer.uniforms.chunkBorders.value);
    },
    switchDebug() {
      this.$bluemap.setDebug(!this.appState.debug);
    },
    blocksFormatter(value) {
      return Math.round(parseFloat(value)) + " " + this.$t("live.blocks");
    },
    renderDistanceFormatter(value) {
      let f = parseFloat(value);
      return f === 0 ? this.$t("renderDistance.off") : f.toFixed(0);
    },
    async changeLanguage(lang) {
        await setLanguage(lang);
        this.$bluemap.updatePageAddress()
        this.$bluemap.saveUserSettings();
    }
  }
}
</script>

<style>
.bm-live-setting-label {
  padding: 0.5em 1em 0.25em;
  opacity: 0.75;
  font-size: 0.9em;
}
</style>
