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
 * BlueMap Live (see docs/bluemap-live/phase-11.md): loads the tiles again that the server rendered again (block-changes),
 * listed in live/tiles.json, without reloading the page.
 */

/** the interval in which live/tiles.json is requested (ms) */
export const TILE_UPDATE_INTERVAL = 2000;

const isInt = value => Number.isInteger(value);

/**
 * @param data {any}
 * @returns {{next: number, tiles: Array<{id: number, x: number, z: number, lowres: boolean}>} | null}
 */
export function parseTilesResponse(data) {
    if (!data || typeof data !== "object" || !isInt(data.next) || !Array.isArray(data.tiles)) return null;
    const tiles = [];
    for (const raw of data.tiles.slice(0, 4096)) {
        if (!raw || !isInt(raw.id) || !isInt(raw.x) || !isInt(raw.z)) continue;
        tiles.push({id: raw.id, x: raw.x, z: raw.z, lowres: raw.lowres === true});
    }
    return {next: data.next, tiles};
}

/**
 * The lowres-tiles (per lod) that contain a hires-tile (like Map.loadMapArea computes the tiles of a position).
 * @param x {number} - hires-tile
 * @param z {number}
 * @param hires {{tileSize: {x: number, z: number}, translate: {x: number, z: number}}}
 * @param lowres {{tileSize: {x: number, z: number}, lodFactor: number, lodCount: number}}
 * @returns {Array<Array<{x: number, z: number}>>} - index: lod - 1
 */
export function lowresTilesOf(x, z, hires, lowres) {
    const minX = x * hires.tileSize.x + hires.translate.x, minZ = z * hires.tileSize.z + hires.translate.z;
    const maxX = minX + hires.tileSize.x - 1, maxZ = minZ + hires.tileSize.z - 1;
    const result = [];
    for (let lod = 1; lod <= lowres.lodCount; lod++) {
        const scale = Math.pow(lowres.lodFactor, lod - 1);
        const sizeX = lowres.tileSize.x * scale, sizeZ = lowres.tileSize.z * scale;
        const tiles = [];
        for (let tx = Math.floor(minX / sizeX); tx <= Math.floor(maxX / sizeX); tx++) {
            for (let tz = Math.floor(minZ / sizeZ); tz <= Math.floor(maxZ / sizeZ); tz++) tiles.push({x: tx, z: tz});
        }
        result.push(tiles);
    }
    return result;
}

/** without live/tiles.json (e.g. an external webserver) it is tried again after this time (ms) */
export const TILE_UPDATE_RETRY = 15000;

export class LiveTileUpdater {

    /**
     * @param map {import("./Map.js").Map}
     * @param fileUrl {string} - live/tiles.json of the map
     * @param events {EventTarget | null}
     */
    constructor(map, fileUrl, events = null) {
        this.map = map;
        this.fileUrl = fileUrl;
        this.events = events;
        this.disposed = false;
        this.timeout = null;
        /** the id of the last entry that was handled (null: nothing received yet) */
        this.lastId = null;
        this.reloaded = 0;
    }

    /** @returns {Promise<boolean>} if live/tiles.json was available */
    update() {
        return fetch(this.fileUrl + (this.fileUrl.includes("?") ? "&" : "?") + Date.now(), {cache: "no-store"})
            .then(response => response.ok ? response.json() : Promise.reject(response.status))
            .then(data => this.updateFromData(data))
            .catch(() => false);
    }

    /**
     * Requests live/tiles.json every interval (the next request after the previous one finished), 0: stopped.
     * @param ms {number}
     */
    setAutoUpdateInterval(ms) {
        if (this.timeout) clearTimeout(this.timeout);
        this.timeout = null;
        if (ms <= 0) return;
        const next = () => {
            if (this.disposed) return;
            this.update().then(ok => {
                if (!this.disposed) this.timeout = setTimeout(next, ok ? ms : Math.max(ms, TILE_UPDATE_RETRY));
            });
        };
        this.timeout = setTimeout(next, ms);
    }

    /**
     * @param data {any}
     * @returns {boolean} if the data was valid
     */
    updateFromData(data) {
        const response = parseTilesResponse(data);
        if (!response) return false;
        // the first response: the loaded tiles are current, only later changes are loaded again
        if (this.lastId === null || response.next - 1 < this.lastId) {
            this.lastId = response.next - 1;
            return true;
        }
        const hires = new Map(), lowres = new Map();
        for (const tile of response.tiles) {
            if (tile.id <= this.lastId) continue;
            (tile.lowres ? lowres : hires).set(tile.x + "," + tile.z, tile);
        }
        this.lastId = response.next - 1;
        if (hires.size > 0 || lowres.size > 0) this.reload([...hires.values()], [...lowres.values()], this.lastId);
        return true;
    }

    /**
     * @param hiresTiles {Array<{x: number, z: number}>}
     * @param lowresTiles {Array<{x: number, z: number}>} - the hires-tiles whose lowres-tiles were saved
     * @param cacheHash {number | string}
     */
    reload(hiresTiles, lowresTiles, cacheHash) {
        const map = this.map;
        if (!map || !map.isLoaded || !map.hiresTileManager) return;
        const hash = "live" + cacheHash;
        for (const tile of hiresTiles) {
            if (map.hiresTileManager.reloadTile(tile.x, tile.z, hash)) this.reloaded++;
        }
        const done = new Set();
        for (const tile of lowresTiles) {
            lowresTilesOf(tile.x, tile.z, map.data.hires, map.data.lowres).forEach((tiles, index) => {
                const manager = map.lowresTileManager[index];
                if (!manager) return;
                for (const t of tiles) {
                    const key = index + ":" + t.x + "," + t.z;
                    if (done.has(key)) continue;
                    done.add(key);
                    if (manager.reloadTile(t.x, t.z, hash)) this.reloaded++;
                }
            });
        }
    }

    dispose() {
        this.disposed = true;
        this.setAutoUpdateInterval(0);
    }

}
