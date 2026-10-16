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
import {Group, MathUtils, Vector3} from "three";
import {Marker} from "./Marker.js";
import {ItemView} from "./player/ItemView.js";
import {
    droppedItemMotion, entityKind, projectileAngles, projectileDirection, projectilePhysics, THROWN_ITEM_SCALES,
} from "./LiveEntityData.js";
import {angleDelta, interpolationDuration} from "./LivePlayerData.js";
import {MobModel} from "./mob/MobModel.js";
import {CREEPER_FUSE_TICKS, limbTarget, MOB_TYPES} from "./mob/MobTypes.js";
import {PlaceholderModel} from "./mob/PlaceholderModel.js";

/** beyond this camera-distance (blocks) entities are not shown */
const ENTITY_MAX_DISTANCE = 300;

/** moving further than this (blocks) between two updates is not interpolated */
const MAX_INTERPOLATION_DISTANCE = 16;

/** a flight is predicted at most this long (seconds) after the last sample (e.g. if the updates stop) */
const MAX_PREDICTION_TIME = 0.75;

/** the difference between the predicted and the sampled position is blended away with this time-constant (seconds) */
const CORRECTION_TIME = 0.1;

/** flat items oriented along the flight (trident): scaled to roughly the length of the vanilla model */
const PROJECTILE_SCALE = 0.6;

/** vanilla LimbAnimator: the limb-speed approaches the target by 40% per tick */
const LIMB_SMOOTHING = 0.6;

/** vanilla: a death-animation takes 20 ticks, then the entity is removed */
const DEATH_TICKS = 20;

const FORWARD = new Vector3(0, 0, 1);
const tempVector = new Vector3();

/**
 * An entity (no player) of the live-data (BlueMap Live): dropped items, thrown items, arrows (vanilla arrow-model)
 * and other projectiles. It is not listed in the marker-menu and has no html-element.
 * <p>Flying projectiles and thrown items are predicted between the samples with the vanilla physics (velocity, drag,
 * gravity per tick), every new sample only corrects the position smoothly. Dropped items are interpolated.</p>
 */
export class EntityMarker extends Marker {

    /**
     * @param markerId {string}
     * @param itemCache {import("./player/ItemAssetCache").ItemAssetCache} - item-models
     * @param entityCache {import("./player/ItemAssetCache").ItemAssetCache | null} - own entity-models (arrow)
     * @param mobCache {import("./mob/MobAssetCache").MobAssetCache | null} - mob-textures
     */
    constructor(markerId, itemCache, entityCache = null, mobCache = null) {
        super(markerId);
        Object.defineProperty(this, 'isEntityMarker', {value: true});
        this.data.type = "entity";
        this.data.listed = false;

        this.itemCache = itemCache;
        this.entityCache = entityCache;
        this.mobCache = mobCache;
        this.kind = null;
        this.entityType = null;
        this.body = new Group();
        this.add(this.body);
        this.view = null;

        this.motionOffset = 0;
        this.age = 0;
        this.lastData = null;

        // interpolation (dropped items, resting projectiles)
        this.from = new Vector3();
        this.to = new Vector3();
        this.progress = 1;
        this.duration = 0;

        // flight-prediction (in ticks)
        this.predicting = false;
        this.simPosition = new Vector3();
        this.simPrevious = new Vector3();
        this.simVelocity = new Vector3();
        this.tickProgress = 0;
        this.sinceSample = 0;
        this.correction = new Vector3();
        this.physics = projectilePhysics("");
        /** where the projectile hits a block (from the server), null if unknown */
        this.impact = null;
        this.impacted = false;

        this.direction = new Vector3(0, 0, 1);

        // mobs: interpolated rotations (degrees) and the animation-state
        this.rotationFrom = {body: 0, head: 0, pitch: 0};
        this.rotationTo = {body: 0, head: 0, pitch: 0};
        this.rotation3 = {body: 0, head: 0, pitch: 0};
        this.lastPosition = new Vector3();
        this.limbSpeed = 0;
        this.limbPos = 0;
        this.hurtTime = 0;
        this.deathTicks = 0;
        this.flapProgress = 0;
        this.flapSpeed = 0;
        this.wingDeviation = 0;
        this.tickRemainder = 0;
        this.fuseTicks = 0;
        this.animationInput = {
            limbAngle: 0, limbDistance: 0, age: 0, headYaw: 0, headPitch: 0, swingProgress: 0,
            flags: new Set(), mainHand: null, leftHanded: false, wingAngle: 0,
        };
    }

