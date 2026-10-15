// Structural tests for the player-model geometry, UV-mapping and skin handling.
// Run with: npm test
//
// The expected skin-regions below are written down independently of PlayerModelLayout.js (from the Minecraft skin
// format), so the tests do not just compare the implementation with itself.

import {test} from "node:test";
import assert from "node:assert/strict";

import {
    boxFaceRects, FACE_NAMES, MODEL_HEIGHT, PART_NAMES, PIXEL_SCALE, playerModelLayout, SKIN_SIZE,
} from "../src/js/markers/player/PlayerModelLayout.js";
import {createSkinBoxGeometry, getPlayerModelGeometries} from "../src/js/markers/player/PlayerModelGeometry.js";
import {PlayerSkinCache} from "../src/js/markers/player/PlayerSkinCache.js";
import {PlayerModel} from "../src/js/markers/player/PlayerModel.js";

// [x, y, w, h] of every face in the skin: EXPECTED[variant][layer][part][face]
function expectedRegions(slim) {
    const a = slim ? 3 : 4; // arm width
    return {
        base: {
            head:     {top: [8, 0, 8, 8],   bottom: [16, 0, 8, 8],  right: [0, 8, 8, 8],    front: [8, 8, 8, 8],    left: [16, 8, 8, 8],  back: [24, 8, 8, 8]},
            body:     {top: [20, 16, 8, 4], bottom: [28, 16, 8, 4], right: [16, 20, 4, 12], front: [20, 20, 8, 12], left: [28, 20, 4, 12], back: [32, 20, 8, 12]},
            rightArm: {top: [44, 16, a, 4], bottom: [44 + a, 16, a, 4], right: [40, 20, 4, 12], front: [44, 20, a, 12], left: [44 + a, 20, 4, 12], back: [48 + a, 20, a, 12]},
            leftArm:  {top: [36, 48, a, 4], bottom: [36 + a, 48, a, 4], right: [32, 52, 4, 12], front: [36, 52, a, 12], left: [36 + a, 52, 4, 12], back: [40 + a, 52, a, 12]},
            rightLeg: {top: [4, 16, 4, 4],  bottom: [8, 16, 4, 4],  right: [0, 20, 4, 12],  front: [4, 20, 4, 12],  left: [8, 20, 4, 12],  back: [12, 20, 4, 12]},
            leftLeg:  {top: [20, 48, 4, 4], bottom: [24, 48, 4, 4], right: [16, 52, 4, 12], front: [20, 52, 4, 12], left: [24, 52, 4, 12], back: [28, 52, 4, 12]},
        },
        overlay: {
            head:     {top: [40, 0, 8, 8],  bottom: [48, 0, 8, 8],  right: [32, 8, 8, 8],   front: [40, 8, 8, 8],   left: [48, 8, 8, 8],  back: [56, 8, 8, 8]},
            body:     {top: [20, 32, 8, 4], bottom: [28, 32, 8, 4], right: [16, 36, 4, 12], front: [20, 36, 8, 12], left: [28, 36, 4, 12], back: [32, 36, 8, 12]},
            rightArm: {top: [44, 32, a, 4], bottom: [44 + a, 32, a, 4], right: [40, 36, 4, 12], front: [44, 36, a, 12], left: [44 + a, 36, 4, 12], back: [48 + a, 36, a, 12]},
            leftArm:  {top: [52, 48, a, 4], bottom: [52 + a, 48, a, 4], right: [48, 52, 4, 12], front: [52, 52, a, 12], left: [52 + a, 52, 4, 12], back: [56 + a, 52, a, 12]},
            rightLeg: {top: [4, 32, 4, 4],  bottom: [8, 32, 4, 4],  right: [0, 36, 4, 12],  front: [4, 36, 4, 12],  left: [8, 36, 4, 12],  back: [12, 36, 4, 12]},
            leftLeg:  {top: [4, 48, 4, 4],  bottom: [8, 48, 4, 4],  right: [0, 52, 4, 12],  front: [4, 52, 4, 12],  left: [8, 52, 4, 12],  back: [12, 52, 4, 12]},
        },
    };
}

