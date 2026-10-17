/*
 * This file is part of BlueMap, licensed under the MIT License (MIT).
 *
 * Copyright (c) Blue (Lukas Rieger) <https://bluecolored.de>
 * Copyright (c) contributors
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 */

/*
 * BlueMap Live: quality-presets of the settings-menu, they set BlueMaps own settings (resolution, render-distances)
 * and the live-settings (frame-rate-limit, entity-distance, particles) together.
 */

export const QUALITY_PRESET_NAMES = ["performance", "balanced", "beautiful"];

/**
 * hires/lowres: render-distances (blocks), "default" uses the defaults of the map-settings; all are clamped to the
 * slider-ranges of the settings
 */
export const QUALITY_PRESETS = {
    performance: {superSampling: 0.5, hires: 60, lowres: 1000, fpsLimit: 30, entityDistance: 150, particles: false},
    balanced: {superSampling: 1, hires: "default", lowres: "default", fpsLimit: 60, entityDistance: 300, particles: true},
    beautiful: {superSampling: 2, hires: 300, lowres: 5000, fpsLimit: 0, entityDistance: 600, particles: true},
};

const SLIDER_DEFAULTS = {hiresSliderMin: 50, hiresSliderMax: 500, hiresSliderDefault: 100,
    lowresSliderMin: 500, lowresSliderMax: 10000, lowresSliderDefault: 2000};

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

/**
 * The values of a preset for the settings of this map.
 * @param name {string}
 * @param settings {{hiresSliderMin: number, hiresSliderMax: number, hiresSliderDefault: number,
 *     lowresSliderMin: number, lowresSliderMax: number, lowresSliderDefault: number}}
 * @returns {{superSampling: number, hires: number, lowres: number, fpsLimit: number, entityDistance: number, particles: boolean} | null}
 */
export function qualityPreset(name, settings) {
    const preset = QUALITY_PRESETS[name];
    if (!preset) return null;
    // the defaults of the settings-menu (SettingsMenu.vue) for settings without slider-ranges
    settings = {...SLIDER_DEFAULTS, ...Object.fromEntries(Object.entries(settings || {}).filter(([, v]) => Number.isFinite(v)))};
    const hires = preset.hires === "default" ? settings.hiresSliderDefault : preset.hires;
    const lowres = preset.lowres === "default" ? settings.lowresSliderDefault : preset.lowres;
    return {
        ...preset,
        hires: clamp(hires, settings.hiresSliderMin, settings.hiresSliderMax),
        lowres: clamp(lowres, settings.lowresSliderMin, settings.lowresSliderMax),
    };
}

/**
 * The preset the current settings match, null if they were changed by hand.
 * @param current {{superSampling: number, hires: number, lowres: number, fpsLimit: number, entityDistance: number, particles: boolean}}
 * @param settings {object} - see qualityPreset
 * @returns {string | null}
 */
export function currentQualityPreset(current, settings) {
    for (const name of QUALITY_PRESET_NAMES) {
        const preset = qualityPreset(name, settings);
        if (Object.keys(current).every(key => preset[key] === current[key])) return name;
    }
    return null;
}