    /**
     * @param entity {import("./LiveEntityData").LiveEntity}
     * @param updateInterval {number} - ms until the next update
     */
    updateFromData(entity, updateInterval) {
        if (this.kind === null) {
            this.kind = entityKind(entity);
            this.entityType = entity.type;
            this.physics = projectilePhysics(entity.type);
            this.motionOffset = (entity.id * 2.399963) % (Math.PI * 2);
            this.createView();
        }

        const previous = this.lastData;
        // the same sample again (e.g. a cached live/entities.json): the running motion is not restarted
        if (previous && previous.time !== null && entity.time === previous.time && previous.type === entity.type) {
            this.lastData = entity;
            return;
        }
        const first = !previous;
        tempVector.set(entity.position.x, entity.position.y, entity.position.z);
        const jump = first || tempVector.distanceTo(this.position) > MAX_INTERPOLATION_DISTANCE;
        const isMob = this.kind === "mob" || this.kind === "placeholder";
        const flying = this.kind !== "item" && !isMob && !entity.onGround;
        if (isMob) this.updateMobTarget(entity, jump);

        if (flying) {
            // predict from the new sample, the current difference is blended away (no visible jump)
            this.correction.copy(jump ? tempVector : this.position).sub(tempVector);
            // simPrevious is the state at the current tick, simPosition one tick ahead (interpolated in between)
            this.simPrevious.copy(tempVector);
            this.simPosition.copy(tempVector);
            this.simVelocity.set(entity.velocity.x / 20, entity.velocity.y / 20, entity.velocity.z / 20);
            this.advanceTick();
            this.tickProgress = 0;
            this.sinceSample = 0;
            this.predicting = true;
            this.impact = entity.impact;
            this.impacted = false;
            this.progress = 1;
            if (jump) this.position.copy(tempVector);
        } else {
            this.predicting = false;
            this.to.copy(tempVector);
            if (jump) {
                this.from.copy(tempVector);
                this.position.copy(tempVector);
                this.progress = 1;
                this.duration = 0;
            } else {
                this.from.copy(this.position);
                this.progress = 0;
                this.duration = interpolationDuration(previous, entity, updateInterval) / 1000;
            }
        }

        const d = projectileDirection(entity);
        if (!flying || first) this.direction.set(d.x, d.y, d.z);

        this.updateView(entity);
        this.lastData = entity;
    }

    /** @private */
    updateMobTarget(entity, jump) {
        const mob = entity.mob;
        const target = {body: mob.bodyYaw, head: mob.headYaw, pitch: entity.rotation.pitch};
        if (jump) {
            Object.assign(this.rotationFrom, target);
            Object.assign(this.rotation3, target);
            this.lastPosition.set(entity.position.x, entity.position.y, entity.position.z);
            this.limbSpeed = 0;
        } else {
            Object.assign(this.rotationFrom, this.rotation3);
        }
        Object.assign(this.rotationTo, target);

        // hurt: vanilla shows the overlay while hurtTime > 0 (ticks)
        if (mob.hurtTime > 0) this.hurtTime = Math.max(this.hurtTime, mob.hurtTime / 20);
        // death: the local clock runs on from the sampled deathTime
        if (mob.deathTime > 0) this.deathTicks = Math.max(this.deathTicks, mob.deathTime);
        else this.deathTicks = 0;

        if (this.view && this.view.isMobModel) {
            const equipment = mob.equipment;
            this.view.setState(mob, {
                mainHand: equipment ? equipment.mainHand : null,
                offHand: equipment ? equipment.offHand : null,
                leftHanded: !!(equipment && equipment.leftHanded),
            });
        } else if (this.view && this.view.isPlaceholderModel) {
            this.view.setSize(mob.width, mob.height);
        }
    }

