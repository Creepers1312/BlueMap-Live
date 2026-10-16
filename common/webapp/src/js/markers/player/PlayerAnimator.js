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

/*
 * Time-based animation of the player-model from the live player-state (no three.js, so it can be unit-tested with node).
 *
 * The animator only calculates a pose (rotations and pivot-offsets of the bones), the PlayerModel applies it.
 * The pose-object is allocated once and reused for every frame.
 *
 * Walking, idle, sneaking and the arm-swing follow the vanilla BipedEntityModel / LimbAnimator (1.21),
 * converted from ticks to seconds. Vanilla model-space is y-down and z-backwards: rotations around x are taken over,
 * rotations around y and z and offsets along y and z are negated. The poses in the air, while swimming/gliding and
 * while flying are approximations (see docs/bluemap-live/phase-3.md).
 */

import {applyArmPoses, armPoses, itemPredicates} from "./PlayerItemPoses.js";

const TICKS_PER_SECOND = 20;
const PI = Math.PI;

/** vanilla: LimbAnimator.updateLimbs(min(distancePerTick * 4, 1), 0.4) */
const LIMB_SPEED_FACTOR = 4 / TICKS_PER_SECOND;
const LIMB_SMOOTHING = 0.6; // remaining difference per tick
const LIMB_FREQUENCY = 0.6662;

/** vanilla: 6 ticks */
export const SWING_DURATION = 0.3;

/** time-constants (seconds) for blending between poses */
const SNEAK_BLEND_TIME = 0.05;
const AIR_BLEND_TIME = 0.1;
const LEAN_BLEND_TIME = 0.15;
const FLY_BLEND_TIME = 0.2;

/** vanilla PlayerEntityRenderer: a sneaking player is rendered 2 / 16 blocks lower */
const SNEAK_ROOT_OFFSET = -2 / 16;

/** the center of the model in blocks (32px * 0.9375 / 16 / 2), the swimming/gliding model is rotated around it */
const MODEL_CENTER = 0.9375;
/** the height (blocks) of the center of a swimming player (vanilla hitbox height 0.6) */
const SWIM_CENTER = 0.3;

const ARM_POSE_BLEND_TIME = 0.06;

/** a use-time that differs more than this (seconds) from the server is corrected (otherwise the own clock runs on) */
const USE_TIME_TOLERANCE = 0.3;

/** vanilla: hurtTime is 10 ticks */
export const HURT_DURATION = 0.5;

/** uses whose pose or item-model changes over time (the others are static poses, e.g. blocking with a shield) */
const ANIMATED_USE_ACTIONS = new Set(["bow", "crossbow", "eat", "drink"]);

/** a blend-weight closer than this to its target counts as settled */
const SETTLED = 0.001;

export const ANIMATED_PARTS = ["head", "body", "rightArm", "leftArm", "rightLeg", "leftLeg"];

const approach = (value, target, dt, time) => target + (value - target) * Math.exp(-dt / time);

function createPose() {
    const pose = {
        parts: {},
        /** offset and rotation (around x) of the whole model, in blocks / radians */
        rootY: 0,
        rootZ: 0,
        rootPitch: 0,
        /** the red hurt-overlay is shown */
        hurt: false,
        /** the held items of the right and the left arm and the values of their model-predicates */
        items: {
            right: {item: null, predicates: {}},
            left: {item: null, predicates: {}},
        },
    };
    for (const name of ANIMATED_PARTS) {
        // rotation in radians, position-offset to the base-pivot in pixels
        pose.parts[name] = {rx: 0, ry: 0, rz: 0, px: 0, py: 0, pz: 0};
    }
    return pose;
}

function resetPose(pose) {
    for (const name of ANIMATED_PARTS) {
        const p = pose.parts[name];
        p.rx = p.ry = p.rz = p.px = p.py = p.pz = 0;
    }
    pose.rootY = pose.rootZ = pose.rootPitch = 0;
}

export class PlayerAnimator {

    constructor() {
        this.pose = createPose();

        // target-state, set from the live-data
        this.targetLimbSpeed = 0;
        this.sneaking = false;
        this.riding = false;
        this.sleeping = false;
        this.inAir = false;
        this.fallSpeed = 0;
        this.leaning = false;
        this.flying = false;
        this.fallFlying = false;
        this.lastSwingCount = null;
        this.swingKind = null;
        this.lastHurtCount = null;
        this.hurtTime = 0;

        // held / used items
        this.itemState = {
            leftHanded: false, mainHand: null, offHand: null, fishing: false,
            use: null, useTicks: 0, swinging: false,
        };
        this.useKey = null;
        this.useTime = 0;
        this.armPoses = {right: "empty", left: "empty"};
        this.armOffsets = {right: {pitch: 0, yaw: 0}, left: {pitch: 0, yaw: 0}};
        this.armOffsetsSettled = true;
        this.vanillaArms = {right: {pitch: 0, yaw: 0}, left: {pitch: 0, yaw: 0}};
        this.headAngles = {pitch: 0, yaw: 0};

        this.reset();
    }

