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

import {DEG2RAD} from "../util/LiveMath.js";

/*
 * BlueMap Live: the camera while following a player in the free-flight view (setting followMode, see LiveDisplay):
 * "firstPerson" at the eyes of the player, "shoulder" behind and right of the head. "map" keeps BlueMaps own
 * following. No three.js, so it can be unit-tested with node.
 */

export const FOLLOW_MODES = ["map", "firstPerson", "shoulder"];

/** the camera of the shoulder-view: behind the eyes, to the right and up (blocks) */
export const SHOULDER_OFFSET = {back: 3.5, right: 0.75, up: 0.35};

/**
 * vanilla EntityType.PLAYER / PlayerEntity.getActiveEyeHeight: standing 1.62, sneaking 1.27, swimming, gliding
 * and sleeping 0.4 (crawling as well, not sent)
 * @param state {{sneaking: boolean, swimming: boolean, fallFlying: boolean, bed: any} | null}
 * @returns {number}
 */
export function eyeHeight(state) {
    if (!state) return 1.62;
    if (state.swimming || state.fallFlying) return 0.4;
    if (state.bed) return 0.2;
    if (state.sneaking) return 1.27;
    return 1.62;
}

/**
 * The view-direction of a player (vanilla Entity.getRotationVector).
 * @param yaw {number} - degrees
 * @param pitch {number} - degrees
 * @returns {{x: number, y: number, z: number}}
 */
export function viewDirection(yaw, pitch) {
    const y = yaw * DEG2RAD, p = pitch * DEG2RAD;
    return {x: -Math.sin(y) * Math.cos(p), y: -Math.sin(p), z: Math.cos(y) * Math.cos(p)};
}

/**
 * The pose of the free-flight camera (ControlsManager position, rotation and angle like FreeFlightControls).
 * @param mode {string} - "firstPerson" or "shoulder"
 * @param eye {{x: number, y: number, z: number}}
 * @param yaw {number} - head-yaw in degrees
 * @param pitch {number} - degrees
 * @returns {{position: {x: number, y: number, z: number}, rotation: number, angle: number}}
 */
export function followCameraPose(mode, eye, yaw, pitch) {
    const rotation = (yaw - 180) * DEG2RAD;
    const angle = -(pitch - 90) * DEG2RAD;
    if (mode !== "shoulder") return {position: {x: eye.x, y: eye.y, z: eye.z}, rotation, angle};
    const forward = viewDirection(yaw, pitch);
    // right of the view-direction (horizontal): forward turned by -90 degrees around the up-axis
    const right = {x: -Math.cos(yaw * DEG2RAD), z: -Math.sin(yaw * DEG2RAD)};
    return {
        position: {
            x: eye.x - forward.x * SHOULDER_OFFSET.back + right.x * SHOULDER_OFFSET.right,
            y: eye.y - forward.y * SHOULDER_OFFSET.back + SHOULDER_OFFSET.up,
            z: eye.z - forward.z * SHOULDER_OFFSET.back + right.z * SHOULDER_OFFSET.right,
        },
        rotation, angle,
    };
}
