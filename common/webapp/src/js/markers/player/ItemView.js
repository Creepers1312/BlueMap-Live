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

import {Group, MathUtils, Mesh} from "three";
import {selectItemModel} from "./PlayerItemPoses.js";

/** vanilla: item-model translations are clamped to +-80/16 blocks, scales to +-4 */
const MAX_ITEM_TRANSLATION = 5;
const MAX_ITEM_SCALE = 4;

/**
 * An item-model (see ItemAssetCache) with the display-transformation of a vanilla ModelTransformationMode:
 * "right" / "left" (third-person hands) or "ground" (dropped and thrown items).
 * <p>The group itself is the display-transformation (vanilla Transformation.apply), its child "content" is
 * translated by -0.5 like in vanilla's ItemRenderer, the meshes are in block-units (0..1).
 * Meshes are only created when the item or its override changes; geometries and materials are shared.</p>
 */
export class ItemView extends Group {

    /**
     * @param itemCache {import("./ItemAssetCache.js").ItemAssetCache | null}
     * @param mode {"right" | "left" | "ground"}
     */
    constructor(itemCache, mode) {
        super();
        this.name = mode + "-item";
        this.rotation.order = "XYZ";
        this.itemCache = itemCache;
        this.mode = mode;

        this.content = new Group();
        this.content.position.set(-0.5, -0.5, -0.5);
        this.add(this.content);

        /** @type {import("./ItemAssetCache.js").ItemEntry | null} */
        this.entry = null;
        this.itemId = null;
        this.modelIndex = -1;
        /** the display-transformation of the shown model (null: none) */
        this.transform = null;

        this.onLoaded = () => {
            this.modelIndex = -1; // rebuild with the next update
        };
    }

    /**
     * Shows the item (or nothing) and selects the model by the predicates. Cheap if nothing changed.
     * @param itemId {string | null}
     * @param predicates {object}
     */
    update(itemId, predicates = {}) {
        if (!this.itemCache) itemId = null;
        if (itemId !== this.itemId) this.setItem(itemId);

        const entry = this.entry;
        if (!entry) return;
        if (entry.state === "failed") {
            this.itemCache.retry(entry);
            return;
        }
        if (entry.state !== "loaded" || entry.models.length === 0) return;

        const modelIndex = selectItemModel(entry.models, predicates);
        if (modelIndex !== this.modelIndex) this.showModel(entry.models[modelIndex], modelIndex);
    }

    /** @private */
    setItem(itemId) {
        if (this.entry) {
            this.entry.listeners.delete(this.onLoaded);
            this.itemCache.release(this.entry);
        }
        this.content.clear();
        this.entry = itemId ? this.itemCache.acquire(itemId) : null;
        if (this.entry) this.entry.listeners.add(this.onLoaded);
        this.itemId = itemId;
        this.modelIndex = -1;
        this.transform = null;
    }

    /** @private */
    showModel(model, modelIndex) {
        this.content.clear();
        for (const part of model.parts) {
            const mesh = new Mesh(part.geometry, part.material);
            mesh.raycast = () => {}; // never intercepts the map-interactions
            mesh.name = this.mode + "-item-part";
            if (part.position) mesh.position.set(part.position[0] * part.scale, part.position[1] * part.scale, part.position[2] * part.scale);
            mesh.scale.setScalar(part.scale);
            this.content.add(mesh);
        }

        // vanilla Transformation.apply(leftHanded): the left hand mirrors the translation-x and the y- and z-rotation
        const transform = model.display[this.mode] || null;
        const mirror = this.mode === "left" ? -1 : 1;
        const v = (array, i, fallback) => Array.isArray(array) && Number.isFinite(array[i]) ? array[i] : fallback;
        if (transform) {
            const t = i => MathUtils.clamp(v(transform.translation, i, 0) / 16, -MAX_ITEM_TRANSLATION, MAX_ITEM_TRANSLATION);
            const s = i => MathUtils.clamp(v(transform.scale, i, 1), -MAX_ITEM_SCALE, MAX_ITEM_SCALE);
            const r = i => MathUtils.degToRad(v(transform.rotation, i, 0));
            this.position.set(mirror * t(0), t(1), t(2));
            this.rotation.set(r(0), mirror * r(1), mirror * r(2), "XYZ");
            this.scale.set(s(0), s(1), s(2));
        } else {
            this.position.set(0, 0, 0);
            this.rotation.set(0, 0, 0, "XYZ");
            this.scale.set(1, 1, 1);
        }
        this.transform = transform;
        this.modelIndex = modelIndex;
    }

    /**
     * The y-scale of the display-transformation (vanilla ItemEntityRenderer lifts dropped items by 0.25 * scale-y)
     * @returns {number}
     */
    get displayScaleY() {
        return this.transform ? this.scale.y : 1;
    }

    /** Releases the item. */
    dispose() {
        if (this.itemId) this.setItem(null);
    }

}