    /**
     * Resets the animation-state (e.g. after a teleport, respawn or world-change).
     * The next step jumps directly to the target pose instead of blending.
     * The swing-counter is kept, so the reset itself never starts a swing.
     */
    reset() {
        this.limbSpeed = 0;
        this.limbPos = 0;
        this.age = 0;

        this.sneakWeight = 0;
        this.airWeight = 0;
        this.leanWeight = 0;
        this.flyWeight = 0;

        this.swingTime = -1; // seconds since the swing started, -1 if not swinging
        this.swingLeft = false;

        if (this.armOffsets) {
            for (const side of ["right", "left"]) this.armOffsets[side].pitch = this.armOffsets[side].yaw = 0;
        }

        this.snap = true;
    }

    /**
     * Updates the target state from the live player-data. Missing values are treated as "standing on the ground".
     * @param player {import("../LivePlayerData").LivePlayer}
     */
    setTarget(player) {
        const state = player.state;
        const velocity = player.velocity;

        const horizontalSpeed = velocity ? Math.sqrt(velocity.x * velocity.x + velocity.z * velocity.z) : 0;
        // vanilla LivingEntityRenderer: a passenger has no limb-animation
        this.riding = !!(state && state.riding);
        // lying in a bed: no walking and no air-pose (the model is laid down by the PlayerMarker)
        this.sleeping = !!(state && state.bed);
        this.targetLimbSpeed = this.riding || this.sleeping ? 0 : Math.min(horizontalSpeed * LIMB_SPEED_FACTOR, 1);

        this.sneaking = !!(state && state.sneaking);
        this.flying = !!(state && state.flying);
        this.fallFlying = !!(state && state.fallFlying);
        this.leaning = !!(state && (state.swimming || state.fallFlying));
        this.inAir = !!(state && !state.onGround && !this.flying && !this.leaning && !this.riding && !this.sleeping);
        this.fallSpeed = velocity && velocity.y < 0 ? Math.min(-velocity.y / 20, 1) : 0;

        const swing = player.swing;
        if (swing) {
            // the first known counter only sets the reference, it is no new swing
            if (this.lastSwingCount !== null && swing.count !== this.lastSwingCount) {
                this.swingTime = 0;
                this.swingLeft = swing.arm === "left";
            }
            this.lastSwingCount = swing.count;
            this.swingKind = swing.kind;
        }

        // hurt (the first known counter only sets the reference)
        const hurt = player.hurt;
        if (hurt) {
            if (this.lastHurtCount !== null && hurt.count !== this.lastHurtCount) this.hurtTime = HURT_DURATION;
            this.lastHurtCount = hurt.count;
        }

        const equipment = player.equipment;
        const items = this.itemState;
        items.leftHanded = !!(equipment && equipment.leftHanded);
        items.mainHand = equipment ? equipment.mainHand : null;
        items.offHand = equipment ? equipment.offHand : null;
        items.fishing = !!(equipment && equipment.fishing);

        // the use-time runs on with the own clock between the samples, it is only corrected when it differs too much
        const use = items.mainHand || items.offHand ? player.use : null;
        if (use) {
            const key = (use.mainHand ? "main:" : "off:") + use.action;
            const serverTime = use.ticks / TICKS_PER_SECOND;
            if (key !== this.useKey || Math.abs(this.useTime - serverTime) > USE_TIME_TOLERANCE) this.useTime = serverTime;
            this.useKey = key;
        } else {
            this.useKey = null;
            this.useTime = 0;
        }
        items.use = use;
    }

