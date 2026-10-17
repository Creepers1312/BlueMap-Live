import {test} from "node:test";
import assert from "node:assert/strict";

import {blockAssetName, buildHiddenTable, DEFAULT_LIGHT, parseLight, isHidden, MAX_HIDDEN_BLOCKS, parseBlocks, PREVIEW_TIMEOUT, PreviewStore, previewParts,
    tileOf, TABLE_SLOTS, voxelHash} from "../src/js/markers/blocks/BlockPreviewData.js";
import {buildPreviewGeometry} from "../src/js/markers/blocks/BlockPreviewView.js";
import {parseEntitiesResponse} from "../src/js/markers/LiveEntityData.js";

const HIRES = {tileSize: {x: 32, z: 32}, translate: {x: 2, z: 2}};
const STONE = "minecraft:stone";
const AIR = "minecraft:air";

test("block-preview: asset-names like the java ItemAssetUpdater.blockAssetName", () => {
    assert.equal(blockAssetName("minecraft:stone"), "minecraft/stone/default");
    assert.equal(blockAssetName("minecraft:oak_stairs[facing=east,half=bottom]"), "minecraft/oak_stairs/facing_east__half_bottom");
});

test("block-preview: the changes of the entities-response (palette, neighbors, validation)", () => {
    const blocks = parseBlocks({palette: [STONE, "minecraft:oak_log[axis=y]", "evil:../x"],
        changes: [[7, 1, 64, -2, 0, -1, 1, -1, -1, -1, 0, 1700000000123], [8, 1, 64, -2, 2, -1, -1, -1, -1, -1, -1, 1], [9, 1, 2]]});
    assert.deepEqual(blocks, [{id: 7, x: 1, y: 64, z: -2, state: STONE, neighbors: [null, "minecraft:oak_log[axis=y]", null, null, null, STONE],
        time: 1700000000123, light: null}]);
    assert.deepEqual(parseEntitiesResponse({protocol: 1, entities: []}).blocks, []);
    assert.equal(parseEntitiesResponse({protocol: 1, entities: [], blocks: {palette: [AIR], changes: [[1, 0, 0, 0, 0, -1, -1, -1, -1, -1, -1, 5]]}}).blocks.length, 1);
});

const change = (id, x, y, z, state, time = 1000_000, neighbors = [null, null, null, null, null, null]) => ({id, x, y, z, state, neighbors, time});

test("block-preview: a preview is confirmed by a tile rendered from chunk-data saved after the change", () => {
    let now = 0;
    const store = new PreviewStore(HIRES, () => now);
    store.apply([change(1, 10, 64, 10, AIR, 1_700_000_000_500)]);
    assert.equal(store.previews.size, 1);
    assert.deepEqual(tileOf(10, 10, HIRES), {x: 0, z: 0});
    // the same second: not sure that the save was after the change
    assert.equal(store.confirm({x: 0, z: 0, chunks: [0, 0, 1_700_000_000]}), 0);
    // another tile / chunk-time unknown: not confirmed
    assert.equal(store.confirm({x: 1, z: 0, chunks: [0, 0, 1_700_000_005]}), 0);
    assert.equal(store.confirm({x: 0, z: 0, chunks: [1, 0, 1_700_000_005]}), 0);
    assert.equal(store.confirm({x: 0, z: 0, chunks: [0, 0, 1_700_000_001]}), 1);
    assert.equal(store.previews.size, 0);
});

test("block-preview: unconfirmed previews are discarded, later changes replace earlier ones, each change once", () => {
    let now = 0;
    const store = new PreviewStore(HIRES, () => now);
    store.apply([change(1, 0, 64, 0, STONE), change(2, 0, 64, 0, AIR)]);
    assert.equal(store.previews.get("0,64,0").state, AIR);
    store.apply([change(1, 0, 64, 0, STONE), change(2, 0, 64, 0, AIR)]);
    assert.equal(store.previews.get("0,64,0").id, 2, "an older change does not replace a newer one");
    const version = store.version;
    store.apply([change(2, 0, 64, 0, AIR)]);
    assert.equal(store.version, version, "nothing new");
    now = PREVIEW_TIMEOUT + 1;
    assert.equal(store.expire(), 1);
    assert.equal(store.previews.size, 0);
});

