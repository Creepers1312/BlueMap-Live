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
 * BlueMap Live (see docs/bluemap-live/phase-11.md): block-changes are previewed at once and replaced by the rendered
 * tile as soon as BlueMap rendered it with the change (confirmed); a preview that is not confirmed is discarded.
 * No three.js, unit-tested with node.
 */

/**
 * A preview whose tile was rendered again this long (ms) after the change, without containing it, is discarded (the
 * rendered tile is newer). Without a render the preview stays: while Minecraft does not save (e.g. a singleplayer-game
 * paused because its window lost focus), BlueMap renders nothing and the tile still shows the old block.
 */
export const PREVIEW_TIMEOUT = 90000;
/** a preview that is never confirmed is discarded after this time (ms) at the latest (e.g. rendering is paused) */
export const PREVIEW_MAX_AGE = 30 * 60000;
/** at most this many previews (the oldest are discarded) */
export const MAX_PREVIEWS = 4096;
/** the 6 neighbors in the order of the data: down, up, north, south, west, east */
export const NEIGHBOR_OFFSETS = [[0, -1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1], [-1, 0, 0], [1, 0, 0]];
/** cullface-codes of the block-assets (the java ItemModelBaker.CULLFACE_CODES): 1..6 like the neighbors */
export const OPPOSITE = [0, 2, 1, 4, 3, 6, 5];

const STATE_PATTERN = /^[a-z0-9_.-]+:[a-z0-9_./-]+(\[[a-z0-9_]+=[a-z0-9_]+(,[a-z0-9_]+=[a-z0-9_]+)*])?$/;

export const isAir = state => state === null || state === "minecraft:air" || state === "minecraft:cave_air" || state === "minecraft:void_air";

/**
 * The asset-name of a block-state (the java ItemAssetUpdater.blockAssetName)
 * @param state {string}
 * @returns {string} e.g. "minecraft/oak_stairs/facing_east__half_bottom"
 */
export function blockAssetName(state) {
    const bracket = state.indexOf("[");
    const id = bracket < 0 ? state : state.substring(0, bracket);
    const [namespace, path] = id.split(":");
    const properties = bracket < 0 ? "default" : state.substring(bracket + 1, state.length - 1).replace(/=/g, "_").replace(/,/g, "__");
    return namespace + "/" + path + "/" + properties;
}

/**
 * @param value {any} - the "blocks" of live/entities.json
 * @returns {Array<{id: number, x: number, y: number, z: number, state: string, neighbors: Array<string | null>, time: number}>}
 */
/**
 * The light at a changed block (sky-light, block-light, luminance of the new block), null if the server sends none.
 * @param values {any[]}
 * @returns {{sky: number, block: number, luminance: number} | null}
 */
export function parseLight(values) {
    if (values.length !== 3 || !values.every(v => Number.isInteger(v) && v >= 0 && v <= 15)) return null;
    return {sky: values[0], block: values[1], luminance: values[2]};
}

/** the light of a part without known light: outdoors (like the entities) */
export const DEFAULT_LIGHT = {sky: 15, block: 0, luminance: 0};

export function parseBlocks(value) {
    if (!value || typeof value !== "object" || !Array.isArray(value.palette) || !Array.isArray(value.changes)) return [];
    const palette = value.palette.map(state => typeof state === "string" && state.length <= 512 && STATE_PATTERN.test(state) &&
        !state.includes("..") ? state : null);
    const state = index => Number.isInteger(index) && index >= 0 && index < palette.length ? palette[index] : null;
    const result = [];
    for (const row of value.changes.slice(0, 8192)) {
        if (!Array.isArray(row) || row.length < 12 || !row.slice(0, 11).every(Number.isInteger) || !Number.isFinite(row[11])) continue;
        const s = state(row[4]);
        if (s === null) continue;
        result.push({id: row[0], x: row[1], y: row[2], z: row[3], state: s, neighbors: row.slice(5, 11).map(state), time: row[11],
            light: parseLight(row.slice(12, 15))});
    }
    return result;
}

/**
 * The hires-tile of a block (like Map.loadMapArea)
 * @param hires {{tileSize: {x: number, z: number}, translate: {x: number, z: number}}}
 */
export function tileOf(x, z, hires) {
    return {x: Math.floor((x - hires.translate.x) / hires.tileSize.x), z: Math.floor((z - hires.translate.z) / hires.tileSize.z)};
}

export const blockKey = (x, y, z) => x + "," + y + "," + z;

/**
 * The previews of the block-changes of a map.
 */
/** applied changes are remembered this long (ms): longer than the server keeps them (10 s) plus the playback-delay */
const SEEN_MAX_AGE = 60000;
const SEEN_PRUNE_INTERVAL = 5000;

export class PreviewStore {

    /**
     * @param hires {{tileSize: {x: number, z: number}, translate: {x: number, z: number}}}
     * @param now {function(): number}
     */
    constructor(hires, now = Date.now) {
        this.hires = hires;
        this.now = now;
        /** @type {Map<string, {id: number, x: number, y: number, z: number, state: string, neighbors: Array<string | null>, time: number, added: number}>} */
        this.previews = new Map();
        /** the ids of the changes that were applied (each change is applied once) */
        /** id@time of the applied changes -> client-time when seen (id and time: the ids start again after a server-restart) */
        this.seen = new Map();
        this.seenPruned = 0;
        this.version = 0;
    }

