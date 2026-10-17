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

import {BED_DIRECTIONS, bedTransform, parseEquipment, parseItem, resolveUpdateInterval, SUPPORTED_PROTOCOL} from "./LivePlayerData.js";
import {MOB_TYPES} from "./mob/MobTypes.js";
import {parseEffects, parseParticles} from "./particles/ParticleData.js";
import {parseContainers} from "./ChestLids.js";
import {parseBlocks} from "./blocks/BlockPreviewData.js";

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
 *     item: object | null,
 *     mob: LiveMob | null,
 *     impact: {x: number, y: number, z: number, ticks: number} | null
 * }}
 * @typedef LiveMob {{
 *     bodyYaw: number, headYaw: number, hurtTime: number, deathTime: number, baby: boolean,
 *     variant: string | null, size: number, width: number, height: number, flags: Set<string>, models: string[],
 *     swingTicks: number, attackTicks: number, bedOffset: number,
 *     equipment: {mainHand: object | null, offHand: object | null, leftHanded: boolean} | null
 * }}
 */

/**
 * vanilla LivingEntityRenderer: a mob lying in a bed (EntityPose.SLEEPING) is moved towards the head-end by
 * getEyeHeight(STANDING) - 0.1 and turned by the direction of the bed (by its body if the bed is unknown)
 * @param mob {LiveMob}
 * @returns {{yaw: number, x: number, z: number} | null} - the yaw in degrees and the offset in blocks
 */
export function bedPose(mob) {
    if (!mob || !mob.flags.has("in_bed")) return null;
    const direction = Object.keys(BED_DIRECTIONS).find(name => mob.flags.has("bed_" + name)) || null;
    return bedTransform(direction, mob.bedOffset, mob.bodyYaw);
}

/** vanilla LivingEntity.getHandSwingDuration (without haste and mining fatigue) */
export const MOB_SWING_TICKS = 6;

const VARIANT_PATTERN = /^[a-z0-9_-]+(\/[a-z0-9_-]+)*$/;
const FLAG_PATTERN = /^[a-z0-9_]{1,32}$/;
const clampNumber = (value, min, max, fallback) => isFiniteNumber(value) ? Math.min(max, Math.max(min, value)) : fallback;

/**
 * @param value {any}
 * @returns {{x: number, y: number, z: number, ticks: number} | null} - where a flying projectile hits a block
 *  (computed by the server), the ticks from the sample until then
 */
export function parseImpact(value) {
    const position = parseVector(value);
    if (!position || !isFiniteNumber(value.ticks) || value.ticks < 0) return null;
    return {...position, ticks: value.ticks};
}

/**
 * @param value {any}
 * @returns {LiveMob | null} - the state of a living entity, null if there is none
 */
export function parseMob(value) {
    if (!value || typeof value !== "object") return null;
    const flags = new Set();
    if (Array.isArray(value.flags)) {
        for (const flag of value.flags.slice(0, 16)) if (typeof flag === "string" && FLAG_PATTERN.test(flag)) flags.add(flag);
    }
    return {
        bodyYaw: isFiniteNumber(value.bodyYaw) ? value.bodyYaw : 0,
        headYaw: isFiniteNumber(value.headYaw) ? value.headYaw : (isFiniteNumber(value.bodyYaw) ? value.bodyYaw : 0),
        hurtTime: clampNumber(value.hurtTime, 0, 10, 0),
        deathTime: clampNumber(value.deathTime, 0, 20, 0),
        baby: value.baby === true,
        variant: typeof value.variant === "string" && value.variant.length <= 64 && VARIANT_PATTERN.test(value.variant) ? value.variant : null,
        size: Math.round(clampNumber(value.size, 0, 127, 0)),
        width: clampNumber(value.width, 0.1, 16, 0.6),
        height: clampNumber(value.height, 0.1, 16, 1.8),
        flags,
        // the hand-swing (ticks since its start, -1: none) and the attack-animation (remaining ticks)
        swingTicks: isFiniteNumber(value.swingTicks) && value.swingTicks >= 0 ? Math.min(value.swingTicks, MOB_SWING_TICKS) : -1,
        attackTicks: clampNumber(value.attackTicks, 0, 20, 0),
        // lying in a bed: the offset towards the head-end (blocks)
        bedOffset: clampNumber(value.bedOffset, -4, 4, 0),
        models: Array.isArray(value.models) ?
            value.models.slice(0, 4).filter(model => typeof model === "string" && TYPE_PATTERN.test(model) && !model.includes("..")) : [],
        equipment: parseEquipment(value.equipment),
        leash: parseLeash(value.leash),
    };
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * @param value {any}
 * @returns {{entity: number | null, player: string | null, start: {x: number, y: number, z: number},
 *     end: {x: number, y: number, z: number}} | null} - the leash: the holder (entity-id or player-uuid) and both
 *     ends relative to their entity, in the frame of its drawn yaw
 */
export function parseLeash(value) {
    if (!value || typeof value !== "object") return null;
    const entity = Number.isInteger(value.entity) ? value.entity : null;
    const player = typeof value.player === "string" && UUID_PATTERN.test(value.player) ? value.player : null;
    const start = parseVector(value.start), end = parseVector(value.end);
    if ((entity === null && player === null) || !start || !end) return null;
    if ([start, end].some(v => Math.abs(v.x) > 8 || Math.abs(v.y) > 8 || Math.abs(v.z) > 8)) return null;
    return {entity, player, start, end};
}

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
        mob: parseMob(raw.mob),
        impact: parseImpact(raw.impact),
        particles: parseParticles(raw.particles),
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
        effects: supported ? parseEffects(data.effects) : [],
        radius: isFiniteNumber(data.radius) && data.radius > 0 ? data.radius : null,
        containers: supported ? parseContainers(data.containers) : [],
        blocks: supported ? parseBlocks(data.blocks) : [],
    };
}

/**
 * How an entity is rendered.
 * @param entity {LiveEntity}
 * @returns {"item" | "arrow" | "projectile" | "thrown" | "mob" | "placeholder" | "particles" | null} - null: not rendered (yet)
 *  - particles: only the particles it emits (an area-effect-cloud)
 *  - mob: a vanilla mob-model (MobTypes), placeholder: a living entity without a model in the webapp
 */
export function entityKind(entity) {
    if (entity.mob) return Object.prototype.hasOwnProperty.call(MOB_TYPES, entity.type) ? "mob" : "placeholder";
    if (ARROW_MODEL_TYPES.has(entity.type)) return "arrow";
    if (!entity.item) return entity.particles ? "particles" : null;
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
