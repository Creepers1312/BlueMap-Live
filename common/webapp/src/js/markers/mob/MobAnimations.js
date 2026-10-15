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
 * The vanilla model-animations of the mobs (setAngles / animateModel of the vanilla entity-models, 1.21) as pure
 * functions on the part-transforms (no three.js), so they can be unit-tested with node.
 * Every function gets the transforms of all parts (reset to the model-data before) and the animation-input.
 */

import {applyArmPoses} from "../player/PlayerItemPoses.js";

const PI = Math.PI;
const DEG = PI / 180;
const cos = Math.cos, sin = Math.sin;

/**
 * @typedef PartTransform {{pitch: number, yaw: number, roll: number, pivotX: number, pivotY: number, pivotZ: number, visible: boolean}}
 * @typedef AnimationInput {{
 *     limbAngle: number,       vanilla limbAnimator.getPos (baby: * 3)
 *     limbDistance: number,    vanilla limbAnimator.getSpeed (max 1)
 *     age: number,             animation-progress in ticks
 *     headYaw: number,         degrees, relative to the body
 *     headPitch: number,       degrees
 *     swingProgress: number,   0..1 (vanilla handSwingProgress), 0 if not swinging
 *     flags: Set<string>,      e.g. "attacking"
 *     mainHand: {id: string} | null,
 *     leftHanded: boolean,
 *     wingAngle: number        chicken: vanilla (sin(flapProgress) + 1) * maxWingDeviation
 * }}
 */

/** a transform from the model-data of a part */
export function createTransform(part) {
    const pivot = part.pivot || [0, 0, 0], rotation = part.rotation || [0, 0, 0];
    return {
        pitch: rotation[0], yaw: rotation[1], roll: rotation[2],
        pivotX: pivot[0], pivotY: pivot[1], pivotZ: pivot[2],
        visible: true,
    };
}

/** resets a transform to the model-data */
export function resetTransform(transform, part) {
    const pivot = part.pivot || [0, 0, 0], rotation = part.rotation || [0, 0, 0];
    transform.pitch = rotation[0]; transform.yaw = rotation[1]; transform.roll = rotation[2];
    transform.pivotX = pivot[0]; transform.pivotY = pivot[1]; transform.pivotZ = pivot[2];
    transform.visible = true;
}

function copyTransform(target, source) {
    if (!target || !source) return;
    target.pitch = source.pitch; target.yaw = source.yaw; target.roll = source.roll;
    target.pivotX = source.pivotX; target.pivotY = source.pivotY; target.pivotZ = source.pivotZ;
}

/** vanilla CrossbowPosing.swingArm (idle arm-sway) */
function swingArm(arm, age, sigma) {
    arm.roll += sigma * (cos(age * 0.09) * 0.05 + 0.05);
    arm.pitch += sigma * sin(age * 0.067) * 0.05;
}

/** vanilla CrossbowPosing.meleeAttack (zombies: arms forward, raised further while attacking) */
export function meleeAttack(leftArm, rightArm, attacking, swingProgress, age) {
    const f = sin(swingProgress * PI);
    const g = sin((1 - (1 - swingProgress) * (1 - swingProgress)) * PI);
    rightArm.roll = 0;
    leftArm.roll = 0;
    rightArm.yaw = -(0.1 - f * 0.6);
    leftArm.yaw = 0.1 - f * 0.6;
    const h = -PI / (attacking ? 1.5 : 2.25);
    rightArm.pitch = h;
    leftArm.pitch = h;
    rightArm.pitch += f * 1.2 - g * 0.4;
    leftArm.pitch += f * 1.2 - g * 0.4;
    swingArm(rightArm, age, 1);
    swingArm(leftArm, age, -1);
}

/** vanilla BipedEntityModel.animateArms (the attack-swing of the main arm) */
function animateArms(p, input) {
    const swing = input.swingProgress;
    if (!(swing > 0)) return;
    const right = !input.leftHanded;
    const arm = right ? p.right_arm : p.left_arm;
    const body = p.body;
    body.yaw = sin(Math.sqrt(swing) * PI * 2) * 0.2;
    if (!right) body.yaw *= -1;
    p.right_arm.pivotZ = sin(body.yaw) * 5;
    p.right_arm.pivotX = -cos(body.yaw) * 5;
    p.left_arm.pivotZ = -sin(body.yaw) * 5;
    p.left_arm.pivotX = cos(body.yaw) * 5;
    p.right_arm.yaw += body.yaw;
    p.left_arm.yaw += body.yaw;
    p.left_arm.pitch += body.yaw;
    let f = 1 - swing;
    f *= f;
    f *= f;
    f = 1 - f;
    const g = sin(f * PI);
    const h = sin(swing * PI) * -(p.head.pitch - 0.7) * 0.75;
    arm.pitch -= g * 1.2 + h;
    arm.yaw += body.yaw * 2;
    arm.roll += sin(swing * PI) * -0.4;
}