test("block-preview: what is drawn - the new block without faces towards full neighbors, the neighbor-faces into a hole", () => {
    const store = new PreviewStore(HIRES);
    const full = state => state === STONE ? true : state === "minecraft:glass" ? false : null;
    // a removed block between stone (below) and air: the hole shows the top-face of the stone below
    store.apply([change(1, 0, 64, 0, AIR, 1, [STONE, null, null, null, null, null])]);
    assert.deepEqual(previewParts(store.previews.get("0,64,0"), store, full),
        [{state: STONE, x: 0, y: 63, z: 0, cullface: 2, skip: [], light: DEFAULT_LIGHT}]);
    // a placed glass-block next to stone: all faces except the one towards the stone, the stone-face behind the glass
    store.apply([change(2, 5, 64, 0, "minecraft:glass", 1, [null, null, null, null, STONE, null])]);
    assert.deepEqual(previewParts(store.previews.get("5,64,0"), store, full), [
        {state: "minecraft:glass", x: 5, y: 64, z: 0, cullface: null, skip: [5], light: DEFAULT_LIGHT},
        {state: STONE, x: 4, y: 64, z: 0, cullface: 6, skip: [], light: DEFAULT_LIGHT},
    ]);
    // a placed stone-block hides the faces of its neighbors: only the block itself
    store.apply([change(3, 9, 64, 0, STONE, 1, [STONE, null, null, null, null, null])]);
    assert.deepEqual(previewParts(store.previews.get("9,64,0"), store, full), [{state: STONE, x: 9, y: 64, z: 0, cullface: null, skip: [1], light: DEFAULT_LIGHT}]);
    // a previewed neighbor draws itself, its newest state is used
    store.apply([change(4, 0, 63, 0, AIR)]);
    assert.deepEqual(previewParts(store.previews.get("0,64,0"), store, full), []);
});

test("block-preview: the hidden-block table of the hires-shader (hash, probing, limit)", () => {
    const blocks = [];
    for (let i = 0; i < 3000; i++) blocks.push({x: (i % 50) - 25, y: 60 + (i % 7), z: Math.floor(i / 50) - 30});
    const table = new Float32Array(TABLE_SLOTS * 4);
    assert.equal(buildHiddenTable(blocks, table), 3000);
    assert.ok(blocks.every(b => isHidden(table, b.x, b.y, b.z)));
    assert.equal(isHidden(table, 100, 64, 100), false);
    assert.equal(isHidden(table, -25, 59, -30), false);
    assert.ok(voxelHash(-1, -64, -1) >= 0 && voxelHash(-1, -64, -1) < TABLE_SLOTS, "negative coordinates (uint like the shader)");
    const many = Array.from({length: MAX_HIDDEN_BLOCKS + 100}, (_, i) => ({x: i, y: 0, z: 0}));
    assert.equal(buildHiddenTable(many, table), MAX_HIDDEN_BLOCKS);
});

test("block-preview: geometry of the placed parts (cullface-filter, tint only for tinted quads, face-shading)", () => {
    // two quads of a 1x1 block: the top (cullface up = 2, tinted) and the north-side (cullface north = 3)
    const top = [0, 1, 0, 0, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 2];
    const north = [1, 0, 0, 0, 0, 0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0, -1, 3];
    const quads = [...top, ...north];
    const all = buildPreviewGeometry(quads, 0, [{x: 10, y: 64, z: 5, cullface: null, skip: []}], 0x91BD59);
    assert.equal(all.getAttribute("position").count, 12);
    assert.deepEqual([...all.getAttribute("position").array.slice(0, 3)], [10, 65, 5]);
    const colors = all.getAttribute("color").array;
    assert.ok(Math.abs(colors[0] - 0x91 / 255) < 1e-6, "tinted top, shade 1");
    assert.ok(Math.abs(colors[6 * 3] - 0.8) < 1e-6, "untinted north-side, shade 0.8");
    assert.equal(buildPreviewGeometry(quads, 0, [{x: 0, y: 0, z: 0, cullface: null, skip: [2]}], 0).getAttribute("position").count, 6);
    assert.equal(buildPreviewGeometry(quads, 0, [{x: 0, y: 0, z: 0, cullface: 3, skip: []}], 0).getAttribute("position").count, 6);
    assert.equal(buildPreviewGeometry(quads, 1, [{x: 0, y: 0, z: 0, cullface: null, skip: []}], 0), null, "another texture");
    // a face without cullface on the top-side of the block counts as the up-face (models without cullfaces)
    const topNoCull = [...top.slice(0, 22), 0];
    assert.equal(buildPreviewGeometry(topNoCull, 0, [{x: 0, y: 0, z: 0, cullface: 2, skip: []}], 0).getAttribute("position").count, 6);
    assert.equal(buildPreviewGeometry(topNoCull, 0, [{x: 0, y: 0, z: 0, cullface: 1, skip: []}], 0), null);
});