    /**
     * Applies new block-changes (a later change of the same block replaces the preview).
     * @returns {boolean} if something changed
     */
    apply(changes) {
        const now = this.now();
        let changed = false;
        for (const change of changes) {
            const seenKey = change.id + "@" + change.time;
            if (this.seen.has(seenKey)) continue;
            // the changes of a response arrive in parts (at their playback-times): the keys are kept for a while
            this.seen.set(seenKey, now);
            const key = blockKey(change.x, change.y, change.z);
            const current = this.previews.get(key);
            if (current && current.id >= change.id) continue;
            this.previews.delete(key);
            this.previews.set(key, {...change, added: this.now()});
            changed = true;
        }
        // the server keeps a change for some seconds (LiveBlockLog.MAX_AGE_MILLIS = 10 s, plus the playback-delay)
        if (this.seen.size > 0 && now - this.seenPruned > SEEN_PRUNE_INTERVAL) {
            this.seenPruned = now;
            this.seen.forEach((time, key) => { if (now - time > SEEN_MAX_AGE) this.seen.delete(key); });
        }
        while (this.previews.size > MAX_PREVIEWS) {
            this.previews.delete(this.previews.keys().next().value);
            changed = true;
        }
        if (changed) this.version++;
        return changed;
    }

    /**
     * A tile was rendered again: its previews whose change is contained in the rendered chunk-data are confirmed and
     * removed (the chunk was saved at or after the change; the save-time has a precision of 1 s, so a change in the
     * same second waits for the next render).
     * @param tile {{x: number, z: number, chunks: number[]}} - chunks: [x, z, epoch-seconds, ...]
     * @returns {number} the number of removed previews
     */
    confirm(tile) {
        const chunks = new Map();
        for (let i = 0; i + 2 < tile.chunks.length; i += 3) chunks.set(tile.chunks[i] + "," + tile.chunks[i + 1], tile.chunks[i + 2]);
        let removed = 0;
        this.previews.forEach((preview, key) => {
            const t = tileOf(preview.x, preview.z, this.hires);
            if (t.x !== tile.x || t.z !== tile.z) return;
            const saved = chunks.get((preview.x >> 4) + "," + (preview.z >> 4));
            if (saved === undefined || saved * 1000 < preview.time) {
                // rendered long after the change, but without it: the tile is newer than the preview
                if (saved !== undefined && this.now() - preview.added > PREVIEW_TIMEOUT) {
                    this.previews.delete(key);
                    removed++;
                }
                return;
            }
            this.previews.delete(key);
            removed++;
        });
        if (removed > 0) this.version++;
        return removed;
    }

    /** discards the previews that were never confirmed (see PREVIEW_MAX_AGE) */
    expire() {
        const now = this.now();
        let removed = 0;
        this.previews.forEach((preview, key) => {
            if (now - preview.added > PREVIEW_MAX_AGE) {
                this.previews.delete(key);
                removed++;
            }
        });
        if (removed > 0) this.version++;
        return removed;
    }

    /** the current state of a block: the preview, otherwise the given state (from the data) */
    stateAt(x, y, z, fallback) {
        const preview = this.previews.get(blockKey(x, y, z));
        return preview ? preview.state : fallback;
    }

    clear() {
        if (this.previews.size > 0) this.version++;
        this.previews.clear();
    }

}

/**
 * What a preview draws:
 * - the new block, without the faces towards full neighbor-blocks (vanilla cullface),
 * - if the new block is not full: the faces of the neighbors towards it (they were hidden by the old block in the tile).
 * @param preview {{x: number, y: number, z: number, state: string, neighbors: Array<string | null>}}
 * @param store {PreviewStore}
 * @param isFull {function(string): boolean | null} - if a block-state is a full cube (null: unknown, its asset is loading)
 * @returns {Array<{state: string, x: number, y: number, z: number, cullface: number | null, skip: number[],
 *     light: {sky: number, block: number, luminance: number}}>}
 *  - cullface: only the quads with this cullface (null: all quads), skip: cullfaces that are not drawn
 */
export function previewParts(preview, store, isFull) {
    const parts = [];
    const neighborStates = NEIGHBOR_OFFSETS.map(([dx, dy, dz], i) =>
        store.stateAt(preview.x + dx, preview.y + dy, preview.z + dz, preview.neighbors[i]));
    if (!isAir(preview.state)) {
        const skip = [];
        neighborStates.forEach((state, i) => {
            if (!isAir(state) && isFull(state) === true) skip.push(i + 1);
        });
        parts.push({state: preview.state, x: preview.x, y: preview.y, z: preview.z, cullface: null, skip, light: preview.light || DEFAULT_LIGHT});
    }
    if (isAir(preview.state) || isFull(preview.state) !== true) {
        neighborStates.forEach((state, i) => {
            if (isAir(state)) return;
            const [dx, dy, dz] = NEIGHBOR_OFFSETS[i];
            // a previewed neighbor draws itself
            if (store.previews.has(blockKey(preview.x + dx, preview.y + dy, preview.z + dz))) return;
            parts.push({state, x: preview.x + dx, y: preview.y + dy, z: preview.z + dz, cullface: OPPOSITE[i + 1], skip: [],
                light: preview.light || DEFAULT_LIGHT});
        });
    }
    return parts;
}

