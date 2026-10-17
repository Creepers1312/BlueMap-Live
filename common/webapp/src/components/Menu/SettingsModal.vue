<template>
  <transition name="bm-settings-modal">
    <div v-if="modal.open" class="bm-settings-modal-backdrop" @click.self="close">
      <div class="bm-settings-modal" role="dialog" aria-modal="true" :aria-label="$t('settings.title')">
        <div class="bm-settings-modal-header">
          <span class="bm-settings-modal-title">{{ $t("settings.title") }}</span>
          <button class="bm-settings-modal-close" :title="$t('settingsTabs.close')" @click="close">
            <svg viewBox="0 0 30 30"><path d="M8 8 L22 22 M22 8 L8 22" stroke-width="3" stroke-linecap="round"/></svg>
          </button>
        </div>
        <div class="bm-settings-modal-body">
          <nav class="bm-settings-modal-tabs" role="tablist">
            <button v-for="tab of tabs" :key="tab.id" role="tab" class="bm-settings-modal-tab"
                    :class="{active: modal.tab === tab.id}" :aria-selected="modal.tab === tab.id"
                    @click="modal.tab = tab.id">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path :d="tab.icon"/></svg>
              <span>{{ $t("settingsTabs." + tab.id) }}</span>
            </button>
          </nav>
          <div class="bm-settings-modal-content">
            <SettingsMenu :key="modal.tab" :section="modal.tab" class="bm-settings-modal-groups" />
          </div>
        </div>
      </div>
    </div>
  </transition>
</template>

<script>
import SettingsMenu from "./SettingsMenu.vue";

// BlueMap Live: the settings in a popup with tabs (the groups of SettingsMenu, one tab at a time)
export const SETTINGS_TABS = [
  {id: "view", icon: "M12 5C6.5 5 2.7 9.3 1.5 12c1.2 2.7 5 7 10.5 7s9.3-4.3 10.5-7C21.3 9.3 17.5 5 12 5zm0 11.5a4.5 4.5 0 1 1 0-9 4.5 4.5 0 0 1 0 9zm0-7a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z"},
  {id: "live", icon: "M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM6.3 5.3l1.4 1.4a7.5 7.5 0 0 0 0 10.6l-1.4 1.4a9.5 9.5 0 0 1 0-13.4zm11.4 0a9.5 9.5 0 0 1 0 13.4l-1.4-1.4a7.5 7.5 0 0 0 0-10.6z"},
  {id: "entities", icon: "M8 3h8v8H8zM5 13h14v8H5zm3 2v4h2v-4zm6 0v4h2v-4z"},
  {id: "light", icon: "M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10zM11 1h2v3h-2zm0 19h2v3h-2zM1 11h3v2H1zm19 0h3v2h-3zM4.2 5.6l1.4-1.4 2.1 2.1-1.4 1.4zm12.1 12.1 1.4-1.4 2.1 2.1-1.4 1.4zM4.2 18.4l2.1-2.1 1.4 1.4-2.1 2.1zM16.3 6.3l2.1-2.1 1.4 1.4-2.1 2.1z"},
  {id: "controls", icon: "M7 6h10a5 5 0 0 1 0 10h-1.5l-2 2h-3l-2-2H7A5 5 0 0 1 7 6zm0 3v2H5v2h2v2h2v-2h2v-2H9V9zm9 1a1.2 1.2 0 1 0 0 2.4 1.2 1.2 0 0 0 0-2.4zm2.5 2a1.2 1.2 0 1 0 0 2.4 1.2 1.2 0 0 0 0-2.4z"},
  {id: "general", icon: "M19.4 13a7.6 7.6 0 0 0 0-2l2.1-1.6-2-3.5-2.5 1a7.4 7.4 0 0 0-1.7-1L15 3h-4l-.4 2.7a7.4 7.4 0 0 0-1.7 1l-2.5-1-2 3.5L6.6 11a7.6 7.6 0 0 0 0 2l-2.1 1.6 2 3.5 2.5-1a7.4 7.4 0 0 0 1.7 1L11 21h4l.4-2.7a7.4 7.4 0 0 0 1.7-1l2.5 1 2-3.5zM13 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z"},
];