/**
 * vanilla BipedEntityModel.setAngles (no riding, sneaking, swimming or gliding: mobs on the ground)
 * @param poses {{right: string, left: string}} - the arm-poses (vanilla ArmPose, as in PlayerItemPoses)
 */
export function biped(p, input, poses = {right: "empty", left: "empty"}) {
    const f = input.limbAngle, g = input.limbDistance;
    const {head, body, right_arm: rightArm, left_arm: leftArm, right_leg: rightLeg, left_leg: leftLeg} = p;
    head.yaw = input.headYaw * DEG;
    head.pitch = input.headPitch * DEG;
    body.yaw = 0;
    rightArm.pivotZ = 0; rightArm.pivotX = -5;
    leftArm.pivotZ = 0; leftArm.pivotX = 5;
    rightArm.pitch = cos(f * 0.6662 + PI) * 2 * g * 0.5;
    leftArm.pitch = cos(f * 0.6662) * 2 * g * 0.5;
    rightArm.roll = 0;
    leftArm.roll = 0;
    rightLeg.pitch = cos(f * 0.6662) * 1.4 * g;
    leftLeg.pitch = cos(f * 0.6662 + PI) * 1.4 * g;
    rightLeg.yaw = 0.005; leftLeg.yaw = -0.005;
    rightLeg.roll = 0.005; leftLeg.roll = -0.005;
    rightArm.yaw = 0;
    leftArm.yaw = 0;

    if (poses.right !== "empty" || poses.left !== "empty") {
        const arms = {right: {pitch: rightArm.pitch, yaw: 0}, left: {pitch: leftArm.pitch, yaw: 0}};
        applyArmPoses(arms, poses, {leftHanded: input.leftHanded, use: null, useTicks: 0}, {pitch: head.pitch, yaw: head.yaw}, false);
        rightArm.pitch = arms.right.pitch; rightArm.yaw = arms.right.yaw;
        leftArm.pitch = arms.left.pitch; leftArm.yaw = arms.left.yaw;
    }

    animateArms(p, input);
    swingArm(rightArm, input.age, 1);
    swingArm(leftArm, input.age, -1);
    copyTransform(p.hat, head);
}

const isOf = (item, id) => !!item && item.id === id;

/** the arm-poses that the vanilla models set in animateModel for the main hand */
function mainHandPose(input, pose) {
    return input.leftHanded ? {right: "empty", left: pose} : {right: pose, left: "empty"};
}

/** vanilla ZombieEntityModel / AbstractZombieModel / ZombieVillagerEntityModel */
export function zombie(p, input) {
    biped(p, input);
    meleeAttack(p.left_arm, p.right_arm, input.flags.has("attacking"), input.swingProgress, input.age);
}

/** vanilla DrownedEntityModel: like a zombie, the trident is raised while attacking */
export function drowned(p, input) {
    const throwing = isOf(input.mainHand, "minecraft:trident") && input.flags.has("attacking");
    const poses = throwing ? mainHandPose(input, "throw_spear") : {right: "empty", left: "empty"};
    biped(p, input, poses);
    meleeAttack(p.left_arm, p.right_arm, input.flags.has("attacking"), input.swingProgress, input.age);
    if (poses.left === "throw_spear") {
        p.left_arm.pitch = p.left_arm.pitch * 0.5 - PI;
        p.left_arm.yaw = 0;
    }
    if (poses.right === "throw_spear") {
        p.right_arm.pitch = p.right_arm.pitch * 0.5 - PI;
        p.right_arm.yaw = 0;
    }
}

