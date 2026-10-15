// Unit-tests for src/js/markers/player/ItemAssetCache.js and the held items of the PlayerModel
// Run with: npm test

import {test} from "node:test";
import assert from "node:assert/strict";
import {Vector3} from "three";

import {buildQuadGeometries, ItemAssetCache, MAX_ATTEMPTS, RETRY_INTERVAL} from "../src/js/markers/player/ItemAssetCache.js";
import {PlayerSkinCache} from "../src/js/markers/player/PlayerSkinCache.js";
import {PlayerModel} from "../src/js/markers/player/PlayerModel.js";

const flush = () => new Promise(r => setTimeout(r, 0));
const image = () => Promise.resolve({width: 16, height: 16});
const PNG = "data:image/png;base64,AAAA";

/** one front-facing quad (south, z = 0.5) over the whole block, like the java ItemModelBaker writes it */
const QUAD = [0, 0, 0.5, 1, 0, 0.5, 1, 1, 0.5, 0, 1, 0.5, 0, 1, 1, 1, 1, 0, 0, 0, 0, -1];

const asset = (extra = {}) => ({
    format: 1, item: "minecraft:stick", textures: [PNG],
    models: [{type: "quads", quads: QUAD, display: {right: {rotation: [0, 0, 0], translation: [0, 0, 0], scale: [1, 1, 1]}}}],
    ...extra,
});

/** a json-loader with controllable responses */
function jsonLoader(responses) {
    const calls = [];
    const loader = url => {
        calls.push(url);
        const response = responses[url];
        return response ? Promise.resolve(typeof response === "function" ? response() : response) : Promise.reject(new Error("404"));
    };
    loader.calls = calls;
    return loader;
}

test("quads become one geometry per texture, with vanilla face-shading and outward normals", () => {
    const down = [0, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1, -1];
    const geometries = buildQuadGeometries([...QUAD, ...down]);
    assert.deepEqual([...geometries.keys()], [0, 1]);
    const front = geometries.get(0);
    assert.equal(front.getAttribute("position").count, 6, "two triangles");
    assert.equal(front.getAttribute("normal").getZ(0), 1, "south face points to +z");
    assert.ok(Math.abs(front.getAttribute("color").getX(0) - 0.8) < 1e-6, "north/south shading");
    assert.equal(geometries.get(1).getAttribute("normal").getY(0), -1);
    assert.equal(geometries.get(1).getAttribute("color").getX(0), 0.5, "down shading");
    // v is flipped for flipY-textures
    assert.equal(front.getAttribute("uv").getY(0), 0, "corner 0 has v = 1 (bottom) in the asset");
});

test("item-assets are shared, released and disposed", async () => {
    const loader = jsonLoader({"items/minecraft/stick.json": asset()});
    const cache = new ItemAssetCache("items/", loader, image);

    const a = cache.acquire("minecraft:stick");
    const b = cache.acquire("minecraft:stick");
    assert.equal(a, b);
    assert.deepEqual(loader.calls, ["items/minecraft/stick.json"], "loaded once");
    await flush();
    assert.equal(a.state, "loaded");
    assert.equal(a.models.length, 1);

    let disposed = 0;
    a.models[0].parts[0].geometry.addEventListener("dispose", () => disposed++);
    a.textures[0].addEventListener("dispose", () => disposed++);
    cache.release(a);
    assert.equal(disposed, 0, "still used");
    cache.release(b);
    assert.equal(disposed, 2, "geometry and texture disposed");
    assert.equal(cache.entries.size, 0);
});

test("a missing asset is requested again (without a timer), but not endlessly", async () => {
    let now = 0;
    const responses = {};
    const loader = jsonLoader(responses);
    const cache = new ItemAssetCache("items/", loader, image, () => now);

    const entry = cache.acquire("minecraft:stick");
    await flush();
    assert.equal(entry.state, "failed");

    cache.retry(entry);
    assert.equal(loader.calls.length, 1, "not before the retry-interval");
    now += RETRY_INTERVAL;
    responses["items/minecraft/stick.json"] = asset(); // the server created the asset in the meantime
    cache.retry(entry);
    await flush();
    assert.equal(entry.state, "loaded");

    const other = cache.acquire("minecraft:missing");
    for (let i = 0; i < MAX_ATTEMPTS + 5; i++) {
        await flush();
        now += RETRY_INTERVAL;
        cache.retry(other);
    }
    assert.equal(loader.calls.filter(u => u.includes("missing")).length, MAX_ATTEMPTS);
});

