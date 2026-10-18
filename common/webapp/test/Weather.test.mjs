import {test} from "node:test";
import assert from "node:assert/strict";

import {
    cloudBrightness, cloudOffset, cloudOpacity, generateStars, lightningFlash, moonUv, nextLightningDelay,
    precipitationAt, precipitationBox, cameraPrecipitationBox, starBrightness, sunDirection
} from "../src/js/weather/WeatherData.js";

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test("weather: the sun rises in the east, is straight up at noon and sets in the west (vanilla renderSky)", () => {
    const sunrise = sunDirection(0), noon = sunDirection(6000), sunset = sunDirection(12000), midnight = sunDirection(18000);
    assert.ok(sunrise.x > 0.95 && Math.abs(sunrise.y) < 0.3, JSON.stringify(sunrise));
    close(noon.y, 1);
    assert.ok(sunset.x < -0.95, JSON.stringify(sunset));
    close(midnight.y, -1, 1e-6); // the moon (opposite) is straight up
});

test("weather: stars only at night (vanilla getStarBrightness, max 0.5), not in the rain", () => {
    close(starBrightness(6000), 0);
    close(starBrightness(18000), 0.5);
    close(starBrightness(18000, 1), 0);
    assert.ok(starBrightness(13000) > 0 && starBrightness(13000) < 0.5);
    const stars = generateStars();
    assert.ok(stars.length > 600 && stars.length < 1500, "points inside the sphere of 1500 attempts: " + stars.length);
    stars.forEach(star => close(Math.hypot(star.x, star.y, star.z), 100, 1e-6));
    assert.deepEqual(generateStars()[0], stars[0], "the same sky for every viewer");
});

test("weather: the parts of moon_phases.png (4 x 2)", () => {
    assert.deepEqual(moonUv(0), {u0: 0, v0: 0, u1: 0.25, v1: 0.5});
    assert.deepEqual(moonUv(5), {u0: 0.25, v0: 0.5, u1: 0.5, v1: 1});
});

test("weather: clouds darker at night and in storms, moving west, see-through from above", () => {
    assert.ok(cloudBrightness(6000) > 0.95);
    assert.ok(cloudBrightness(18000) < 0.2);
    assert.ok(cloudBrightness(6000, 1, 1) < cloudBrightness(6000, 1, 0));
    close(cloudOffset(100), 3);
    close(cloudOffset(256 * 12 / 0.03), 0, 1e-6);
    assert.equal(cloudOpacity(100), 0.8);
    close(cloudOpacity(192 + 64), 0.3);
    close(cloudOpacity(5000), 0.3);
});

test("weather: precipitation of the nearest player with a status, rain if unknown; the box grows with the distance", () => {
    const players = [{x: 0, z: 0, precipitation: "snow"}, {x: 100, z: 0, precipitation: "none"}, {x: 50, z: 0, precipitation: null}];
    assert.equal(precipitationAt(players, {x: 10, z: 0}), "snow");
    assert.equal(precipitationAt(players, {x: 90, z: 0}), "none");
    assert.equal(precipitationAt([], {x: 0, z: 0}), "rain");
    assert.deepEqual(precipitationBox(0), {radius: 10, height: 20, dropSize: 1});
    assert.equal(precipitationBox(200).radius, 200);
    assert.equal(precipitationBox(1500).radius, 400);
    // around the camera: only below the clouds
    assert.deepEqual(cameraPrecipitationBox(100), {radius: 16, height: 32, dropSize: 2});
    assert.equal(cameraPrecipitationBox(300), null);
});

test("weather: lightning-flashes every 4..16 seconds, a short flicker", () => {
    assert.equal(nextLightningDelay(() => 0), 4);
    assert.equal(nextLightningDelay(() => 1), 16);
    assert.equal(lightningFlash(0.05), 1);
    assert.ok(lightningFlash(0.15) < lightningFlash(0.2));
    assert.equal(lightningFlash(0.5), 0);
    assert.equal(lightningFlash(-1), 0);
});
