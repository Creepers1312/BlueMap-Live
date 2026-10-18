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

import {clamp} from "../../util/LiveMath.js";

/*
 * Arm-poses for held and used items, and the item-model predicates (pure logic, no three.js).
 *
 * Follows the vanilla 1.21.1 PlayerEntityRenderer.getArmPose / BipedEntityModel.positionRightArm/positionLeftArm /
 * CrossbowPosing (reproduced from the vanilla source, see docs/bluemap-live/phase-4.md). All angles here are in the
 * vanilla convention (pitch, yaw in radians); the animator converts them to the model.
 * Eating and drinking have no third-person pose in vanilla 1.21.1, "eat" is an approximation of this project.
 */

const PI = Math.PI;
const lerp = (t, a, b) => a + (b - a) * t;

/** vanilla: the default crossbow pull-time in ticks (without quick-charge) */
export const CROSSBOW_PULL_TICKS = 25;

const TWO_HANDED = new Set(["bow_and_arrow", "crossbow_charge", "crossbow_hold"]);

const USE_POSES = {
    block: "block",
    bow: "bow_and_arrow",
    spear: "throw_spear",
    crossbow: "crossbow_charge",
    spyglass: "spyglass",
    toot_horn: "toot_horn",
    brush: "brush",
    eat: "eat",
    drink: "eat",
};

/**
 * @typedef ItemState {{
 *     leftHanded: boolean,
 *     mainHand: object | null,
 *     offHand: object | null,
 *     fishing: boolean,
 *     use: {mainHand: boolean, action: string} | null,
 *     useTicks: number,
 *     swinging: boolean
 * }}
 */

/** vanilla PlayerEntityRenderer.getArmPose for one hand */
function handPose(state, item, isMainHand) {
    if (!item) return "empty";
    const use = state.use;
    if (use && use.mainHand === isMainHand) {
        const pose = USE_POSES[use.action];
        if (pose) return pose;
    } else if (!state.swinging && item.id === "minecraft:crossbow" && item.charged) {
        return "crossbow_hold";
    }
    return "item";
}

/**
 * @param state {ItemState}
 * @returns {{right: string, left: string}} - the arm-pose of the right and the left arm
 */
export function armPoses(state) {
    const mainPose = handPose(state, state.mainHand, true);
    let offPose = handPose(state, state.offHand, false);
    if (TWO_HANDED.has(mainPose)) offPose = state.offHand ? "item" : "empty";
    return state.leftHanded ? {right: offPose, left: mainPose} : {right: mainPose, left: offPose};
}

/**
 * Applies the arm-poses like vanilla BipedEntityModel.setAngles (after the walking-animation).
 * @param arms {{right: {pitch: number, yaw: number}, left: {pitch: number, yaw: number}}} - modified in place
 * @param poses {{right: string, left: string}}
 * @param state {ItemState}
 * @param head {{pitch: number, yaw: number}} - head-rotation relative to the body (radians)
 * @param sneaking {boolean}
 */
export function applyArmPoses(arms, poses, state, head, sneaking) {
    arms.right.yaw = 0;
    arms.left.yaw = 0;

    const rightIsMain = !state.leftHanded;
    if (state.use) {
        // only the arm that uses the item is posed
        if (state.use.mainHand === rightIsMain) positionArm(arms, poses.right, true, state, head, sneaking);
        else positionArm(arms, poses.left, false, state, head, sneaking);
    } else {
        const otherTwoHanded = rightIsMain ? TWO_HANDED.has(poses.left) : TWO_HANDED.has(poses.right);
        if (rightIsMain !== otherTwoHanded) {
            positionArm(arms, poses.left, false, state, head, sneaking);
            positionArm(arms, poses.right, true, state, head, sneaking);
        } else {
            positionArm(arms, poses.right, true, state, head, sneaking);
            positionArm(arms, poses.left, false, state, head, sneaking);
        }
    }
}