/** synthetic, color-coded skin: every pixel tells which (layer, part, face) region it belongs to */
function colorCodedSkin(slim) {
    const regions = expectedRegions(slim);
    const pixels = Array.from({length: SKIN_SIZE}, () => new Array(SKIN_SIZE).fill(null));
    for (const layer of ["base", "overlay"]) {
        for (const part of PART_NAMES) {
            for (const face of FACE_NAMES) {
                const [x0, y0, w, h] = regions[layer][part][face];
                for (let y = y0; y < y0 + h; y++) {
                    for (let x = x0; x < x0 + w; x++) {
                        assert.equal(pixels[y][x], null, `test-skin regions overlap at ${x},${y}`);
                        pixels[y][x] = `${layer}/${part}/${face}`;
                    }
                }
            }
        }
    }
    return (u, v) => {
        const x = Math.floor(u * SKIN_SIZE), y = Math.floor((1 - v) * SKIN_SIZE);
        return pixels[y]?.[x] ?? null;
    };
}

const faceOfNormal = (nx, ny, nz) =>
    nx < -0.5 ? "right" : nx > 0.5 ? "left" : ny > 0.5 ? "top" : ny < -0.5 ? "bottom" : nz > 0.5 ? "front" : "back";

/** iterates over the 6 faces (4 vertices each) of a three.js BoxGeometry */
function* faces(geometry) {
    const pos = geometry.getAttribute("position"), nor = geometry.getAttribute("normal"), uv = geometry.getAttribute("uv");
    for (let f = 0; f < 6; f++) {
        const vertices = [];
        for (let i = f * 4; i < f * 4 + 4; i++) {
            vertices.push({
                p: [pos.getX(i), pos.getY(i), pos.getZ(i)],
                uv: [uv.getX(i), uv.getY(i)],
            });
        }
        yield {face: faceOfNormal(nor.getX(f * 4), nor.getY(f * 4), nor.getZ(f * 4)), vertices};
    }
}

for (const variant of ["classic", "slim"]) {
    const slim = variant === "slim";

    test(`${variant}: every face samples exactly its own region of a color-coded skin (base + overlay)`, () => {
        const sample = colorCodedSkin(slim);
        const geometries = getPlayerModelGeometries(variant);
        for (const part of PART_NAMES) {
            for (const layer of ["base", "overlay"]) {
                for (const {face, vertices} of faces(geometries.get(part)[layer])) {
                    const expected = `${layer}/${part}/${face}`;
                    // center of the face and points close to each corner must all lie in the same region
                    const cu = vertices.reduce((s, v) => s + v.uv[0], 0) / 4, cv = vertices.reduce((s, v) => s + v.uv[1], 0) / 4;
                    assert.equal(sample(cu, cv), expected, `center of ${expected}`);
                    for (const v of vertices) {
                        const u = v.uv[0] + (cu - v.uv[0]) * 0.05, w = v.uv[1] + (cv - v.uv[1]) * 0.05;
                        assert.equal(sample(u, w), expected, `corner of ${expected}`);
                    }
                }
            }
        }
    });

    test(`${variant}: faces cover their complete region (no gaps, no stretching beyond)`, () => {
        const regions = expectedRegions(slim);
        const geometries = getPlayerModelGeometries(variant);
        for (const part of PART_NAMES) {
            for (const layer of ["base", "overlay"]) {
                for (const {face, vertices} of faces(geometries.get(part)[layer])) {
                    const [x, y, w, h] = regions[layer][part][face];
                    const px = vertices.map(v => v.uv[0] * SKIN_SIZE), py = vertices.map(v => (1 - v.uv[1]) * SKIN_SIZE);
                    const close = (a, b) => Math.abs(a - b) < 1e-4;
                    assert.ok(close(Math.min(...px), x) && close(Math.max(...px), x + w), `${layer}/${part}/${face} x-range`);
                    assert.ok(close(Math.min(...py), y) && close(Math.max(...py), y + h), `${layer}/${part}/${face} y-range`);
                    for (const v of vertices) {
                        assert.ok(v.uv[0] >= 0 && v.uv[0] <= 1 && v.uv[1] >= 0 && v.uv[1] <= 1, "uv inside the texture");
                    }
                }
            }
        }
    });
}

