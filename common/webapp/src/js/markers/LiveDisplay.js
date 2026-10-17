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
 * BlueMap Live: the display-settings of the live-data that each viewer chooses in the settings-menu (saved with the
 * other user-settings).
 */

export const LIVE_DISPLAY = {
    /** entities further than this from the nearest shown player are not shown (blocks), null: all the server sends */
    entityRadius: null,
    /** entities further than this from the camera are not shown (blocks) */
    entityDistance: 300,
    /** particles and effects (explosions, potions, fire, smoke) */
    particles: true,
    /** the previews of changed blocks */
    blockPreview: true,
    /** the shown entity-categories (see entityCategory) */
    categories: {hostile: true, animals: true, other: true, items: true, vehicles: true},
    /** name-tags over players and named mobs */
    nameTags: true,
    /** health-bars over players and mobs */
    healthBars: false,
    /** the camera while following a player: "map" (BlueMaps own), "firstPerson", "shoulder" (see FollowCamera) */
    followMode: "map",
};

const FOLLOW_MODES = ["map", "firstPerson", "shoulder"];

/** the entity-categories of the filter */
export const ENTITY_CATEGORIES = ["hostile", "animals", "other", "items", "vehicles"];

const ANIMAL_GROUPS = new Set(["creature", "ambient", "axolotls", "water_creature", "water_ambient", "underground_water_creature"]);
const VEHICLE_TYPES = /^minecraft:(.*_)?(boat|raft|minecart)$|^minecraft:leash_knot$/;

/**
 * The category of an entity for the filter: hostile (vanilla spawn-group monster), animals (creatures, fish, bats,
 * axolotls), other (other mobs: villagers, golems, ...), items (dropped and thrown items, arrows), vehicles (boats,
 * minecarts, leash-knots).
 * @param type {string}
 * @param kind {string | null} - see entityKind
 * @param group {string | null} - the spawn-group of a mob
 * @returns {string | null} null: always shown
 */
export function entityCategory(type, kind, group) {
    // the cloud of a lingering potion is an effect (see particles)
    if (kind === "particles") return null;
    if (VEHICLE_TYPES.test(type)) return "vehicles";
    if (kind === "mob" || kind === "placeholder") {
        if (group === "monster") return "hostile";
        if (group && ANIMAL_GROUPS.has(group)) return "animals";
        return "other";
    }
    return "items";
}

export const ENTITY_DISTANCE_MIN = 50;
export const ENTITY_DISTANCE_MAX = 1000;

/** the keys of setLiveDisplay (saved as user-settings "live.<key>") */
export const LIVE_DISPLAY_KEYS = ["entityRadius", "entityDistance", "particles", "blockPreview", "nameTags", "healthBars", "followMode",
    ...ENTITY_CATEGORIES.map(category => "category." + category)];

const BOOLEAN_KEYS = new Set(["particles", "blockPreview", "nameTags", "healthBars"]);

/**
 * Sets a display-setting, invalid values are replaced by the default.
 * @param key {string} - see LIVE_DISPLAY_KEYS
 * @param value {any}
 * @returns {boolean} if the key is known
 */
export function setLiveDisplayValue(key, value) {
    if (key === "entityRadius") LIVE_DISPLAY.entityRadius = value === null || value === undefined || !Number.isFinite(Number(value)) ?
        null : Math.max(0, Math.min(256, Number(value)));
    else if (key === "entityDistance") LIVE_DISPLAY.entityDistance =
        Math.max(ENTITY_DISTANCE_MIN, Math.min(ENTITY_DISTANCE_MAX, Number(value) || 300));
    else if (key === "healthBars") LIVE_DISPLAY.healthBars = value === true;
    else if (key === "followMode") LIVE_DISPLAY.followMode = FOLLOW_MODES.includes(value) ? value : "map";
    else if (BOOLEAN_KEYS.has(key)) LIVE_DISPLAY[key] = value !== false;
    else if (key.startsWith("category.") && ENTITY_CATEGORIES.includes(key.substring(9))) LIVE_DISPLAY.categories[key.substring(9)] = value !== false;
    else return false;
    return true;
}

/**
 * @param key {string} - see LIVE_DISPLAY_KEYS
 * @returns {any}
 */
export function liveDisplayValue(key) {
    if (key.startsWith("category.")) return LIVE_DISPLAY.categories[key.substring(9)];
    return LIVE_DISPLAY[key];
}

/**
 * If an entity is within the chosen radius around the shown players.
 * @param position {{x: number, y: number, z: number}}
 * @param players {Array<{x: number, y: number, z: number}>}
 * @param radius {number | null}
 * @returns {boolean}
 */
export function withinPlayerRadius(position, players, radius) {
    if (radius === null || radius === undefined) return true;
    const r2 = radius * radius;
    for (const p of players) {
        const dx = p.x - position.x, dy = p.y - position.y, dz = p.z - position.z;
        if (dx * dx + dy * dy + dz * dz <= r2) return true;
    }
    return false;
}
