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
 * BlueMap Live: dynamic lights. Vanilla Minecraft has none; like the mod LambDynamicLights a player holding a
 * light-emitting item (the server sends its luminance, e.g. 14 for a torch) lights the map around them:
 * the block-light of the hires-map rises to (level - distance in blocks), see HiresFragmentShader.
 */

/** the number of lights the shader supports */
export const MAX_DYNAMIC_LIGHTS = 8;

/** vanilla PlayerEntity: the standing eye-height, the light is emitted from there */
export const LIGHT_HEIGHT = 1.62;

/**
 * The block-light at a position with the dynamic lights (the same formula as the shader).
 * @param blockLight {number} - the light of the map (0..15)
 * @param lights {Array<{x: number, y: number, z: number, level: number}>}
 */
export function dynamicBlockLight(blockLight, lights, x, y, z) {
    let light = blockLight;
    for (const l of lights.slice(0, MAX_DYNAMIC_LIGHTS)) {
        light = Math.max(light, Math.min(15, Math.max(0, l.level - Math.hypot(x - l.x, y - l.y, z - l.z))));
    }
    return light;
}

/**
 * The lights of the players: shown players that hold a light-emitting item, the nearest to the camera first.
 * @param markers {Iterable<object>} - player-markers
 * @param camera {{x: number, y: number, z: number} | null}
 * @returns {Array<{x: number, y: number, z: number, level: number}>}
 */
export function playerLights(markers, camera = null) {
    const lights = [];
    for (const marker of markers) {
        if (!marker.isPlayerMarker || marker.visible === false) continue;
        const data = marker.lastPlayerData;
        const level = data && data.equipment ? data.equipment.light : 0;
        if (!level || data.foreign) continue;
        const anchor = marker.anchor;
        lights.push({x: anchor.position.x, y: anchor.position.y + LIGHT_HEIGHT, z: anchor.position.z, level});
    }
    if (camera) lights.sort((a, b) => Math.hypot(a.x - camera.x, a.z - camera.z) - Math.hypot(b.x - camera.x, b.z - camera.z));
    return lights.slice(0, MAX_DYNAMIC_LIGHTS);
}

/**
 * BlueMap Live: the light-emitting block-previews (e.g. a placed torch, set by the EntityMarkerManager), lighting the
 * map until BlueMap rendered the tile with the block-light.
 * @type {{lights: Array<{x: number, y: number, z: number, level: number}>}}
 */
export const PREVIEW_LIGHTS = {lights: []};

/**
 * The lights of the players and the block-previews together, the nearest to the camera first (at most MAX_DYNAMIC_LIGHTS).
 * @param players {Array<{x: number, y: number, z: number, level: number}>}
 * @param previews {Array<{x: number, y: number, z: number, level: number}>}
 * @param camera {{x: number, y: number, z: number} | null}
 */
export function combineLights(players, previews, camera = null) {
    const lights = players.concat(previews);
    if (camera) lights.sort((a, b) => Math.hypot(a.x - camera.x, a.z - camera.z) - Math.hypot(b.x - camera.x, b.z - camera.z));
    return lights.slice(0, MAX_DYNAMIC_LIGHTS);
}

/**
 * Writes the lights into the map-uniforms.
 * @param uniforms {{dynamicLights: {value: Array<{set: function}>}, dynamicLightCount: {value: number}}}
 * @param lights {Array<{x: number, y: number, z: number, level: number}>}
 * @returns {boolean} true if something changed (the map has to be redrawn)
 */
export function applyDynamicLights(uniforms, lights) {
    if (!uniforms || !uniforms.dynamicLights) return false;
    let changed = uniforms.dynamicLightCount.value !== lights.length;
    lights.forEach((l, i) => {
        const v = uniforms.dynamicLights.value[i];
        if (v.x !== l.x || v.y !== l.y || v.z !== l.z || v.w !== l.level) changed = true;
        v.set(l.x, l.y, l.z, l.level);
    });
    uniforms.dynamicLightCount.value = lights.length;
    return changed;
}
