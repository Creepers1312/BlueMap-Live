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
import {Mesh} from "three";
import {getLayerGeometries} from "./MobModelGeometry.js";
import {VANILLA_MODELS} from "./MobTypes.js";

/**
 * vanilla ArmorFeatureRenderer.setVisible: the parts of the armor-model that are rendered per slot;
 * the leggings use the inner model, the other slots the outer model.
 */
export const ARMOR_SLOTS = {
    head: {model: "outer", parts: ["head", "hat"]},
    chest: {model: "outer", parts: ["body", "right_arm", "left_arm"]},
    legs: {model: "inner", parts: ["body", "right_leg", "left_leg"]},
    feet: {model: "outer", parts: ["right_leg", "left_leg"]},
};

/**
 * The worn armor (vanilla ArmorFeatureRenderer): per slot and texture-layer meshes on the parts of the vanilla
 * armor-models, attached to bones that follow the body-parts (like vanilla copyBipedStateTo).
 * Armor is not tinted red when hurt (vanilla renders it with the default overlay).
 */
export class ArmorView {

    /**
     * @param textureCache {import("./TextureAssetCache.js").TextureAssetCache}
     * @param layers {{inner: string, outer: string}} - the armor model-layers in vanilla-mob-models.json
     * @param bone {function(string, string): (import("three").Object3D | null)} - (model "inner"/"outer", part) -> the
     *  bone the meshes are attached to (its origin is the pivot of the part, in vanilla model-space)
     */
    constructor(textureCache, layers, bone) {
        this.textureCache = textureCache;
        this.layers = layers;
        this.bone = bone;
        this.key = "";
        /** @type {Array<{entry: object, meshes: Mesh[], color: number | null}>} */
        this.pieces = [];
        this.onLoaded = () => this.updateMaterials();
    }

    /**
     * @param armor {Object<string, Array<{texture: string, color: number | null}>> | null}
     */
    update(armor) {
        const key = armor ? JSON.stringify(armor) : "";
        if (key === this.key) {
            for (const piece of this.pieces) if (piece.entry.state === "failed") this.textureCache.retry(piece.entry);
            return;
        }
        this.key = key;
        this.clear();
        if (!armor) return;

        for (const slot of ["feet", "legs", "chest", "head"]) {
            const layers = armor[slot];
            if (!layers) continue;
            const {model, parts} = ARMOR_SLOTS[slot];
            const layerName = this.layers[model];
            const data = VANILLA_MODELS.models[layerName];
            if (!data) continue;
            const geometries = getLayerGeometries(layerName, data);
            for (const layer of layers) {
                const entry = this.textureCache.acquire(layer.texture);
                entry.listeners.add(this.onLoaded);
                const meshes = [];
                for (const part of parts) {
                    const geometry = geometries.get(part);
                    const bone = this.bone(model, part);
                    if (!geometry || !bone) continue;
                    const mesh = new Mesh(geometry, null);
                    mesh.raycast = () => {};
                    mesh.name = `armor-${slot}-${part}`;
                    mesh.visible = false;
                    bone.add(mesh);
                    meshes.push(mesh);
                }
                this.pieces.push({entry, meshes, color: layer.color});
            }
        }
        this.updateMaterials();
    }

    /** @private */
    updateMaterials() {
        for (const piece of this.pieces) {
            const material = this.textureCache.material(piece.entry, piece.color);
            for (const mesh of piece.meshes) {
                mesh.material = material;
                mesh.visible = !!material;
            }
        }
    }

    /** @private */
    clear() {
        for (const piece of this.pieces) {
            for (const mesh of piece.meshes) mesh.removeFromParent();
            piece.entry.listeners.delete(this.onLoaded);
            this.textureCache.release(piece.entry);
        }
        this.pieces = [];
    }

    dispose() {
        this.clear();
        this.key = "";
    }

}
