import test from "node:test";
import assert from "node:assert/strict";

import {currentDayTime, parseWorldTime, skyAngle, worldSunlight} from "../src/js/markers/WorldTime.js";
import {ENTITY_LIGHT, applyEntityShader, entityLight} from "../src/js/markers/EntityLighting.js";
import {WORLD_TIME_EVENT, WorldTimeLighting} from "../src/js/markers/WorldTimeLighting.js";
import {parsePlayersResponse} from "../src/js/markers/LivePlayerData.js";

const close = (actual, expected, eps = 1e-6) => assert.ok(Math.abs(actual - expected) < eps, `${actual} != ${expected}`);

test("skyAngle like vanilla DimensionType.getSkyAngle: noon 0, midnight 0.5, sunset/sunrise about 0.25/0.75", () => {
    close(skyAngle(6000), 0);
    close(skyAngle(18000), 0.5);
    close(skyAngle(12000), 0.2155, 0.001);
    close(skyAngle(0), 0.7845, 0.001);
});

test("worldSunlight like vanilla calculateAmbientDarkness: day 1, night 4/15, rain and thunder darker", () => {
    close(worldSunlight(6000), 1);
    close(worldSunlight(1000), 1);
    close(worldSunlight(18000), 4 / 15);
    // rain: darkness = (1 - 11/16) * 11
    close(worldSunlight(6000, 1, 0), (15 - (1 - 11 / 16) * 11) / 15);
    close(worldSunlight(6000, 1, 1), (15 - (1 - (11 / 16) ** 2) * 11) / 15);
    // the evening: between day and night, decreasing
    const evening = [12000, 12500, 13000, 13500].map(t => worldSunlight(t));
    for (let i = 1; i < evening.length; i++) assert.ok(evening[i] <= evening[i - 1]);
    assert.ok(evening[0] < 1 && evening[3] > 4 / 15 - 1e-9);
});

test("parseWorldTime validates and normalizes the world-object", () => {
    assert.equal(parseWorldTime(null), null);
    assert.equal(parseWorldTime({}), null);
    assert.equal(parseWorldTime({dayTime: "x"}), null);
    assert.deepEqual(parseWorldTime({dayTime: 25000, rain: 2, thunder: -1, cycle: false}),
        {dayTime: 1000, rain: 1, thunder: 0, cycle: false, moonPhase: 0});
    assert.deepEqual(parseWorldTime({dayTime: -1000}), {dayTime: 23000, rain: 0, thunder: 0, cycle: true, moonPhase: 0});
    assert.equal(parseWorldTime({dayTime: 0, moonPhase: 11}).moonPhase, 3);
    assert.equal(parseWorldTime({dayTime: 0, moonPhase: -1}).moonPhase, 7);
});

test("currentDayTime runs on with 20 ticks per second, stands still without the cycle", () => {
    assert.equal(currentDayTime({dayTime: 1000, cycle: true}, 10), 1200);
    assert.equal(currentDayTime({dayTime: 23990, cycle: true}, 1), 10);
    assert.equal(currentDayTime({dayTime: 1000, cycle: false}, 10), 1000);
});

test("players.json: the world-time is parsed (only for supported protocols)", () => {
    const world = {dayTime: 13000, rain: 0.5, thunder: 0, cycle: true, moonPhase: 4};
    assert.deepEqual(parsePlayersResponse({protocol: 1, players: [], world}).world, world);
    assert.equal(parsePlayersResponse({protocol: 1, players: []}).world, null);
    assert.equal(parsePlayersResponse({protocol: 99, players: [], world}).world, null);
});

test("entityLight follows the map-shader outdoors: mix(ambient, 1, sunlight)", () => {
    close(entityLight(1, 0), 1);
    close(entityLight(0.25, 0), 0.25);
    close(entityLight(0, 0.5), 0.5);
    close(entityLight(2, 0), 1);
});

test("applyEntityShader multiplies the color with the shared uniform after the output", () => {
    const material = {userData: {}};
    applyEntityShader(material, "gl_FragColor.rgb = vec3(1.0);", "test");
    const shader = {fragmentShader: "void main() {\n#include <output_fragment>\n}"};
    material.onBeforeCompile(shader);
    assert.equal(shader.uniforms.bmEntityLight, ENTITY_LIGHT);
    assert.match(shader.fragmentShader, /^uniform float bmEntityLight;/);
    assert.ok(shader.fragmentShader.indexOf("vec3(1.0)") < shader.fragmentShader.indexOf("*= bmEntityLight"));
    assert.equal(material.customProgramCacheKey(), "bluemap-live-entity-test");
});

test("WorldTimeLighting: sets the sunlight only when enabled and available, follows the running time", () => {
    const uniforms = {sunlightStrength: {value: 1}, ambientLight: {value: 0}};
    const state = {enabled: false, available: false};
    const events = new EventTarget();
    let now = 0, redraws = 0;
    const lighting = new WorldTimeLighting(uniforms, state, events, () => redraws++, () => now);
    try {
        events.dispatchEvent(new CustomEvent(WORLD_TIME_EVENT, {detail: {world: {dayTime: 18000, rain: 0, thunder: 0, cycle: true}}}));
        assert.equal(state.available, true);
        assert.equal(uniforms.sunlightStrength.value, 1); // not enabled: BlueMaps own lighting stays
        lighting.setEnabled(true);
        close(uniforms.sunlightStrength.value, 4 / 15);
        close(ENTITY_LIGHT.value, 4 / 15);
        assert.equal(redraws, 1);

        // 600 s later the cycle has run 12000 ticks: noon
        now = 600000;
        lighting.update();
        close(uniforms.sunlightStrength.value, 1);

        // the own switch / the slider: disabled, the value stays as set
        lighting.setEnabled(false);
        uniforms.sunlightStrength.value = 0.25;
        lighting.update();
        assert.equal(uniforms.sunlightStrength.value, 0.25);
        close(ENTITY_LIGHT.value, 0.25);

        // no world-time (nether, other map): not available
        events.dispatchEvent(new CustomEvent(WORLD_TIME_EVENT, {detail: {world: null}}));
        assert.equal(state.available, false);
    } finally {
        lighting.dispose();
        ENTITY_LIGHT.value = 1;
    }
});
