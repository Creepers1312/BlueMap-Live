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

import {DoubleSide, FrontSide, MeshBasicMaterial, NearestFilter, Texture} from "three";

/** resource-paths of the default skins in a maps textures.json (from the resource-pack, used by the player-head blocks) */
export const DEFAULT_SKIN_RESOURCES = [
    {resourcePath: "minecraft:entity/player/slim/steve", variant: "slim"},
    {resourcePath: "minecraft:entity/player/wide/steve", variant: "classic"},
];

/**
 * @typedef SkinEntry {{
 *     url: string,
 *     texture: Texture,
 *     baseMaterial: MeshBasicMaterial,
 *     overlayMaterial: MeshBasicMaterial,
 *     state: "loading" | "loaded" | "failed",
 *     refs: number,
 *     isDefault: boolean,
 *     variant: string | null,
 *     listeners: Set<function(SkinEntry)>
 * }}
 */

/**
 * Loads skin-textures and shares them (and their materials) between all players that use the same skin-url.
 * Textures are reference-counted and disposed when no player uses them anymore.
 */
export class PlayerSkinCache {

    /**
     * @param loadImage {function(string): Promise<HTMLImageElement | ImageBitmap | HTMLCanvasElement>} - image loader (replaceable for tests)
     */
    constructor(loadImage = PlayerSkinCache.loadImage) {
        this.loadImage = loadImage;

        /** @type {Map<string, SkinEntry>} */
        this.entries = new Map();

        /** @type {SkinEntry | null} */
        this.defaultSkin = null;

        /** listeners that are called when the default skin changed
         * @type {Set<function(SkinEntry)>} */
        this.defaultSkinListeners = new Set();
    }

    /**
     * Returns the (shared) entry for a skin-url and increases its reference-count.
     * Call release() when the entry is not used anymore.
     * @param url {string}
     * @returns {SkinEntry}
     */
    acquire(url) {
        let entry = this.entries.get(url);
        if (!entry) {
            entry = this.createEntry(url, false, null);
            this.entries.set(url, entry);
            this.loadImage(url)
                .then(image => this.setImage(entry, image))
                .catch(() => this.setFailed(entry));
        }
        entry.refs++;
        return entry;
    }

    /**
     * Decreases the reference-count of an entry and disposes it if it is not used anymore.
     * @param entry {SkinEntry | null}
     */
    release(entry) {
        if (!entry || entry.isDefault) return;
        entry.refs--;
        if (entry.refs <= 0) {
            entry.listeners.clear();
            this.disposeEntry(entry);
            if (this.entries.get(entry.url) === entry) this.entries.delete(entry.url);
        }
    }

    /**
     * Sets the default skin (used for players without (loadable) skin) from an image-url (e.g. a data-url).
     * @param url {string}
     * @param variant {"classic" | "slim"}
     * @returns {Promise<SkinEntry | null>}
     */
    setDefaultSkin(url, variant) {
        const entry = this.createEntry(url, true, variant);
        return this.loadImage(url)
            .then(image => {
                this.setImage(entry, image);
                const previous = this.defaultSkin;
                this.defaultSkin = entry;
                this.defaultSkinListeners.forEach(listener => listener(entry));
                if (previous) this.disposeEntry(previous);
                return entry;
            })
            .catch(() => {
                this.disposeEntry(entry);
                return null;
            });
    }

    /**
     * Loads the default skin from a maps textures.json (the steve-texture of the resource-pack).
     * @param texturesUrl {string}
     * @returns {Promise<SkinEntry | null>} - null if the textures do not contain a default skin
     */
    loadDefaultSkinFromTextures(texturesUrl) {
        return fetch(texturesUrl)
            .then(response => response.ok ? response.json() : null)
            .then(textures => {
                const found = PlayerSkinCache.findDefaultSkin(textures);
                if (!found) return null;
                return this.setDefaultSkin(found.texture, found.variant);
            })
            .catch(() => null);
    }

    /**
     * @param textures {any} - the parsed textures.json
     * @returns {{texture: string, variant: string} | null}
     */
    static findDefaultSkin(textures) {
        if (!Array.isArray(textures)) return null;
        for (const candidate of DEFAULT_SKIN_RESOURCES) {
            const texture = textures.find(t => t && t.resourcePath === candidate.resourcePath);
            if (texture && typeof texture.texture === "string" && texture.texture.startsWith("data:image/")) {
                return {texture: texture.texture, variant: candidate.variant};
            }
        }
        return null;
    }

    /**
     * Disposes all textures and materials.
     */
    dispose() {
        this.entries.forEach(entry => this.disposeEntry(entry));
        this.entries.clear();
        if (this.defaultSkin) this.disposeEntry(this.defaultSkin);
        this.defaultSkin = null;
        this.defaultSkinListeners.clear();
    }

    /** @private */
    createEntry(url, isDefault, variant) {
        const texture = new Texture();
        texture.magFilter = NearestFilter;
        texture.minFilter = NearestFilter;
        texture.generateMipmaps = false;
        texture.flipY = true; // the model-UVs use v = 0 at the bottom of the image

        return {
            url,
            texture,
            // base layer: opaque like in Minecraft (alpha of the first layer is ignored)
            baseMaterial: new MeshBasicMaterial({map: texture, side: FrontSide}),
            // second layer: cut-out transparency, rendered from both sides (visible through holes)
            overlayMaterial: new MeshBasicMaterial({map: texture, alphaTest: 0.5, side: DoubleSide}),
            state: "loading",
            refs: 0,
            isDefault,
            variant,
            listeners: new Set(),
        };
    }

    /** @private */
    setImage(entry, image) {
        entry.texture.image = image;
        entry.texture.needsUpdate = true;
        entry.state = "loaded";
        entry.listeners.forEach(listener => listener(entry));
    }

    /** @private */
    setFailed(entry) {
        entry.state = "failed";
        entry.listeners.forEach(listener => listener(entry));
    }

    /** @private */
    disposeEntry(entry) {
        entry.texture.dispose();
        entry.baseMaterial.dispose();
        entry.overlayMaterial.dispose();
    }

    /**
     * Default image-loader
     * @param url {string}
     * @returns {Promise<HTMLImageElement>}
     */
    static loadImage(url) {
        return new Promise((resolve, reject) => {
            const image = new Image();
            image.crossOrigin = "anonymous";
            image.onload = () => {
                // only 64x64 skins are supported (the server normalizes all skins to 64x64)
                if (image.naturalWidth === 64 && image.naturalHeight === 64) resolve(image);
                else reject(new Error(`Unsupported skin size: ${image.naturalWidth}x${image.naturalHeight}`));
            };
            image.onerror = () => reject(new Error(`Failed to load skin: ${url}`));
            image.src = url;
        });
    }

}
