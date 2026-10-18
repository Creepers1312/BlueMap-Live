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
import {BufferGeometry, Float32BufferAttribute} from "three";

/*
 * Builds the geometries of the vanilla mob-models (vanilla-mob-models.json, verified against Minecraft by the fabric
 * test VanillaMobModelsTest) like vanilla ModelPart.Cuboid / ModelPart.Quad (1.21), in pixels.
 */

/**
 * The quads of a vanilla cuboid: 4 corners each, positions in pixels, uvs in texture-pixels (v = 0 at the top).
 * Same corners, uvs and order as vanilla ModelPart.Cuboid (DOWN, UP, WEST, NORTH, EAST, SOUTH).
 * @param cuboid {{uv: number[], box: number[], dilation?: number | number[], mirror?: boolean, textureScale?: number[]}}
 * @param textureSize {number[]} - [width, height] of the model-layer
 * @returns {Array<{direction: string, corners: Array<{position: number[], uv: number[]}>}>}
 *  uvs are normalized (0..1) like vanilla
 */
export function cuboidQuads(cuboid, textureSize) {
    const [u, v] = cuboid.uv;
    const [x0, y0, z0, sizeX, sizeY, sizeZ] = cuboid.box;
    const d = cuboid.dilation === undefined ? [0, 0, 0] :
        Array.isArray(cuboid.dilation) ? cuboid.dilation : [cuboid.dilation, cuboid.dilation, cuboid.dilation];
    const mirror = !!cuboid.mirror;
    const scale = cuboid.textureScale || [1, 1];
    const width = textureSize[0] * scale[0], height = textureSize[1] * scale[1];

    let x = x0 - d[0], y = y0 - d[1], z = z0 - d[2];
    let f = x0 + sizeX + d[0];
    const g = y0 + sizeY + d[1], h = z0 + sizeZ + d[2];
    if (mirror) [x, f] = [f, x];

    const v1 = [x, y, z], v2 = [f, y, z], v3 = [f, g, z], v4 = [x, g, z];
    const v5 = [x, y, h], v6 = [f, y, h], v7 = [f, g, h], v8 = [x, g, h];

    // vanilla uses the integer uv-origin (ModelCuboidData casts the uv to int)
    const j = Math.trunc(u), p = Math.trunc(v);
    const k = j + sizeZ, l = j + sizeZ + sizeX, m = j + sizeZ + sizeX + sizeX;
    const n = j + sizeZ + sizeX + sizeZ, o = j + sizeZ + sizeX + sizeZ + sizeX;
    const q = p + sizeZ, r = p + sizeZ + sizeY;

    const quad = (direction, vertices, u1, vv1, u2, vv2) => {
        const uvs = [[u2 / width, vv1 / height], [u1 / width, vv1 / height], [u1 / width, vv2 / height], [u2 / width, vv2 / height]];
        let corners = vertices.map((position, i) => ({position, uv: uvs[i]}));
        if (mirror) corners = corners.reverse();
        return {direction, corners};
    };

    return [
        quad("down", [v6, v5, v1, v2], k, p, l, q),
        quad("up", [v3, v4, v8, v7], l, q, m, p),
        quad("west", [v1, v5, v8, v4], j, q, k, r),
        quad("north", [v2, v1, v4, v3], k, q, l, r),
        quad("east", [v6, v2, v3, v7], l, q, n, r),
        quad("south", [v5, v6, v7, v8], n, q, o, r),
    ];
}

/**
 * One geometry with all cuboids of a model-part (in pixels, relative to the pivot of the part).
 * Every quad is split into two triangles (corners 0-1-2, 0-2-3), uvs for flipY-textures (v = 0 at the bottom).
 * @param cuboids {object[]}
 * @param textureSize {number[]}
 * @returns {BufferGeometry | null} - null if the part has no cuboids
 */
export function buildPartGeometry(cuboids, textureSize) {
    if (!cuboids || cuboids.length === 0) return null;
    const positions = [], uvs = [];
    for (const cuboid of cuboids) {
        for (const {corners} of cuboidQuads(cuboid, textureSize)) {
            for (const i of [0, 1, 2, 0, 2, 3]) {
                positions.push(...corners[i].position);
                uvs.push(corners[i].uv[0], 1 - corners[i].uv[1]);
            }
        }
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
    geometry.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
    return geometry;
}

/** model-layer -> Map(part-path -> geometry), shared by all mobs (never disposed) */
const geometryCache = new Map();

/**
 * The geometries of all parts of a model-layer, created once and shared.
 * @param layerName {string} - e.g. "minecraft:zombie#main"
 * @param layer {{texture: number[], parts: object}}
 * @returns {Map<string, BufferGeometry>} - part-path ("head/hat") -> geometry, parts without cuboids are missing
 */
export function getLayerGeometries(layerName, layer) {
    let geometries = geometryCache.get(layerName);
    if (!geometries) {
        geometries = new Map();
        const visit = (parts, prefix) => {
            for (const name in parts) {
                const part = parts[name];
                const path = prefix + name;
                const geometry = buildPartGeometry(part.cuboids, layer.texture);
                if (geometry) geometries.set(path, geometry);
                if (part.children) visit(part.children, path + "/");
            }
        };
        visit(layer.parts, "");
        geometryCache.set(layerName, geometries);
    }
    return geometries;
}
