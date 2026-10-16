import {test} from "node:test";
import assert from "node:assert/strict";

import {LiveTileUpdater, lowresTilesOf, parseTilesResponse} from "../src/js/map/LiveTileUpdater.js";
import {Tile} from "../src/js/map/Tile.js";

const HIRES = {tileSize: {x: 32, z: 32}, translate: {x: 2, z: 2}};
const LOWRES = {tileSize: {x: 500, z: 500}, lodFactor: 5, lodCount: 3};

test("live-tiles: the response is validated", () => {
    assert.equal(parseTilesResponse(null), null);
    assert.equal(parseTilesResponse({tiles: []}), null, "next is required");
    assert.deepEqual(parseTilesResponse({next: 5, tiles: [{id: 3, x: 1, z: -2}, {id: "4", x: 1, z: 1}, {id: 4, x: 0, z: 0, lowres: true}]}),
        {next: 5, tiles: [{id: 3, x: 1, z: -2, lowres: false, chunks: []}, {id: 4, x: 0, z: 0, lowres: true, chunks: []}]});
    assert.deepEqual(parseTilesResponse({next: 2, tiles: [{id: 1, x: 0, z: 0, chunks: [0, 0, 1700000000, 1, 0, "x"]}]}).tiles[0].chunks, [],
        "invalid chunk-times are ignored");
    assert.deepEqual(parseTilesResponse({next: 2, tiles: [{id: 1, x: 0, z: 0, chunks: [0, 0, 1700000000]}]}).tiles[0].chunks, [0, 0, 1700000000]);
});

test("live-tiles: the lowres-tiles of a hires-tile (like Map.loadMapArea)", () => {
    // hires-tile 0,0 covers blocks 2..33
    assert.deepEqual(lowresTilesOf(0, 0, HIRES, LOWRES), [[{x: 0, z: 0}], [{x: 0, z: 0}], [{x: 0, z: 0}]]);
    // hires-tile -1,-1 covers blocks -30..1
    assert.deepEqual(lowresTilesOf(-1, -1, HIRES, LOWRES)[0], [{x: -1, z: -1}, {x: -1, z: 0}, {x: 0, z: -1}, {x: 0, z: 0}]);
    // blocks 482..513 cross the border of lod 1 (500), not of lod 2 (2500)
    assert.deepEqual(lowresTilesOf(15, 0, HIRES, LOWRES)[0], [{x: 0, z: 0}, {x: 1, z: 0}]);
    assert.deepEqual(lowresTilesOf(15, 0, HIRES, LOWRES)[1], [{x: 0, z: 0}]);
});

function fakeMap() {
    const calls = [];
    const manager = name => ({reloadTile: (x, z, hash) => { calls.push([name, x, z, hash]); return Promise.resolve(); }});
    return {
        calls,
        map: {isLoaded: true, data: {hires: HIRES, lowres: LOWRES}, hiresTileManager: manager("hires"),
            lowresTileManager: [manager("lod1"), manager("lod2"), manager("lod3")]},
    };
}

test("live-tiles: the first response is current, later entries are loaded again once (no duplicates)", () => {
    const {calls, map} = fakeMap();
    const updater = new LiveTileUpdater(map, "tiles.json");
    assert.equal(updater.updateFromData({next: 4, tiles: [{id: 1, x: 0, z: 0}, {id: 3, x: 5, z: 5}]}), true);
    assert.deepEqual(calls, [], "the loaded tiles already show these changes");
    updater.updateFromData({next: 7, tiles: [{id: 3, x: 5, z: 5}, {id: 4, x: 1, z: 2}, {id: 5, x: 1, z: 2}, {id: 6, x: 1, z: 2, lowres: true}]});
    assert.deepEqual(calls, [["hires", 1, 2, "live6"], ["lod1", 0, 0, "live6"], ["lod2", 0, 0, "live6"], ["lod3", 0, 0, "live6"]]);
    calls.length = 0;
    updater.updateFromData({next: 7, tiles: [{id: 4, x: 1, z: 2}]});
    assert.deepEqual(calls, [], "nothing new");
    // the server was restarted (ids start again): taken as the first response
    updater.updateFromData({next: 2, tiles: [{id: 1, x: 9, z: 9}]});
    assert.deepEqual(calls, []);
    updater.updateFromData({next: 3, tiles: [{id: 1, x: 9, z: 9}, {id: 2, x: 8, z: 8}]});
    assert.deepEqual(calls, [["hires", 8, 8, "live2"]]);
});

test("live-tiles: a rendered hires-tile is reported after it was loaded again (block-previews are confirmed then)", async () => {
    const {map} = fakeMap();
    const updater = new LiveTileUpdater(map, "tiles.json");
    const rendered = [];
    updater.onTileRendered = tile => rendered.push([tile.x, tile.z, tile.chunks]);
    updater.updateFromData({next: 1, tiles: []});
    updater.updateFromData({next: 2, tiles: [{id: 1, x: 3, z: 4, chunks: [6, 8, 1700000000]}]});
    assert.deepEqual(rendered, [], "not before the tile is loaded");
    await new Promise(r => setTimeout(r, 0));
    assert.deepEqual(rendered, [[3, 4, [6, 8, 1700000000]]]);
});

test("tile: reload keeps the current model until the new one is loaded, a reload while loading follows", async () => {
    const events = [];
    let resolveLoad;
    const loader = {load: (x, z, cancel, hash) => new Promise(resolve => { resolveLoad = () => resolve({userData: {}, hash}); })};
    const tile = new Tile(1, 2, t => events.push(["load", t.model.hash]), t => events.push(["unload", t.model.hash]));
    const first = tile.load(loader, "h0");
    resolveLoad();
    await first;
    assert.deepEqual(events, [["load", "h0"]]);

    const reload = tile.reload(loader, "live1");
    assert.equal(tile.model.hash, "h0", "still the old model while loading");
    tile.reload(loader, "live2"); // while loading: afterwards
    resolveLoad();
    await reload;
    assert.deepEqual(events.slice(1), [["unload", "h0"], ["load", "live1"]]);
    await new Promise(r => setTimeout(r, 0));
    resolveLoad();
    await new Promise(r => setTimeout(r, 0));
    assert.equal(tile.model.hash, "live2");

    // a failed reload keeps the model
    const failing = {load: () => Promise.reject(new Error("204"))};
    await tile.reload(failing, "live3");
    assert.equal(tile.model.hash, "live2");
    tile.unload();
    await tile.reload(loader, "live4");
    assert.equal(tile.model, null, "an unloaded tile is not loaded again");
});
