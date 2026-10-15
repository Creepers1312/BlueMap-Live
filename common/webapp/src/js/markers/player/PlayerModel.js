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
import {getPlayerModelGeometries} from "./PlayerModelGeometry.js";
import {PART_NAMES, PIXEL_SCALE} from "./PlayerModelLayout.js";

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
     */
    constructor(skinCache) {
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
            if (name === "head") bone.rotation.order = "YXZ";
            this.parts[name] = bone;
            this.root.add(bone);
        }

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
        const geometries = getPlayerModelGeometries(variant);
        for (const name of PART_NAMES) {
            const bone = this.parts[name];
            bone.clear();

            const {layout, base, overlay} = geometries.get(name);
            bone.position.set(layout.pivot[0], layout.pivot[1], layout.pivot[2]);

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