test("invalid assets fail safely, an asset released while loading is not built", async () => {
    const loader = jsonLoader({
        "items/minecraft/a.json": {models: "x"},
        "items/minecraft/b.json": asset({models: [{type: "unknown"}, null]}),
        "items/minecraft/c.json": asset(),
    });
    const cache = new ItemAssetCache("items/", loader, image);
    const a = cache.acquire("minecraft:a");
    const b = cache.acquire("minecraft:b");
    const c = cache.acquire("minecraft:c");
    cache.release(c);
    await flush();
    assert.equal(a.state, "failed");
    assert.equal(b.state, "loaded");
    assert.equal(b.models.length, 0, "unknown model-types are skipped");
    assert.equal(c.textures.length, 0, "nothing created for the released entry");

    // no base-url: no items (e.g. a map without assets)
    const none = new ItemAssetCache(null, loader, image).acquire("minecraft:stick");
    assert.equal(none.state, "failed");
});

// --- held items on the model ---

function pose(right = null, left = null, predicates = {}) {
    const parts = {};
    for (const name of ["head", "body", "rightArm", "leftArm", "rightLeg", "leftLeg"]) parts[name] = {rx: 0, ry: 0, rz: 0, px: 0, py: 0, pz: 0};
    return {parts, rootY: 0, rootZ: 0, rootPitch: 0, items: {right: {item: right, predicates}, left: {item: left, predicates}}};
}

async function modelWithItems(responses) {
    const skins = new PlayerSkinCache(url => Promise.resolve({width: 64, height: 64, src: url}));
    const items = new ItemAssetCache("items/", jsonLoader(responses), image);
    const model = new PlayerModel(skins, items);
    model.setSkin("skins/x.png", "classic");
    await flush();
    return {model, items};
}

const itemMeshes = (model, side) => {
    const result = [];
    model.itemSlots[side].content.traverse(o => { if (o.isMesh) result.push(o); });
    return result;
};

/** a point of the item (block-units) in the pixel-space of the model (feet at 0, y up) */
function itemPointInModel(model, side, point) {
    model.updateMatrixWorld(true);
    const world = model.itemSlots[side].content.localToWorld(new Vector3(...point));
    return model.root.worldToLocal(world);
}

test("held items are attached to the hands with the vanilla transformation-chain", async () => {
    const {model} = await modelWithItems({"items/minecraft/stick.json": asset()});
    model.applyPose(pose({id: "minecraft:stick"}));
    await flush();
    model.applyPose(pose({id: "minecraft:stick"}));
    assert.equal(itemMeshes(model, "right").length, 1);
    assert.equal(itemMeshes(model, "left").length, 0, "empty hand");

    // independently from the groups: vanilla (y down, neck at 0, px) arm-pivot (-5, 2, 0), then
    // rotX(-90) rotY(180) translate(1/16, 2/16, -10/16) translate(-0.5) on the item-point (blocks),
    // converted to the model (x, 24 - y, -z)
    const vanilla = ([x, y, z]) => {
        let p = [x - 0.5, y - 0.5, z - 0.5];
        p = [p[0] + 1 / 16, p[1] + 0.125, p[2] - 0.625];
        p = [-p[0], p[1], -p[2]]; // rotY(180)
        p = [p[0], p[2], -p[1]]; // rotX(-90): y' = -(-z)... (y, z) -> (z, -y)
        return [p[0] * 16 - 5, p[1] * 16 + 2, p[2] * 16];
    };
    for (const point of [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0.5, 0.5, 0.5]]) {
        const [vx, vy, vz] = vanilla(point);
        const ours = itemPointInModel(model, "right", point);
        assert.ok(Math.abs(ours.x - vx) < 1e-4 && Math.abs(ours.y - (24 - vy)) < 1e-4 && Math.abs(ours.z + vz) < 1e-4,
            `${point} -> ${ours.toArray()} expected ${[vx, 24 - vy, -vz]}`);
    }

    // the item follows the arm
    const before = itemPointInModel(model, "right", [0.5, 0.5, 0.5]);
    const swung = pose({id: "minecraft:stick"});
    swung.parts.rightArm.rx = -1.2;
    model.applyPose(swung);
    const after = itemPointInModel(model, "right", [0.5, 0.5, 0.5]);
    assert.ok(after.distanceTo(before) > 3, "moved with the arm");
});

