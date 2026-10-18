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
 * The lids of opened chests (BlueMap Live, see docs/bluemap-live/phase-11.md) like vanilla ChestBlockEntityRenderer
 * and ChestLidAnimator (CI-dump 1.21). The map-tile shows the closed chest: its lid is hidden by the hires-shader
 * (hidden boxes) while the webapp draws the moving lid. No three.js, unit-tested with node.
 */

export const CHEST_TEXTURE_SIZE = [64, 64];

/**
 * vanilla ChestBlockEntityRenderer.get(Single|Left|Right)TexturedModelData: lid and lock, relative to their pivot
 * (0, 9, 1), in pixels
 */
export const CHEST_LIDS = {
    single: [{uv: [0, 0], box: [1, 0, 0, 14, 5, 14]}, {uv: [0, 0], box: [7, -2, 14, 2, 4, 1]}],
    right: [{uv: [0, 0], box: [1, 0, 0, 15, 5, 14]}, {uv: [0, 0], box: [15, -2, 14, 1, 4, 1]}],
    left: [{uv: [0, 0], box: [0, 0, 0, 15, 5, 14]}, {uv: [0, 0], box: [0, -2, 14, 1, 4, 1]}],
};
export const LID_PIVOT = [0, 9, 1];

/** vanilla Direction.asRotation */
export const FACING_ROTATION = {south: 0, west: 90, north: 180, east: 270};

/** vanilla ChestLidAnimator.step: 0.1 per tick towards open or closed */
export function stepProgress(progress, open) {
    return open ? Math.min(1, progress + 0.1) : Math.max(0, progress - 0.1);
}

/** vanilla ChestBlockEntityRenderer.render: pitch = -(1 - (1 - progress)^3) * PI / 2 */
export function lidPitch(progress) {
    const g = 1 - progress;
    return -(1 - g * g * g) * Math.PI / 2;
}

/**
 * vanilla ChestBlockEntityRenderer: christmas-textures from December 24 to 26 (the date of the viewer, like the client)
 * @param texture {string}
 * @param date {Date}
 * @returns {string}
 */
export function chestTexture(texture, date = new Date()) {
    const christmas = date.getMonth() === 11 && date.getDate() >= 24 && date.getDate() <= 26;
    return christmas && texture.startsWith("minecraft:entity/chest/normal") ? texture.replace("/normal", "/christmas") : texture;
}

/**
 * Turns a point of the chest-frame (pixels, facing south) like the renderer: around the block-center by -asRotation.
 * @returns {number[]} - blocks, relative to the block
 */
export function chestPoint(x, y, z, facing) {
    const angle = -(FACING_ROTATION[facing] || 0) * Math.PI / 180;
    const cx = x / 16 - 0.5, cz = z / 16 - 0.5;
    const cos = Math.cos(angle), sin = Math.sin(angle);
    return [cos * cx + sin * cz + 0.5, y / 16, -sin * cx + cos * cz + 0.5];
}

/**
 * The parts of the tile-model that belong to the lid (hidden by the hires-shader while the webapp draws it): everything
 * above the top of the base (y 10) and the front-strip of the lock below it (in front of the base, z > 15).
 * @param container {{position: {x: number, y: number, z: number}, facing: string}}
 * @returns {Array<{min: number[], max: number[]}>} - world-coordinates
 */
export function lidHideBoxes(container) {
    const boxes = [[0, 10.02, 0, 16, 16.01, 16], [0, 6.98, 15.02, 16, 10.05, 16.05]];
    const p = container.position;
    return boxes.map(([x0, y0, z0, x1, y1, z1]) => {
        const a = chestPoint(x0, y0, z0, container.facing), b = chestPoint(x1, y1, z1, container.facing);
        return {
            min: [p.x + Math.min(a[0], b[0]), p.y + Math.min(a[1], b[1]), p.z + Math.min(a[2], b[2])],
            max: [p.x + Math.max(a[0], b[0]), p.y + Math.max(a[1], b[1]), p.z + Math.max(a[2], b[2])],
        };
    });
}

const TEXTURE_PATTERN = /^minecraft:entity\/chest\/(normal|trapped|christmas)(_left|_right)?$|^minecraft:entity\/chest\/ender$/;

/**
 * @param value {any} - the "containers" of live/entities.json
 * @returns {Array<{position: {x: number, y: number, z: number}, texture: string, facing: string, part: string}>}
 */
export function parseContainers(value) {
    if (!Array.isArray(value)) return [];
    const result = [];
    for (const raw of value.slice(0, 256)) {
        if (!raw || !Number.isInteger(raw.x) || !Number.isInteger(raw.y) || !Number.isInteger(raw.z)) continue;
        if (typeof raw.texture !== "string" || !TEXTURE_PATTERN.test(raw.texture)) continue;
        if (!Object.prototype.hasOwnProperty.call(FACING_ROTATION, raw.facing)) continue;
        const part = raw.part === "left" || raw.part === "right" ? raw.part : "single";
        result.push({position: {x: raw.x, y: raw.y, z: raw.z}, texture: raw.texture, facing: raw.facing, part});
    }
    return result;
}

/** the key of a container (its block) */
export const containerKey = container => container.position.x + "," + container.position.y + "," + container.position.z;