    /** @private */
    createView() {
        if (!this.kind) return;
        if (this.kind === "mob") {
            this.view = new MobModel(this.entityType, MOB_TYPES[this.entityType], this.mobCache, this.itemCache);
            this.body.add(this.view);
            return;
        }
        if (this.kind === "placeholder") {
            this.view = new PlaceholderModel(this.entityType);
            this.body.add(this.view);
            return;
        }
        if (this.kind === "arrow") {
            // the vanilla arrow-model (entity-asset), no display-transformation
            this.view = new ItemView(this.entityCache, "none");
            this.body.add(this.view);
        } else if (this.kind === "projectile") {
            // flat item: the texture runs diagonally (tail bottom-left, tip top-right), rotated to point along +z
            this.view = new ItemView(this.itemCache, "none");
            const orientation = new Group();
            const diagonal = new Group();
            diagonal.rotation.z = -Math.PI / 4;
            orientation.rotation.y = -Math.PI / 2;
            orientation.scale.setScalar(PROJECTILE_SCALE);
            diagonal.add(this.view);
            orientation.add(diagonal);
            this.body.add(orientation);
        } else {
            this.view = new ItemView(this.itemCache, "ground");
            this.body.add(this.view);
        }
    }

    /** @private */
    updateView(entity = this.lastData) {
        if (!this.view || !entity) return;
        if (this.kind === "mob" || this.kind === "placeholder") return;
        if (this.kind === "arrow") {
            this.view.update(entity.type, {});
        } else {
            const item = entity.item;
            this.view.update(item ? item.id : null, {custom_model_data: item && item.customModelData !== null ? item.customModelData : 0});
        }
    }

    /**
     * Advances the prediction / interpolation and the vanilla item-motion.
     * @param dt {number} - seconds
     * @param camera {import("three").Camera | null}
     * @returns {boolean} true if the entity is moving (high frame-rate needed)
     */
    step(dt, camera) {
        this.age += dt * 20;

        let moving = false;
        if (this.predicting) {
            moving = this.stepPrediction(dt);
        } else if (this.progress < 1) {
            this.progress = this.duration > 0 ? Math.min(1, this.progress + dt / this.duration) : 1;
            this.position.lerpVectors(this.from, this.to, this.progress);
            moving = true;
        }

        // the model may still be loading or change its override
        this.updateView();

        const body = this.body;
        if (this.kind === "mob" || this.kind === "placeholder") {
            if (this.stepMob(dt)) moving = true;
        } else if (this.kind === "item") {
            const motion = droppedItemMotion(this.age, this.motionOffset);
            body.position.set(0, motion.bob + 0.25 * (this.view ? this.view.displayScaleY : 1), 0);
            body.rotation.set(0, motion.rotation, 0);
        } else if (this.kind === "thrown") {
            if (camera) body.quaternion.copy(camera.quaternion);
            body.scale.setScalar(THROWN_ITEM_SCALES[this.entityType] || 1);
        } else if (this.kind === "arrow") {
            // vanilla ArrowEntityRenderer: rotate y by (yaw - 90°), then z by pitch; the model points along +x
            const angles = projectileAngles(this.direction);
            body.rotation.set(0, MathUtils.degToRad(angles.yaw - 90), MathUtils.degToRad(angles.pitch), "YZX");
        } else if (this.kind === "projectile") {
            body.quaternion.setFromUnitVectors(FORWARD, tempVector.copy(this.direction).normalize());
        }

        if (camera) {
            const distance = Marker.calculateDistanceToCameraPlane(this.position, camera);
            body.visible = distance <= ENTITY_MAX_DISTANCE;
        }
        return moving;
    }

