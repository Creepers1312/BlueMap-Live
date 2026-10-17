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

import {BufferAttribute, BufferGeometry, DoubleSide, Mesh, MeshBasicMaterial} from "three";
import {applyEntityShader} from "./EntityLighting.js";

/** vanilla EntityRenderer.renderLeash: 24 pieces, 0.025 blocks wide */
const SEGMENTS = 24;
const WIDTH = 0.025;

/**
 * The vertices and colors of a leash as vanilla EntityRenderer.renderLeash / renderLeashSegment draws it: two crossed
 * ribbons (triangle-strips) from the start (0, 0, 0) to (dx, dy, dz), hanging like a parabola, brown with every
 * other piece darker (0.7).
 * @returns {{positions: Float32Array, colors: Float32Array}} - 2 strips * 25 pairs * 2 vertices
 */
export function leashVertices(dx, dy, dz, positions = new Float32Array(2 * (SEGMENTS + 1) * 2 * 3),
                              colors = new Float32Array(2 * (SEGMENTS + 1) * 2 * 3)) {
    const horizontal = Math.hypot(dx, dz);
    const s = horizontal > 0 ? WIDTH / horizontal / 2 : 0;
    const k = dz * s, l = dx * s;
    let v = 0;
    for (let strip = 0; strip < 2; strip++) {
        // first strip: j = 0.025 (index 0..24), second strip: j = 0 (vanilla draws it from 24 to 0, same quads)
        const j = strip === 0 ? WIDTH : 0;
        for (let index = 0; index <= SEGMENTS; index++) {
            const t = index / SEGMENTS;
            const dark = index % 2 === (strip === 1 ? 1 : 0) ? 0.7 : 1;
            const x = dx * t;
            const y = dy > 0 ? dy * t * t : dy - dy * (1 - t) * (1 - t);
            const z = dz * t;
            const pair = [[x - k, y + j, z + l], [x + k, y + WIDTH - j, z - l]];
            for (const p of pair) {
                positions.set(p, v * 3);
                colors.set([0.5 * dark, 0.4 * dark, 0.3 * dark], v * 3);
                v++;
            }
        }
    }
    return {positions, colors};
}

/** strip-indices of the two ribbons (two triangles per piece) */
function stripIndices() {
    const indices = [];
    for (let strip = 0; strip < 2; strip++) {
        const base = strip * (SEGMENTS + 1) * 2;
        for (let i = 0; i < SEGMENTS; i++) {
            const a = base + i * 2;
            indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
        }
    }
    return indices;
}

/**
 * An offset in the frame of an entity (relative to its drawn yaw, see the server-side Vehicle.toLocal) in the world.
 * @param offset {{x: number, y: number, z: number}}
 * @param yaw {number} - degrees
 */
export function frameToWorld(offset, yaw) {
    const rad = yaw * Math.PI / 180, cos = Math.cos(rad), sin = Math.sin(rad);
    return {x: offset.x * cos - offset.z * sin, y: offset.y, z: offset.x * sin + offset.z * cos};
}

/**
 * Where the leash of an entity is drawn: from its end at the drawn entity to its end at the drawn holder.
 * @param leash {{start: object, end: object}}
 * @param entity {{position: {x, y, z}, yaw: number}} - the drawn leashed entity
 * @param holder {{position: {x, y, z}, yaw: number}} - the drawn holder (feet)
 * @returns {{start: {x, y, z}, delta: {x, y, z}}} - the start relative to the entity, the rope (end - start)
 */
export function leashSpan(leash, entity, holder) {
    const start = frameToWorld(leash.start, entity.yaw), end = frameToWorld(leash.end, holder.yaw);
    return {
        start,
        delta: {
            x: holder.position.x + end.x - entity.position.x - start.x,
            y: holder.position.y + end.y - entity.position.y - start.y,
            z: holder.position.z + end.z - entity.position.z - start.z,
        },
    };
}

let sharedMaterial = null;

/** The rope of a leash, positioned at its start; set(dx, dy, dz) moves its end. */
export class LeashView extends Mesh {

    constructor() {
        const geometry = new BufferGeometry();
        const count = 2 * (SEGMENTS + 1) * 2;
        geometry.setAttribute("position", new BufferAttribute(new Float32Array(count * 3), 3));
        geometry.setAttribute("color", new BufferAttribute(new Float32Array(count * 3), 3));
        geometry.setIndex(stripIndices());
        if (!sharedMaterial) sharedMaterial = applyEntityShader(new MeshBasicMaterial({vertexColors: true, side: DoubleSide}));
        super(geometry, sharedMaterial);
        this.name = "bm-leash";
        this.raycast = () => {};
        this.frustumCulled = false;
        this.last = null;
    }

    /** the end of the rope relative to its start (blocks) */
    set(dx, dy, dz) {
        const last = this.last;
        if (last && Math.abs(last[0] - dx) < 1e-4 && Math.abs(last[1] - dy) < 1e-4 && Math.abs(last[2] - dz) < 1e-4) return;
        this.last = [dx, dy, dz];
        const position = this.geometry.getAttribute("position"), color = this.geometry.getAttribute("color");
        leashVertices(dx, dy, dz, position.array, color.array);
        position.needsUpdate = true;
        color.needsUpdate = true;
    }

    dispose() {
        this.geometry.dispose();
    }

}
