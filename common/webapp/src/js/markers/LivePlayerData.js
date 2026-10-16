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

import {parseWorldTime} from "./WorldTime.js";
import {parseParticles} from "./particles/ParticleData.js";

/*
 * Parsing and validation of the live/players.json data (no three.js dependencies, so it can be unit-tested with node).
 * See docs/bluemap-live/phase-2.md for the format.
 */

/** The highest protocol version this client fully understands */
export const SUPPORTED_PROTOCOL = 1;

/** Default and limits for the polling interval in ms */
export const DEFAULT_UPDATE_INTERVAL = 1000;
export const MIN_UPDATE_INTERVAL = 100;
export const MAX_UPDATE_INTERVAL = 10000;

/** Moving further than this (blocks) between two updates is never interpolated, even without a generation change */
export const MAX_INTERPOLATION_DISTANCE = 64;

const isFiniteNumber = value => typeof value === "number" && Number.isFinite(value);

const numberOr = (value, fallback) => isFiniteNumber(value) ? value : fallback;

const parseVector = value => {
    if (!value || typeof value !== "object") return null;
    if (!isFiniteNumber(value.x) || !isFiniteNumber(value.y) || !isFiniteNumber(value.z)) return null;
    return {x: value.x, y: value.y, z: value.z};
}

const STATE_KEYS = ["sneaking", "sprinting", "onGround", "swimming", "flying", "fallFlying", "riding"];

const SKIN_VERSION_PATTERN = /^[0-9a-f]{1,64}$/;

/**
 * @param value {any}
 * @returns {{model: "classic" | "slim", version: string} | null} - null if there is no valid skin-info
 *  (an unknown model falls back to "classic", an invalid version means no skin)
 */
export function parseSkin(value) {
    if (!value || typeof value !== "object") return null;
    if (typeof value.version !== "string" || !SKIN_VERSION_PATTERN.test(value.version)) return null;
    return {
        model: value.model === "slim" ? "slim" : "classic",
        version: value.version,
    };
}

const SWING_KINDS = ["swing", "attack", "mine", "use"];

/**
 * @param value {any}
 * @returns {{count: number, arm: "left" | "right", kind: string} | null} - the arm-swing counter of the player (it increases by one
 *  with every new swing, the arm and kind are the ones of the last swing), null if unknown or invalid
 */
export function parseSwing(value) {
    if (!value || typeof value !== "object") return null;
    if (!Number.isInteger(value.count) || value.count < 0) return null;
    return {
        count: value.count,
        arm: value.arm === "left" ? "left" : "right",
        kind: SWING_KINDS.includes(value.kind) ? value.kind : "swing",
    };
}

const ITEM_ID_PATTERN = /^[a-z0-9_.-]+:[a-z0-9_.-]+(\/[a-z0-9_.-]+)*$/;

/**
 * @param value {any}
 * @returns {{id: string, glint: boolean, customModelData: number | null, charged: boolean, firework: boolean} | null}
 *  - null for an empty hand or an invalid item (the id is used in an url and must be a valid resource-location)
 */
export function parseItem(value) {
    if (!value || typeof value !== "object") return null;
    if (typeof value.id !== "string" || !ITEM_ID_PATTERN.test(value.id) || value.id.includes("..")) return null;
    return {
        id: value.id,
        glint: value.glint === true,
        customModelData: Number.isInteger(value.customModelData) ? value.customModelData : null,
        charged: value.charged === true,
        firework: value.firework === true,
    };
}

/**
 * @param value {any}
 * @returns {{mainHand: object | null, offHand: object | null, leftHanded: boolean, fishing: boolean} | null}
 */
export function parseEquipment(value) {
    if (!value || typeof value !== "object") return null;
    return {
        mainHand: parseItem(value.mainHand),
        offHand: parseItem(value.offHand),
        leftHanded: value.mainArm === "left",
        fishing: value.fishing === true,
        armor: parseArmor(value.armor),
        // an item on the head that is no helmet (vanilla HeadFeatureRenderer)
        head: parseItem(value.head),
        // dynamic lights: the light the items emit (0..15)
        light: Number.isInteger(value.light) ? Math.max(0, Math.min(15, value.light)) : 0,
    };
}

const TEXTURE_KEY_PATTERN = /^[a-z0-9_.-]+:[a-z0-9_./-]+$/;
export const ARMOR_SLOT_NAMES = ["head", "chest", "legs", "feet"];

