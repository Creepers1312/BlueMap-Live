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
import {BufferGeometry, DataTexture, DoubleSide, Float32BufferAttribute, FloatType, Group, Mesh, MeshBasicMaterial,
    NearestFilter, RGBAFormat, Texture} from "three";
import {applyEntityShader} from "../EntityLighting.js";
import {ASSET_VERSION, MAX_ATTEMPTS, RETRY_INTERVAL} from "../player/ItemAssetCache.js";
import {blockAssetName, blockTint, buildHiddenTable, DEFAULT_LIGHT, isAir, previewParts, TABLE_SIZE} from "./BlockPreviewData.js";
import {MAX_DYNAMIC_LIGHTS} from "../DynamicLights.js";

/**
 * Lights a preview-material like the hires-tiles (HiresFragmentShader): the sky-light of the vertex with the
 * sunlight-strength, the block-light raised by the dynamic lights, then mix(ambientLight, 1, light / 15).
 * @param material {import("three").Material}
 * @param uniforms {{sunlightStrength: {value: number}, ambientLight: {value: number},
 *     dynamicLights: {value: Array}, dynamicLightCount: {value: number}}} - the map-uniforms
 * @returns {import("three").Material}
 */
export function applyPreviewLighting(material, uniforms) {
    material.onBeforeCompile = shader => {
        shader.uniforms.bmSunlight = uniforms.sunlightStrength;
        shader.uniforms.bmAmbient = uniforms.ambientLight;
        shader.uniforms.bmLights = uniforms.dynamicLights;
        shader.uniforms.bmLightCount = uniforms.dynamicLightCount;
        shader.vertexShader = "attribute vec2 bmLight;\nvarying vec2 vBmLight;\nvarying vec3 vBmWorld;\n" + shader.vertexShader.replace(
            "#include <project_vertex>",
            "#include <project_vertex>\n\tvBmLight = bmLight;\n\tvBmWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;"
        );
        shader.fragmentShader = `uniform float bmSunlight;
uniform float bmAmbient;
uniform vec4 bmLights[${MAX_DYNAMIC_LIGHTS}];
uniform int bmLightCount;
varying vec2 vBmLight;
varying vec3 vBmWorld;
` + shader.fragmentShader.replace("#include <output_fragment>", `#include <output_fragment>
	float bmBlock = vBmLight.y;
	for (int i = 0; i < ${MAX_DYNAMIC_LIGHTS}; i++) {
		if (i >= bmLightCount) break;
		bmBlock = max(bmBlock, clamp(bmLights[i].w - length(vBmWorld - bmLights[i].xyz), 0.0, 15.0));
	}
	float bmLightLevel = mix(bmBlock, max(vBmLight.x, bmBlock), bmSunlight);
	gl_FragColor.rgb *= mix(bmAmbient, 1.0, bmLightLevel / 15.0);`);
    };
    material.customProgramCacheKey = () => "bluemap-live-block-preview-lit";
    return material;
}

/**
 * The depth-bias of the previews (in the units of the logarithmic depth, i.e. relative to the distance: about 0.02 %).
 * BlueMaps renderer uses a logarithmic depth-buffer, the shaders write gl_FragDepth and polygonOffset has no effect:
 * without the bias, the faces of a preview that lie on faces of the tile flicker (z-fighting).
 */
export const PREVIEW_DEPTH_BIAS = 1e-5;

/**
 * Draws a material a bit in front of coplanar faces (see PREVIEW_DEPTH_BIAS), after its other shader-patches.
 * @param material {import("three").Material}
 * @returns {import("three").Material}
 */
export function applyDepthBias(material) {
    const patch = material.onBeforeCompile;
    material.onBeforeCompile = (shader, renderer) => {
        if (patch) patch.call(material, shader, renderer);
        shader.fragmentShader = shader.fragmentShader.replace("#include <logdepthbuf_fragment>", `#include <logdepthbuf_fragment>
#if defined( USE_LOGDEPTHBUF ) && defined( USE_LOGDEPTHBUF_EXT )
	gl_FragDepthEXT = max(0.0, gl_FragDepthEXT - ${PREVIEW_DEPTH_BIAS.toExponential()});
#endif`);
    };
    const key = material.customProgramCacheKey;
    material.customProgramCacheKey = () => key.call(material) + "-depth-bias";
    return material;
}

/**
 * The previews whose old block is hidden in the tiles: removed blocks, and changed blocks whose new block is drawn
 * (otherwise the tile keeps the old block, e.g. for liquids without a preview or while the model is loading,
 * instead of a hole that flickers).
 * @param previews {Iterable<{state: string}>}
 * @param drawnStates {Set<string>}
 */