// --- the hidden blocks of the tiles (hires-shader) ---

/** the size of the hidden-block table (a square texture of TABLE_SIZE x TABLE_SIZE texels) */
export const TABLE_SIZE = 128;
export const TABLE_SLOTS = TABLE_SIZE * TABLE_SIZE;
/** at most this many hidden blocks (half of the slots, so the probing stays short) */
export const MAX_HIDDEN_BLOCKS = TABLE_SLOTS / 2;
export const MAX_PROBES = 32;

/** the same hash as in the hires-shader (uint-arithmetic) */
export function voxelHash(x, y, z) {
    return ((Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(z, 83492791)) >>> 0) & (TABLE_SLOTS - 1);
}

/**
 * The table of the hidden blocks: per slot x, y, z, 1 (0 in the 4th value: empty), linear probing
 * @param blocks {Array<{x: number, y: number, z: number}>}
 * @param table {Float32Array} - TABLE_SLOTS * 4, reused
 * @returns {number} the number of hidden blocks
 */
export function buildHiddenTable(blocks, table = new Float32Array(TABLE_SLOTS * 4)) {
    table.fill(0);
    let count = 0;
    for (const {x, y, z} of blocks) {
        if (count >= MAX_HIDDEN_BLOCKS) break;
        let slot = voxelHash(x, y, z);
        for (let probe = 0; probe < MAX_PROBES; probe++) {
            const o = slot * 4;
            if (table[o + 3] === 0) {
                table[o] = x; table[o + 1] = y; table[o + 2] = z; table[o + 3] = 1;
                count++;
                break;
            }
            if (table[o] === x && table[o + 1] === y && table[o + 2] === z) break;
            slot = (slot + 1) & (TABLE_SLOTS - 1);
        }
    }
    return count;
}

/** the lookup of buildHiddenTable (for tests, the shader does the same) */
export function isHidden(table, x, y, z) {
    let slot = voxelHash(x, y, z);
    for (let probe = 0; probe < MAX_PROBES; probe++) {
        const o = slot * 4;
        if (table[o + 3] === 0) return false;
        if (table[o] === x && table[o + 1] === y && table[o + 2] === z) return true;
        slot = (slot + 1) & (TABLE_SLOTS - 1);
    }
    return false;
}

/**
 * glsl for the hires-fragment-shader: discards the fragments of a hidden block (the block a face belongs to: the
 * position moved a bit against the face-normal)
 */
export const HIDDEN_BLOCKS_GLSL = `
uniform highp sampler2D hiddenBlocks;
uniform int hiddenBlockCount;

bool isHiddenBlock(vec3 worldPosition, vec3 normal) {
	if (hiddenBlockCount <= 0) return false;
	ivec3 block = ivec3(floor(worldPosition - normal * 0.01));
	uint h = (uint(block.x) * 73856093u) ^ (uint(block.y) * 19349663u) ^ (uint(block.z) * 83492791u);
	int slot = int(h & ${TABLE_SLOTS - 1}u);
	for (int probe = 0; probe < ${MAX_PROBES}; probe++) {
		vec4 entry = texelFetch(hiddenBlocks, ivec2(slot % ${TABLE_SIZE}, slot / ${TABLE_SIZE}), 0);
		if (entry.w == 0.0) return false;
		if (ivec3(entry.xyz) == block) return true;
		slot = (slot + 1) & ${TABLE_SLOTS - 1};
	}
	return false;
}
`;

/**
 * The tint of a block-quad (tintindex >= 0) without biome-data: the colors of the plains-biome, like the vanilla
 * defaults (the rendered tile has the correct biome-color)
 * @param state {string}
 * @returns {number} rgb
 */
export function blockTint(state) {
    const id = state.split("[")[0];
    if (id === "minecraft:spruce_leaves") return 0x619961;
    if (id === "minecraft:birch_leaves") return 0x80A755;
    if (/_leaves$/.test(id) || id === "minecraft:vine") return 0x77AB2F;
    if (id === "minecraft:lily_pad") return 0x208030;
    if (id === "minecraft:water" || id === "minecraft:water_cauldron") return 0x3F76E4;
    if (id === "minecraft:redstone_wire") {
        const power = Number((state.match(/power=(\d+)/) || [0, 0])[1]);
        const f = power / 15;
        const r = f * 0.6 + (f > 0 ? 0.4 : 0.3);
        return (Math.round(Math.min(1, r) * 255) << 16) | (Math.round(Math.max(0, f * f * 0.7 - 0.5) * 255) << 8) |
            Math.round(Math.max(0, f * f * 0.6 - 0.7) * 255);
    }
    if (/_stem$/.test(id)) return 0xE0C71C;
    return 0x91BD59; // grass
}