/**
 * @param value {any}
 * @returns {Object<string, Array<{texture: string, color: number | null}>> | null} - per slot the texture-layers
 *  (vanilla ArmorFeatureRenderer), null if no armor is worn
 */
export function parseArmor(value) {
    if (!value || typeof value !== "object") return null;
    const armor = {};
    let any = false;
    for (const slot of ARMOR_SLOT_NAMES) {
        if (!Array.isArray(value[slot])) continue;
        const layers = [];
        for (const layer of value[slot].slice(0, 4)) {
            if (!layer || typeof layer.texture !== "string" || !TEXTURE_KEY_PATTERN.test(layer.texture) || layer.texture.includes("..")) continue;
            const color = Number.isInteger(layer.color) && layer.color >= 0 && layer.color <= 0xFFFFFF ? layer.color : null;
            layers.push({texture: layer.texture, color});
        }
        if (layers.length > 0) {
            armor[slot] = layers;
            any = true;
        }
    }
    return any ? armor : null;
}

const USE_ACTION_PATTERN = /^[a-z_]{1,32}$/;

/**
 * @param value {any}
 * @returns {{mainHand: boolean, action: string, ticks: number} | null} - the item the player is using, null if none
 */
export function parseItemUse(value) {
    if (!value || typeof value !== "object") return null;
    if (typeof value.action !== "string" || !USE_ACTION_PATTERN.test(value.action)) return null;
    return {
        mainHand: value.hand !== "off",
        action: value.action,
        ticks: Number.isInteger(value.ticks) && value.ticks >= 0 ? value.ticks : 0,
    };
}

/** vanilla LivingEntityRenderer.getYaw(Direction) and Direction.getOffsetX/Z: the beds by their direction */
export const BED_DIRECTIONS = {
    south: {yaw: 90, x: 0, z: 1},
    west: {yaw: 0, x: -1, z: 0},
    north: {yaw: 270, x: 0, z: -1},
    east: {yaw: 180, x: 1, z: 0},
};

/**
 * vanilla LivingEntityRenderer: lying in a bed (EntityPose.SLEEPING), moved towards the head-end by the offset
 * (getEyeHeight(STANDING) - 0.1) and turned by the direction of the bed (by the body if the bed is unknown)
 * @param direction {string | null} - e.g. "north"
 * @param offset {number}
 * @param bodyYaw {number}
 * @returns {{yaw: number, x: number, z: number}} - the yaw in degrees and the offset in blocks
 */
export function bedTransform(direction, offset, bodyYaw) {
    const d = direction && BED_DIRECTIONS[direction];
    if (!d) return {yaw: bodyYaw, x: 0, z: 0};
    return {yaw: d.yaw, x: -d.x * offset, z: -d.z * offset};
}

/**
 * @param value {any}
 * @returns {{direction: string | null, offset: number} | null} - the bed of a sleeping player
 */
export function parseBed(value) {
    if (!value || typeof value !== "object") return null;
    const direction = typeof value.direction === "string" && BED_DIRECTIONS[value.direction] ? value.direction : null;
    const offset = isFiniteNumber(value.offset) ? Math.max(-4, Math.min(4, value.offset)) : 0;
    return {direction, offset};
}

/**
 * @param value {any}
 * @returns {{id: number, offset: {x: number, y: number, z: number}, bodyYaw: number, headYaw: number} | null} - the
 * vehicle of a riding player: the offset and the yaws are relative to the drawn yaw of the vehicle
 */
export function parseVehicle(value) {
    if (!value || typeof value !== "object" || !Number.isInteger(value.id)) return null;
    const offset = parseVector(value.offset);
    if (!offset) return null;
    return {id: value.id, offset, bodyYaw: numberOr(value.bodyYaw, 0), headYaw: numberOr(value.headYaw, 0)};
}

/**
 * Where a riding player is drawn on the drawn vehicle: the offset is turned back from the frame of the vehicle
 * (inverse of the server-side Vehicle.toLocal), the yaws are relative to the vehicle-yaw.
 * @param vehicle {{offset: {x: number, y: number, z: number}, bodyYaw: number, headYaw: number}}
 * @param position {{x: number, y: number, z: number}} - the drawn position of the vehicle
 * @param yaw {number} - the drawn yaw of the vehicle in degrees
 * @returns {{x: number, y: number, z: number, bodyYaw: number, headYaw: number}}
 */