export function hiddenPreviews(previews, drawnStates) {
    return [...previews].filter(preview => isAir(preview.state) || drawnStates.has(preview.state));
}

/**
 * The light-emitting previews (e.g. a placed torch) as dynamic lights, until the tile with the block-light is rendered.
 * @param previews {Iterable<{x: number, y: number, z: number, state: string, light: {luminance: number} | null}>}
 * @returns {Array<{x: number, y: number, z: number, level: number}>}
 */
export function previewLights(previews) {
    const lights = [];
    for (const preview of previews) {
        if (!preview.light || preview.light.luminance <= 0 || isAir(preview.state)) continue;
        lights.push({x: preview.x + 0.5, y: preview.y + 0.5, z: preview.z + 0.5, level: preview.light.luminance});
    }
    return lights;
}

/*
 * Draws the previews of changed blocks (BlueMap Live, see BlockPreviewData.js) and hides the old blocks in the tiles
 * (the hidden-block table of the hires-shader).
 */

const QUAD = 23;

/** vanilla face-shading of block-models (up, down, north/south, east/west), like the item-models */
function shade(nx, ny, nz) {
    const ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz);
    if (ay >= ax && ay >= az) return ny > 0 ? 1 : 0.5;
    if (az >= ax) return 0.8;
    return 0.6;
}

/**
 * Loads the block-assets (assets/blocks/<state>.json, created by the server when a change is shown) and their textures.
 */
export class BlockAssetCache {

    /**
     * @param baseUrl {string | null} - assets/blocks/ of the map
     * @param onChange {function()} - called when an asset was loaded
     */
    constructor(baseUrl, onChange = () => {}) {
        this.baseUrl = baseUrl;
        this.onChange = onChange;
        this.entries = new Map();
        this.disposed = false;
    }

    /** @returns {{state: string, status: string, data: object | null, textures: Texture[], attempts: number, failedAt: number}} */
    get(state) {
        let entry = this.entries.get(state);
        if (!entry) {
            entry = {state, status: "loading", data: null, textures: [], attempts: 0, failedAt: 0};
            this.entries.set(state, entry);
            this.load(entry);
        } else if (entry.status === "failed" && entry.attempts < MAX_ATTEMPTS && Date.now() - entry.failedAt > RETRY_INTERVAL) {
            entry.status = "loading";
            this.load(entry);
        }
        return entry;
    }

    /** if the block is a full cube, null while unknown */
    isFull(state) {
        const entry = this.get(state);
        return entry.status === "loaded" ? entry.data.full === true : null;
    }

    /** @private */
    load(entry) {
        entry.attempts++;
        if (!this.baseUrl) return this.failed(entry);
        fetch(`${this.baseUrl}${blockAssetName(entry.state)}.json?v=${ASSET_VERSION}`)
            .then(response => response.ok ? response.json() : Promise.reject(response.status))
            .then(data => {
                if (this.disposed) return;
                if (!data || !Array.isArray(data.quads) || !Array.isArray(data.textures)) throw new Error("Invalid block-asset");
                return Promise.all(data.textures.slice(0, 64).map(url => loadTexture(url))).then(textures => {
                    if (this.disposed) {
                        textures.forEach(t => t && t.dispose());
                        return;
                    }
                    entry.data = data;
                    entry.textures = textures;
                    entry.animations = textures.map((texture, i) => {
                        const animation = parseAnimation(Array.isArray(data.animations) ? data.animations[i] : null);
                        // one frame of the vertical strip (flipY: the first frame is at the top)
                        if (animation && texture) texture.repeat.set(1, 1 / animation.frames);
                        return animation;
                    });
                    entry.animations.forEach((animation, i) => animation && textures[i] && setFrame(textures[i], animation, 0));
                    entry.status = "loaded";
                    this.onChange();
                });
            })
            .catch(() => this.failed(entry));
    }

    /** @private */
    failed(entry) {
        if (this.disposed) return;
        entry.status = "failed";
        entry.failedAt = Date.now();
    }

    dispose() {
        this.disposed = true;
        this.entries.forEach(entry => entry.textures.forEach(t => t && t.dispose()));
        this.entries.clear();
    }

}

/**
 * @param value {any} - an entry of the "animations" of a block-asset
 * @returns {{frames: number, frametime: number, order: number[] | null} | null}
 */
export function parseAnimation(value) {
    if (!value || typeof value !== "object" || !Number.isInteger(value.frames) || value.frames < 2 || value.frames > 1024) return null;
    const frametime = Number.isInteger(value.frametime) && value.frametime > 0 ? value.frametime : 1;
    const order = Array.isArray(value.order) && value.order.length > 0 && value.order.every(f => Number.isInteger(f) && f >= 0 && f < value.frames) ?
        value.order : null;
    return {frames: value.frames, frametime, order};
}

