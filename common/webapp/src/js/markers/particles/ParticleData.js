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

import {isFiniteNumber} from "../../util/LiveMath.js";

/*
 * Parsing of the particle-data of BlueMap Live (see docs/bluemap-live/phase-10.md, no three.js, unit-tested with node):
 * the particles an entity or player emits ("particles") and the effects of a world ("effects" in live/entities.json).
 */

/** at most this many swirl-colors are used (the java ParticleState.MAX_SWIRLS) */
export const MAX_SWIRLS = 16;
/** vanilla AreaEffectCloudEntity.MAX_RADIUS */
export const MAX_CLOUD_RADIUS = 32;

/** the effect-types (the java LiveEffect) */
export const EFFECT_TYPES = new Set(["explosion", "splash", "instant_splash"]);

const isColor = value => Number.isInteger(value) && value >= 0 && value <= 0xFFFFFFFF;

/**
 * @typedef {{fire: boolean, swirls: number[], ambient: boolean, invisible: boolean,
 *     cloud: {radius: number, color: number, waiting: boolean} | null}} LiveParticles
 *  - swirls and the cloud-color are ARGB
 */

/**
 * @param value {any}
 * @returns {LiveParticles | null} - null if nothing is emitted
 */
export function parseParticles(value) {
    if (!value || typeof value !== "object") return null;
    const swirls = Array.isArray(value.swirls) ? value.swirls.filter(isColor).slice(0, MAX_SWIRLS) : [];
    let cloud = null;
    const c = value.cloud;
    if (c && typeof c === "object" && isFiniteNumber(c.radius) && c.radius >= 0 && isColor(c.color)) {
        cloud = {radius: Math.min(c.radius, MAX_CLOUD_RADIUS), color: c.color, waiting: c.waiting === true};
    }
    const fire = value.fire === true;
    if (!fire && swirls.length === 0 && !cloud) return null;
    return {fire, swirls, ambient: value.ambient === true, invisible: value.invisible === true, cloud};
}

/**
 * @typedef {{id: number, type: string, position: {x: number, y: number, z: number}, power: number,
 *     destroy: boolean, color: number, time: number | null}} LiveEffect - color: RGB
 */

/**
 * @param raw {any}
 * @returns {LiveEffect | null}
 */
export function parseEffect(raw) {
    if (!raw || typeof raw !== "object" || !Number.isInteger(raw.id) || !EFFECT_TYPES.has(raw.type)) return null;
    if (!isFiniteNumber(raw.x) || !isFiniteNumber(raw.y) || !isFiniteNumber(raw.z)) return null;
    return {
        id: raw.id,
        type: raw.type,
        position: {x: raw.x, y: raw.y, z: raw.z},
        power: isFiniteNumber(raw.power) ? Math.min(Math.max(raw.power, 0), 128) : 0,
        destroy: raw.destroy === true,
        color: Number.isInteger(raw.color) ? raw.color & 0xFFFFFF : 0,
        time: isFiniteNumber(raw.time) ? raw.time : null,
    };
}

/**
 * @param value {any} - the "effects" of a response
 * @returns {LiveEffect[]}
 */
export function parseEffects(value) {
    if (!Array.isArray(value)) return [];
    const effects = [];
    for (const raw of value.slice(0, 512)) {
        const effect = parseEffect(raw);
        if (effect) effects.push(effect);
    }
    return effects;
}