export function riderOnVehicle(vehicle, position, yaw) {
    const rad = yaw * Math.PI / 180, cos = Math.cos(rad), sin = Math.sin(rad);
    const o = vehicle.offset;
    return {
        x: position.x + o.x * cos - o.z * sin,
        y: position.y + o.y,
        z: position.z + o.x * sin + o.z * cos,
        bodyYaw: yaw + vehicle.bodyYaw,
        headYaw: yaw + vehicle.headYaw,
    };
}

/**
 * @typedef LivePlayer {{
 *     uuid: string,
 *     name: string,
 *     foreign: boolean,
 *     position: {x: number, y: number, z: number},
 *     rotation: {pitch: number, yaw: number, roll: number},
 *     bodyYaw: number,
 *     world: string | null,
 *     generation: number | null,
 *     time: number | null,
 *     velocity: {x: number, y: number, z: number} | null,
 *     state: object | null,
 *     skin: {model: "classic" | "slim", version: string} | null,
 *     swing: {count: number, arm: "left" | "right", kind: string} | null,
 *     equipment: {mainHand: object | null, offHand: object | null, leftHanded: boolean, fishing: boolean} | null,
 *     use: {mainHand: boolean, action: string, ticks: number} | null,
 *     hurt: {count: number} | null,
 *     vehicle: {id: number, offset: {x: number, y: number, z: number}, bodyYaw: number, headYaw: number} | null,
 *     particles: import("./particles/ParticleData.js").LiveParticles | null
 * }}
 */

/**
 * Normalizes one player-entry. Invalid entries (no uuid, no valid position) return null,
 * missing or invalid optional fields are replaced by defaults / null.
 * @param raw {any}
 * @returns {LivePlayer | null}
 */
export function parsePlayer(raw) {
    if (!raw || typeof raw !== "object") return null;
    if (typeof raw.uuid !== "string" || raw.uuid.length === 0) return null;

    const position = parseVector(raw.position);
    if (!position) return null;

    const rot = (raw.rotation && typeof raw.rotation === "object") ? raw.rotation : {};
    const rotation = {
        pitch: numberOr(rot.pitch, 0),
        yaw: numberOr(rot.yaw, 0),
        roll: numberOr(rot.roll, 0),
    };

    let state = null;
    if (raw.state && typeof raw.state === "object") {
        state = {};
        STATE_KEYS.forEach(key => state[key] = raw.state[key] === true);
        state.bed = parseBed(raw.state.bed);
    }

    return {
        uuid: raw.uuid,
        name: typeof raw.name === "string" && raw.name.length > 0 ? raw.name : raw.uuid,
        foreign: raw.foreign === true,
        position,
        rotation,
        bodyYaw: numberOr(raw.bodyYaw, rotation.yaw),
        world: typeof raw.world === "string" ? raw.world : null,
        generation: Number.isInteger(raw.generation) ? raw.generation : null,
        time: isFiniteNumber(raw.time) ? raw.time : null,
        velocity: parseVector(raw.velocity),
        state,
        skin: parseSkin(raw.skin),
        swing: parseSwing(raw.swing),
        equipment: parseEquipment(raw.equipment),
        use: parseItemUse(raw.use),
        hurt: raw.hurt && Number.isInteger(raw.hurt.count) && raw.hurt.count >= 0 ? {count: raw.hurt.count} : null,
        vehicle: parseVehicle(raw.vehicle),
        particles: parseParticles(raw.particles),
    };
}

/**
 * Parses the whole live/players.json response.
 * <ul>
 *   <li>Missing <code>protocol</code> → data of an older server (protocol 0), only the original fields are used.</li>
 *   <li><code>protocol</code> higher than supported → treated like protocol 0 (only the original fields are used),
 *       because those are guaranteed to stay compatible.</li>
 *   <li>Invalid player-entries are skipped and counted in <code>invalid</code>.</li>
 * </ul>
 * @param data {any}
 * @returns {{protocol: number, supported: boolean, serverTime: number | null, updateInterval: number | null, players: LivePlayer[], invalid: number} | null}
 *  - null if the data is not a valid players-response at all
 */
