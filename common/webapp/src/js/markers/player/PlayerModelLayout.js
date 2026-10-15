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
 * Layout of the Minecraft player-model: body-parts, dimensions, pivots and skin-UV regions.
 * Pure data and math (no three.js), so it can be unit-tested with node.
 *
 * Coordinate system (same as BlueMap / three.js): y up, the model faces +z, the players right side is at -x.
 * Units are skin-pixels, the feet are at y = 0. (The vanilla player is rendered with a scale of 0.9375,
 * so 1 pixel = 0.9375 / 16 blocks and the model is 32 px = 1.875 blocks high.)
 *
 * Sources: the vanilla PlayerEntityModel / BipedEntityModel values, cross-checked with skinview3d 3.4.2.
 * See docs/bluemap-live/phase-3.md.
 */

export const SKIN_SIZE = 64;

/** blocks per skin-pixel */
export const PIXEL_SCALE = 0.9375 / 16;

/** height of the model in pixels */
export const MODEL_HEIGHT = 32;

export const MODEL_VARIANTS = ["classic", "slim"];

export const PART_NAMES = ["head", "body", "rightArm", "leftArm", "rightLeg", "leftLeg"];

export const FACE_NAMES = ["right", "left", "top", "bottom", "front", "back"];

/**
 * @typedef PartLayout {{
 *     name: string,
 *     size: [number, number, number],
 *     pivot: [number, number, number],
 *     offset: [number, number, number],
 *     uv: [number, number],
 *     overlayUv: [number, number],
 *     overlayInflate: number
 * }}
 * size: width (x), height (y), depth (z) of the box in pixels
 * pivot: the joint (rotation-point) of the part, relative to the feet
 * offset: the center of the box relative to the pivot
 * uv / overlayUv: the top-left corner of the box-layout in the skin for the base- and the second (outer) layer
 * overlayInflate: how much (pixels) the second layer box is bigger on each side
 */

/**
 * Returns the layout of all six body-parts for the given model-variant.
 * @param variant {"classic" | "slim"}
 * @returns {PartLayout[]}
 */
export function playerModelLayout(variant = "classic") {
    const slim = variant === "slim";
    const armWidth = slim ? 3 : 4;
    const armPivotY = slim ? 21.5 : 22;

    return [
        { name: "head", size: [8, 8, 8], pivot: [0, 24, 0], offset: [0, 4, 0], uv: [0, 0], overlayUv: [32, 0], overlayInflate: 0.5 },
        { name: "body", size: [8, 12, 4], pivot: [0, 24, 0], offset: [0, -6, 0], uv: [16, 16], overlayUv: [16, 32], overlayInflate: 0.25 },
        { name: "rightArm", size: [armWidth, 12, 4], pivot: [-5, armPivotY, 0], offset: [slim ? -0.5 : -1, -4, 0], uv: [40, 16], overlayUv: [40, 32], overlayInflate: 0.25 },
        { name: "leftArm", size: [armWidth, 12, 4], pivot: [5, armPivotY, 0], offset: [slim ? 0.5 : 1, -4, 0], uv: [32, 48], overlayUv: [48, 48], overlayInflate: 0.25 },
        { name: "rightLeg", size: [4, 12, 4], pivot: [-1.9, 12, 0], offset: [0, -6, 0], uv: [0, 16], overlayUv: [0, 32], overlayInflate: 0.25 },
        { name: "leftLeg", size: [4, 12, 4], pivot: [1.9, 12, 0], offset: [0, -6, 0], uv: [16, 48], overlayUv: [0, 48], overlayInflate: 0.25 },
    ];
}

/**
 * The pixel-rectangles of the six faces of a box in the skin (the standard Minecraft box-UV layout).
 * "right" is the side at -x (the players right), "left" the side at +x, "front" at +z.
 * @param u {number}
 * @param v {number}
 * @param w {number} width (x)
 * @param h {number} height (y)
 * @param d {number} depth (z)
 * @returns {Object<string, {x: number, y: number, w: number, h: number}>}
 */
export function boxFaceRects(u, v, w, h, d) {
    return {
        top:    { x: u + d,         y: v,     w: w, h: d },
        bottom: { x: u + d + w,     y: v,     w: w, h: d },
        right:  { x: u,             y: v + d, w: d, h: h },
        front:  { x: u + d,         y: v + d, w: w, h: h },
        left:   { x: u + d + w,     y: v + d, w: d, h: h },
        back:   { x: u + d + w + d, y: v + d, w: w, h: h },
    };
}

/**
 * Orientation of every face-rectangle on the box: the world-axis (and direction) the image-x and the image-y axis
 * of the face-rectangle run along.
 * Viewed from outside, the four side faces are unmirrored with the top of the image at the top (e.g. on the front
 * face the left edge of the image is on the players right side, -x). On the top and the bottom face the image-y axis
 * runs towards the front (+z) – for the bottom face this means it appears flipped when viewed from below, like in
 * Minecraft.
 */
export const FACE_ORIENTATION = {
    //        normal axis/sign      image-x: axis, sign     image-y: axis, sign
    right:  { normal: ["x", -1], imageX: ["z", 1],  imageY: ["y", -1] },
    left:   { normal: ["x", 1],  imageX: ["z", -1], imageY: ["y", -1] },
    top:    { normal: ["y", 1],  imageX: ["x", 1],  imageY: ["z", 1] },
    bottom: { normal: ["y", -1], imageX: ["x", 1],  imageY: ["z", 1] },
    front:  { normal: ["z", 1],  imageX: ["x", 1],  imageY: ["y", -1] },
    back:   { normal: ["z", -1], imageX: ["x", -1], imageY: ["y", -1] },
};

const AXIS_INDEX = { x: 0, y: 1, z: 2 };

/**
 * Determines the face of an axis-aligned box a vertex belongs to, from the face-normal.
 * @param normal {[number, number, number]}
 * @returns {string}
 */
export function faceFromNormal(normal) {
    for (const name of FACE_NAMES) {
        const [axis, sign] = FACE_ORIENTATION[name].normal;
        if (Math.sign(normal[AXIS_INDEX[axis]]) === sign) return name;
    }
    throw new Error(`Not an axis-aligned normal: ${normal}`);
}

/**
 * Calculates the texture-coordinates (0..1, v = 0 at the bottom of the image like three.js with flipY) of a
 * vertex of a box centered at the origin.
 * @param position {[number, number, number]} - vertex position relative to the box-center
 * @param normal {[number, number, number]} - face normal of the vertex
 * @param size {[number, number, number]} - box size (without inflation, the UVs always cover the original rect)
 * @param uv {[number, number]} - top-left corner of the box-layout in the skin
 * @param inflatedSize {[number, number, number]} - the actual (maybe inflated) size of the box
 * @returns {[number, number]}
 */
export function vertexUV(position, normal, size, uv, inflatedSize = size) {
    const face = faceFromNormal(normal);
    const rect = boxFaceRects(uv[0], uv[1], size[0], size[1], size[2])[face];
    const orientation = FACE_ORIENTATION[face];

    // relative position along an axis: 0 at the negative side, 1 at the positive side of the box
    const rel = axis => (position[AXIS_INDEX[axis]] / inflatedSize[AXIS_INDEX[axis]]) + 0.5;
    const along = ([axis, sign]) => sign > 0 ? rel(axis) : 1 - rel(axis);

    const px = rect.x + along(orientation.imageX) * rect.w;
    const py = rect.y + along(orientation.imageY) * rect.h;

    return [px / SKIN_SIZE, 1 - py / SKIN_SIZE];
}
