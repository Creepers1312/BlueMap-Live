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
 * Parsing and validation of the live/entities.json data of BlueMap Live (no three.js dependencies, so it can be
 * unit-tested with node). See docs/bluemap-live/phase-5.md for the format.
 */

import {parseItem, resolveUpdateInterval, SUPPORTED_PROTOCOL} from "./LivePlayerData.js";

const isFiniteNumber = value => typeof value === "number" && Number.isFinite(value);

const parseVector = value => {
    if (!value || typeof value !== "object") return null;
    if (!isFiniteNumber(value.x) || !isFiniteNumber(value.y) || !isFiniteNumber(value.z)) return null;
    return {x: value.x, y: value.y, z: value.z};
};

const TYPE_PATTERN = /^[a-z0-9_.-]+:[a-z0-9_./-]+$/;

/** entity-types that are rendered like arrows (an item oriented along the flight-direction) */
export const PROJECTILE_TYPES = new Set(["minecraft:arrow", "minecraft:spectral_arrow", "minecraft:trident"]);

/** entity-types with an own model built by the webapp (vanilla ArrowEntityRenderer), loaded as entity-asset */
export const ARROW_MODEL_TYPES = new Set(["minecraft:arrow", "minecraft:spectral_arrow"]);

/**
 * Vanilla projectile-physics per tick (1.21.1): the velocity is multiplied by the drag and the gravity is subtracted.
 * Used to predict the flight between two samples (the server samples only every 250 ms).
 * @param type {string}
 * @returns {{gravity: number, drag: number}}
 */
export function projectilePhysics(type) {
    switch (type) {
        case "minecraft:arrow":
        case "minecraft:spectral_arrow":
        case "minecraft:trident":
        case "minecraft:potion":
            return {gravity: 0.05, drag: 0.99};
        case "minecraft:experience_bottle":
            return {gravity: 0.07, drag: 0.99};
        case "minecraft:fireball":
        case "minecraft:small_fireball":
        case "minecraft:dragon_fireball":
        case "minecraft:wither_skull":
        case "minecraft:wind_charge":
        case "minecraft:breeze_wind_charge":
            return {gravity: 0, drag: 1};
        default: // snowball, egg, ender pearl, ...
            return {gravity: 0.03, drag: 0.99};
    }
}

/**
 * The vanilla projectile-rotation (degrees) for a direction: yaw = atan2(x, z), pitch = atan2(y, horizontal).
 * @param direction {{x: number, y: number, z: number}}
 * @returns {{yaw: number, pitch: number}}
 */
export function projectileAngles(direction) {
    const horizontal = Math.hypot(direction.x, direction.z);
    return {
        yaw: Math.atan2(direction.x, direction.z) * 180 / Math.PI,
        pitch: Math.atan2(direction.y, horizontal) * 180 / Math.PI,
    };
}

/** vanilla FlyingItemEntityRenderer scales (default 1) */
export const THROWN_ITEM_SCALES = {"minecraft:fireball": 3, "minecraft:small_fireball": 0.75};

/**
 * @typedef LiveEntity {{
 *     id: number,
 *     type: string,
 *     position: {x: number, y: number, z: number},
 *     rotation: {yaw: number, pitch: number},
 *     velocity: {x: number, y: number, z: number},
 *     time: number | null,
 *     onGround: boolean,
 *     item: object | null
 * }}
 */

/**
 * @param raw {any}
 * @returns {LiveEntity | null} - null for invalid entries
 */
export function parseEntity(raw) {
    if (!raw || typeof raw !== "object") return null;
    if (!Number.isInteger(raw.id)) return null;
    if (typeof raw.type !== "string" || !TYPE_PATTERN.test(raw.type)) return null;
    const position = parseVector(raw.position);
    if (!position) return null;
    const rotation = raw.rotation && typeof raw.rotation === "object" ? raw.rotation : {};
    return {
        id: raw.id,
        type: raw.type,
        position,
        rotation: {
            yaw: isFiniteNumber(rotation.yaw) ? rotation.yaw : 0,
            pitch: isFiniteNumber(rotation.pitch) ? rotation.pitch : 0,
        },
        velocity: parseVector(raw.velocity) || {x: 0, y: 0, z: 0},
        time: isFiniteNumber(raw.time) ? raw.time : null,
        onGround: raw.onGround === true,
        item: parseItem(raw.item),
    };
}

/**
 * @param data {any}
 * @returns {{protocol: number, supported: boolean, serverTime: number | null, updateInterval: number, entities: LiveEntity[], invalid: number} | null}
 *  - null if the data is no entities-response at all; an unsupported (newer) protocol has no entities
 */
export function parseEntitiesResponse(data) {
    if (!data || typeof data !== "object" || !Array.isArray(data.entities)) return null;
    const protocol = Number.isInteger(data.protocol) && data.protocol > 0 ? data.protocol : 0;
    const supported = protocol > 0 && protocol <= SUPPORTED_PROTOCOL;

    const entities = [];
    let invalid = 0;
    if (supported) {
        for (const raw of data.entities) {
            const entity = parseEntity(raw);
            if (entity) entities.push(entity);
            else invalid++;
        }
    }
    return {
        protocol,
        supported,
        serverTime: isFiniteNumber(data.serverTime) ? data.serverTime : null,
        updateInterval: resolveUpdateInterval(isFiniteNumber(data.updateInterval) ? data.updateInterval : null),
        entities,
        invalid,
    };
}

/**
 * How an entity is rendered.
 * @param entity {LiveEntity}
 * @returns {"item" | "arrow" | "projectile" | "thrown" | null} - null: not rendered (yet)
 */
export function entityKind(entity) {
    if (ARROW_MODEL_TYPES.has(entity.type)) return "arrow";
    if (!entity.item) return null;
    if (entity.type === "minecraft:item") return "item";
    if (PROJECTILE_TYPES.has(entity.type)) return "projectile";
    return "thrown";
}

/**
 * The flight-direction of an arrow-like projectile: from the velocity while it flies, otherwise from its rotation
 * (vanilla projectiles use yaw = atan2(vx, vz), pitch = atan2(vy, horizontal-speed), in degrees).
 * @param entity {LiveEntity}
 * @returns {{x: number, y: number, z: number}} normalized
 */
export function projectileDirection(entity) {
    const v = entity.velocity;
    const speed = Math.hypot(v.x, v.y, v.z);
    if (speed > 0.5) return {x: v.x / speed, y: v.y / speed, z: v.z / speed};
    const yaw = entity.rotation.yaw * Math.PI / 180, pitch = entity.rotation.pitch * Math.PI / 180;
    return {x: Math.sin(yaw) * Math.cos(pitch), y: Math.sin(pitch), z: Math.cos(yaw) * Math.cos(pitch)};
}

/**
 * Vanilla ItemEntityRenderer: the bobbing (blocks) and the rotation (radians) of a dropped item.
 * @param ageTicks {number} - the (client-side) age of the item in ticks
 * @param offset {number} - a per-entity offset (vanilla uses a random value per item)
 * @returns {{bob: number, rotation: number}}
 */
export function droppedItemMotion(ageTicks, offset) {
    return {
        bob: Math.sin(ageTicks / 10 + offset) * 0.1 + 0.1,
        rotation: ageTicks / 20 + offset,
    };
}
