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
import {buildPartGeometry} from "./mob/MobModelGeometry.js";
import {CHEST_LIDS, CHEST_TEXTURE_SIZE, chestTexture, containerKey, FACING_ROTATION, LID_PIVOT, lidHideBoxes, lidPitch,
    stepProgress} from "./ChestLids.js";

/*
 * Draws the moving lids of the opened chests (BlueMap Live, see ChestLids.js) and hides the lids of the tile-models
 * there (the hidden boxes of the hires-shader, see MapViewer).
 */

/** the size of the hidden-box arrays of the hires-shader */
export const MAX_HIDDEN_BOXES = 16;
const TICK = 0.05;

/** shared per part (single, left, right), never disposed */
const geometries = new Map();
function lidGeometry(part) {
    if (!geometries.has(part)) geometries.set(part, buildPartGeometry(CHEST_LIDS[part], CHEST_TEXTURE_SIZE));
    return geometries.get(part);
}

export class ChestLidView {

    /**
     * @param textureCache {import("./mob/TextureAssetCache.js").TextureAssetCache | null}
     */
    constructor(textureCache) {
        this.textureCache = textureCache;
        this.group = new Group();
        this.group.userData.noCss2d = true; // see CSS2DRenderer
        this.group.name = "bm-live-chest-lids";
        /** @type {Map<string, object>} */
        this.lids = new Map();
        this.accumulator = 0;
    }

    /**
     * The opened containers (played back): new ones start opening, missing ones close.
     * @param containers {Array<{position: {x: number, y: number, z: number}, texture: string, facing: string, part: string}>}
     */
    setOpen(containers) {
        const open = new Set();
        for (const container of containers) {
            const key = containerKey(container);
            open.add(key);
            let lid = this.lids.get(key);
            if (lid && (lid.container.texture !== container.texture || lid.container.facing !== container.facing ||
                    lid.container.part !== container.part)) {
                this.remove(key);
                lid = null;
            }
            if (!lid) lid = this.create(container);
            lid.open = true;
        }
        this.lids.forEach((lid, key) => {
            if (!open.has(key)) lid.open = false;
        });
    }

    /** @private */
    create(container) {
        const entry = this.textureCache ? this.textureCache.acquire(chestTexture(container.texture)) : null;
        const root = new Group();
        root.position.set(container.position.x, container.position.y, container.position.z);
        // vanilla: translate(0.5, 0.5, 0.5), rotate -asRotation around y, translate back
        const facing = new Group();
        facing.position.set(0.5, 0, 0.5);
        facing.rotation.y = -FACING_ROTATION[container.facing] * Math.PI / 180;
        const offset = new Group();
        offset.position.set(-0.5, 0, -0.5);
        const pivot = new Group();
        pivot.position.set(LID_PIVOT[0] / 16, LID_PIVOT[1] / 16, LID_PIVOT[2] / 16);
        pivot.scale.setScalar(1 / 16);
        root.add(facing);
        facing.add(offset);
        offset.add(pivot);
        const lid = {container, entry, root, pivot, mesh: null, open: false, progress: 0, lastProgress: 0,
            boxes: lidHideBoxes(container)};
        this.lids.set(containerKey(container), lid);
        this.group.add(root);
        return lid;
    }

    /** @private */
    remove(key) {
        const lid = this.lids.get(key);
        if (!lid) return;
        this.group.remove(lid.root);
        if (lid.entry) this.textureCache.release(lid.entry);
        this.lids.delete(key);
    }

    /**
     * @param dt {number} - seconds
     * @returns {boolean} if a lid moves, appears or disappears (needs high-fps rendering)
     */
    step(dt) {
        this.accumulator += Math.max(0, dt);
        let ticks = 0;
        let changed = false;
        const before = this.lids.size;
        while (this.accumulator >= TICK) {
            this.accumulator -= TICK;
            if (ticks++ >= 10) continue;
            this.lids.forEach((lid, key) => {
                lid.lastProgress = lid.progress;
                lid.progress = stepProgress(lid.progress, lid.open);
                if (!lid.open && lid.progress <= 0 && lid.lastProgress <= 0) this.remove(key);
            });
        }
        const delta = this.accumulator / TICK;
        this.lids.forEach(lid => {
            if (!lid.mesh && lid.entry) {
                if (lid.entry.state === "failed") this.textureCache.retry(lid.entry);
                const material = this.textureCache.material(lid.entry);
                if (material) {
                    lid.mesh = new Mesh(lidGeometry(lid.container.part), material);
                    lid.pivot.add(lid.mesh);
                    changed = true;
                }
            }
            if (lid.progress !== lid.lastProgress || lid.open !== (lid.progress >= 1)) changed = true;
            lid.pivot.rotation.x = lidPitch(lid.lastProgress + (lid.progress - lid.lastProgress) * delta);
        });
        return changed || this.lids.size !== before;
    }

    /**
     * The hidden boxes of the hires-shader: the tile-lids of the chests whose lid is drawn (not while its texture is
     * loading, then the closed tile-lid stays visible).
     * @param uniforms {{hiddenBoxesMin: {value: import("three").Vector3[]}, hiddenBoxesMax: {value: import("three").Vector3[]},
     *     hiddenBoxCount: {value: number}} | null}
     */
    applyHiddenBoxes(uniforms) {
        if (!uniforms || !uniforms.hiddenBoxesMin) return;
        let count = 0;
        this.lids.forEach(lid => {
            if (!lid.mesh) return;
            for (const box of lid.boxes) {
                if (count >= MAX_HIDDEN_BOXES) return;
                uniforms.hiddenBoxesMin.value[count].set(...box.min);
                uniforms.hiddenBoxesMax.value[count].set(...box.max);
                count++;
            }
        });
        uniforms.hiddenBoxCount.value = count;
    }

    clear() {
        [...this.lids.keys()].forEach(key => this.remove(key));
    }

    dispose() {
        this.clear();
        if (this.group.parent) this.group.parent.remove(this.group);
    }

}
