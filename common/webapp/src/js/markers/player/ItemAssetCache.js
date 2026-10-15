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

import {BufferGeometry, Float32BufferAttribute, FrontSide, MeshBasicMaterial, NearestFilter, Texture} from "three";
import {createSkinBoxGeometry} from "./PlayerModelGeometry.js";

/*
 * Loads the item-assets (baked item-models, see the java ItemModelBaker and docs/bluemap-live/phase-4.md) and shares
 * their geometries, textures and materials between all players that hold the same item (reference-counted).
 */

/** a missing asset (the server creates it when the item is first seen) is requested again after this time */
export const RETRY_INTERVAL = 2000;
export const MAX_ATTEMPTS = 15;

const QUAD_STRIDE = 22;

/** vanilla face-shading of block-models (up, down, north/south, east/west) */
function shade(nx, ny, nz) {
    const ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz);
    if (ay >= ax && ay >= az) return ny > 0 ? 1 : 0.5;
    if (az >= ax) return 0.8;
    return 0.6;
}

/**
 * Builds one geometry per texture from the quads of a baked model.
 * @param quads {number[]} - flat: per quad 4 positions (xyz, block-units), 4 uvs (v = 0 at the top), texture, tint
 * @returns {Map<number, BufferGeometry>} texture-index -> geometry
 */
export function buildQuadGeometries(quads) {
    const byTexture = new Map();
    const count = Math.floor(quads.length / QUAD_STRIDE);
    for (let q = 0; q < count; q++) {
        const texture = quads[q * QUAD_STRIDE + 20];
        if (!byTexture.has(texture)) byTexture.set(texture, []);
        byTexture.get(texture).push(q);
    }

    const geometries = new Map();
    for (const [texture, quadIndices] of byTexture) {
        const positions = new Float32Array(quadIndices.length * 18);
        const uvs = new Float32Array(quadIndices.length * 12);
        const normals = new Float32Array(quadIndices.length * 18);
        const colors = new Float32Array(quadIndices.length * 18);

        quadIndices.forEach((q, i) => {
            const o = q * QUAD_STRIDE;
            const p = c => [quads[o + c * 3], quads[o + c * 3 + 1], quads[o + c * 3 + 2]];
            const uv = c => [quads[o + 12 + c * 2], 1 - quads[o + 12 + c * 2 + 1]]; // flipY-textures: v = 0 at the bottom

            // face-normal (right-handed: corners are counter-clockwise seen from outside)
            const [a, b, c] = [p(0), p(1), p(2)];
            let nx = (b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]);
            let ny = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
            let nz = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
            const length = Math.hypot(nx, ny, nz) || 1;
            nx /= length; ny /= length; nz /= length;
            const s = shade(nx, ny, nz);

            [0, 1, 2, 0, 2, 3].forEach((corner, v) => {
                const pos = p(corner), t = uv(corner);
                positions.set(pos, i * 18 + v * 3);
                uvs.set(t, i * 12 + v * 2);
                normals.set([nx, ny, nz], i * 18 + v * 3);
                colors.set([s, s, s], i * 18 + v * 3);
            });
        });

        const geometry = new BufferGeometry();
        geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
        geometry.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
        geometry.setAttribute("normal", new Float32BufferAttribute(normals, 3));
        geometry.setAttribute("color", new Float32BufferAttribute(colors, 3));
        geometries.set(texture, geometry);
    }
    return geometries;
}

/**
 * The shield (an entity-model in vanilla, ShieldEntityModel): plate and handle on the 64x64 shield-texture.
 * Positions in pixels, already converted like the vanilla renderer does (scale 1, -1, -1).
 * @returns {Array<{geometry: BufferGeometry, position: number[]}>}
 */
export function buildShieldGeometries() {
    return [
        {geometry: createSkinBoxGeometry([12, 22, 1], [0, 0]), position: [0, 0, 1.5]},
        {geometry: createSkinBoxGeometry([2, 6, 6], [26, 0]), position: [0, 0, -2]},
    ];
}

/**
 * @typedef ItemModel {{
 *     type: "quads" | "shield",
 *     predicate: object | null,
 *     display: {right: object | null, left: object | null},
 *     parts: Array<{geometry: BufferGeometry, material: MeshBasicMaterial, position: number[] | null, scale: number}>
 * }}
 *
 * @typedef ItemEntry {{
 *     id: string,
 *     url: string,
 *     refs: number,
 *     state: "loading" | "loaded" | "failed",
 *     attempts: number,
 *     failedAt: number,
 *     models: ItemModel[],
 *     textures: Texture[],
 *     listeners: Set<function(ItemEntry)>
 * }}
 */

export class ItemAssetCache {

    /**
     * @param baseUrl {string | null} - the url-prefix of the item-assets (assets/items/), null: no items are loaded
     * @param loadJson {function(string): Promise<any>} - replaceable for tests
     * @param loadImage {function(string): Promise<any>} - replaceable for tests
     * @param now {function(): number} - replaceable for tests
     */
    constructor(baseUrl, loadJson = ItemAssetCache.loadJson, loadImage = ItemAssetCache.loadImage, now = Date.now) {
        this.baseUrl = baseUrl;
        this.loadJson = loadJson;
        this.loadImage = loadImage;
        this.now = now;

        /** @type {Map<string, ItemEntry>} */
        this.entries = new Map();
        this.disposed = false;
    }