    /**
     * Advances the animation.
     * @param dt {number} - time since the last step in seconds
     * @param headPitch {number} - the current head-pitch in radians (positive = looking down)
     * @param headYaw {number} - the current head-yaw relative to the body in radians (minecraft convention)
     * @returns {boolean} true if the model is moving (the caller should render with a high frame-rate)
     */
    step(dt, headPitch = 0, headYaw = 0) {
        if (!(dt >= 0)) dt = 0;
        const snap = this.snap;
        this.snap = false;

        // limbs (vanilla LimbAnimator, continuous in time)
        const ticks = dt * TICKS_PER_SECOND;
        this.limbSpeed = snap ? this.targetLimbSpeed :
            this.targetLimbSpeed + (this.limbSpeed - this.targetLimbSpeed) * Math.pow(LIMB_SMOOTHING, ticks);
        if (this.limbSpeed < 1e-4 && this.targetLimbSpeed === 0) this.limbSpeed = 0;
        this.limbPos = (this.limbPos + this.limbSpeed * ticks) % (2 * PI / LIMB_FREQUENCY * 1000);
        this.age = (this.age + ticks) % 100000;

        // blend-weights
        const blend = (weight, on, time) => snap ? (on ? 1 : 0) : approach(weight, on ? 1 : 0, dt, time);
        this.sneakWeight = blend(this.sneakWeight, this.sneaking, SNEAK_BLEND_TIME);
        this.airWeight = blend(this.airWeight, this.inAir, AIR_BLEND_TIME);
        this.leanWeight = blend(this.leanWeight, this.leaning, LEAN_BLEND_TIME);
        this.flyWeight = blend(this.flyWeight, this.flying || this.fallFlying, FLY_BLEND_TIME);

        // swing
        if (this.swingTime >= 0) {
            this.swingTime += dt;
            if (this.swingTime >= SWING_DURATION) this.swingTime = -1;
        }

        // hurt-overlay
        const hurting = this.hurtTime > 0;
        this.hurtTime = Math.max(0, this.hurtTime - dt);
        this.pose.hurt = this.hurtTime > 0;

        // used item
        if (this.useKey !== null) this.useTime += dt;
        this.itemState.useTicks = this.useTime * TICKS_PER_SECOND;
        this.itemState.swinging = this.swingTime >= 0;
        this.headAngles.pitch = headPitch;
        this.headAngles.yaw = headYaw;

        this.calculatePose(dt, snap);

        return this.limbSpeed > 0 ||
            this.swingTime >= 0 ||
            hurting ||
            (this.itemState.use !== null && ANIMATED_USE_ACTIONS.has(this.itemState.use.action)) ||
            !this.armOffsetsSettled ||
            Math.abs(this.sneakWeight - (this.sneaking ? 1 : 0)) > SETTLED ||
            Math.abs(this.airWeight - (this.inAir ? 1 : 0)) > SETTLED ||
            Math.abs(this.leanWeight - (this.leaning ? 1 : 0)) > SETTLED ||
            Math.abs(this.flyWeight - (this.flying || this.fallFlying ? 1 : 0)) > SETTLED;
    }

