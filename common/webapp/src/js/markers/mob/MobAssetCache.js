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
import {AdditiveBlending, Color, DoubleSide, MeshBasicMaterial, NearestFilter, RepeatWrapping, Texture} from "three";
import {assetUrl, MAX_ATTEMPTS, RETRY_INTERVAL} from "../player/ItemAssetCache.js";
import {createHurtMaterial, createWhiteOverlayMaterial} from "../player/PlayerSkinCache.js";

/*
 * Loads the mob-assets (the textures of a mob from the resource-pack, see the java ItemModelBaker.bakeMob and
 * docs/bluemap-live/phase-6.md) and shares their textures and materials between all mobs of a type (reference-counted).
 */

/**
 * @typedef MobEntry {{
 *     type: string, url: string | null, refs: number, state: "loading" | "loaded" | "failed",
 *     attempts: number, failedAt: number, images: Map<string, any>, materials: Map<string, MeshBasicMaterial>,
 *     textures: Texture[], listeners: Set<function(MobEntry)>
 * }}
 */

/** draws the images onto each other (cut-out layers like the villager-clothing), the first image sets the size */
function composeImages(images) {
    const canvas = document.createElement("canvas");
    canvas.width = images[0].width;
    canvas.height = images[0].height;
    const context = canvas.getContext("2d");
    for (const image of images) context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas;
}

export class MobAssetCache {

    /**
     * @param baseUrl {string | null} - the url-prefix of the entity-assets (assets/entities/), null: nothing is loaded
     * @param loadJson {function(string): Promise<any>} - replaceable for tests
     * @param loadImage {function(string): Promise<any>} - replaceable for tests
     * @param now {function(): number} - replaceable for tests
     * @param compose {function(any[]): any} - draws several images onto each other, replaceable for tests
     */
    constructor(baseUrl, loadJson = MobAssetCache.loadJson, loadImage = MobAssetCache.loadImage, now = Date.now, compose = composeImages) {
        this.baseUrl = baseUrl;
        this.loadJson = loadJson;
        this.loadImage = loadImage;
        this.now = now;
        this.compose = compose;

        /** @type {Map<string, MobEntry>} */
        this.entries = new Map();
        this.disposed = false;
    }

    /**
     * @param type {string} - a validated entity-type
     * @returns {MobEntry}
     */
    acquire(type) {
        let entry = this.entries.get(type);
        if (!entry) {
            entry = {
                type,
                url: assetUrl(this.baseUrl, type),
                refs: 0,
                state: "loading",
                attempts: 0,
                failedAt: 0,
                images: new Map(),
                materials: new Map(),
                textures: [],
                listeners: new Set(),
            };
            this.entries.set(type, entry);
            this.load(entry);
        }
        entry.refs++;
        return entry;
    }

    /**
     * Requests a missing asset again if enough time passed (called by the users of the entry, no own timer).
     * @param entry {MobEntry}
     */
    retry(entry) {
        if (entry.state !== "failed" || entry.attempts >= MAX_ATTEMPTS) return;
        if (this.now() - entry.failedAt < RETRY_INTERVAL) return;
        entry.state = "loading";
        this.load(entry);
    }

    /**
     * @param entry {MobEntry | null}
     */
    release(entry) {
        if (!entry) return;
        entry.refs--;
        if (entry.refs <= 0) {
            entry.listeners.clear();
            this.disposeEntry(entry);
            if (this.entries.get(entry.type) === entry) this.entries.delete(entry.type);
        }
    }