test("orientation: faces are not mirrored or upside-down (Minecraft conventions)", () => {
    // which box-corner shows the top-left pixel of the face-rectangle
    // (model faces +z, the players right side is -x)
    const topLeftCorner = {
        front:  v => v.p[0] < 0 && v.p[1] > 0,   // viewed from the front: top-left is on the players right (-x)
        back:   v => v.p[0] > 0 && v.p[1] > 0,   // viewed from behind: top-left is on the players left (+x)
        right:  v => v.p[2] < 0 && v.p[1] > 0,   // right side (-x), viewed from outside: back edge on the left
        left:   v => v.p[2] > 0 && v.p[1] > 0,   // left side (+x), viewed from outside: front edge on the left
        top:    v => v.p[0] < 0 && v.p[2] < 0,   // top: image-top towards the back, image-left on the players right
        bottom: v => v.p[0] < 0 && v.p[2] < 0,   // bottom: same as top (flipped when viewed from below, like Minecraft)
    };
    const head = getPlayerModelGeometries("classic").get("head").base;
    const rects = boxFaceRects(0, 0, 8, 8, 8);
    for (const {face, vertices} of faces(head)) {
        const corner = vertices.find(topLeftCorner[face]);
        assert.ok(corner, `corner for ${face}`);
        assert.deepEqual(
            [Math.round(corner.uv[0] * SKIN_SIZE), Math.round((1 - corner.uv[1]) * SKIN_SIZE)],
            [rects[face].x, rects[face].y],
            `top-left pixel of ${face}`
        );
    }
});

test("dimensions and pivots", () => {
    const classic = playerModelLayout("classic"), slim = playerModelLayout("slim");
    assert.deepEqual(classic.map(p => p.name), PART_NAMES);

    const bounds = part => {
        const c = part.pivot.map((v, i) => v + part.offset[i]);
        return {min: c.map((v, i) => v - part.size[i] / 2), max: c.map((v, i) => v + part.size[i] / 2)};
    };
    const byName = layout => Object.fromEntries(layout.map(p => [p.name, p]));
    const c = byName(classic), s = byName(slim);

    // overall height 32 px, feet at 0
    assert.equal(Math.max(...classic.map(p => bounds(p).max[1])), MODEL_HEIGHT);
    assert.equal(Math.min(...classic.map(p => bounds(p).min[1])), 0);
    assert.ok(Math.abs(MODEL_HEIGHT * PIXEL_SCALE - 1.875) < 1e-9, "1.875 blocks high");

    // joints: neck, shoulders, hips
    assert.deepEqual(c.head.pivot, [0, 24, 0]);
    assert.deepEqual(c.rightArm.pivot, [-5, 22, 0]);
    assert.deepEqual(c.leftArm.pivot, [5, 22, 0]);
    assert.deepEqual(c.rightLeg.pivot, [-1.9, 12, 0]);
    assert.deepEqual(c.leftLeg.pivot, [1.9, 12, 0]);
    assert.deepEqual(bounds(c.head).min, [-4, 24, -4]);
    assert.deepEqual(bounds(c.body).min, [-4, 12, -2]);

    // arms: 4 px (classic) vs. 3 px (slim), attached to the body at x = -/+4
    assert.deepEqual(c.rightArm.size, [4, 12, 4]);
    assert.deepEqual(s.rightArm.size, [3, 12, 4]);
    assert.deepEqual([bounds(c.rightArm).min[0], bounds(c.rightArm).max[0]], [-8, -4]);
    assert.deepEqual([bounds(s.rightArm).min[0], bounds(s.rightArm).max[0]], [-7, -4]);
    assert.deepEqual([bounds(c.leftArm).min[0], bounds(c.leftArm).max[0]], [4, 8]);
    assert.deepEqual([bounds(s.leftArm).min[0], bounds(s.leftArm).max[0]], [4, 7]);

    // everything except the arms is identical in both variants
    for (const name of ["head", "body", "rightLeg", "leftLeg"]) assert.deepEqual(s[name], c[name], name);
});

test("second layer boxes are bigger, but use the unchanged UV-rectangles", () => {
    const geometries = getPlayerModelGeometries("classic");
    for (const name of PART_NAMES) {
        const {layout, base, overlay} = geometries.get(name);
        assert.deepEqual([base.parameters.width, base.parameters.height, base.parameters.depth], layout.size);
        assert.deepEqual(
            [overlay.parameters.width, overlay.parameters.height, overlay.parameters.depth],
            layout.size.map(v => v + 2 * layout.overlayInflate)
        );
        assert.ok(layout.overlayInflate > 0, "no z-fighting between the layers");
    }
    // the inflation does not change which pixels are used
    const plain = createSkinBoxGeometry([8, 8, 8], [32, 0], 0), inflated = createSkinBoxGeometry([8, 8, 8], [32, 0], 0.5);
    assert.deepEqual(Array.from(plain.getAttribute("uv").array), Array.from(inflated.getAttribute("uv").array));
});

