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

const STATE_KEYS = ["sneaking", "sprinting", "onGround", "swimming", "flying", "fallFlying"];

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
    };
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
 *     hurt: {count: number} | null
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
 * @returns {number}
 */
export function interpolationDuration(previous, next, updateInterval) {
    let duration = updateInterval;
    if (previous && previous.time !== null && next.time !== null && next.time > previous.time) {
        duration = Math.min(next.time - previous.time, updateInterval);
    }
    return Math.min(MAX_UPDATE_INTERVAL, Math.max(50, duration));
}
