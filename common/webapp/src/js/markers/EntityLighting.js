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
 * The brightness of the live entities (players, mobs, items) like the map-lighting (BlueMap Live): the entity-materials
 * multiply their color with one shared uniform, so they get darker at night like the map
 * (map-shader: color * mix(ambientLight, 1, light / 15), outdoors light / 15 = sunlightStrength).
 * Emissive layers (eyes, the energy-swirl) are not patched and stay bright, like in vanilla.
 */

/** shared by all entity-materials */
export const ENTITY_LIGHT = {value: 1};

/**
 * @param sunlightStrength {number} - the map-uniform (0..1)
 * @param ambientLight {number} - the map-uniform (0..1)
 * @returns {number}
 */
export function entityLight(sunlightStrength, ambientLight) {
    const light = Math.min(1, Math.max(0, sunlightStrength));
    return ambientLight + (1 - ambientLight) * light;
}

/**
 * Patches a material: an optional overlay (e.g. the red hurt-overlay, before the light like vanilla), then the
 * entity-light.
 * @param material {import("three").Material}
 * @param overlay {string} - glsl applied to gl_FragColor before the light
 * @param key {string} - a unique name of the overlay (program-cache)
 * @returns {import("three").Material} the material
 */
export function applyEntityShader(material, overlay = "", key = "") {
    material.onBeforeCompile = shader => {
        shader.uniforms = shader.uniforms || {};
        shader.uniforms.bmEntityLight = ENTITY_LIGHT;
        shader.fragmentShader = "uniform float bmEntityLight;\n" + shader.fragmentShader.replace(
            "#include <output_fragment>",
            `#include <output_fragment>\n\t${overlay}\n\tgl_FragColor.rgb *= bmEntityLight;`
        );
    };
    material.customProgramCacheKey = () => "bluemap-live-entity-" + key;
    material.userData.entityLit = true;
    return material;
}
