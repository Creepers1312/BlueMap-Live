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
import {getPlayerModelGeometries} from "./PlayerModelGeometry.js";
import {PART_NAMES, PIXEL_SCALE, playerModelLayout} from "./PlayerModelLayout.js";
import {selectItemModel} from "./PlayerItemPoses.js";

/** vanilla: item-model translations are clamped to +-80/16 blocks, scales to +-4 */
const MAX_ITEM_TRANSLATION = 5;
const MAX_ITEM_SCALE = 4;

/**
 * Creates a mesh that is ignored by raycasting, so the model never intercepts the normal map-interactions (clicks)
 */
function nonInteractiveMesh(geometry, material) {
    const mesh = new Mesh(geometry, material);
    mesh.raycast = () => {};
    return mesh;
}

/**
 * The 3d model of a Minecraft player with skin.
 * <p>The model is a Group with its origin at the feet of the player, facing +z.
 * Every body-part is its own Group ("bone") positioned at its joint, so it can be rotated (animated) separately:
 * <code>model.parts.head</code>, <code>.body</code>, <code>.rightArm</code>, <code>.leftArm</code>,
 * <code>.rightLeg</code>, <code>.leftLeg</code>. Each bone contains the base-layer and the second-layer mesh.</p>
 * <p>Geometries are shared per model-variant, textures and materials are shared per skin (see PlayerSkinCache).
 * Only the meshes and bones belong to this model.</p>
 */
export class PlayerModel extends Group {

    /**
     * @param skinCache {import("./PlayerSkinCache.js").PlayerSkinCache}
     * @param itemCache {import("./ItemAssetCache.js").ItemAssetCache | null} - the held items, null: no items are shown
     */
    constructor(skinCache, itemCache = null) {
        super();
        Object.defineProperty(this, 'isPlayerModel', {value: true});
        this.name = "bm-player-model";

        this.skinCache = skinCache;

        /** the skin the player has (may still be loading or have failed) */
        this.skin = null;
        this.skinUrl = null;
        this.skinVariant = "classic";

        /** the variant and skin that are currently displayed (the default skin while the players skin is not available) */
        this.displayedVariant = null;
        this.displayedSkin = null;

        // all body-parts in pixel-units, scaled to blocks
        this.root = new Group();
        this.root.scale.setScalar(PIXEL_SCALE);
        this.add(this.root);

        /** @type {Object<string, Group>} */
        this.parts = {};
        for (const name of PART_NAMES) {
            const bone = new Group();
            bone.name = name;
            // the head is rotated by the look-direction, the other parts like vanilla model-parts (roll, yaw, pitch)
            bone.rotation.order = name === "head" ? "YXZ" : "ZYX";
            this.parts[name] = bone;
            this.root.add(bone);
        }

        /** the joint-positions of the displayed variant, poses are applied relative to them */
        this.basePivots = {};
        this.setBasePivots("classic");

        // held items: one slot per arm, following the arm-bones
        this.itemCache = itemCache;
        this.itemSlots = {right: this.createItemSlot("right"), left: this.createItemSlot("left")};

        this.onSkinStateChanged = () => this.updateDisplayedSkin();
        this.skinCache.defaultSkinListeners.add(this.onSkinStateChanged);

        /** true if a skin (the players or the default skin) is displayed */
        this.hasSkin = false;
        this.visible = false; // until a skin can be displayed
        this.updateDisplayedSkin();
    }

    /**
     * Sets the skin of the player.
     * @param url {string | null} - the url of the skin-image, null if the player has no (known) skin
     * @param variant {"classic" | "slim"}
     */
    setSkin(url, variant) {
        if (variant !== "slim") variant = "classic";
        if (url === this.skinUrl && variant === this.skinVariant) return;

        if (this.skin) {
            this.skin.listeners.delete(this.onSkinStateChanged);
            this.skinCache.release(this.skin);
        }

        this.skinUrl = url;
        this.skinVariant = variant;
        this.skin = url ? this.skinCache.acquire(url) : null;
        if (this.skin) this.skin.listeners.add(this.onSkinStateChanged);

        this.updateDisplayedSkin();
    }