/** vanilla SkeletonEntityModel: aims with the bow while attacking, arms forward with other weapons */
export function skeleton(p, input) {
    const attacking = input.flags.has("attacking");
    const bow = isOf(input.mainHand, "minecraft:bow");
    biped(p, input, bow && attacking ? mainHandPose(input, "bow_and_arrow") : undefined);
    if (attacking && !bow) {
        const k = sin(input.swingProgress * PI);
        const l = sin((1 - (1 - input.swingProgress) * (1 - input.swingProgress)) * PI);
        const {right_arm: rightArm, left_arm: leftArm} = p;
        rightArm.roll = 0;
        leftArm.roll = 0;
        rightArm.yaw = -(0.1 - k * 0.6);
        leftArm.yaw = 0.1 - k * 0.6;
        rightArm.pitch = -PI / 2;
        leftArm.pitch = -PI / 2;
        rightArm.pitch -= k * 1.2 - l * 0.4;
        leftArm.pitch -= k * 1.2 - l * 0.4;
        swingArm(rightArm, input.age, 1);
        swingArm(leftArm, input.age, -1);
    }
}

/** vanilla PlayerEntityModel: the second layer follows the limbs */
function copyPlayerLayers(p) {
    copyTransform(p.left_pants, p.left_leg);
    copyTransform(p.right_pants, p.right_leg);
    copyTransform(p.left_sleeve, p.left_arm);
    copyTransform(p.right_sleeve, p.right_arm);
    copyTransform(p.jacket, p.body);
    copyTransform(p.hat, p.head);
}

/** vanilla PiglinEntityModel (piglin, piglin brute, zombified piglin); the dance (celebrating piglins) is not shown */
export function piglin(p, input, zombified = false) {
    const flags = input.flags;
    const crossbowHold = flags.has("crossbow_hold"), crossbowCharge = flags.has("crossbow_charge");
    biped(p, input);
    const k = input.age * 0.1 + input.limbAngle * 0.5;
    const m = 0.08 + input.limbDistance * 0.4;
    if (p["head/left_ear"]) p["head/left_ear"].roll = -PI / 6 - cos(k * 1.2) * m;
    if (p["head/right_ear"]) p["head/right_ear"].roll = PI / 6 + cos(k) * m;

    if (zombified) {
        meleeAttack(p.left_arm, p.right_arm, flags.has("attacking"), input.swingProgress, input.age);
    } else if (flags.has("melee") && !(input.swingProgress > 0)) {
        if (input.leftHanded) p.left_arm.pitch = -1.8;
        else p.right_arm.pitch = -1.8;
    } else if (crossbowHold || crossbowCharge) {
        const arms = {right: {pitch: p.right_arm.pitch, yaw: p.right_arm.yaw}, left: {pitch: p.left_arm.pitch, yaw: p.left_arm.yaw}};
        const pose = crossbowHold ? "crossbow_hold" : "crossbow_charge";
        applyArmPoses(arms, mainHandPose(input, pose), {leftHanded: input.leftHanded, use: null, useTicks: 0},
            {pitch: p.head.pitch, yaw: p.head.yaw}, false);
        p.right_arm.pitch = arms.right.pitch; p.right_arm.yaw = arms.right.yaw;
        p.left_arm.pitch = arms.left.pitch; p.left_arm.yaw = arms.left.yaw;
    } else if (flags.has("admiring")) {
        p.head.pitch = 0.5;
        p.head.yaw = 0;
        if (input.leftHanded) {
            p.right_arm.yaw = -0.5;
            p.right_arm.pitch = -0.9;
        } else {
            p.left_arm.yaw = 0.5;
            p.left_arm.pitch = -0.9;
        }
    }
    copyPlayerLayers(p);
}

/** vanilla QuadrupedEntityModel (cow, mooshroom, pig, sheep) */
export function quadruped(p, input) {
    const f = input.limbAngle, g = input.limbDistance;
    p.head.pitch = input.headPitch * DEG;
    p.head.yaw = input.headYaw * DEG;
    p.right_hind_leg.pitch = cos(f * 0.6662) * 1.4 * g;
    p.left_hind_leg.pitch = cos(f * 0.6662 + PI) * 1.4 * g;
    p.right_front_leg.pitch = cos(f * 0.6662 + PI) * 1.4 * g;
    p.left_front_leg.pitch = cos(f * 0.6662) * 1.4 * g;
}

/** vanilla CreeperEntityModel */
export function creeper(p, input) {
    const f = input.limbAngle, g = input.limbDistance;
    p.head.yaw = input.headYaw * DEG;
    p.head.pitch = input.headPitch * DEG;
    p.right_hind_leg.pitch = cos(f * 0.6662) * 1.4 * g;
    p.left_hind_leg.pitch = cos(f * 0.6662 + PI) * 1.4 * g;
    p.right_front_leg.pitch = cos(f * 0.6662 + PI) * 1.4 * g;
    p.left_front_leg.pitch = cos(f * 0.6662) * 1.4 * g;
}

