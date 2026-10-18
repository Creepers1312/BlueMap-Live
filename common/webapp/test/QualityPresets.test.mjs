import {test} from "node:test";
import assert from "node:assert/strict";

import {currentQualityPreset, qualityPreset} from "../src/js/QualityPresets.js";

const SETTINGS = {hiresSliderMin: 0, hiresSliderMax: 200, hiresSliderDefault: 100, lowresSliderMin: 500, lowresSliderMax: 7000, lowresSliderDefault: 2000};

test("quality-presets: values clamped to the slider-ranges of the map, the defaults for balanced", () => {
    assert.deepEqual(qualityPreset("performance", SETTINGS),
        {superSampling: 0.5, hires: 60, lowres: 1000, fpsLimit: 30, entityDistance: 150, particles: false});
    assert.equal(qualityPreset("balanced", SETTINGS).hires, 100);
    assert.equal(qualityPreset("beautiful", SETTINGS).hires, 200, "clamped to hiresSliderMax");
    assert.equal(qualityPreset("evil", SETTINGS), null);
    assert.equal(qualityPreset("beautiful", {}).lowres, 5000, "settings without slider-ranges");
});

test("quality-presets: the active preset is recognized, changed settings match none", () => {
    const current = {...qualityPreset("beautiful", SETTINGS)};
    assert.equal(currentQualityPreset(current, SETTINGS), "beautiful");
    current.fpsLimit = 60;
    assert.equal(currentQualityPreset(current, SETTINGS), null);
});