    /** @private */
    calculatePose(dt, snap) {
        const headPitch = this.headAngles.pitch;
        const pose = this.pose;
        resetPose(pose);
        const {head, body, rightArm, leftArm, rightLeg, leftLeg} = pose.parts;

        // walking (vanilla BipedEntityModel.setAngles), damped while flying/gliding
        const speed = this.riding ? 0 : this.limbSpeed * (1 - 0.7 * this.flyWeight);
        const phase = this.limbPos * LIMB_FREQUENCY;
        rightArm.rx = Math.cos(phase + PI) * speed;
        leftArm.rx = Math.cos(phase) * speed;
        rightLeg.rx = Math.cos(phase) * 1.4 * speed;
        leftLeg.rx = Math.cos(phase + PI) * 1.4 * speed;

        // riding (vanilla BipedEntityModel.setAngles): arms forward, legs sitting and spread (yaw / roll negated)
        if (this.riding) {
            rightArm.rx += -PI / 5;
            leftArm.rx += -PI / 5;
            rightLeg.rx = leftLeg.rx = -1.4137167;
            rightLeg.ry = -PI / 10;
            leftLeg.ry = PI / 10;
            rightLeg.rz = -0.07853982;
            leftLeg.rz = 0.07853982;
        }

        // arm-poses of held and used items (vanilla), blended: the difference to the walking-pose is smoothed
        this.calculateArmPoses(dt, snap, rightArm, leftArm);

        // idle arm-movement (vanilla CrossbowPosing.swingArms), the vanilla roll is negated
        const idleRoll = Math.cos(this.age * 0.09) * 0.05 + 0.05;
        const idlePitch = Math.sin(this.age * 0.067) * 0.05;
        if (this.armPoses.right !== "spyglass") {
            rightArm.rz -= idleRoll;
            rightArm.rx += idlePitch;
        }
        if (this.armPoses.left !== "spyglass") {
            leftArm.rz += idleRoll;
            leftArm.rx -= idlePitch;
        }

        // in the air (approximation, vanilla has no jump-pose): arms slightly spread, more while falling
        const air = this.airWeight;
        if (air > 0) {
            const spread = (0.15 + 0.35 * this.fallSpeed) * air;
            rightArm.rz -= spread;
            leftArm.rz += spread;
            rightLeg.rx -= 0.15 * air;
            leftLeg.rx += 0.1 * air;
        }

        // arm-swing (vanilla BipedEntityModel.animateArms)
        if (this.swingTime >= 0) {
            const progress = Math.min(this.swingTime / SWING_DURATION, 1);
            let bodyYaw = Math.sin(Math.sqrt(progress) * 2 * PI) * 0.2;
            if (this.swingLeft) bodyYaw = -bodyYaw;

            body.ry = -bodyYaw;
            rightArm.px = 5 - Math.cos(bodyYaw) * 5;
            rightArm.pz = -Math.sin(bodyYaw) * 5;
            leftArm.px = Math.cos(bodyYaw) * 5 - 5;
            leftArm.pz = Math.sin(bodyYaw) * 5;
            rightArm.ry -= bodyYaw;
            leftArm.ry -= bodyYaw;
            leftArm.rx += bodyYaw;

            let f = 1 - progress;
            f *= f;
            f *= f;
            f = 1 - f;
            const g = Math.sin(f * PI);
            const h = Math.sin(progress * PI) * -(headPitch - 0.7) * 0.75;
            const arm = this.swingLeft ? leftArm : rightArm;
            arm.rx -= g * 1.2 + h;
            arm.ry -= bodyYaw * 2;
            arm.rz += Math.sin(progress * PI) * 0.4;
        }

        // sneaking (vanilla BipedEntityModel.setAngles), blended
        const sneak = this.sneakWeight;
        if (sneak > 0) {
            body.rx += 0.5 * sneak;
            rightArm.rx += 0.4 * sneak;
            leftArm.rx += 0.4 * sneak;
            head.py -= 4.2 * sneak;
            body.py -= 3.2 * sneak;
            rightArm.py -= 3.2 * sneak;
            leftArm.py -= 3.2 * sneak;
            rightLeg.py -= 0.2 * sneak;
            leftLeg.py -= 0.2 * sneak;
            rightLeg.pz -= 4 * sneak;
            leftLeg.pz -= 4 * sneak;
            pose.rootY += SNEAK_ROOT_OFFSET * sneak;
        }

        // swimming / gliding (approximation): the model leans forward into the horizontal around its center
        const lean = this.leanWeight;
        if (lean > 0) {
            const angle = lean * PI / 2;
            const centerY = MODEL_CENTER + (SWIM_CENTER - MODEL_CENTER) * lean;
            pose.rootPitch = angle;
            pose.rootY += centerY - MODEL_CENTER * Math.cos(angle);
            pose.rootZ = -MODEL_CENTER * Math.sin(angle);
        }
    }

    /** @private */
    calculateArmPoses(dt, snap, rightArm, leftArm) {
        const items = this.itemState;
        const poses = armPoses(items);
        this.armPoses.right = poses.right;
        this.armPoses.left = poses.left;

        // the poses in vanilla convention (pitch = our x-rotation, yaw = negated y-rotation)
        const arms = this.vanillaArms;
        arms.right.pitch = rightArm.rx;
        arms.left.pitch = leftArm.rx;
        arms.right.yaw = arms.left.yaw = 0;
        applyArmPoses(arms, poses, items, this.headAngles, this.sneaking);

        let settled = true;
        for (const side of ["right", "left"]) {
            const offset = this.armOffsets[side];
            const walkPitch = side === "right" ? rightArm.rx : leftArm.rx;
            const targetPitch = arms[side].pitch - walkPitch;
            const targetYaw = arms[side].yaw;
            offset.pitch = snap ? targetPitch : approach(offset.pitch, targetPitch, dt, ARM_POSE_BLEND_TIME);
            offset.yaw = snap ? targetYaw : approach(offset.yaw, targetYaw, dt, ARM_POSE_BLEND_TIME);
            if (Math.abs(offset.pitch - targetPitch) > SETTLED || Math.abs(offset.yaw - targetYaw) > SETTLED) settled = false;
        }
        this.armOffsetsSettled = settled;

        rightArm.rx += this.armOffsets.right.pitch;
        rightArm.ry -= this.armOffsets.right.yaw;
        leftArm.rx += this.armOffsets.left.pitch;
        leftArm.ry -= this.armOffsets.left.yaw;

        // the items and their model-predicates per arm
        const right = this.pose.items.right, left = this.pose.items.left;
        right.item = items.leftHanded ? items.offHand : items.mainHand;
        left.item = items.leftHanded ? items.mainHand : items.offHand;
        itemPredicates(items, !items.leftHanded, right.predicates);
        itemPredicates(items, items.leftHanded, left.predicates);
    }

}