    /**
     * The animation of a mob: rotations, walking (vanilla LimbAnimator from the displayed movement), hurt, death
     * and the wings of chickens.
     * @private
     * @returns {boolean} true if it is animated (high frame-rate needed)
     */
    stepMob(dt) {
        const entity = this.lastData;
        if (!entity || !entity.mob) return false;
        const mob = entity.mob;
        const t = this.progress;

        // rotations, interpolated with the position (shortest way)
        const r = this.rotation3;
        r.body = this.rotationFrom.body + angleDelta(this.rotationFrom.body, this.rotationTo.body) * t;
        r.head = this.rotationFrom.head + angleDelta(this.rotationFrom.head, this.rotationTo.head) * t;
        r.pitch = this.rotationFrom.pitch + (this.rotationTo.pitch - this.rotationFrom.pitch) * t;

        // walking: the horizontal movement of the displayed position, per tick
        const ticks = dt * 20;
        const moved = Math.hypot(this.position.x - this.lastPosition.x, this.position.z - this.lastPosition.z);
        this.lastPosition.copy(this.position);
        const target = ticks > 0 ? limbTarget(moved / ticks) : this.limbSpeed;
        this.limbSpeed = target + (this.limbSpeed - target) * Math.pow(LIMB_SMOOTHING, ticks);
        if (this.limbSpeed < 1e-4 && target === 0) this.limbSpeed = 0;
        const dying = this.deathTicks > 0;
        if (!dying) this.limbPos += this.limbSpeed * ticks;

        this.hurtTime = Math.max(0, this.hurtTime - dt);
        if (dying) this.deathTicks = Math.min(DEATH_TICKS, this.deathTicks + ticks);

        // vanilla ChickenEntity.tickMovement: the wings flap in the air (per tick)
        this.tickRemainder += ticks;
        for (let i = 0; this.tickRemainder >= 1 && i < 20; i++) {
            this.tickRemainder -= 1;
            this.wingDeviation = Math.min(1, Math.max(0, this.wingDeviation + (entity.onGround ? -1 : 4) * 0.3));
            if (!entity.onGround && this.flapSpeed < 1) this.flapSpeed = 1;
            this.flapSpeed *= 0.9;
            this.flapProgress += this.flapSpeed * 2;
            // vanilla CreeperEntity.tick: the fuse runs up while ignited and back down otherwise
            this.fuseTicks = Math.min(CREEPER_FUSE_TICKS, Math.max(0, this.fuseTicks + (mob.flags.has("fusing") ? 1 : -1)));
        }

        const input = this.animationInput;
        input.limbAngle = dying ? 0 : this.limbPos * (mob.baby ? 3 : 1);
        input.limbDistance = dying ? 0 : Math.min(this.limbSpeed, 1);
        input.age = this.age;
        input.headYaw = angleDelta(r.body, r.head);
        input.headPitch = r.pitch;
        input.flags = mob.flags;
        input.mainHand = mob.equipment ? mob.equipment.mainHand : null;
        input.leftHanded = !!(mob.equipment && mob.equipment.leftHanded);
        input.wingAngle = (Math.sin(this.flapProgress) + 1) * this.wingDeviation;

        const hurt = this.hurtTime > 0 || dying;
        const fuse = this.fuseTicks / (CREEPER_FUSE_TICKS - 2);
        if (this.view && this.view.isMobModel) this.view.animate(input, r.body, this.deathTicks, hurt, fuse);
        else if (this.view && this.view.isPlaceholderModel) this.view.animate(r.body, hurt);

        return this.limbSpeed > 0 || this.progress < 1 || hurt || dying || this.wingDeviation > 0 || mob.flags.has("charged") ||
            this.fuseTicks > 0;
    }

    /** @private */
    stepPrediction(dt) {
        this.sinceSample += dt;

        // the server predicted where the projectile hits a block: it stops there (instead of flying through it)
        const impact = this.impact;
        if (impact && this.sinceSample * 20 >= impact.ticks) {
            this.impacted = true;
            this.correction.multiplyScalar(Math.exp(-dt / CORRECTION_TIME));
            this.position.set(impact.x, impact.y, impact.z).add(this.correction);
            return this.correction.lengthSq() > 1e-6;
        }

        if (this.sinceSample <= MAX_PREDICTION_TIME) {
            this.tickProgress += dt * 20;
            for (let i = 0; this.tickProgress >= 1 - 1e-9 && i < 20; i++) {
                this.simPrevious.copy(this.simPosition);
                this.advanceTick();
                this.tickProgress = Math.max(0, this.tickProgress - 1);
            }
            this.tickProgress = Math.min(this.tickProgress, 1);
            // the rotation follows the movement of the current tick (vanilla: the rotation from the current velocity)
            tempVector.copy(this.simPosition).sub(this.simPrevious);
            if (tempVector.lengthSq() > 1e-8) this.direction.copy(tempVector).normalize();
        }

        this.correction.multiplyScalar(Math.exp(-dt / CORRECTION_TIME));
        this.position.lerpVectors(this.simPrevious, this.simPosition, this.tickProgress).add(this.correction);
        return this.sinceSample <= MAX_PREDICTION_TIME || this.correction.lengthSq() > 1e-6;
    }

    /** one tick of the vanilla projectile-physics: move, then drag and gravity @private */
    advanceTick() {
        this.simPosition.add(this.simVelocity);
        this.simVelocity.multiplyScalar(this.physics.drag);
        this.simVelocity.y -= this.physics.gravity;
    }

    dispose() {
        super.dispose();
        if (this.view) this.view.dispose();
        this.view = null;
        this.body.clear();
    }

}