test("geometries are created once per variant and shared", () => {
    assert.equal(getPlayerModelGeometries("classic"), getPlayerModelGeometries("classic"));
    assert.equal(getPlayerModelGeometries("unknown"), getPlayerModelGeometries("classic"), "unknown variant -> classic");
    assert.notEqual(getPlayerModelGeometries("slim"), getPlayerModelGeometries("classic"));
    // identical parts share one geometry across variants, only the arms differ
    for (const name of ["head", "body", "rightLeg", "leftLeg"]) {
        assert.equal(getPlayerModelGeometries("slim").get(name).base, getPlayerModelGeometries("classic").get(name).base, name);
        assert.equal(getPlayerModelGeometries("slim").get(name).overlay, getPlayerModelGeometries("classic").get(name).overlay, name);
    }
    assert.notEqual(getPlayerModelGeometries("slim").get("rightArm").base, getPlayerModelGeometries("classic").get("rightArm").base);
    assert.equal(getPlayerModelGeometries("slim").get("rightArm").base.parameters.width, 3);
    assert.equal(getPlayerModelGeometries("classic").get("rightArm").base.parameters.width, 4);
});

// --- skin cache and model ---

/** image-loader for tests: resolves/rejects on demand */
function controllableLoader() {
    const pending = new Map();
    const loader = url => new Promise((resolve, reject) => pending.set(url, {resolve, reject}));
    loader.resolve = url => pending.get(url).resolve({width: 64, height: 64, src: url});
    loader.reject = url => pending.get(url).reject(new Error("404"));
    return loader;
}
const flush = () => new Promise(r => setTimeout(r, 0));

function meshes(model) {
    const result = [];
    model.traverse(o => { if (o.isMesh) result.push(o); });
    return result;
}

test("skin textures are shared per skin and disposed when unused", async () => {
    const loader = controllableLoader();
    const cache = new PlayerSkinCache(loader);

    const a = cache.acquire("skins/a.png?v=1");
    const b = cache.acquire("skins/a.png?v=1");
    assert.equal(a, b);
    assert.equal(a.refs, 2);
    loader.resolve("skins/a.png?v=1");
    await flush();
    assert.equal(a.state, "loaded");

    let disposed = 0;
    a.texture.dispose = () => disposed++;
    cache.release(a);
    assert.equal(disposed, 0, "still used by one player");
    cache.release(b);
    assert.equal(disposed, 1);
    assert.equal(cache.entries.size, 0);
});

test("player-models share geometry, but not skins; changing one does not change another", async () => {
    const loader = controllableLoader();
    const cache = new PlayerSkinCache(loader);
    const one = new PlayerModel(cache), two = new PlayerModel(cache);

    one.setSkin("skins/one.png?v=1", "classic");
    two.setSkin("skins/two.png?v=1", "slim");
    loader.resolve("skins/one.png?v=1");
    loader.resolve("skins/two.png?v=1");
    await flush();

    assert.ok(one.hasSkin && two.hasSkin);
    assert.equal(meshes(one).length, 12, "6 parts x 2 layers");
    assert.equal(one.parts.head.children[0].geometry, two.parts.head.children[0].geometry, "head geometry shared");
    assert.notEqual(one.parts.rightArm.children[0].geometry, two.parts.rightArm.children[0].geometry, "classic vs slim arms");
    assert.notEqual(one.parts.head.children[0].material, two.parts.head.children[0].material, "own skin per player");
    assert.equal(one.parts.head.children[0].material.map, cache.entries.get("skins/one.png?v=1").texture);

    const twoMaterial = two.parts.head.children[0].material;
    one.setSkin("skins/one.png?v=2", "classic");
    loader.resolve("skins/one.png?v=2");
    await flush();
    assert.equal(two.parts.head.children[0].material, twoMaterial, "the other player is unchanged");
    assert.equal(cache.entries.has("skins/one.png?v=1"), false, "old skin released");

    one.dispose();
    two.dispose();
    assert.equal(cache.entries.size, 0);
});

test("bones are separate groups at their joints, the model origin is at the feet", async () => {
    const loader = controllableLoader();
    const cache = new PlayerSkinCache(loader);
    const model = new PlayerModel(cache);
    model.setSkin("skins/x.png", "classic");
    loader.resolve("skins/x.png");
    await flush();

    assert.deepEqual(Object.keys(model.parts), PART_NAMES);
    assert.equal(model.root.scale.x, PIXEL_SCALE);
    assert.deepEqual(model.parts.head.position.toArray(), [0, 24, 0]);
    assert.deepEqual(model.parts.leftLeg.position.toArray(), [1.9, 12, 0]);
    // rotating one bone does not move another
    model.parts.rightArm.rotation.x = 1;
    assert.equal(model.parts.leftArm.rotation.x, 0);
    for (const mesh of meshes(model)) {
        assert.doesNotThrow(() => mesh.raycast(), "meshes ignore raycasting (map-clicks stay unchanged)");
    }
});

