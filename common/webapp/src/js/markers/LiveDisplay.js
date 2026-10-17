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
 * BlueMap Live: the display-settings of the live-data that each viewer chooses in the settings-menu (saved with the
 * other user-settings).
 */

export const LIVE_DISPLAY = {
    /** entities further than this from the nearest shown player are not shown (blocks), null: all the server sends */
    entityRadius: null,
    /** entities further than this from the camera are not shown (blocks) */
    entityDistance: 300,
    /** particles and effects (explosions, potions, fire, smoke) */
    particles: true,
    /** the previews of changed blocks */
    blockPreview: true,
};

export const ENTITY_DISTANCE_MIN = 50;
export const ENTITY_DISTANCE_MAX = 1000;

/**
 * If an entity is within the chosen radius around the shown players.
 * @param position {{x: number, y: number, z: number}}
 * @param players {Array<{x: number, y: number, z: number}>}
 * @param radius {number | null}
 * @returns {boolean}
 */
export function withinPlayerRadius(position, players, radius) {
    if (radius === null || radius === undefined) return true;
    const r2 = radius * radius;
    for (const p of players) {
        const dx = p.x - position.x, dy = p.y - position.y, dz = p.z - position.z;
        if (dx * dx + dy * dy + dz * dz <= r2) return true;
    }
    return false;
}
