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

import {skyAngle} from "../markers/WorldTime.js";

/*
 * BlueMap Live: the sky and the weather of the live world-time mode (sun, moon, stars, clouds, rain, snow, lightning),
 * see docs/bluemap-live/phase-13.md. No three.js, so it can be unit-tested with node.
 */

/** the textures (provided by the server like the particle-textures, see the java LiveWorldTime.TEXTURES) */
export const WEATHER_TEXTURES = {
    sun: "minecraft:environment/sun",
    moon: "minecraft:environment/moon_phases",
    clouds: "minecraft:environment/clouds",
    rain: "minecraft:environment/rain",
    snow: "minecraft:environment/snow",
};

/** vanilla WorldRenderer.renderSky: half the size of the sun-quad (30) and the moon-quad (20), both 100 away */
export const SKY_DISTANCE = 100;
export const SUN_SIZE = 30;
export const MOON_SIZE = 20;

/** vanilla: the clouds of the overworld are at y 192, one pixel of clouds.png is 12 blocks, they move 0.03 blocks per tick */
export const CLOUD_HEIGHT = 192;
export const CLOUD_SCALE = 12;
export const CLOUD_SPEED = 0.03;

const TAU = Math.PI * 2;
const clamp01 = value => Math.min(1, Math.max(0, value));

/**
 * The direction of the sun (the moon is opposite), vanilla renderSky: rotated by -90 degrees around y, then by the
 * sky-angle around x; noon is straight up, the sun rises in the east (+x) and sets in the west.
 * @param dayTime {number}
 * @returns {{x: number, y: number, z: number}}
 */
export function sunDirection(dayTime) {
    const angle = skyAngle(dayTime) * TAU;
    return {x: -Math.sin(angle), y: Math.cos(angle), z: 0};
}

/**
 * vanilla World.getStarBrightness, multiplied by (1 - rain) like renderSky
 * @param dayTime {number}
 * @param rain {number} 0..1
 * @returns {number} 0..0.5
 */
export function starBrightness(dayTime, rain = 0) {
    const g = clamp01(1 - (Math.cos(skyAngle(dayTime) * TAU) * 2 + 0.25));
    return g * g * 0.5 * (1 - rain);
}

/**
 * The part of moon_phases.png for a moon-phase (vanilla: 4 columns, 2 rows; v from the top).
 * @param phase {number} 0..7
 * @returns {{u0: number, v0: number, u1: number, v1: number}}
 */
export function moonUv(phase) {
    const column = phase % 4, row = Math.floor(phase / 4) % 2;
    return {u0: column / 4, v0: row / 2, u1: (column + 1) / 4, v1: (row + 1) / 2};
}

/**
 * The brightness of the clouds (0..1, like the sky: bright at day, dark at night, darker in rain and thunder).
 * Modelled on vanilla World.getCloudsColor, not exact.
 * @param dayTime {number}
 * @param rain {number}
 * @param thunder {number}
 * @returns {number}
 */
export function cloudBrightness(dayTime, rain = 0, thunder = 0) {
    const day = clamp01(Math.cos(skyAngle(dayTime) * TAU) * 2 + 0.5);
    let brightness = day * 0.9 + 0.1;
    brightness *= 1 - rain * 0.4;
    brightness *= 1 - thunder * 0.5;
    return brightness;
}

/**
 * How far the clouds moved west (blocks) after some ticks of the world-time (vanilla uses the ticks of the client,
 * so the clouds are not at the same place as in the game).
 * @param ticks {number}
 * @returns {number}
 */
export function cloudOffset(ticks) {
    return (ticks * CLOUD_SPEED) % (256 * CLOUD_SCALE);
}

/**
 * The opacity of the clouds: like vanilla (0.8) seen from below, see-through from above (the map stays visible).
 * @param cameraY {number}
 * @returns {number}
 */
