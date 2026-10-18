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
 * BlueMap Live: small math- and validation-helpers shared by the live-modules (no three.js, unit-tested with node).
 */

export const DEG2RAD = Math.PI / 180;
export const TAU = Math.PI * 2;

/** @returns {boolean} if the value is a finite number (not NaN, not Infinity, no string) */
export const isFiniteNumber = value => typeof value === "number" && Number.isFinite(value);

export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export const clamp01 = value => Math.min(1, Math.max(0, value));

/** an angle in degrees to [-180, 180) like vanilla MathHelper.wrapDegrees */
export const wrapDegrees = angle => {
    let a = angle % 360;
    if (a >= 180) a -= 360;
    if (a < -180) a += 360;
    return a;
};