import {animationFrame, parseAnimation} from "../src/js/markers/blocks/BlockPreviewView.js";

test("block-preview: animated textures (fire) - frames of the strip in the order and speed of the .mcmeta", () => {
    assert.equal(parseAnimation(null), null);
    assert.equal(parseAnimation({frames: 1}), null, "one frame is no animation");
    const fire = parseAnimation({frames: 32, frametime: 1, order: [16, 17, 0]});
    assert.deepEqual([0, 1, 2, 3].map(t => animationFrame(fire, t)), [16, 17, 0, 16]);
    const slow = parseAnimation({frames: 4, frametime: 2});
    assert.deepEqual([0, 1, 2, 3, 8].map(t => animationFrame(slow, t)), [0, 0, 1, 1, 0]);
    assert.equal(parseAnimation({frames: 4, order: [9]}).order, null, "invalid order: in order");
});

import {previewLights} from "../src/js/markers/blocks/BlockPreviewView.js";
import {combineLights, MAX_DYNAMIC_LIGHTS} from "../src/js/markers/DynamicLights.js";

test("block-preview: the light at a changed block (sky, block, luminance), lit like the tiles", () => {
    const blocks = parseBlocks({palette: ["minecraft:torch"], changes: [[1, 2, 64, 3, 0, -1, -1, -1, -1, -1, -1, 5, 15, 14, 14],
        [2, 2, 64, 4, 0, -1, -1, -1, -1, -1, -1, 5], [3, 2, 64, 5, 0, -1, -1, -1, -1, -1, -1, 5, 16, 0, 0]]});
    assert.deepEqual(blocks.map(b => b.light), [{sky: 15, block: 14, luminance: 14}, null, null], "unknown or invalid light: null");
    assert.equal(parseLight([1, 2]), null);
    // the parts get the light of their change, the vertices the sky- and block-light
    const store = new PreviewStore(HIRES);
    store.apply([{...change(1, 0, 64, 0, STONE), light: {sky: 7, block: 3, luminance: 0}}]);
    assert.deepEqual(previewParts(store.previews.get("0,64,0"), store, () => true)[0].light, {sky: 7, block: 3, luminance: 0});
    const top = [0, 1, 0, 0, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 1, 0, 1, 1, 0, 1, 0, -1, 2];
    const geometry = buildPreviewGeometry(top, 0, [{x: 0, y: 0, z: 0, cullface: null, skip: [], light: {sky: 7, block: 3}}], 0);
    assert.deepEqual([...geometry.getAttribute("bmLight").array.slice(0, 4)], [7, 3, 7, 3]);
    const outdoors = buildPreviewGeometry(top, 0, [{x: 0, y: 0, z: 0, cullface: null, skip: []}], 0);
    assert.deepEqual([...outdoors.getAttribute("bmLight").array.slice(0, 2)], [15, 0], "unknown light: outdoors like the entities");
});

test("block-preview: light-emitting previews are dynamic lights (with the players, the nearest first)", () => {
    const previews = [{x: 0, y: 64, z: 0, state: "minecraft:torch", light: {sky: 15, block: 14, luminance: 14}},
        {x: 5, y: 64, z: 0, state: STONE, light: {sky: 15, block: 0, luminance: 0}},
        {x: 6, y: 64, z: 0, state: AIR, light: {sky: 15, block: 14, luminance: 14}},
        {x: 7, y: 64, z: 0, state: "minecraft:glowstone", light: null}];
    assert.deepEqual(previewLights(previews), [{x: 0.5, y: 64.5, z: 0.5, level: 14}]);
    const many = Array.from({length: 12}, (_, i) => ({x: i * 10, y: 64, z: 0, level: 14}));
    const lights = combineLights([{x: 100, y: 65, z: 0, level: 14}], many, {x: 100, y: 80, z: 0});
    assert.equal(lights.length, MAX_DYNAMIC_LIGHTS);
    assert.equal(lights[0].x, 100);
});
