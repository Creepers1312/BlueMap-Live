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
import {Group, Vector3} from "three";
import {Marker} from "./Marker.js";
import {ItemView} from "./player/ItemView.js";
import {droppedItemMotion, entityKind, projectileDirection, THROWN_ITEM_SCALES} from "./LiveEntityData.js";
import {interpolationDuration} from "./LivePlayerData.js";

/** beyond this camera-distance (blocks) entities are not shown */
const ENTITY_MAX_DISTANCE = 300;

/** moving further than this (blocks) between two updates is not interpolated */
const MAX_INTERPOLATION_DISTANCE = 16;

/** arrow-like projectiles: the (flat) item is scaled to roughly the length of the vanilla arrow-model */
const PROJECTILE_SCALE = 0.6;

const FORWARD = new Vector3(0, 0, 1);
const tempDirection = new Vector3();
const tempPosition = new Vector3();

/**
 * An entity (no player) of the live-data: dropped items, thrown items and arrow-like projectiles (BlueMap Live).
 * It is not listed in the marker-menu and has no html-element, only the 3d-item.
 */
export class EntityMarker extends Marker {

    /**
     * @param markerId {string}
     * @param itemCache {import("./player/ItemAssetCache").ItemAssetCache}
     */
    constructor(markerId, itemCache) {
        super(markerId);
        Object.defineProperty(this, 'isEntityMarker', {value: true});
        this.data.type = "entity";
        this.data.listed = false;

        this.itemCache = itemCache;
        this.kind = null;
        this.entityType = null;
        this.body = new Group();
        this.add(this.body);
        this.view = null;

        /** a per-entity offset for the bobbing/rotation of dropped items (vanilla uses a random one) */
        this.motionOffset = 0;
        this.age = 0;

        this.lastData = null;
        this.from = new Vector3();
        this.to = new Vector3();
        this.progress = 1;
        this.duration = 0;
        this.direction = new Vector3(0, 0, 1);
    }

    /**
     * @param entity {import("./LiveEntityData").LiveEntity}
     * @param updateInterval {number} - ms until the next update
     */
    updateFromData(entity, updateInterval) {
        if (this.kind === null) {
            this.kind = entityKind(entity);
            this.entityType = entity.type;
            this.motionOffset = (entity.id * 2.399963) % (Math.PI * 2);
            this.createView();
        }

        const previous = this.lastData;
        this.to.set(entity.position.x, entity.position.y, entity.position.z);
        const jump = !previous || this.to.distanceTo(tempPosition.set(previous.position.x, previous.position.y, previous.position.z)) > MAX_INTERPOLATION_DISTANCE;
        if (jump) {
            this.from.copy(this.to);
            this.position.copy(this.to);
            this.progress = 1;
            this.duration = 0;
        } else {
            this.from.copy(this.position);
            this.progress = 0;
            this.duration = interpolationDuration(previous, entity, updateInterval) / 1000;
        }

        const d = projectileDirection(entity);
        this.direction.set(d.x, d.y, d.z);

        if (this.view) {
            const item = entity.item;
            this.view.update(item ? item.id : null, {custom_model_data: item && item.customModelData !== null ? item.customModelData : 0});
        }
        this.lastData = entity;
    }

    /** @private */
    createView() {
        if (!this.kind) return;
        // arrow-like projectiles have no display-transformation, they are oriented along the flight-direction
        this.view = new ItemView(this.itemCache, this.kind === "projectile" ? "none" : "ground");

        if (this.kind === "projectile") {
            // the item-texture runs diagonally (tail bottom-left, tip top-right): rotate it to point along +z
            const orientation = new Group();
            const diagonal = new Group();
            diagonal.rotation.z = -Math.PI / 4;
            orientation.rotation.y = -Math.PI / 2;
            orientation.scale.setScalar(PROJECTILE_SCALE);
            diagonal.add(this.view);
            orientation.add(diagonal);
            this.body.add(orientation);
        } else {
            this.body.add(this.view);
        }
    }

    /**
     * Advances the interpolation and the vanilla item-motion.
     * @param dt {number} - seconds
     * @param camera {import("three").Camera | null}
     * @returns {boolean} true if the entity is moving (high frame-rate needed)
     */
    step(dt, camera) {
        this.age += dt * 20;

        let moving = false;
        if (this.progress < 1) {
            this.progress = this.duration > 0 ? Math.min(1, this.progress + dt / this.duration) : 1;
            this.position.lerpVectors(this.from, this.to, this.progress);
            moving = true;
        }

        if (this.view) {
            // the item may still be loading or update its model (overrides)
            this.view.update(this.view.itemId, {custom_model_data: this.lastData?.item?.customModelData ?? 0});
        }

        const body = this.body;
        if (this.kind === "item") {
            const motion = droppedItemMotion(this.age, this.motionOffset);
            body.position.set(0, motion.bob + 0.25 * (this.view ? this.view.displayScaleY : 1), 0);
            body.rotation.set(0, motion.rotation, 0);
        } else if (this.kind === "thrown") {
            if (camera) body.quaternion.copy(camera.quaternion);
            body.scale.setScalar(THROWN_ITEM_SCALES[this.entityType] || 1);
        } else if (this.kind === "projectile") {
            tempDirection.copy(this.direction);
            body.quaternion.setFromUnitVectors(FORWARD, tempDirection.normalize());
        }

        if (camera) {
            const distance = Marker.calculateDistanceToCameraPlane(this.position, camera);
            body.visible = distance <= ENTITY_MAX_DISTANCE;
        }
        return moving;
    }

    dispose() {
        super.dispose();
        if (this.view) this.view.dispose();
        this.view = null;
        this.body.clear();
    }

}