test("missing or failed skins fall back to the default skin (with its model-variant)", async () => {
    const loader = controllableLoader();
    const cache = new PlayerSkinCache(loader);
    const model = new PlayerModel(cache);

    // no skin and no default skin yet -> nothing to show
    model.setSkin(null, "classic");
    assert.equal(model.hasSkin, false);

    // default skin arrives later (from textures.json) -> displayed
    const defaultLoad = cache.setDefaultSkin("data:image/png;base64,steve", "slim");
    loader.resolve("data:image/png;base64,steve");
    await defaultLoad;
    assert.equal(model.hasSkin, true);
    assert.equal(model.displayedVariant, "slim");
    assert.equal(model.parts.head.children[0].material, cache.defaultSkin.baseMaterial);

    // the players skin fails to load -> stays on the default skin
    model.setSkin("skins/broken.png?v=1", "classic");
    assert.equal(model.displayedSkin, cache.defaultSkin, "default while loading");
    loader.reject("skins/broken.png?v=1");
    await flush();
    assert.equal(model.displayedSkin, cache.defaultSkin);
    assert.equal(cache.entries.get("skins/broken.png?v=1").state, "failed");

    // disposing a model never disposes the default skin
    let disposed = 0;
    cache.defaultSkin.texture.dispose = () => disposed++;
    model.dispose();
    assert.equal(disposed, 0);
});

test("default skin is found in textures.json", () => {
    const steve = "data:image/png;base64,AAAA";
    assert.deepEqual(PlayerSkinCache.findDefaultSkin([
        {resourcePath: "minecraft:block/stone", texture: "data:image/png;base64,BBBB"},
        {resourcePath: "minecraft:entity/player/slim/steve", texture: steve},
    ]), {texture: steve, variant: "slim"});
    assert.deepEqual(PlayerSkinCache.findDefaultSkin([
        {resourcePath: "minecraft:entity/player/wide/steve", texture: steve},
    ]), {texture: steve, variant: "classic"});
    assert.equal(PlayerSkinCache.findDefaultSkin([{resourcePath: "minecraft:block/stone", texture: steve}]), null);
    assert.equal(PlayerSkinCache.findDefaultSkin([{resourcePath: "minecraft:entity/player/slim/steve", texture: "javascript:alert(1)"}]), null);
    assert.equal(PlayerSkinCache.findDefaultSkin(null), null);
});

test("applyPose moves and rotates only the existing bones, the head rotation stays the look-direction", async () => {
    const loader = controllableLoader();
    const cache = new PlayerSkinCache(loader);
    const model = new PlayerModel(cache);
    model.setSkin("skins/slim.png", "slim");
    loader.resolve("skins/slim.png");
    await flush();

    const childrenBefore = PART_NAMES.map(name => model.parts[name].children.slice());
    model.parts.head.rotation.set(0.3, 0.2, 0);

    const pose = {parts: {}, rootY: -0.125, rootZ: 0, rootPitch: 0};
    for (const name of PART_NAMES) pose.parts[name] = {rx: 0.1, ry: 0.2, rz: 0.3, px: 0, py: -1, pz: 2};
    model.applyPose(pose);

    assert.deepEqual(model.parts.head.rotation.toArray().slice(0, 3), [0.3, 0.2, 0], "head rotation untouched");
    assert.deepEqual(model.parts.head.position.toArray(), [0, 23, 2]);
    assert.deepEqual(model.parts.rightArm.position.toArray(), [-5, 20.5, 2], "relative to the slim pivot");
    assert.deepEqual(model.parts.rightArm.rotation.toArray().slice(0, 4), [0.1, 0.2, 0.3, "ZYX"]);
    assert.equal(model.root.position.y, -0.125);
    PART_NAMES.forEach((name, i) => assert.deepEqual(model.parts[name].children, childrenBefore[i], "no new meshes"));

    // a later variant-change keeps the bones and uses the new pivots
    model.setSkin("skins/classic.png", "classic");
    loader.resolve("skins/classic.png");
    await flush();
    model.applyPose(pose);
    assert.deepEqual(model.parts.rightArm.position.toArray(), [-5, 21, 2]);
    model.dispose();
});