/** vanilla SpiderEntityModel (spider, cave spider) */
export function spider(p, input) {
    const f = input.limbAngle, g = input.limbDistance;
    p.head.yaw = input.headYaw * DEG;
    p.head.pitch = input.headPitch * DEG;
    const legs = [
        ["right_hind_leg", "left_hind_leg", PI / 4, PI / 4, 0],
        ["right_middle_hind_leg", "left_middle_hind_leg", 0.58119464, 0.3926991, PI],
        ["right_middle_front_leg", "left_middle_front_leg", 0.58119464, -0.3926991, PI / 2],
        ["right_front_leg", "left_front_leg", PI / 4, -PI / 4, PI * 3 / 2],
    ];
    for (const [rightName, leftName, roll, yaw, phase] of legs) {
        const right = p[rightName], left = p[leftName];
        right.roll = -roll;
        left.roll = roll;
        right.yaw = yaw;
        left.yaw = -yaw;
        const swingYaw = -(cos(f * 0.6662 * 2 + phase) * 0.4) * g;
        const swingRoll = Math.abs(sin(f * 0.6662 + phase) * 0.4) * g;
        right.yaw += swingYaw;
        left.yaw += -swingYaw;
        right.roll += swingRoll;
        left.roll += -swingRoll;
    }
}

/** vanilla ChickenEntityModel */
export function chicken(p, input) {
    const f = input.limbAngle, g = input.limbDistance;
    p.head.pitch = input.headPitch * DEG;
    p.head.yaw = input.headYaw * DEG;
    p.beak.pitch = p.head.pitch;
    p.beak.yaw = p.head.yaw;
    p.red_thing.pitch = p.head.pitch;
    p.red_thing.yaw = p.head.yaw;
    p.right_leg.pitch = cos(f * 0.6662) * 1.4 * g;
    p.left_leg.pitch = cos(f * 0.6662 + PI) * 1.4 * g;
    p.right_wing.roll = input.wingAngle;
    p.left_wing.roll = -input.wingAngle;
}

/** vanilla EndermanEntityModel */
export function enderman(p, input) {
    biped(p, input);
    const {head, hat, body, right_arm: rightArm, left_arm: leftArm, right_leg: rightLeg, left_leg: leftLeg} = p;
    head.visible = true;
    body.pitch = 0;
    body.pivotY = -14;
    body.pivotZ = 0;
    rightArm.pitch *= 0.5;
    leftArm.pitch *= 0.5;
    rightLeg.pitch *= 0.5;
    leftLeg.pitch *= 0.5;
    const clamp = v => Math.max(-0.4, Math.min(0.4, v));
    rightArm.pitch = clamp(rightArm.pitch);
    leftArm.pitch = clamp(leftArm.pitch);
    rightLeg.pitch = clamp(rightLeg.pitch);
    leftLeg.pitch = clamp(leftLeg.pitch);
    if (input.flags.has("carrying")) {
        rightArm.pitch = -0.5;
        leftArm.pitch = -0.5;
        rightArm.roll = 0.05;
        leftArm.roll = -0.05;
    }
    rightLeg.pivotZ = 0;
    leftLeg.pivotZ = 0;
    rightLeg.pivotY = -5;
    leftLeg.pivotY = -5;
    head.pivotZ = 0;
    head.pivotY = -13;
    copyTransform(hat, head);
    if (input.flags.has("angry")) head.pivotY -= 5;
    rightArm.pivotX = -5; rightArm.pivotY = -12; rightArm.pivotZ = 0;
    leftArm.pivotX = 5; leftArm.pivotY = -12; leftArm.pivotZ = 0;
}

/** vanilla VillagerResemblingModel (no head-shaking) */
export function villager(p, input) {
    const f = input.limbAngle, g = input.limbDistance;
    p.head.yaw = input.headYaw * DEG;
    p.head.pitch = input.headPitch * DEG;
    p.head.roll = 0;
    p.right_leg.pitch = cos(f * 0.6662) * 1.4 * g * 0.5;
    p.left_leg.pitch = cos(f * 0.6662 + PI) * 1.4 * g * 0.5;
    p.right_leg.yaw = 0;
    p.left_leg.yaw = 0;
}

/** vanilla SlimeEntityModel: no animation */
export function slime() {}

export const ANIMATIONS = {
    zombie, drowned, skeleton, piglin, zombified_piglin: (p, input) => piglin(p, input, true),
    quadruped, creeper, spider, chicken, enderman, villager, slime,
};
