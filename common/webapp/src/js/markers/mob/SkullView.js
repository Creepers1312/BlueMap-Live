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

import {Group, Mesh} from "three";
import {getLayerGeometries} from "./MobModelGeometry.js";
import {VANILLA_MODELS} from "./MobTypes.js";

/**
 * vanilla SkullBlockEntityRenderer: the skull-items, their model (SkullBlockEntityRenderer.getModels with the layers
 * of EntityModels.getModels) and their texture (SkullBlockEntityRenderer.TEXTURES). Player-heads are shown with the
 * default skin (the skin of the profile is not known).
 */
export const SKULLS = {
    "minecraft:skeleton_skull": {layer: "minecraft:skull#skull", texture: "minecraft:entity/skeleton/skeleton"},
    "minecraft:wither_skeleton_skull": {layer: "minecraft:skull#skull", texture: "minecraft:entity/skeleton/wither_skeleton"},
    "minecraft:player_head": {layer: "minecraft:skull#head", texture: "minecraft:entity/player/wide/steve"},
    "minecraft:zombie_head": {layer: "minecraft:skull#head", texture: "minecraft:entity/zombie/zombie"},
    "minecraft:creeper_head": {layer: "minecraft:skull#skull", texture: "minecraft:entity/creeper/creeper"},
    "minecraft:dragon_head": {layer: "minecraft:dragon_head#main", texture: "minecraft:entity/enderdragon/dragon", kind: "dragon"},
    "minecraft:piglin_head": {layer: "minecraft:piglin_head#main", texture: "minecraft:entity/piglin/piglin", kind: "piglin"},
};

/**
 * vanilla SkullBlockEntityModel.setHeadRotation(animation, yaw, pitch) of the skull-models
 * @param kind {string | undefined} - "dragon", "piglin" or a plain skull
 * @param parts {Object<string, {pitch: number, yaw: number, roll: number}>}
 * @param animation {number} - the limb-position of the wearer (vanilla HeadFeatureRenderer)
 * @param yaw {number} - degrees (on the head: 180)
 * @param pitch {number} - degrees
 */
export function skullHeadRotation(kind, parts, animation, yaw, pitch) {
    const head = parts.head;
    if (head) {
        head.yaw = yaw * Math.PI / 180;
        head.pitch = pitch * Math.PI / 180;
    }
    if (kind === "dragon" && parts["head/jaw"]) {
        parts["head/jaw"].pitch = (Math.sin(animation * Math.PI * 0.2) + 1) * 0.2;
    } else if (kind === "piglin") {
        if (parts["head/left_ear"]) parts["head/left_ear"].roll = -(Math.cos(animation * Math.PI * 0.2 * 1.2) + 2.5) * 0.2;
        if (parts["head/right_ear"]) parts["head/right_ear"].roll = (Math.cos(animation * Math.PI * 0.2) + 2.5) * 0.2;
    }
}

/**
 * A skull on the head (vanilla HeadFeatureRenderer, skull-branch, and SkullBlockEntityRenderer.renderSkull):
 * in the space after the head-rotation (blocks): scale (1.1875, -1.1875, -1.1875), villagers (0, 1/16, 0) higher,
 * translate (-0.5, 0, -0.5), then renderSkull: translate (0.5, 0, 0.5), scale (-1, -1, 1), the model (pixels).
 */
export class SkullView extends Group {

    /**
     * @param textureCache {import("./TextureAssetCache.js").TextureAssetCache}
     * @param villager {boolean}
     */
    constructor(textureCache, villager = false) {
        super();
        this.name = "skull";
        this.textureCache = textureCache;
        this.scale.set(1.1875, -1.1875, -1.1875);
        const offset = new Group();
        offset.position.set(-0.5 + 0.5, villager ? 0.0625 : 0, -0.5 + 0.5);
        this.add(offset);
        this.model = new Group();
        this.model.scale.set(-1 / 16, -1 / 16, 1 / 16);
        offset.add(this.model);

        this.itemId = null;
        this.skull = null;
        this.entry = null;
        this.meshes = [];
        this.bones = new Map();
        this.transforms = {};
        this.onLoaded = () => this.updateMaterial();
    }

    /**
     * @param itemId {string | null} - a skull-item (see SKULLS) or null
     * @param animation {number} - the limb-position of the wearer
     */
    update(itemId, animation = 0) {
        if (itemId !== this.itemId) this.build(itemId);
        if (!this.skull) return;
        const parts = this.transforms;
        for (const [path, data] of this.partData) {
            const rotation = data.rotation || [0, 0, 0];
            Object.assign(parts[path], {pitch: rotation[0], yaw: rotation[1], roll: rotation[2]});
        }
        skullHeadRotation(this.skull.kind, parts, animation, 180, 0);
        for (const [path, bone] of this.bones) {
            const t = parts[path];
            bone.rotation.set(t.pitch, t.yaw, t.roll);
        }
    }

    /** @private */
    build(itemId) {
        this.clear();
        this.itemId = itemId;
        this.skull = itemId ? SKULLS[itemId] || null : null;
        const data = this.skull ? VANILLA_MODELS.models[this.skull.layer] : null;
        if (!data) {
            this.skull = null;
            return;
        }
        const geometries = getLayerGeometries(this.skull.layer, data);
        this.partData = new Map();
        const build = (parts, prefix, parent) => {
            for (const name in parts) {
                const path = prefix + name, part = parts[name];
                const bone = new Group();
                bone.name = path;
                bone.rotation.order = "ZYX"; // vanilla ModelPart.rotate
                const pivot = part.pivot || [0, 0, 0];
                bone.position.set(pivot[0], pivot[1], pivot[2]);
                parent.add(bone);
                this.bones.set(path, bone);
                this.partData.set(path, part);
                this.transforms[path] = {pitch: 0, yaw: 0, roll: 0};
                const geometry = geometries.get(path);
                if (geometry) {
                    const mesh = new Mesh(geometry, null);
                    mesh.raycast = () => {};
                    mesh.visible = false;
                    bone.add(mesh);
                    this.meshes.push(mesh);
                }
                if (part.children) build(part.children, path + "/", bone);
            }
        };
        build(data.parts, "", this.model);
        this.entry = this.textureCache.acquire(this.skull.texture);
        this.entry.listeners.add(this.onLoaded);
        this.updateMaterial();
    }

    /** @private */
    updateMaterial() {
        const material = this.entry ? this.textureCache.material(this.entry, null) : null;
        for (const mesh of this.meshes) {
            mesh.material = material;
            mesh.visible = !!material;
        }
    }

    /** @private */
    clear() {
        for (const bone of this.bones.values()) bone.removeFromParent();
        this.bones.clear();
        this.meshes = [];
        this.transforms = {};
        if (this.entry) {
            this.entry.listeners.delete(this.onLoaded);
            this.textureCache.release(this.entry);
        }
        this.entry = null;
    }

    dispose() {
        this.clear();
        this.removeFromParent();
    }

}