    /**
     * Displays the players skin if it is loaded, otherwise the default skin (with the default skins variant),
     * or hides the model if neither is available.
     */
    updateDisplayedSkin() {
        let skin = null, variant = null;
        if (this.skin && this.skin.state === "loaded") {
            skin = this.skin;
            variant = this.skinVariant;
        } else if (this.skinCache.defaultSkin) {
            skin = this.skinCache.defaultSkin;
            variant = this.skinCache.defaultSkin.variant || "classic";
        }

        this.hasSkin = !!skin;
        if (!skin) {
            this.visible = false;
            return;
        }

        if (variant !== this.displayedVariant) this.buildParts(variant, skin);
        else if (skin !== this.displayedSkin) this.applyMaterials(skin);

        this.displayedSkin = skin;
        this.displayedVariant = variant;
    }

    /**
     * (Re)creates the meshes of all body-parts for a model-variant. The bones (and their rotations) are kept.
     * @private
     */
    buildParts(variant, skin) {
        this.setBasePivots(variant);
        const geometries = getPlayerModelGeometries(variant);
        for (const name of PART_NAMES) {
            const bone = this.parts[name];
            bone.clear();

            const {layout, base, overlay} = geometries.get(name);

            const baseMesh = nonInteractiveMesh(base, skin.baseMaterial);
            const overlayMesh = nonInteractiveMesh(overlay, skin.overlayMaterial);
            baseMesh.name = name + "-base";
            overlayMesh.name = name + "-overlay";
            baseMesh.position.set(layout.offset[0], layout.offset[1], layout.offset[2]);
            overlayMesh.position.copy(baseMesh.position);
            bone.add(baseMesh, overlayMesh);
        }
    }

    /** @private */
    setBasePivots(variant) {
        for (const layout of playerModelLayout(variant)) {
            this.basePivots[layout.name] = layout.pivot;
            this.parts[layout.name].position.set(layout.pivot[0], layout.pivot[1], layout.pivot[2]);
        }
    }

    /**
     * Applies an animation-pose (see PlayerAnimator). Only changes the transforms of the existing bones.
     * The rotation of the head is not changed, it is the look-direction and set by the player-marker.
     * @param pose {{parts: Object<string, {rx: number, ry: number, rz: number, px: number, py: number, pz: number}>,
     *  rootY: number, rootZ: number, rootPitch: number}}
     */
    applyPose(pose) {
        for (const name of PART_NAMES) {
            const part = pose.parts[name];
            if (!part) continue;
            const bone = this.parts[name];
            const pivot = this.basePivots[name];
            bone.position.set(pivot[0] + part.px, pivot[1] + part.py, pivot[2] + part.pz);
            if (name !== "head") bone.rotation.set(part.rx, part.ry, part.rz);
        }
        this.root.position.set(0, pose.rootY, pose.rootZ);
        this.root.rotation.x = pose.rootPitch;

        if (pose.items) {
            this.updateItemSlot(this.itemSlots.right, pose.items.right);
            this.updateItemSlot(this.itemSlots.left, pose.items.left);
        }
    }

    /**
     * The transformation-chain of vanilla HeldItemFeatureRenderer + ItemRenderer, as groups (created once):
     * arm-joint (+0.5px for slim arms) -> to vanilla model-space (rotate x 180°, pixels -> blocks) ->
     * rotate x -90°, y 180° -> translate (+-1/16, 2/16, -10/16) -> display-transformation -> translate -0.5.
     * @private
     */
    createItemSlot(side) {
        const anchor = new Group();
        anchor.name = side + "-item";
        anchor.rotation.order = "ZYX";
        this.root.add(anchor);

        const modelSpace = new Group();
        modelSpace.rotation.x = Math.PI;
        modelSpace.scale.setScalar(16);
        anchor.add(modelSpace);

        const hand = new Group();
        hand.rotation.set(-Math.PI / 2, Math.PI, 0, "XYZ");
        modelSpace.add(hand);

        const offset = new Group();
        offset.position.set((side === "left" ? -1 : 1) / 16, 0.125, -0.625);
        hand.add(offset);

        const display = new Group();
        display.rotation.order = "XYZ";
        offset.add(display);

        const content = new Group();
        content.position.set(-0.5, -0.5, -0.5);
        display.add(content);

        const slot = {side, anchor, display, content, entry: null, itemId: null, modelIndex: -1};
        slot.onLoaded = () => {
            slot.modelIndex = -1; // rebuild with the next pose
        };
        return slot;
    }