export default {
  name: "SettingsModal",
  components: {SettingsMenu},
  data() {
    return {
      modal: this.$bluemap.appState.settingsModal,
      tabs: SETTINGS_TABS,
    }
  },
  mounted() {
    window.addEventListener("keydown", this.onKey);
  },
  unmounted() {
    window.removeEventListener("keydown", this.onKey);
  },
  methods: {
    close() {
      this.modal.open = false;
    },
    onKey(event) {
      if (this.modal.open && event.key === "Escape") this.close();
    }
  }
}
</script>

<style lang="scss">
@import "/src/scss/variables.scss";

.bm-settings-modal-backdrop {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  box-sizing: border-box;
  pointer-events: auto;
  background-color: #0004;

  @media (max-width: $mobile-break) {
    padding: 0;
  }
}

.bm-settings-modal-enter-active, .bm-settings-modal-leave-active {
  transition: opacity 0.2s;
}

.bm-settings-modal-enter-from, .bm-settings-modal-leave-to {
  opacity: 0;
}

.bm-settings-modal {
  display: flex;
  flex-direction: column;
  width: min(60em, 100%);
  height: min(40em, 100%);
  overflow: hidden;

  background-color: var(--theme-bg);
  color: var(--theme-fg);
  filter: drop-shadow(1px 1px 3px #0008);

  @media (max-width: $mobile-break) {
    width: 100%;
    height: 100%;
  }
}

.bm-settings-modal-header {
  display: flex;
  align-items: center;
  flex-shrink: 0;
  height: 3em;
  padding: 0 0.5em 0 1em;
  border-bottom: solid 1px var(--theme-bg-hover);

  .bm-settings-modal-title {
    flex-grow: 1;
    font-size: 1.1em;
  }

  .bm-settings-modal-close {
    width: 2.5em;
    height: 2.5em;
    padding: 0.4em;
    border: none;
    background: none;
    cursor: pointer;
    stroke: var(--theme-fg);

    &:hover {
      background-color: var(--theme-bg-hover);
    }

    svg {
      width: 100%;
      height: 100%;
    }
  }
}

.bm-settings-modal-body {
  display: flex;
  flex-grow: 1;
  min-height: 0;

  @media (max-width: $mobile-break) {
    flex-direction: column;
  }
}

.bm-settings-modal-tabs {
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  width: 13em;
  padding: 0.5em 0;
  overflow-y: auto;
  border-right: solid 1px var(--theme-bg-hover);

  @media (max-width: $mobile-break) {
    flex-direction: row;
    width: 100%;
    padding: 0;
    overflow-x: auto;
    overflow-y: hidden;
    border-right: none;
    border-bottom: solid 1px var(--theme-bg-hover);
  }
}

.bm-settings-modal-tab {
  display: flex;
  align-items: center;
  gap: 0.75em;
  padding: 0.75em 1em;
  border: none;
  border-left: solid 3px transparent;
  background: none;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
  white-space: nowrap;

  svg {
    flex-shrink: 0;
    width: 1.3em;
    height: 1.3em;
    fill: var(--theme-fg-light);
  }

  &:hover {
    background-color: var(--theme-bg-hover);
  }

  &.active {
    border-left-color: var(--theme-fg);
    background-color: var(--theme-bg-hover);

    svg {
      fill: var(--theme-fg);
    }
  }

  @media (max-width: $mobile-break) {
    gap: 0.4em;
    padding: 0.5em 0.75em;
    border-left: none;
    border-bottom: solid 3px transparent;

    &.active {
      border-bottom-color: var(--theme-fg);
    }
  }
}

.bm-settings-modal-content {
  flex-grow: 1;
  min-width: 0;
  padding: 0 1em 1em;
  overflow-x: hidden;
  overflow-y: auto;
}

// the groups side by side where there is room, without the height-limit of the side-menu
.bm-settings-modal .bm-settings-modal-groups {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(18em, 100%), 1fr));
  column-gap: 1em;
  align-items: start;

  > .group {
    margin: 2em 0 0;

    > .content {
      max-height: none;
    }
  }

  // chunk-borders, debug and reset (the "general"-tab) span the whole width
  > .switch-button, > .simple-button {
    grid-column: 1 / -1;
  }

  > .group + .switch-button {
    margin-top: 1.5em;
  }
}
</style>