/**
 * The frame of an animation at a tick, like vanilla (frametime ticks per frame, in the order of the .mcmeta)
 * @returns {number}
 */
export function animationFrame(animation, ticks) {
    const step = Math.floor(ticks / animation.frametime);
    return animation.order ? animation.order[step % animation.order.length] : step % animation.frames;
}

function setFrame(texture, animation, frame) {
    texture.offset.y = 1 - (frame + 1) / animation.frames;
}

function loadTexture(url) {
    if (typeof Image === "undefined" || typeof url !== "string" || !url.startsWith("data:image/png;base64,")) return Promise.resolve(null);
    return new Promise(resolve => {
        const image = new Image();
        image.onload = () => {
            const texture = new Texture(image);
            texture.magFilter = texture.minFilter = NearestFilter;
            texture.generateMipmaps = false;
            texture.flipY = true;
            texture.needsUpdate = true;
            resolve(texture);
        };
        image.onerror = () => resolve(null);
        image.src = url;
    });
}

/** [axis, value] of the block-sides by cullface-code (1..6: down, up, north, south, west, east) */
const SIDES = [null, [1, 0], [1, 1], [2, 0], [2, 1], [0, 0], [0, 1]];

/** if all corners of a quad lie on a side of the block (a face without cullface that is still on the block-border) */
export function onSide(quads, o, code) {
    const [axis, value] = SIDES[code];
    for (let c = 0; c < 4; c++) if (Math.abs(quads[o + c * 3 + axis] - value) > 1e-4) return false;
    return true;
}

/**
 * The geometry of the parts of the previews that use one texture of one block-asset.
 * @param quads {number[]} - the quads of the asset (23 values each)
 * @param texture {number}
 * @param placements {Array<{x: number, y: number, z: number, cullface: number | null, skip: number[]}>}
 * @param tint {number} - rgb
 * @returns {BufferGeometry | null}
 */
export function buildPreviewGeometry(quads, texture, placements, tint) {
    const positions = [], uvs = [], colors = [], lights = [];
    const tr = ((tint >> 16) & 255) / 255, tg = ((tint >> 8) & 255) / 255, tb = (tint & 255) / 255;
    const count = Math.floor(quads.length / QUAD);
    for (const placement of placements) {
        for (let q = 0; q < count; q++) {
            const o = q * QUAD;
            if (quads[o + 20] !== texture) continue;
            const cullface = quads[o + 22];
            if (placement.cullface !== null && cullface !== placement.cullface &&
                (cullface !== 0 || !onSide(quads, o, placement.cullface))) continue;
            if (cullface !== 0 && placement.skip.includes(cullface)) continue;
            const p = c => [quads[o + c * 3] + placement.x, quads[o + c * 3 + 1] + placement.y, quads[o + c * 3 + 2] + placement.z];
            const [a, b, c] = [p(0), p(1), p(2)];
            const nx = (b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]);
            const ny = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
            const nz = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
            const s = shade(nx, ny, nz);
            const tinted = quads[o + 21] >= 0;
            for (const corner of [0, 1, 2, 0, 2, 3]) {
                positions.push(...p(corner));
                uvs.push(quads[o + 12 + corner * 2], 1 - quads[o + 12 + corner * 2 + 1]);
                colors.push(s * (tinted ? tr : 1), s * (tinted ? tg : 1), s * (tinted ? tb : 1));
                // sky- and block-light like the vertices of the hires-tiles (see previewMaterialShader)
                const light = placement.light || DEFAULT_LIGHT;
                lights.push(light.sky, light.block);
            }
        }
    }
    if (positions.length === 0) return null;
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
    geometry.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
    geometry.setAttribute("color", new Float32BufferAttribute(colors, 3));
    geometry.setAttribute("bmLight", new Float32BufferAttribute(lights, 2));
    return geometry;
}

export class BlockPreviewView {

    /**
     * @param store {import("./BlockPreviewData.js").PreviewStore}
     * @param assets {BlockAssetCache}
     */
    constructor(store, assets, uniforms = null) {
        this.store = store;
        this.assets = assets;
        /** @type {function(): object | null} the map-uniforms (light like the tiles), null: lit like the entities */
        this.uniforms = typeof uniforms === "function" ? uniforms : () => uniforms;
        /** the light-emitting previews (see previewLights) */
        this.lights = [];
        this.group = new Group();
        this.group.userData.noCss2d = true; // see CSS2DRenderer
        this.group.name = "bm-live-block-previews";
        this.meshes = [];
        this.materials = new Map();
        this.builtVersion = -1;
        this.assetsChanged = false;
        this.table = new Float32Array(TABLE_SIZE * TABLE_SIZE * 4);
        this.hiddenTexture = null;
        this.hiddenCount = 0;
        /** the block-states that are drawn */
        this.drawnStates = new Set();
    }

