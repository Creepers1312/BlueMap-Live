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

import {BoxGeometry, Float32BufferAttribute} from "three";
import {playerModelLayout, vertexUV} from "./PlayerModelLayout.js";

/**
 * Creates a box-geometry with Minecraft skin-UVs.
 * @param size {[number, number, number]} - the box size in pixels (the UV-rect size)
 * @param uv {[number, number]} - top-left corner of the box-layout in the skin
 * @param inflate {number} - pixels the box is enlarged on each side (second skin-layer), the UVs are not changed
 * @returns {BoxGeometry}
 */
export function createSkinBoxGeometry(size, uv, inflate = 0) {
    const inflatedSize = size.map(v => v + 2 * inflate);
    const geometry = new BoxGeometry(inflatedSize[0], inflatedSize[1], inflatedSize[2]);

    const position = geometry.getAttribute("position");
    const normal = geometry.getAttribute("normal");
    const uvs = new Float32Array(position.count * 2);
    for (let i = 0; i < position.count; i++) {
        const [u, v] = vertexUV(
            [position.getX(i), position.getY(i), position.getZ(i)],
            [normal.getX(i), normal.getY(i), normal.getZ(i)],
            size, uv, inflatedSize
        );
        uvs[i * 2] = u;
        uvs[i * 2 + 1] = v;
    }
    geometry.setAttribute("uv", new Float32BufferAttribute(uvs, 2));

    return geometry;
}

/** variant -> Map(partName -> {layout, base, overlay}) */
const geometryCache = new Map();

/** box-parameters -> geometry; parts with identical boxes (e.g. the head of both variants) share one geometry */
const boxGeometryCache = new Map();

function sharedSkinBoxGeometry(size, uv, inflate) {
    const key = `${size.join(",")}|${uv.join(",")}|${inflate}`;
    let geometry = boxGeometryCache.get(key);
    if (!geometry) {
        geometry = createSkinBoxGeometry(size, uv, inflate);
        boxGeometryCache.set(key, geometry);
    }
    return geometry;
}

/**
 * Returns the geometries of all body-parts of a model-variant.
 * They are created once per variant and shared by all players, so they must never be disposed or modified.
 * @param variant {"classic" | "slim"}
 * @returns {Map<string, {layout: import("./PlayerModelLayout.js").PartLayout, base: BoxGeometry, overlay: BoxGeometry}>}
 */
export function getPlayerModelGeometries(variant) {
    if (variant !== "slim") variant = "classic";

    let parts = geometryCache.get(variant);
    if (!parts) {
        parts = new Map();
        for (const layout of playerModelLayout(variant)) {
            parts.set(layout.name, {
                layout,
                base: sharedSkinBoxGeometry(layout.size, layout.uv, 0),
                overlay: sharedSkinBoxGeometry(layout.size, layout.overlayUv, layout.overlayInflate),
            });
        }
        geometryCache.set(variant, parts);
    }
    return parts;
}