export function cloudOpacity(cameraY) {
    if (cameraY <= CLOUD_HEIGHT) return 0.8;
    // from above: fades from 0.8 to 0.3 within 64 blocks, then stays (the map below the clouds is still seen)
    return 0.8 - 0.5 * clamp01((cameraY - CLOUD_HEIGHT) / 64);
}

/**
 * The precipitation at the place the camera looks at: the biome-precipitation (status of the live players) of the
 * nearest player, rain if unknown.
 * @param players {Array<{x: number, z: number, precipitation: string | null}>}
 * @param position {{x: number, z: number}}
 * @returns {"rain" | "snow" | "none"}
 */
export function precipitationAt(players, position) {
    let best = null, bestDistance = Infinity;
    for (const player of players) {
        if (!player.precipitation) continue;
        const d = (player.x - position.x) ** 2 + (player.z - position.z) ** 2;
        if (d < bestDistance) {
            bestDistance = d;
            best = player.precipitation;
        }
    }
    return best || "rain";
}

/**
 * The box around the point the camera looks at in which the drops fall: like vanilla (10 blocks) close to the
 * ground, larger when the camera is further away (so the rain is seen from the map-view as well).
 * @param distance {number} - the distance of the camera to the point it looks at
 * @returns {{radius: number, height: number, dropSize: number}}
 */
export function precipitationBox(distance) {
    const radius = Math.min(400, Math.max(10, distance));
    return {radius, height: radius * 2, dropSize: radius / 10};
}

/**
 * The drops directly around the camera (like vanilla, which draws the rain only around the camera): they fill the
 * whole view, only while the camera is below the clouds.
 * @param cameraY {number}
 * @returns {{radius: number, height: number, dropSize: number} | null} null: above the clouds, no drops around it
 */
export function cameraPrecipitationBox(cameraY) {
    if (cameraY > CLOUD_HEIGHT) return null;
    return {radius: 16, height: 32, dropSize: 2};
}

/** vanilla: rain falls with ~ 0.5 blocks per tick (fast), snow slowly */
export const FALL_SPEED = {rain: 10, snow: 1.5};

/**
 * Lightning-flashes during a thunderstorm (the server sends no lightning-bolts): a flash every 4..16 seconds.
 * vanilla: the sky lights up when a lightning-bolt strikes (World.lightningTicksLeft).
 * @param random {function(): number}
 * @returns {number} seconds until the next flash
 */
export function nextLightningDelay(random = Math.random) {
    return 4 + random() * 12;
}

/**
 * The brightness-boost of a flash (vanilla: the sky is lit for 2 ticks and flickers), 0 when over.
 * @param age {number} - seconds since the flash
 * @returns {number} 0..1
 */
export function lightningFlash(age) {
    if (age < 0 || age > 0.45) return 0;
    if (age < 0.1) return 1;
    if (age < 0.18) return 0.3;
    if (age < 0.25) return 0.8;
    return 0.8 * (1 - (age - 0.25) / 0.2);
}

/**
 * The stars: like vanilla 1500 attempts of random points in a cube, kept inside the unit-sphere (not too close to
 * the center), 100 away, size 0.15..0.25 (vanilla uses java-random with seed 10842; the positions here differ).
 * @param seed {number}
 * @returns {Array<{x: number, y: number, z: number, size: number, rotation: number}>}
 */
export function generateStars(seed = 10842) {
    let state = seed >>> 0;
    const random = () => {
        // mulberry32
        state = (state + 0x6D2B79F5) >>> 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const stars = [];
    for (let i = 0; i < 1500; i++) {
        const x = random() * 2 - 1, y = random() * 2 - 1, z = random() * 2 - 1;
        const size = 0.15 + random() * 0.1;
        const length2 = x * x + y * y + z * z;
        const rotation = random() * TAU;
        if (length2 >= 1 || length2 <= 0.01) continue;
        const scale = SKY_DISTANCE / Math.sqrt(length2);
        stars.push({x: x * scale, y: y * scale, z: z * scale, size, rotation});
    }
    return stars;
}