export function parsePlayersResponse(data) {
    if (!data || typeof data !== "object" || !Array.isArray(data.players)) return null;

    const protocol = Number.isInteger(data.protocol) && data.protocol > 0 ? data.protocol : 0;
    const supported = protocol <= SUPPORTED_PROTOCOL;

    const players = [];
    let invalid = 0;
    for (const raw of data.players) {
        let player = parsePlayer(raw);
        if (!player) {
            invalid++;
            continue;
        }
        if (!supported || protocol === 0) player = toLegacy(player);
        players.push(player);
    }

    return {
        protocol,
        supported,
        serverTime: isFiniteNumber(data.serverTime) ? data.serverTime : null,
        updateInterval: isFiniteNumber(data.updateInterval) ? data.updateInterval : null,
        players,
        invalid,
        world: supported ? parseWorldTime(data.world) : null,
    };
}

/** Strips everything that is not part of the original (protocol 0) format */
function toLegacy(player) {
    return {
        ...player,
        bodyYaw: player.rotation.yaw,
        world: null,
        generation: null,
        time: null,
        velocity: null,
        state: null,
        skin: null,
        swing: null,
        equipment: null,
        use: null,
        hurt: null,
    };
}

/**
 * @param lastServerTime {number | null}
 * @param serverTime {number | null}
 * @returns {boolean} true if a response with the given serverTime is older than the last processed one and must be ignored
 */
export function isStaleResponse(lastServerTime, serverTime) {
    if (lastServerTime == null || serverTime == null) return false;
    return serverTime < lastServerTime;
}

/**
 * @param updateInterval {number | null} - the interval announced by the server
 * @returns {number} the interval in ms the client should poll with
 */
export function resolveUpdateInterval(updateInterval) {
    if (!isFiniteNumber(updateInterval)) return DEFAULT_UPDATE_INTERVAL;
    return Math.min(MAX_UPDATE_INTERVAL, Math.max(MIN_UPDATE_INTERVAL, updateInterval));
}

/**
 * Decides if the change from previous to next must be applied instantly (no interpolation).
 * @param previous {LivePlayer | null}
 * @param next {LivePlayer}
 * @param maxDistance {number}
 * @returns {boolean}
 */
export function isDiscontinuous(previous, next, maxDistance = MAX_INTERPOLATION_DISTANCE) {
    if (!previous) return true;
    if (previous.generation !== null && next.generation !== null && previous.generation !== next.generation) return true;
    if (previous.world !== null && next.world !== null && previous.world !== next.world) return true;
    if (previous.foreign !== next.foreign) return true;

    const dx = next.position.x - previous.position.x;
    const dy = next.position.y - previous.position.y;
    const dz = next.position.z - previous.position.z;
    return dx * dx + dy * dy + dz * dz > maxDistance * maxDistance;
}

/**
 * Returns the signed shortest difference (in degrees) to rotate from angle a to angle b
 * @param a {number}
 * @param b {number}
 * @returns {number} - in the range [-180, 180)
 */
export function angleDelta(a, b) {
    let d = (b - a) % 360;
    if (d >= 180) d -= 360;
    if (d < -180) d += 360;
    return d;
}

/**
 * The duration for interpolating between two updates in ms.
 * Uses the time between the two samples if available, but never more than the update-interval,
 * so the displayed position never lags behind more than one update (e.g. after a pause or a throttled browser-tab).
 * @param previous {LivePlayer | null}
 * @param next {LivePlayer}
 * @param updateInterval {number}
 * @param buffered {boolean} - the samples are played back at their sample-times (LivePlayback): the whole time
 *   between the samples, without the limit of the update-interval
 * @returns {number}
 */
export function interpolationDuration(previous, next, updateInterval, buffered = false) {
    let duration = updateInterval;
    if (previous && previous.time !== null && next.time !== null && next.time > previous.time) {
        // played back (see LivePlayback): the samples are applied as far apart as they were taken, also if some were
        // missed (requested less often than sampled), so the movement takes the whole time between them
        duration = buffered ? Math.min(next.time - previous.time, MAX_BUFFERED_INTERPOLATION) :
            Math.min(next.time - previous.time, updateInterval);
    }
    return Math.min(MAX_UPDATE_INTERVAL, Math.max(50, duration));
}

/** the longest interpolation of played back samples (ms), e.g. after the page was in the background */
export const MAX_BUFFERED_INTERPOLATION = 2000;