function positionArm(arms, pose, right, state, head, sneaking) {
    const arm = right ? arms.right : arms.left;
    const sign = right ? 1 : -1; // vanilla mirrors the yaws for the left arm
    switch (pose) {
        case "empty":
            arm.yaw = 0;
            break;
        case "block":
            arm.pitch = arm.pitch * 0.5 - 0.9424779 + clamp(head.pitch, -PI * 4 / 9, 0.43633232);
            arm.yaw = -sign * 30 * PI / 180 + clamp(head.yaw, -PI / 6, PI / 6);
            break;
        case "item":
            arm.pitch = arm.pitch * 0.5 - PI / 10;
            arm.yaw = 0;
            break;
        case "throw_spear":
            arm.pitch = arm.pitch * 0.5 - PI;
            arm.yaw = 0;
            break;
        case "bow_and_arrow":
            if (right) {
                arms.right.yaw = -0.1 + head.yaw;
                arms.left.yaw = 0.1 + head.yaw + 0.4;
            } else {
                arms.right.yaw = -0.1 + head.yaw - 0.4;
                arms.left.yaw = 0.1 + head.yaw;
            }
            arms.right.pitch = -PI / 2 + head.pitch;
            arms.left.pitch = -PI / 2 + head.pitch;
            break;
        case "crossbow_charge":
            crossbowCharge(arms, right, state.useTicks);
            break;
        case "crossbow_hold":
            crossbowHold(arms, right, head);
            break;
        case "brush":
            arm.pitch = arm.pitch * 0.5 - PI / 5;
            arm.yaw = 0;
            break;
        case "spyglass":
            arm.pitch = clamp(head.pitch - 1.9198622 - (sneaking ? PI / 12 : 0), -2.4, 3.3);
            arm.yaw = head.yaw - sign * PI / 12;
            break;
        case "toot_horn":
            arm.pitch = clamp(head.pitch, -1.2, 1.2) - 1.4835298;
            arm.yaw = head.yaw - sign * PI / 6;
            break;
        case "eat": {
            // approximation (no vanilla third-person pose): the arm to the mouth, a small bob like in first-person
            const bob = Math.abs(Math.cos(state.useTicks / 4 * PI)) * 0.1;
            arm.pitch = -1.25 + clamp(head.pitch, -0.6, 0.6) * 0.5 + bob;
            arm.yaw = -sign * 0.45 + clamp(head.yaw, -0.4, 0.4) * 0.5;
            break;
        }
    }
}

/** vanilla CrossbowPosing.hold */
function crossbowHold(arms, right, head) {
    const holding = right ? arms.right : arms.left;
    const other = right ? arms.left : arms.right;
    holding.yaw = (right ? -0.3 : 0.3) + head.yaw;
    other.yaw = (right ? 0.6 : -0.6) + head.yaw;
    holding.pitch = -PI / 2 + head.pitch + 0.1;
    other.pitch = -1.5 + head.pitch;
}

/** vanilla CrossbowPosing.charge */
function crossbowCharge(arms, right, useTicks) {
    const holding = right ? arms.right : arms.left;
    const pulling = right ? arms.left : arms.right;
    holding.yaw = right ? -0.8 : 0.8;
    holding.pitch = -0.97079635;
    pulling.pitch = holding.pitch;
    const progress = clamp(useTicks, 0, CROSSBOW_PULL_TICKS) / CROSSBOW_PULL_TICKS;
    pulling.yaw = lerp(progress, 0.4, 0.85) * (right ? 1 : -1);
    pulling.pitch = lerp(progress, pulling.pitch, -PI / 2);
}

/**
 * The values of the vanilla item-model predicates (used to select an override of the item-model).
 * @param state {ItemState}
 * @param isMainHand {boolean}
 * @param target {object} - filled and returned (reused to avoid allocations)
 * @returns {object}
 */
export function itemPredicates(state, isMainHand, target = {}) {
    const item = isMainHand ? state.mainHand : state.offHand;
    const using = !!(item && state.use && state.use.mainHand === isMainHand);
    const action = using ? state.use.action : null;

    target.pulling = 0;
    target.pull = 0;
    if (action === "bow") {
        target.pulling = 1;
        target.pull = state.useTicks / 20;
    } else if (action === "crossbow" && !item.charged) {
        target.pulling = 1;
        target.pull = state.useTicks / CROSSBOW_PULL_TICKS;
    }
    target.blocking = action === "block" ? 1 : 0;
    target.throwing = action === "spear" ? 1 : 0;
    target.charged = item && item.charged ? 1 : 0;
    target.firework = item && item.firework ? 1 : 0;
    target.custom_model_data = item && item.customModelData !== null ? item.customModelData : 0;

    // vanilla: the cast-state belongs to the rod in the main hand, or to the one in the off hand if the main hand has none
    const mainRod = !!(state.mainHand && state.mainHand.id === "minecraft:fishing_rod");
    const isRod = !!(item && item.id === "minecraft:fishing_rod");
    target.cast = state.fishing && isRod && (isMainHand || !mainRod) ? 1 : 0;
    return target;
}

/**
 * Selects the model of an item-asset: the last override whose predicates are all reached (like vanilla), or the base.
 * @param models {Array<{predicate?: object}>} - models[0] is the base model, the others are the overrides in order
 * @param predicates {object}
 * @returns {number} the index of the model
 */
export function selectItemModel(models, predicates) {
    let selected = 0;
    for (let i = 1; i < models.length; i++) {
        const predicate = models[i].predicate;
        if (!predicate) continue;
        let matches = true;
        for (const key in predicate) {
            if (!((predicates[key] || 0) >= predicate[key])) {
                matches = false;
                break;
            }
        }
        if (matches) selected = i;
    }
    return selected;
}