    /**
     * @param itemId {string} - a validated item-id (see LivePlayerData.parseItem)
     * @returns {ItemEntry}
     */
    acquire(itemId) {
        let entry = this.entries.get(itemId);
        if (!entry) {
            const [namespace, path] = itemId.split(":");
            entry = {
                id: itemId,
                url: this.baseUrl ? `${this.baseUrl}${namespace}/${path}.json` : null,
                refs: 0,
                state: "loading",
                attempts: 0,
                failedAt: 0,
                models: [],
                textures: [],
                listeners: new Set(),
            };
            this.entries.set(itemId, entry);
            this.load(entry);
        }
        entry.refs++;
        return entry;
    }

    /**
     * Requests a missing asset again if enough time passed (called by the users of the entry, no own timer).
     * @param entry {ItemEntry}
     */
    retry(entry) {
        if (entry.state !== "failed" || entry.attempts >= MAX_ATTEMPTS) return;
        if (this.now() - entry.failedAt < RETRY_INTERVAL) return;
        entry.state = "loading";
        this.load(entry);
    }

    /**
     * @param entry {ItemEntry | null}
     */
    release(entry) {
        if (!entry) return;
        entry.refs--;
        if (entry.refs <= 0) {
            entry.listeners.clear();
            this.disposeEntry(entry);
            if (this.entries.get(entry.id) === entry) this.entries.delete(entry.id);
        }
    }

    dispose() {
        this.disposed = true;
        this.entries.forEach(entry => this.disposeEntry(entry));
        this.entries.clear();
    }

    /** @private */
    load(entry) {
        entry.attempts++;
        if (!entry.url) {
            this.setFailed(entry);
            return;
        }
        this.loadJson(entry.url)
            .then(asset => this.buildEntry(entry, asset))
            .catch(() => this.setFailed(entry));
    }

    /** @private */
    async buildEntry(entry, asset) {
        if (!asset || !Array.isArray(asset.models) || !Array.isArray(asset.textures)) throw new Error("Invalid item-asset");

        const images = await Promise.all(asset.textures.map(url =>
            typeof url === "string" && url.startsWith("data:image/png;base64,") ? this.loadImage(url).catch(() => null) : null
        ));

        // released or cache disposed while loading
        if (this.disposed || entry.refs <= 0 || this.entries.get(entry.id) !== entry) return;

        entry.materials = [];
        const textures = images.map(image => {
            if (!image) return null;
            const texture = new Texture(image);
            texture.magFilter = NearestFilter;
            texture.minFilter = NearestFilter;
            texture.generateMipmaps = false;
            texture.flipY = true;
            texture.needsUpdate = true;
            entry.textures.push(texture);
            return texture;
        });

        // per texture: one material for the quads (with the face-shading as vertex-colors) and one for entity-boxes
        const quadMaterials = [], boxMaterials = [];
        const material = (list, index, vertexColors) => {
            if (!textures[index]) return null;
            if (!list[index]) {
                list[index] = new MeshBasicMaterial({map: textures[index], vertexColors, alphaTest: 0.1, side: FrontSide});
                entry.materials.push(list[index]);
            }
            return list[index];
        };
        const materials = {
            quads: index => material(quadMaterials, index, true),
            box: index => material(boxMaterials, index, false),
        };

        entry.models = asset.models.slice(0, 32).map(model => this.buildModel(model, materials)).filter(Boolean);
        entry.state = "loaded";
        entry.listeners.forEach(listener => listener(entry));
    }

    /** @private */
    buildModel(model, materials) {
        if (!model || typeof model !== "object") return null;
        const display = model.display && typeof model.display === "object" ? model.display : {};
        const result = {
            type: model.type,
            predicate: model.predicate && typeof model.predicate === "object" ? model.predicate : null,
            display: {right: display.right || null, left: display.left || display.right || null},
            parts: [],
        };

        if (model.type === "quads" && Array.isArray(model.quads)) {
            for (const [texture, geometry] of buildQuadGeometries(model.quads)) {
                const material = materials.quads(texture);
                if (!material) {
                    geometry.dispose();
                    continue;
                }
                result.parts.push({geometry, material, position: null, scale: 1});
            }
        } else if (model.type === "shield" && materials.box(model.texture)) {
            // the shield-texture uses the box-layout of entity-models (v = 0 at the bottom, like the skins)
            for (const part of buildShieldGeometries()) {
                result.parts.push({geometry: part.geometry, material: materials.box(model.texture), position: part.position, scale: 1 / 16});
            }
        } else {
            return null;
        }
        return result;
    }

    /** @private */
    setFailed(entry) {
        if (this.disposed) return;
        entry.state = "failed";
        entry.failedAt = this.now();
        entry.listeners.forEach(listener => listener(entry));
    }

    /** @private */
    disposeEntry(entry) {
        entry.models.forEach(model => model.parts.forEach(part => part.geometry.dispose()));
        (entry.materials || []).forEach(material => material.dispose());
        entry.textures.forEach(texture => texture.dispose());
        entry.models = [];
        entry.materials = [];
        entry.textures = [];
    }

    static loadJson(url) {
        return fetch(url).then(response => {
            if (!response.ok) throw new Error(`Failed to load item-asset: ${url} (${response.status})`);
            return response.json();
        });
    }

    static loadImage(url) {
        return new Promise((resolve, reject) => {
            const image = new Image();
            image.onload = () => {
                if (image.naturalWidth > 0 && image.naturalWidth <= 512 && image.naturalHeight <= 512) resolve(image);
                else reject(new Error("Unsupported item-texture size"));
            };
            image.onerror = () => reject(new Error("Failed to load item-texture"));
            image.src = url;
        });
    }

}