    /** @private */
    updateItemSlot(slot, state) {
        const arm = this.parts[slot.side === "right" ? "rightArm" : "leftArm"];

        // follow the arm (vanilla shifts the joint of slim arms by half a pixel outwards for the item)
        const slimShift = this.displayedVariant === "slim" ? (slot.side === "right" ? 0.5 : -0.5) : 0;
        slot.anchor.position.set(arm.position.x + slimShift, arm.position.y, arm.position.z);
        slot.anchor.rotation.copy(arm.rotation);

        const itemId = state && state.item && this.itemCache ? state.item.id : null;
        if (itemId !== slot.itemId) this.setSlotItem(slot, itemId);

        const entry = slot.entry;
        if (!entry) return;
        if (entry.state === "failed") {
            this.itemCache.retry(entry);
            return;
        }
        if (entry.state !== "loaded" || entry.models.length === 0) return;

        const modelIndex = selectItemModel(entry.models, state.predicates);
        if (modelIndex !== slot.modelIndex) this.showItemModel(slot, entry.models[modelIndex], modelIndex);
    }

    /** @private */
    setSlotItem(slot, itemId) {
        if (slot.entry) {
            slot.entry.listeners.delete(slot.onLoaded);
            this.itemCache.release(slot.entry);
        }
        slot.content.clear();
        slot.entry = itemId ? this.itemCache.acquire(itemId) : null;
        if (slot.entry) slot.entry.listeners.add(slot.onLoaded);
        slot.itemId = itemId;
        slot.modelIndex = -1;
    }

    /**
     * Creates the meshes of an item-model (only when the item or its override changes; geometries and materials are shared).
     * @private
     */
    showItemModel(slot, model, modelIndex) {
        slot.content.clear();
        for (const part of model.parts) {
            const mesh = nonInteractiveMesh(part.geometry, part.material);
            mesh.name = slot.side + "-item-part";
            if (part.position) mesh.position.set(part.position[0] * part.scale, part.position[1] * part.scale, part.position[2] * part.scale);
            mesh.scale.setScalar(part.scale);
            slot.content.add(mesh);
        }

        // vanilla Transformation.apply(leftHanded): the left hand mirrors the translation-x and the y- and z-rotation
        const transform = slot.side === "right" ? model.display.right : model.display.left;
        const left = slot.side === "left";
        const v = (array, i, fallback) => Array.isArray(array) && Number.isFinite(array[i]) ? array[i] : fallback;
        const display = slot.display;
        if (transform) {
            const t = i => MathUtils.clamp(v(transform.translation, i, 0) / 16, -MAX_ITEM_TRANSLATION, MAX_ITEM_TRANSLATION);
            const sc = i => MathUtils.clamp(v(transform.scale, i, 1), -MAX_ITEM_SCALE, MAX_ITEM_SCALE);
            const r = i => MathUtils.degToRad(v(transform.rotation, i, 0));
            display.position.set((left ? -1 : 1) * t(0), t(1), t(2));
            display.rotation.set(r(0), (left ? -1 : 1) * r(1), (left ? -1 : 1) * r(2), "XYZ");
            display.scale.set(sc(0), sc(1), sc(2));
        } else {
            display.position.set(0, 0, 0);
            display.rotation.set(0, 0, 0, "XYZ");
            display.scale.set(1, 1, 1);
        }
        slot.modelIndex = modelIndex;
    }

    /** @private */
    applyMaterials(skin) {
        for (const name of PART_NAMES) {
            const [baseMesh, overlayMesh] = this.parts[name].children;
            baseMesh.material = skin.baseMaterial;
            overlayMesh.material = skin.overlayMaterial;
        }
    }

    /**
     * Releases the skin. The shared geometries and the default skin are not disposed.
     */
    dispose() {
        for (const slot of Object.values(this.itemSlots)) {
            if (slot.itemId) this.setSlotItem(slot, null);
        }
        this.skinCache.defaultSkinListeners.delete(this.onSkinStateChanged);
        if (this.skin) {
            this.skin.listeners.delete(this.onSkinStateChanged);
            this.skinCache.release(this.skin);
        }
        this.skin = null;
        this.skinUrl = null;
        for (const name of PART_NAMES) this.parts[name].clear();
        this.displayedSkin = null;
        this.displayedVariant = null;
    }

}