    /**
     * Shows the current frame of the animated textures (e.g. fire).
     * @param timeMs {number}
     * @returns {boolean} if an animated texture is drawn (needs a redraw)
     */
    animate(timeMs) {
        let animated = false;
        const ticks = Math.floor(timeMs / 50);
        for (const state of this.drawnStates) {
            const entry = this.assets.entries.get(state);
            if (!entry || !entry.animations) continue;
            entry.animations.forEach((animation, i) => {
                if (!animation || !entry.textures[i]) return;
                setFrame(entry.textures[i], animation, animationFrame(animation, ticks));
                animated = true;
            });
        }
        return animated;
    }

    /** an asset was loaded: the meshes are built again */
    invalidate() {
        this.assetsChanged = true;
    }

    /**
     * Builds the meshes and the hidden-block table again if the previews (or their assets) changed.
     * @returns {boolean} if something changed (needs a redraw)
     */
    update() {
        if (this.builtVersion === this.store.version && !this.assetsChanged) return false;
        this.builtVersion = this.store.version;
        this.assetsChanged = false;
        this.clearMeshes();
        this.lights = previewLights(this.store.previews.values());

        // the parts of all previews, grouped by block-state
        const byState = new Map();
        this.store.previews.forEach(preview => {
            for (const part of previewParts(preview, this.store, state => this.assets.isFull(state))) {
                if (!byState.has(part.state)) byState.set(part.state, []);
                byState.get(part.state).push(part);
            }
        });
        this.drawnStates = new Set();
        byState.forEach((placements, state) => {
            const entry = this.assets.get(state);
            if (entry.status !== "loaded") return;
            // a model without faces (e.g. vanilla water and lava, drawn by the renderer itself) is no preview
            if (!entry.data.quads || entry.data.quads.length === 0) return;
            this.drawnStates.add(state);
            entry.textures.forEach((texture, index) => {
                if (!texture) return;
                const geometry = buildPreviewGeometry(entry.data.quads, index, placements, blockTint(state));
                if (!geometry) return;
                const mesh = new Mesh(geometry, this.material(texture));
                mesh.raycast = () => {};
                this.meshes.push(mesh);
                this.group.add(mesh);
            });
        });

        // the old blocks in the tiles
        this.hiddenCount = buildHiddenTable(hiddenPreviews(this.store.previews.values(), this.drawnStates), this.table);
        if (this.hiddenTexture) this.hiddenTexture.needsUpdate = true;
        return true;
    }

    /** @private one material per texture */
    material(texture) {
        let material = this.materials.get(texture);
        if (!material) {
            // drawn a bit in front of the tile (the same faces can be in the tile, e.g. the neighbor-faces): applyDepthBias,
            // polygonOffset only helps without the logarithmic depth-buffer
            material = new MeshBasicMaterial({map: texture, vertexColors: true, alphaTest: 0.1,
                transparent: true, side: DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2});
            const uniforms = this.uniforms();
            // lit like the tiles (sky-, block- and dynamic light), without the map-uniforms like the entities
            if (uniforms && uniforms.dynamicLights) applyPreviewLighting(material, uniforms);
            else applyEntityShader(material, "", "block-preview");
            applyDepthBias(material);
            this.materials.set(texture, material);
        }
        return material;
    }

    /**
     * The hidden-block table for the hires-shader.
     * @param uniforms {{hiddenBlocks: {value: Texture | null}, hiddenBlockCount: {value: number}} | null}
     */
    applyHiddenBlocks(uniforms) {
        if (!uniforms || !uniforms.hiddenBlocks) return;
        if (!this.hiddenTexture) {
            this.hiddenTexture = new DataTexture(this.table, TABLE_SIZE, TABLE_SIZE, RGBAFormat, FloatType);
            this.hiddenTexture.magFilter = this.hiddenTexture.minFilter = NearestFilter;
            this.hiddenTexture.generateMipmaps = false;
            this.hiddenTexture.needsUpdate = true;
        }
        uniforms.hiddenBlocks.value = this.hiddenTexture;
        uniforms.hiddenBlockCount.value = this.hiddenCount;
    }

    /** @private */
    clearMeshes() {
        for (const mesh of this.meshes) {
            this.group.remove(mesh);
            mesh.geometry.dispose();
        }
        this.meshes = [];
    }

    dispose() {
        this.clearMeshes();
        this.materials.forEach(material => material.dispose());
        this.materials.clear();
        if (this.hiddenTexture) this.hiddenTexture.dispose();
        if (this.group.parent) this.group.parent.remove(this.group);
    }

}