test("left hand mirrors the display-transformation, slim arms shift the item half a pixel", async () => {
    const display = {right: {rotation: [0, -90, 55], translation: [0, 4, 0.5], scale: [0.85, 0.85, 0.85]}};
    const {model} = await modelWithItems({"items/minecraft/sword.json": asset({models: [{type: "quads", quads: QUAD, display}]})});
    const p = pose({id: "minecraft:sword"}, {id: "minecraft:sword"});
    model.applyPose(p);
    await flush();
    model.applyPose(p);
    const right = model.itemSlots.right.display, left = model.itemSlots.left.display;
    assert.ok(Math.abs(right.rotation.y + Math.PI / 2) < 1e-9 && Math.abs(left.rotation.y - Math.PI / 2) < 1e-9, "y-rotation mirrored");
    assert.ok(Math.abs(right.rotation.z + left.rotation.z) < 1e-9, "z-rotation mirrored");
    assert.ok(Math.abs(right.position.y - 0.25) < 1e-9, "translation in 1/16");

    // mirror-symmetric positions (x negated) for a mirror-symmetric pose
    const r = itemPointInModel(model, "right", [0.5, 0.5, 0.5]);
    const l = itemPointInModel(model, "left", [0.5, 0.5, 0.5]);
    assert.ok(Math.abs(r.x + l.x) < 1e-4 && Math.abs(r.y - l.y) < 1e-4 && Math.abs(r.z - l.z) < 1e-4, `${r.toArray()} / ${l.toArray()}`);

    model.setSkin("skins/slim.png", "slim");
    await flush();
    model.applyPose(p);
    assert.equal(model.itemSlots.right.anchor.position.x, -5 + 0.5);
    assert.equal(model.itemSlots.left.anchor.position.x, 5 - 0.5);
});

test("item-switch, overrides, empty hands and dispose release the shared resources", async () => {
    const bow = asset({item: "minecraft:bow", models: [
        {type: "quads", quads: QUAD, display: {}},
        {type: "quads", quads: QUAD, predicate: {pulling: 1}, display: {}},
    ]});
    const {model, items} = await modelWithItems({"items/minecraft/stick.json": asset(), "items/minecraft/bow.json": bow});

    model.applyPose(pose({id: "minecraft:stick"}));
    await flush();
    model.applyPose(pose({id: "minecraft:stick"}));
    const stickEntry = model.itemSlots.right.entry;

    model.applyPose(pose({id: "minecraft:bow"}));
    assert.equal(items.entries.has("minecraft:stick"), false, "the old item is released");
    assert.equal(stickEntry.models.length, 0);
    await flush();
    model.applyPose(pose({id: "minecraft:bow"}, null, {pulling: 0}));
    const idle = itemMeshes(model, "right")[0];
    model.applyPose(pose({id: "minecraft:bow"}, null, {pulling: 0}));
    assert.equal(itemMeshes(model, "right")[0], idle, "no new meshes while nothing changes");
    model.applyPose(pose({id: "minecraft:bow"}, null, {pulling: 1}));
    assert.equal(model.itemSlots.right.modelIndex, 1, "override selected");

    model.applyPose(pose(null));
    assert.equal(itemMeshes(model, "right").length, 0);
    assert.equal(items.entries.size, 0);

    model.applyPose(pose({id: "minecraft:bow"}));
    model.dispose();
    assert.equal(items.entries.size, 0, "dispose releases the items");
});