    /**
     * The (shared) material of a model-layer, created on first use.
     * @param entry {MobEntry}
     * @param textureKeys {string[]} - the textures, drawn onto each other in this order (the first is required)
     * @param kind {"cutout" | "translucent" | "eyes" | "energy"}
     * @param tint {number | null} - rgb-color the texture is multiplied with
     * @param hurt {boolean} - with the red hurt-overlay
     * @param white {number} - the vanilla white-overlay level (0: none, 1..15), ignored when hurt (vanilla: the
     *  hurt-rows of the overlay-texture are red in every column)
     * @returns {MeshBasicMaterial | null} - null if the first texture is missing
     */
    material(entry, textureKeys, kind = "cutout", tint = null, hurt = false, white = 0) {
        if (entry.state !== "loaded") return null;
        if (hurt) white = 0;
        const key = `${textureKeys.join("+")}|${kind}|${tint}|${hurt}|${white}`;
        let material = entry.materials.get(key);
        if (material !== undefined) return material;

        if (white > 0) {
            const base = this.material(entry, textureKeys, kind, tint, false, 0);
            material = base ? createWhiteOverlayMaterial(base, white) : null;
        } else if (hurt) {
            const base = this.material(entry, textureKeys, kind, tint, false);
            material = base ? createHurtMaterial(base) : null;
        } else {
            // the first texture is required, missing overlays (e.g. a villager-level a resource-pack does not have) are left out
            const images = textureKeys.map(textureKey => entry.images.get(textureKey)).filter((image, i) => image || i === 0);
            if (images.length === 0 || !images[0]) {
                material = null;
            } else {
                const texture = new Texture(images.length === 1 ? images[0] : this.compose(images));
                texture.magFilter = NearestFilter;
                texture.minFilter = NearestFilter;
                texture.generateMipmaps = false;
                texture.flipY = true; // the geometries use v = 0 at the bottom
                if (kind === "energy") texture.wrapS = texture.wrapT = RepeatWrapping;
                texture.needsUpdate = true;
                entry.textures.push(texture);
                material = new MeshBasicMaterial({map: texture, side: DoubleSide});
                if (kind === "cutout") {
                    material.alphaTest = 0.1; // vanilla entity-cutout
                } else if (kind === "translucent") {
                    material.transparent = true;
                } else { // eyes, energy: vanilla additive render-layers
                    material.transparent = true;
                    material.blending = AdditiveBlending;
                    material.depthWrite = false;
                    if (kind === "energy") material.color = new Color(0.5, 0.5, 0.5); // vanilla: the swirl at half brightness
                }
                if (tint !== null) material.color = new Color(tint);
            }
        }
        entry.materials.set(key, material);
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
        this.loadJson(entry.url)
            .then(asset => this.buildEntry(entry, asset))
            .catch(() => this.setFailed(entry));
    }

    /** @private */
    async buildEntry(entry, asset) {
        if (!asset || typeof asset.textures !== "object" || asset.textures === null) throw new Error("Invalid mob-asset");
        const keys = Object.keys(asset.textures).slice(0, 128);
        const images = await Promise.all(keys.map(key => {
            const url = asset.textures[key];
            return typeof url === "string" && url.startsWith("data:image/png;base64,") ? this.loadImage(url).catch(() => null) : null;
        }));

        // released or cache disposed while loading
        if (this.disposed || entry.refs <= 0 || this.entries.get(entry.type) !== entry) return;

        keys.forEach((key, i) => {
            if (images[i]) entry.images.set(key, images[i]);
        });
        entry.state = "loaded";
        entry.listeners.forEach(listener => listener(entry));
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
        entry.materials.forEach(material => material && material.dispose());
        entry.textures.forEach(texture => texture.dispose());
        entry.materials.clear();
        entry.textures = [];
    }

    static loadJson(url) {
        return fetch(url).then(response => {
            if (!response.ok) throw new Error(`Failed to load mob-asset: ${url} (${response.status})`);
            return response.json();
        });
    }

    static loadImage(url) {
        return new Promise((resolve, reject) => {
            const image = new Image();
            image.onload = () => {
                if (image.naturalWidth > 0 && image.naturalWidth <= 512 && image.naturalHeight <= 512) resolve(image);
                else reject(new Error("Unsupported mob-texture size"));
            };
            image.onerror = () => reject(new Error("Failed to load mob-texture"));
            image.src = url;
        });
    }

}
