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
 *     swingOffHand: boolean,   the swing is done with the off-hand (vanilla preferredHand)
 *     attackTicks: number,     the remaining ticks of the attack-animation (iron golem, ravager, hoglin, zoglin)
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
    // vanilla getPreferredArm: the main arm, the other one for a swing with the off-hand
    const right = input.swingOffHand ? input.leftHanded : !input.leftHanded;
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

/**
 * vanilla PandaEntityModel.setAngles: sitting (eating while sitting) and lying on the back; asking for bamboo,
 * sneezing, rolling and the thunder-fear are not sampled. input.panda: {sit, lie} 0..1
 */
export function panda(p, input) {
    quadruped(p, input);
    const progress = input.panda || {sit: 0, lie: 0};
    const h = input.age;
    p.head.roll = 0;
    if (progress.sit > 0) {
        p.body.pitch = interpolateAngle(p.body.pitch, 1.7407963, progress.sit);
        p.head.pitch = interpolateAngle(p.head.pitch, 1.5707964, progress.sit);
        p.right_front_leg.roll = -0.27079642;
        p.left_front_leg.roll = 0.27079642;
        p.right_hind_leg.roll = 0.5707964;
        p.left_hind_leg.roll = -0.5707964;
        if (input.flags.has("eating")) {
            p.head.pitch = 1.5707964 + 0.2 * sin(h * 0.6);
            p.right_front_leg.pitch = -0.4 - 0.2 * sin(h * 0.6);
            p.left_front_leg.pitch = -0.4 - 0.2 * sin(h * 0.6);
        }
    }
    if (progress.lie > 0) {
        p.right_hind_leg.pitch = -0.6 * sin(h * 0.15);
        p.left_hind_leg.pitch = 0.6 * sin(h * 0.15);
        p.right_front_leg.pitch = 0.3 * sin(h * 0.25);
        p.left_front_leg.pitch = -0.3 * sin(h * 0.25);
        p.head.pitch = interpolateAngle(p.head.pitch, 1.5707964, progress.lie);
    }
}

