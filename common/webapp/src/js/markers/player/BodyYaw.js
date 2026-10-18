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
 * BlueMap Live: the body-yaw of the players like the vanilla client computes it for other players
 * (OtherClientPlayerEntity -> LivingEntity.tick / turnHead, 1.21, read from the game in the CI-dump).
 * The server-side bodyYaw of players does not follow their movement: LivingEntity.tick runs in the network-tick of the
 * player, after the world-tick has already reset the previous position, so the player counts as standing and the body
 * only follows the head when it turns more than 50 degrees (walking straight ahead with the body turned sideways).
 */

/** one tick in seconds */
const TICK = 0.05;

const wrapDegrees = angle => {
    let a = angle % 360;
    if (a >= 180) a -= 360;
    if (a < -180) a += 360;
    return a;
};

/**
 * One tick of vanilla LivingEntity.tick (the body-part) and turnHead.
 * @param bodyYaw {number} - degrees
 * @param yaw {number} - the yaw (look-direction) of the player
 * @param dx {number} - the movement since the last tick (blocks)
 * @param dz {number}
 * @param swinging {boolean} - handSwingProgress > 0: the body turns to the look-direction
 * @param blocking {boolean} - PlayerEntity.getMaxRelativeHeadRotation: 15 degrees while blocking, otherwise 50
 * @returns {number} the new body-yaw
 */
export function bodyYawTick(bodyYaw, yaw, dx, dz, swinging = false, blocking = false) {
    let target = bodyYaw;
    if (dx * dx + dz * dz > 0.0025000002) {
        const moveYaw = Math.atan2(dz, dx) * 180 / Math.PI - 90;
        const diff = Math.abs(wrapDegrees(yaw) - moveYaw);
        // walking backwards: the body faces the other way
        target = diff > 95 && diff < 265 ? moveYaw - 180 : moveYaw;
    }
    if (swinging) target = yaw;
    // turnHead
    let body = bodyYaw + wrapDegrees(target - bodyYaw) * 0.3;
    const relative = wrapDegrees(yaw - body);
    const max = blocking ? 15 : 50;
    if (Math.abs(relative) > max) body += relative - Math.sign(relative) * max;
    return body;
}

/**
 * Follows the drawn position of a player in ticks and gives the interpolated body-yaw for every frame
 * (vanilla renders lerpAngle(tickDelta, prevBodyYaw, bodyYaw)).
 */
export class BodyYawTracker {

    constructor() {
        this.body = null;
        this.prev = null;
        this.x = 0;
        this.z = 0;
        this.time = 0;
    }

    /** starts again from a body-yaw (first sample, teleport, getting off a vehicle) */
    reset(bodyYaw, x, z) {
        this.body = this.prev = bodyYaw;
        this.x = x;
        this.z = z;
        this.time = 0;
    }

    /**
     * @param dt {number} - seconds since the last frame
     * @param x {number} - the drawn position
     * @param z {number}
     * @param yaw {number}
     * @param swinging {boolean}
     * @param blocking {boolean}
     * @returns {number} the body-yaw to draw
     */
    step(dt, x, z, yaw, swinging = false, blocking = false) {
        if (this.body === null) this.reset(yaw, x, z);
        this.time += Math.max(0, dt);
        const ticks = Math.floor(this.time / TICK);
        if (ticks > 0) {
            this.time -= ticks * TICK;
            // a slow frame: the movement is spread over its ticks (at most a second, e.g. after a hidden tab)
            const n = Math.min(ticks, 20);
            const dx = (x - this.x) / n, dz = (z - this.z) / n;
            for (let i = 0; i < n; i++) {
                this.prev = this.body;
                this.body = bodyYawTick(this.body, yaw, dx, dz, swinging, blocking);
            }
            this.x = x;
            this.z = z;
        }
        return this.prev + wrapDegrees(this.body - this.prev) * (this.time / TICK);
    }

}
