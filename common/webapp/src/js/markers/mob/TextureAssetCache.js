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
import {Color, DoubleSide, MeshBasicMaterial, NearestFilter, Texture} from "three";
import {ASSET_VERSION, MAX_ATTEMPTS, RETRY_INTERVAL} from "../player/ItemAssetCache.js";

/*
 * Loads single textures of the resource-pack that the server provides as png (assets/textures/<ns>/<path>.png, e.g.
 * the armor-layers, see the java ItemAssetUpdater.requestTexture) and shares them and their materials (reference-counted).
 */

const KEY_PATTERN = /^[a-z0-9_.-]+:[a-z0-9_./-]+$/;

export class TextureAssetCache {

    /**
     * @param baseUrl {string | null} - the url-prefix of the texture-assets (assets/textures/), null: nothing is loaded
     * @param loadImage {function(string): Promise<any>} - replaceable for tests
     * @param now {function(): number} - replaceable for tests
     */
    constructor(baseUrl, loadImage = TextureAssetCache.loadImage, now = Date.now) {
        this.baseUrl = baseUrl;
        this.loadImage = loadImage;
        this.now = now;
        this.entries = new Map();
        this.disposed = false;
    }

    /**
     * @param key {string} - e.g. "minecraft:models/armor/iron_layer_1"
     * @returns {{key: string, url: string | null, refs: number, state: string, attempts: number, failedAt: number,
     *  texture: Texture | null, materials: Map<string, MeshBasicMaterial>, listeners: Set<function>}}
     */
    acquire(key) {
        let entry = this.entries.get(key);
        if (!entry) {
            const valid = KEY_PATTERN.test(key) && !key.includes("..");
            const [namespace, path] = key.split(":");
            entry = {
                key,
                url: this.baseUrl && valid ? `${this.baseUrl}${namespace}/${path}.png?v=${ASSET_VERSION}` : null,
                refs: 0, state: "loading", attempts: 0, failedAt: 0,
                texture: null, materials: new Map(), listeners: new Set(),
            };
            this.entries.set(key, entry);
            this.load(entry);
        }
        entry.refs++;
        return entry;
    }

    retry(entry) {
        if (entry.state !== "failed" || entry.attempts >= MAX_ATTEMPTS) return;
        if (this.now() - entry.failedAt < RETRY_INTERVAL) return;
        entry.state = "loading";
        this.load(entry);
    }

    release(entry) {
        if (!entry) return;
        entry.refs--;
        if (entry.refs <= 0) {
            entry.listeners.clear();
            this.disposeEntry(entry);
            if (this.entries.get(entry.key) === entry) this.entries.delete(entry.key);
        }
    }

    /**
     * The (shared) cut-out material of the texture, multiplied with a color.
     * @param entry
     * @param color {number | null} - rgb
     * @returns {MeshBasicMaterial | null} - null while the texture is not loaded
     */
    material(entry, color = null) {
        if (entry.state !== "loaded") return null;
        const key = String(color);
        let material = entry.materials.get(key);
        if (!material) {
            // vanilla armor-cutout-no-cull
            material = new MeshBasicMaterial({map: entry.texture, alphaTest: 0.1, side: DoubleSide});
            if (color !== null) material.color = new Color(color);
            entry.materials.set(key, material);
        }
        return material;
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
        this.loadImage(entry.url).then(image => {
            if (this.disposed || entry.refs <= 0 || this.entries.get(entry.key) !== entry) return;
            const texture = new Texture(image);
            texture.magFilter = NearestFilter;
            texture.minFilter = NearestFilter;
            texture.generateMipmaps = false;
            texture.flipY = true;
            texture.needsUpdate = true;
            entry.texture = texture;
            entry.state = "loaded";
            entry.listeners.forEach(listener => listener(entry));
        }).catch(() => this.setFailed(entry));
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
        entry.materials.forEach(material => material.dispose());
        entry.materials.clear();
        if (entry.texture) entry.texture.dispose();
        entry.texture = null;
    }

    static loadImage(url) {
        return new Promise((resolve, reject) => {
            const image = new Image();
            image.onload = () => {
                if (image.naturalWidth > 0 && image.naturalWidth <= 512 && image.naturalHeight <= 512) resolve(image);
                else reject(new Error("Unsupported texture size"));
            };
            image.onerror = () => reject(new Error("Failed to load texture: " + url));
            image.src = url;
        });
    }

}