/** vanilla PolarBearEntityModel.setAngles: standing up (getWarningAnimationProgress, squared). input.warning 0..1 */
export function polarBear(p, input) {
    quadruped(p, input);
    const w = (input.warning || 0) * (input.warning || 0), n = 1 - w;
    p.body.pitch = 1.5707964 - w * PI * 0.35;
    p.body.pivotY = 9 * n + 11 * w;
    p.right_front_leg.pivotY = 14 * n - 6 * w;
    p.right_front_leg.pivotZ = -8 * n - 4 * w;
    p.right_front_leg.pitch -= w * PI * 0.45;
    p.left_front_leg.pivotY = p.right_front_leg.pivotY;
    p.left_front_leg.pivotZ = p.right_front_leg.pivotZ;
    p.left_front_leg.pitch -= w * PI * 0.45;
    if (input.baby) {
        p.head.pivotY = 10 * n - 9 * w;
        p.head.pivotZ = -16 * n - 7 * w;
    } else {
        p.head.pivotY = 10 * n - 14 * w;
        p.head.pivotZ = -16 * n - 3 * w;
    }
    p.head.pitch += w * PI * 0.15;
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

// ---- further mobs (1.21) ----

const head = p => p.head || Object.entries(p).find(([path]) => path.endsWith("/head"))?.[1];

/** the head follows the look-direction (most vanilla models) */
function look(p, input) {
    const h = head(p);
    if (!h) return;
    h.yaw += input.headYaw * DEG;
    h.pitch += input.headPitch * DEG;
}

/** the leg-swing of vanilla QuadrupedEntityModel on the legs a model has (any path) */
function quadrupedLegs(p, input, amount = 1.4) {
    const f = input.limbAngle, g = input.limbDistance;
    for (const [path, t] of Object.entries(p)) {
        const name = path.substring(path.lastIndexOf("/") + 1);
        if (!name.endsWith("_leg") || name.includes("baby")) continue;
        const right = name.startsWith("right"), hind = name.includes("hind") || name.includes("back") || name.includes("mid");
        // right-hind and left-front together, like vanilla
        t.pitch += cos(f * 0.6662 + (right === hind ? 0 : PI)) * amount * g;
    }
}

/** vanilla IllagerEntityModel: crossed arms when neutral, spell-casting, bow, crossbow, attacking, celebrating */
export function illager(p, input) {
    const f = input.limbAngle, g = input.limbDistance, flags = input.flags;
    look(p, input);
    const {right_arm: rightArm, left_arm: leftArm, right_leg: rightLeg, left_leg: leftLeg} = p;
    rightArm.pitch = cos(f * 0.6662 + PI) * 2 * g * 0.5;
    leftArm.pitch = cos(f * 0.6662) * 2 * g * 0.5;
    rightLeg.pitch = cos(f * 0.6662) * 1.4 * g * 0.5;
    leftLeg.pitch = cos(f * 0.6662 + PI) * 1.4 * g * 0.5;
    const h = p.head;
    if (flags.has("illager_attacking")) {
        if (!input.mainHand) {
            meleeAttack(leftArm, rightArm, true, input.swingProgress, input.age);
        } else { // vanilla CrossbowPosing.method_29352 (main arm right): the weapon raised
            const sw = input.swingProgress;
            const sf = sin(sw * PI), sg = sin((1 - (1 - sw) * (1 - sw)) * PI);
            rightArm.roll = 0;
            leftArm.roll = 0;
            rightArm.yaw = 0.15707964;
            leftArm.yaw = -0.15707964;
            rightArm.pitch = -1.8849558 + cos(input.age * 0.09) * 0.15 + sf * 2.2 - sg * 0.4;
            leftArm.pitch = cos(input.age * 0.19) * 0.5 + sf * 1.2 - sg * 0.4;
            swingArm(rightArm, input.age, 1);
            swingArm(leftArm, input.age, -1);
        }
    } else if (flags.has("illager_spellcasting")) {
        rightArm.pivotZ = 0; rightArm.pivotX = -5;
        leftArm.pivotZ = 0; leftArm.pivotX = 5;
        rightArm.pitch = cos(input.age * 0.6662) * 0.25;
        leftArm.pitch = cos(input.age * 0.6662) * 0.25;
        rightArm.roll = PI * 3 / 4;
        leftArm.roll = -PI * 3 / 4;
        rightArm.yaw = 0;
        leftArm.yaw = 0;
    } else if (flags.has("illager_bow_and_arrow")) {
        rightArm.yaw = -0.1 + h.yaw;
        rightArm.pitch = -PI / 2 + h.pitch;
        leftArm.pitch = -0.9424779 + h.pitch;
        leftArm.yaw = h.yaw - 0.4;
        leftArm.roll = PI / 2;
    } else if (flags.has("illager_crossbow_hold") || flags.has("illager_crossbow_charge")) {
        const arms = {right: {pitch: rightArm.pitch, yaw: 0}, left: {pitch: leftArm.pitch, yaw: 0}};
        applyArmPoses(arms, {right: flags.has("illager_crossbow_hold") ? "crossbow_hold" : "crossbow_charge", left: "empty"},
            {leftHanded: false, use: null, useTicks: 0}, {pitch: h.pitch, yaw: h.yaw}, false);
        rightArm.pitch = arms.right.pitch; rightArm.yaw = arms.right.yaw;
        leftArm.pitch = arms.left.pitch; leftArm.yaw = arms.left.yaw;
    } else if (flags.has("illager_celebrating")) {
        rightArm.pivotZ = 0; rightArm.pivotX = -5;
        rightArm.pitch = cos(input.age * 0.6662) * 0.05;
        rightArm.roll = 2.670354;
        rightArm.yaw = 0;
        leftArm.pivotZ = 0; leftArm.pivotX = 5;
        leftArm.pitch = cos(input.age * 0.6662) * 0.05;
        leftArm.roll = -2.3561945;
        leftArm.yaw = 0;
    }
    const crossed = !["attacking", "spellcasting", "bow_and_arrow", "crossbow_hold", "crossbow_charge", "celebrating"]
        .some(state => flags.has("illager_" + state));
    p.arms.visible = crossed;
    leftArm.visible = !crossed;
    rightArm.visible = !crossed;
}

/** vanilla MathHelper.wrap: a triangle-wave with the period size (-1..1) */
export function wrap(value, size) {
    return (Math.abs(value % size - size * 0.5) - size * 0.25) / (size * 0.25);
}

/** vanilla IronGolemEntityModel: legs and arms swing with a triangle-wave, both arms strike while attacking */
export function ironGolem(p, input) {
    const f = input.limbAngle, g = input.limbDistance;
    const wave = x => wrap(x, 13);
    look(p, input);
    p.right_leg.pitch = -1.5 * wave(f) * g;
    p.left_leg.pitch = 1.5 * wave(f) * g;
    if (input.attackTicks > 0) { // animateModel: getAttackTicksLeft (10 .. 0)
        p.right_arm.pitch = -2 + 1.5 * wrap(input.attackTicks, 10);
        p.left_arm.pitch = -2 + 1.5 * wrap(input.attackTicks, 10);
    } else {
        p.right_arm.pitch = (-0.2 + 1.5 * wave(f)) * g;
        p.left_arm.pitch = (-0.2 - 1.5 * wave(f)) * g;
    }
}

/** vanilla SnowGolemEntityModel */
export function snowGolem(p, input) {
    look(p, input);
    p.upper_body.yaw = input.headYaw * DEG * 0.25;
    const k = sin(p.upper_body.yaw), l = cos(p.upper_body.yaw);
    p.left_arm.roll = 1;
    p.right_arm.roll = -1;
    p.left_arm.yaw = p.upper_body.yaw;
    p.right_arm.yaw = PI + p.upper_body.yaw;
    p.left_arm.pivotX = l * 5;
    p.left_arm.pivotZ = -k * 5;
    p.right_arm.pivotX = -l * 5;
    p.right_arm.pivotZ = k * 5;
}

/** vanilla BlazeEntityModel: three rings of rods around the body */
export function blaze(p, input) {
    const h = input.age;
    let f = h * PI * -0.1;
    for (let i = 0; i < 4; i++, f++) {
        const rod = p["part" + i];
        rod.pivotY = -2 + cos((i * 2 + h) * 0.25);
        rod.pivotX = cos(f) * 9;
        rod.pivotZ = sin(f) * 9;
    }
    f = PI / 4 + h * PI * 0.03;
    for (let i = 4; i < 8; i++, f++) {
        const rod = p["part" + i];
        rod.pivotY = 2 + cos((i * 2 + h) * 0.25);
        rod.pivotX = cos(f) * 7;
        rod.pivotZ = sin(f) * 7;
    }
    f = 0.47123894 + h * PI * -0.05;
    for (let i = 8; i < 12; i++, f++) {
        const rod = p["part" + i];
        rod.pivotY = 11 + cos((i * 1.5 + h) * 0.5);
        rod.pivotX = cos(f) * 5;
        rod.pivotZ = sin(f) * 5;
    }
    look(p, input);
}

/** vanilla GhastEntityModel: the tentacles swing */
export function ghast(p, input) {
    for (let i = 0; i < 9; i++) {
        const t = p["tentacle" + i];
        if (t) t.pitch = 0.2 * sin(input.age * 0.3 + i) + 0.4;
    }
}

/** vanilla SquidEntityModel: the tentacles open and close (approximation of the tentacle-angle) */
export function squid(p, input) {
    const angle = (sin(input.age * 0.1) + 1) * 0.3;
    for (let i = 0; i < 8; i++) {
        const t = p["tentacle" + i];
        if (t) t.pitch = angle;
    }
}

/** vanilla SilverfishEntityModel / EndermiteEntityModel: the segments wave */
export function silverfish(p, input) {
    const h = input.age;
    for (let i = 0; i < 7; i++) {
        const segment = p["segment" + i];
        if (!segment) continue;
        segment.yaw = cos(h * 0.9 + i * 0.15 * PI) * PI * 0.05 * (1 + Math.abs(i - 2));
        segment.pivotX = sin(h * 0.9 + i * 0.15 * PI) * PI * 0.2 * Math.abs(i - 2);
    }
    const layers = [["layer0", "segment2"], ["layer1", "segment4"], ["layer2", "segment1"]];
    for (const [layer, segment] of layers) {
        if (!p[layer] || !p[segment]) continue;
        p[layer].yaw = p[segment].yaw;
        p[layer].pivotX = p[segment].pivotX;
    }
}

export function endermite(p, input) {
    const h = input.age;
    for (let i = 0; i < 4; i++) {
        const segment = p["segment" + i];
        segment.yaw = cos(h * 0.9 + i * 0.15 * PI) * PI * 0.01 * (1 + Math.abs(i - 2));
        segment.pivotX = sin(h * 0.9 + i * 0.15 * PI) * PI * 0.1 * Math.abs(i - 2);
    }
}

/** vanilla PhantomEntityModel: the wings flap */
export function phantom(p, input) {
    const f = input.age * 7.448451 * DEG;
    p["body/left_wing_base"].roll = cos(f) * 16 * DEG;
    p["body/left_wing_base/left_wing_tip"].roll = cos(f) * 16 * DEG;
    p["body/right_wing_base"].roll = -p["body/left_wing_base"].roll;
    p["body/right_wing_base/right_wing_tip"].roll = -p["body/left_wing_base/left_wing_tip"].roll;
    p["body/tail_base"].pitch = -(5 + cos(f * 2) * 5) * DEG;
    p["body/tail_base/tail_tip"].pitch = -(5 + cos(f * 2) * 5) * DEG;
}

/** vanilla fish-models (cod, tropical fish, pufferfish): the tail swings */
export function fish(p, input) {
    const k = 1.5 * sin(0.6 * input.age);
    const tail = p.tail_fin || p.tail || p.back_fin;
    if (tail) tail.yaw = -k * 0.45 / 1.5;
}

/** vanilla Small/Medium/LargePufferfishEntityModel: the side-fins flap */
export function pufferfish(p, input) {
    const roll = 0.4 * sin(input.age * 0.2);
    const right = p.right_blue_fin || p.right_fin, left = p.left_blue_fin || p.left_fin;
    if (right) right.roll = -0.2 + roll;
    if (left) left.roll = 0.2 - roll;
}

/** vanilla SalmonEntityModel */
export function salmon(p, input) {
    p.body_back.yaw = -0.25 * sin(0.6 * input.age);
}

/** vanilla DolphinEntityModel (swimming, approximation) */
export function dolphin(p, input) {
    p.body.pitch = input.headPitch * DEG;
    p.body.yaw = input.headYaw * DEG;
    if (input.limbDistance > 0.01) {
        p["body/tail"].pitch = -0.1 * cos(input.age * 0.3);
        p["body/tail/tail_fin"].pitch = -0.2 * cos(input.age * 0.3);
    }
}

/** vanilla GuardianEntityModel: the tail swings (the spikes are not animated) */
export function guardian(p, input) {
    look(p, input);
    const a = sin(input.age * 0.09) * 0.2;
    p["head/tail0"].yaw = a;
    p["head/tail0/tail1"].yaw = a * 1.5;
    p["head/tail0/tail1/tail2"].yaw = a * 2;
}

/** vanilla HoglinEntityModel (hoglin, zoglin): ears and legs, the head is thrown up while attacking */
export function hoglin(p, input) {
    const f = input.limbAngle, g = input.limbDistance;
    p["head/right_ear"].roll = -0.6981317 - g * sin(f);
    p["head/left_ear"].roll = 0.6981317 + g * sin(f);
    p.head.yaw = input.headYaw * DEG;
    // getMovementCooldownTicks (10 .. 0 after an attack): up to -20 degrees at the half
    const k = 1 - Math.abs(10 - 2 * Math.max(0, input.attackTicks || 0)) / 10;
    p.head.pitch = 0.87266463 + (-0.34906584 - 0.87266463) * Math.max(0, k);
    // the mane (and the head of babies) are placed by setAngles, not by the model-data
    if (input.baby) {
        p.head.pivotY = 2 + 3 * Math.max(0, k);
        if (p["body/mane"]) p["body/mane"].pivotZ = -3;
    } else {
        p.head.pivotY = 2;
        if (p["body/mane"]) p["body/mane"].pivotZ = -7;
    }
    const front = cos(f) * 1.2 * g;
    p.right_front_leg.pitch = front;
    p.left_front_leg.pitch = -front;
    p.right_hind_leg.pitch = -front;
    p.left_hind_leg.pitch = front;
}

/** vanilla RavagerEntityModel (walking, the bite: the neck lunges forward and the mouth opens) */
export function ravager(p, input) {
    const f = input.limbAngle, g = input.limbDistance;
    p["neck/head"].yaw = input.headYaw * DEG;
    p["neck/head"].pitch = input.headPitch * DEG;
    const l = input.attackTicks || 0; // animateModel: getAttackTick (10 .. 0); stunned and roaring are not shown
    if (l > 0) {
        const o = (1 + wrap(l, 10)) * 0.5;
        const q = o * o * o * 12;
        p.neck.pivotZ = -6.5 + q;
        p.neck.pivotY = -7 - q * sin(p.neck.pitch);
        p["neck/head/mouth"].pitch = l > 5 ? sin((l - 4) / 4) * PI * 0.4 : PI / 20 * sin(PI * l / 10);
    } else { // not stunned: neck at rest, the jaw slightly open (PI * 0.01)
        p.neck.pivotX = 0;
        p.neck.pivotZ = 5.5;
        p.neck.pivotY = -7;
        p.neck.pitch = 0;
        p["neck/head/mouth"].pitch = PI * 0.01;
    }
    const leg = cos(f * 0.6662) * 0.4 * g;
    p.right_hind_leg.pitch = leg;
    p.left_hind_leg.pitch = -leg;
    p.right_front_leg.pitch = -leg;
    p.left_front_leg.pitch = leg;
}

/** vanilla ModelUtil.interpolateAngle: from angle1 towards angle2 the shortest way */
export function interpolateAngle(angle1, angle2, progress) {
    let f = angle2 - angle1;
    while (f < -PI) f += PI * 2;
    while (f >= PI) f -= PI * 2;
    return angle1 + progress * f;
}

/**
 * vanilla OcelotEntityModel.animateModel and setAngles (cat, ocelot; standing or sitting, sneaking and sprinting are
 * not sampled). The defaults of animateModel are the pivots of the model-data.
 */
export function ocelot(p, input, sitting = false) {
    const f = input.limbAngle, g = input.limbDistance;
    p.tail1.pitch = 0.9;
    if (sitting) { // CatEntityModel.animateModel: animationState 3
        p.body.pitch = 0.7853982;
        p.body.pivotY += -4; p.body.pivotZ += 5;
        p.head.pivotY += -3.3; p.head.pivotZ += 1;
        p.tail1.pivotY += 8; p.tail1.pivotZ += -2;
        p.tail2.pivotY += 2; p.tail2.pivotZ += -0.8;
        p.tail1.pitch = 1.7278761;
        p.tail2.pitch = 2.670354;
        for (const leg of [p.left_front_leg, p.right_front_leg]) { leg.pitch = -0.15707964; leg.pivotY = 16.1; leg.pivotZ = -7; }
        for (const leg of [p.left_hind_leg, p.right_hind_leg]) { leg.pitch = -1.5707964; leg.pivotY = 21; leg.pivotZ = 1; }
    }
    p.head.pitch = input.headPitch * DEG;
    p.head.yaw = input.headYaw * DEG;
    if (!sitting) {
        p.body.pitch = 1.5707964;
        p.left_hind_leg.pitch = cos(f * 0.6662) * g;
        p.right_hind_leg.pitch = cos(f * 0.6662 + PI) * g;
        p.left_front_leg.pitch = cos(f * 0.6662 + PI) * g;
        p.right_front_leg.pitch = cos(f * 0.6662) * g;
        p.tail2.pitch = 1.7278761 + 0.7853982 * cos(f) * g;
    }
}

/**
 * vanilla CatEntityModel: sitting, lying (sleepAnimation, tailCurlAnimation) and the head down (headDownAnimation)
 * input.cat: {sleep, tailCurl, headDown} 0..1
 */
export function cat(p, input) {
    const progress = input.cat || {sleep: 0, tailCurl: 0, headDown: 0};
    ocelot(p, input, input.flags.has("sitting"));
    if (progress.sleep > 0) {
        p.head.roll = interpolateAngle(p.head.roll, -1.2707963, progress.sleep);
        p.head.yaw = interpolateAngle(p.head.yaw, 1.2707963, progress.sleep);
        p.left_front_leg.pitch = -1.2707963;
        p.right_front_leg.pitch = -0.47079635;
        p.right_front_leg.roll = -0.2;
        p.right_front_leg.pivotX = -0.2;
        p.left_hind_leg.pitch = -0.4;
        p.right_hind_leg.pitch = 0.5;
        p.right_hind_leg.roll = -0.5;
        p.right_hind_leg.pivotX = -0.3;
        p.right_hind_leg.pivotY = 20;
        p.tail1.pitch = interpolateAngle(p.tail1.pitch, 0.8, progress.tailCurl);
        p.tail2.pitch = interpolateAngle(p.tail2.pitch, -0.4, progress.tailCurl);
    }
    if (progress.headDown > 0) p.head.pitch = interpolateAngle(p.head.pitch, -0.58177644, progress.headDown);
}

/** vanilla WolfEntityModel.animateModel and setAngles: sitting, legs, the tail (angry: raised, tame: high, wild: low) */
export function wolf(p, input) {
    const f = input.limbAngle, g = input.limbDistance;
    const angry = input.flags.has("angry");
    p.tail.yaw = angry ? 0 : cos(f * 0.6662) * 1.4 * g;
    if (input.flags.has("sitting")) {
        p.upper_body.pivotX = -1; p.upper_body.pivotY = 16; p.upper_body.pivotZ = -3;
        p.upper_body.pitch = 1.2566371;
        p.upper_body.yaw = 0;
        p.body.pivotX = 0; p.body.pivotY = 18; p.body.pivotZ = 0;
        p.body.pitch = 0.7853982;
        p.tail.pivotX = -1; p.tail.pivotY = 21; p.tail.pivotZ = 6;
        p.right_hind_leg.pivotX = -2.5; p.right_hind_leg.pivotY = 22.7; p.right_hind_leg.pivotZ = 2;
        p.right_hind_leg.pitch = 4.712389;
        p.left_hind_leg.pivotX = 0.5; p.left_hind_leg.pivotY = 22.7; p.left_hind_leg.pivotZ = 2;
        p.left_hind_leg.pitch = 4.712389;
        p.right_front_leg.pitch = 5.811947;
        p.right_front_leg.pivotX = -2.49; p.right_front_leg.pivotY = 17; p.right_front_leg.pivotZ = -4;
        p.left_front_leg.pitch = 5.811947;
        p.left_front_leg.pivotX = 0.51; p.left_front_leg.pivotY = 17; p.left_front_leg.pivotZ = -4;
    } else {
        p.right_hind_leg.pitch = cos(f * 0.6662) * 1.4 * g;
        p.left_hind_leg.pitch = cos(f * 0.6662 + PI) * 1.4 * g;
        p.right_front_leg.pitch = cos(f * 0.6662 + PI) * 1.4 * g;
        p.left_front_leg.pitch = cos(f * 0.6662) * 1.4 * g;
    }
    p.head.pitch = input.headPitch * DEG;
    p.head.yaw = input.headYaw * DEG;
    // setAngles: WolfEntity.getTailAngle (tame: without the health-dependent lowering)
    p.tail.pitch = angry ? 1.5393804 : input.flags.has("tame") ? 0.55 * PI : PI / 5;
}

/** vanilla FoxEntityModel.animateModel and setAngles: walking, sitting, sleeping (sneaking and pouncing not sampled) */
export function fox(p, input) {
    const f = input.limbAngle, g = input.limbDistance;
    const tail = p["body/tail"];
    p.body.pitch = 1.5707964;
    tail.pitch = -0.05235988;
    p.right_hind_leg.pitch = cos(f * 0.6662) * 1.4 * g;
    p.left_hind_leg.pitch = cos(f * 0.6662 + PI) * 1.4 * g;
    p.right_front_leg.pitch = cos(f * 0.6662 + PI) * 1.4 * g;
    p.left_front_leg.pitch = cos(f * 0.6662) * 1.4 * g;
    const sleeping = input.flags.has("sleeping");
    if (sleeping) {
        p.body.roll = -1.5707964;
        p.body.pivotX = 0; p.body.pivotY = 21; p.body.pivotZ = -6;
        tail.pitch = -2.6179938;
        if (input.baby) {
            tail.pitch = -2.1816616;
            p.body.pivotZ = -2;
        }
        p.head.pivotX = 1; p.head.pivotY = 19.49; p.head.pivotZ = -3;
        p.head.pitch = 0;
        p.head.yaw = -2.0943952;
        p.head.roll = cos(input.age * 0.027) / 22; // setAngles
        for (const leg of ["right_hind_leg", "left_hind_leg", "right_front_leg", "left_front_leg"]) p[leg].visible = false;
    } else if (input.flags.has("sitting")) {
        p.body.pitch = 0.5235988;
        p.body.pivotX = 0; p.body.pivotY = 9; p.body.pivotZ = -3;
        tail.pitch = 0.7853982;
        tail.pivotX = -4; tail.pivotY = 15; tail.pivotZ = -2;
        p.head.pivotX = -1; p.head.pivotY = 10; p.head.pivotZ = -0.25;
        if (input.baby) { p.head.pivotX = -1; p.head.pivotY = 13; p.head.pivotZ = -3.75; }
        p.right_hind_leg.pitch = -1.3089969;
        p.right_hind_leg.pivotX = -5; p.right_hind_leg.pivotY = 21.5; p.right_hind_leg.pivotZ = 6.75;
        p.left_hind_leg.pitch = -1.3089969;
        p.left_hind_leg.pivotX = -1; p.left_hind_leg.pivotY = 21.5; p.left_hind_leg.pivotZ = 6.75;
        p.right_front_leg.pitch = -0.2617994;
        p.left_front_leg.pitch = -0.2617994;
    }
    // setAngles: the head looks (not while sleeping; walking is not sampled)
    if (!sleeping) {
        p.head.pitch = input.headPitch * DEG;
        p.head.yaw = input.headYaw * DEG;
    }
}

/** mobs with a head and legs (generic: the head looks, the legs swing like a quadruped / biped) */
export function generic(p, input) {
    look(p, input);
    quadrupedLegs(p, input);
    const f = input.limbAngle, g = input.limbDistance;
    if (p.right_leg && p.left_leg) {
        p.right_leg.pitch += cos(f * 0.6662) * 1.4 * g;
        p.left_leg.pitch += cos(f * 0.6662 + PI) * 1.4 * g;
    }
}

/** vanilla StriderEntityModel: big steps and waving bristles */
export function strider(p, input) {
    const f = input.limbAngle, g = Math.min(input.limbDistance, 0.25);
    look(p, input);
    p.right_leg.pitch = sin(f * 1.5 * 0.5) * 2 * g;
    p.left_leg.pitch = sin(f * 1.5 * 0.5 + PI) * 2 * g;
    for (const [path, t] of Object.entries(p)) {
        if (!path.includes("bristle")) continue;
        t.roll += (path.includes("right") ? -1 : 1) * 0.1 * sin(input.age * 0.4);
    }
}

/** horses (approximation of AbstractHorseEntityModel: walking legs, head; saddle and chests by flags, baby-legs) */
export function horse(p, input) {
    const f = input.limbAngle, g = input.limbDistance;
    p.head_parts.pitch += input.headPitch * DEG;
    p.head_parts.yaw += input.headYaw * DEG;
    const swing = cos(f * 0.6662) * 0.8 * g;
    for (const prefix of ["", "baby_"]) {
        const leg = name => p[name.replace("_leg", "_" + prefix + "leg")];
        if (leg("right_hind_leg")) leg("right_hind_leg").pitch = swing;
        if (leg("left_hind_leg")) leg("left_hind_leg").pitch = -swing;
        if (leg("right_front_leg")) leg("right_front_leg").pitch = -swing;
        if (leg("left_front_leg")) leg("left_front_leg").pitch = swing;
    }
    p["body/tail"] && (p["body/tail"].pitch += g * 0.5);
    const baby = !!input.baby, saddled = input.flags.has("saddled"), chest = input.flags.has("chest");
    for (const [path, t] of Object.entries(p)) {
        const name = path.substring(path.lastIndexOf("/") + 1);
        if (name.endsWith("_leg")) t.visible = name.includes("baby") === baby;
        if (name.includes("saddle") || name === "mouth_saddle_wrap") t.visible = saddled;
        if (name.endsWith("_chest")) t.visible = chest;
    }
}

/** vanilla LlamaEntityModel: legs, head, chests by flag */
export function llama(p, input) {
    look(p, input);
    quadrupedLegs(p, input);
    p.left_chest.visible = p.right_chest.visible = input.flags.has("chest");
}

/** camel (keyframe-animations in vanilla, approximation): head, legs, saddle by flag */
export function camel(p, input) {
    generic(p, input);
    const saddled = input.flags.has("saddled");
    for (const name of ["body/saddle", "body/head/bridle", "body/head/reins"]) if (p[name]) p[name].visible = saddled;
}

/** bogged: like a skeleton, the mushrooms are gone when sheared */
export function bogged(p, input) {
    skeleton(p, input);
    if (p["head/mushrooms"]) p["head/mushrooms"].visible = !input.flags.has("sheared");
}

/** frog (keyframe-animations in vanilla, approximation): the croaking-body and the tongue are hidden */
export function frog(p, input) {
    generic(p, input);
    p["root/body/croaking_body"].visible = false;
    p["root/body/tongue"].visible = false;
}

/** bat (keyframe-animations in vanilla, approximation): the wings flap */
export function bat(p, input) {
    const flap = cos(input.age * 1.3) * PI * 0.25;
    p["body/right_wing"].yaw = flap;
    p["body/left_wing"].yaw = -flap;
    p["body/right_wing/right_wing_tip"].yaw = flap * 0.5;
    p["body/left_wing/left_wing_tip"].yaw = -flap * 0.5;
}

/** bee (approximation of BeeEntityModel): flapping wings, no stinger after stinging */
export function bee(p, input) {
    p.bone.pivotY = 19 - cos(input.age * 0.18) * 0.9;
    p["bone/right_wing"].yaw = 0;
    p["bone/right_wing"].roll = cos(input.age * 2.1) * PI * 0.15;
    p["bone/left_wing"].pitch = p["bone/right_wing"].pitch;
    p["bone/left_wing"].yaw = p["bone/right_wing"].yaw;
    p["bone/left_wing"].roll = -p["bone/right_wing"].roll;
    if (p["bone/body/stinger"]) p["bone/body/stinger"].visible = !input.flags.has("stung");
}

/** allay, vex (keyframe-like in vanilla, approximation): hovering with flapping wings */
export function allay(p, input) {
    const flap = cos(input.age * 0.8) * 0.4;
    for (const [path, t] of Object.entries(p)) {
        if (path.endsWith("right_wing")) t.yaw += 0.4 + flap;
        if (path.endsWith("left_wing")) t.yaw -= 0.4 + flap;
    }
    look(p, input);
}

/** parrot (approximation of ParrotEntityModel standing): head and legs */
export function parrot(p, input) {
    look(p, input);
    p.right_leg.pitch += cos(input.limbAngle * 0.6662) * 1.4 * input.limbDistance;
    p.left_leg.pitch += cos(input.limbAngle * 0.6662 + PI) * 1.4 * input.limbDistance;
}

/** breeze (keyframe-animations in vanilla, approximation): the rods turn around the body */
export function breeze(p, input) {
    if (p["body/rods"]) p["body/rods"].yaw = input.age * 0.1;
    look(p, input);
    if (p.wind_body) p.wind_body.visible = false; // the translucent wind is not shown
}

/** shulker: closed shell, the head looks */
export function shulker(p, input) {
    p.head.yaw = input.headYaw * DEG;
    p.head.pitch = input.headPitch * DEG;
}

/** wither: the three heads look in the same direction (the side heads follow their own targets in vanilla) */
export function wither(p, input) {
    for (const name of ["center_head", "left_head", "right_head"]) {
        p[name].yaw = input.headYaw * DEG;
        p[name].pitch = input.headPitch * DEG;
    }
    p.tail.pitch = (0.065 + 0.05 * cos(input.age * 0.1)) * PI;
}

export const ANIMATIONS = {
    zombie, drowned, skeleton, piglin, zombified_piglin: (p, input) => piglin(p, input, true),
    quadruped, creeper, spider, chicken, enderman, villager, slime,
    illager, ironGolem, snowGolem, blaze, ghast, squid, silverfish, endermite, phantom, fish, salmon, dolphin, guardian,
    hoglin, ravager, ocelot, cat, fox, wolf, pufferfish, panda, polarBear, generic, strider, horse, llama, camel, bogged, frog, bat, bee, allay, parrot, breeze,
    shulker, wither,
};
