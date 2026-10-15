// BlueMap Live – Phase 2 browser end-to-end test (NOT part of the BlueMap build).
// Drives the ORIGINAL built BlueMap webapp in Chromium against LiveE2EServer and checks the live-player pipeline.
// Usage: see docs/bluemap-live/e2e/README.md

import {createRequire} from "node:module";
import assert from "node:assert/strict";
import {mkdirSync} from "node:fs";
import {inflateSync} from "node:zlib";

const require = createRequire(import.meta.url);
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || "playwright");

const BASE = process.env.E2E_BASE || "http://127.0.0.1:8100";
const OUT = process.env.E2E_OUT || "e2e-out";
mkdirSync(OUT, {recursive: true});

const A = "069a79f4-44e9-4726-a5be-fca90e38aaf5";
const B = "853c80ef-3c37-49fd-aa49-938b674adae6";
const C = "c0ffee00-0000-4000-8000-000000000001";

const results = [];
async function step(name, fn) {
    try {
        await fn();
        results.push({name, ok: true});
        console.log(`PASS  ${name}`);
    } catch (e) {
        results.push({name, ok: false, error: e.message});
        console.log(`FAIL  ${name}\n      ${e.message}`);
    }
}

async function control(params) {
    const res = await fetch(`${BASE}/control?${new URLSearchParams(params)}`);
    assert.equal(res.status, 200);
    return res.json();
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
const page = await browser.newPage({viewport: {width: 1280, height: 800}});

const pageErrors = [];
page.on("pageerror", e => pageErrors.push(e.message));
page.on("console", msg => {
    if (msg.type() === "error" && !msg.text().includes("404") && !msg.text().includes("Failed to load resource")) {
        pageErrors.push(msg.text());
    }
});

// helpers evaluated in the page
const marker = uuid => page.evaluate(uuid => {
    const m = window.bluemap.playerMarkerManager?.getPlayerMarkerSet(false)?.getPlayerMarker(uuid);
    if (!m) return null;
    let meshes = 0;
    m.model.traverse(o => { if (o.isMesh) meshes++; });
    return {
        x: m.position.x, y: m.position.y, z: m.position.z,
        visible: m.visible,
        modelInMarker: m.children.includes(m.model),
        modelVisible: m.model.visible,
        meshes,
        bodyRotY: m.model.rotation.y,
        headRotY: m.headPivot.rotation.y,
        headRotX: m.headPivot.rotation.x,
        generation: m.lastPlayerData?.generation ?? null,
        inMarkerScene: (() => { let p = m; while (p.parent) p = p.parent; return p === window.bluemap.mapViewer.markers; })(),
    };
}, uuid);

/** samples the x-position of a marker on every animation-frame for the given time */
const sampleX = (uuid, ms) => page.evaluate(([uuid, ms]) => new Promise(resolve => {
    const values = [];
    const end = performance.now() + ms;
    const frame = () => {
        const m = window.bluemap.playerMarkerManager?.getPlayerMarkerSet(false)?.getPlayerMarker(uuid);
        if (m) values.push(m.position.x);
        if (performance.now() < end) requestAnimationFrame(frame); else resolve(values);
    };
    requestAnimationFrame(frame);
}), [uuid, ms]);

const near = (a, b, eps = 1e-3) => Math.abs(a - b) < eps;

/** retries an assertion until it passes (max 5s), for states that are reached by animation */
async function eventually(fn, timeout = 5000) {
    const end = Date.now() + timeout;
    for (;;) {
        try {
            return await fn();
        } catch (e) {
            if (Date.now() > end) throw e;
            await sleep(100);
        }
    }
}

/** waits until the displayed x-position of a marker reached the expected value (animation-frames can be slow with software-rendering) */
const waitForX = (uuid, x) => page.waitForFunction(([uuid, x]) => {
    const m = window.bluemap.playerMarkerManager?.getPlayerMarkerSet(false)?.getPlayerMarker(uuid);
    return m && Math.abs(m.position.x - x) < 1e-3;
}, [uuid, x], {timeout: 5000});

// --- load the original webapp ---
// camera via the normal page-address: map:x:y:z:distance:rotation:angle:tilt:ortho:view (looking at the test-tile from the south)
await page.goto(`${BASE}/#world:18:64:18:30:0:1:0:0:perspective`);
await page.waitForFunction(() => window.bluemap?.mapViewer?.map?.isLoaded, null, {timeout: 30000});
await page.evaluate(() => {
    // count hires/lowres tile-loads from now on (live player updates must not cause any)
    window.__tileLoads = 0;
    window.bluemap.events.addEventListener("bluemapMapTileLoaded", () => window.__tileLoads++);
});
// hires-tiles are only loaded close to the camera
await page.waitForFunction(() => {
    const tiles = window.bluemap.mapViewer.map.hiresTileManager.tiles;
    return [...tiles.values()].some(t => t.model);
}, null, {timeout: 30000});
await sleep(1500);
const tileLoadsBaseline = await page.evaluate(() => window.__tileLoads);
await page.screenshot({path: `${OUT}/00-map-without-players.png`});

await step("map and hires-tile of the original webapp are loaded", async () => {
    assert.equal(await page.evaluate(() => window.bluemap.mapViewer.map.isLoaded), true);
});

await step("player joins -> marker with 3d player-model in the original marker-scene", async () => {
    await control({uuid: A, name: "Alice", x: 10, y: 64, z: 24, yaw: 0, pitch: 0});
    await page.waitForFunction(uuid => !!window.bluemap.playerMarkerManager?.getPlayerMarkerSet(false)?.getPlayerMarker(uuid), A, {timeout: 5000});
    const m = await marker(A);
    assert.ok(near(m.x, 10) && near(m.y, 65.8) && near(m.z, 24), `position ${m.x},${m.y},${m.z}`);
    assert.equal(m.modelInMarker, true);
    // player-model with the default skin from textures.json: 6 body-parts x 2 layers
    await eventually(async () => assert.equal((await marker(A)).meshes, 12));
    assert.equal(m.inMarkerScene, true, "model must be part of mapViewer.markers (same scene/camera/depth as map)");
    assert.equal(m.visible, true);
    // the css head-marker is attached to the DOM by the css2d-renderer on the next rendered frame
    await eventually(async () => assert.equal(await page.evaluate(() => document.querySelectorAll(".bm-marker-player img").length), 1, "head-marker (css) still exists"));
});
await sleep(400);
await page.screenshot({path: `${OUT}/01-join.png`});

await step("normal movement is interpolated", async () => {
    await control({uuid: A, x: 11, y: 64, z: 24, yaw: 0, pitch: 0});
    const xs = await sampleX(A, 900);
    assert.ok(xs.some(x => x > 10.01 && x < 10.99), `no intermediate positions: ${xs.slice(0, 40).join(",")}`);
    await waitForX(A, 11);
});

await step("rotation without movement updates yaw/pitch, position unchanged", async () => {
    await control({uuid: A, x: 11, y: 64, z: 24, yaw: 90, bodyYaw: 90, pitch: 30});
    await eventually(async () => {
        const m = await marker(A);
        assert.ok(near(m.x, 11), `x ${m.x}`);
        assert.ok(near(m.bodyRotY, -Math.PI / 2), `body ${m.bodyRotY}`);
        assert.ok(near(m.headRotX, Math.PI / 6), `pitch ${m.headRotX}`);
        assert.ok(near(m.headRotY, 0), `head relative to body ${m.headRotY}`);
    });
});

await step("head-yaw differing from body-yaw rotates only the head", async () => {
    await control({uuid: A, x: 11, y: 64, z: 24, yaw: 135, bodyYaw: 90, pitch: 0});
    await eventually(async () => {
        const m = await marker(A);
        assert.ok(near(m.bodyRotY, -Math.PI / 2), `body ${m.bodyRotY}`);
        assert.ok(near(m.headRotY, -Math.PI / 4), `head ${m.headRotY}`);
    });
});

await step("teleport jumps without interpolation (generation changes)", async () => {
    const before = await marker(A);
    const sampling = sampleX(A, 900);
    await control({uuid: A, x: 1000, y: 80, z: -500, yaw: 0, pitch: 0});
    const xs = await sampling;
    const between = xs.filter(x => x > 11.5 && x < 999.5);
    assert.equal(between.length, 0, `interpolated through: ${between.slice(0, 10)}`);
    await eventually(async () => {
        const m = await marker(A);
        assert.ok(near(m.x, 1000), `x ${m.x}`);
        assert.equal(m.generation, before.generation + 1);
    });
});

await step("teleport back (behind the pillar) + second player in front -> depth-test against map geometry", async () => {
    // pillar occupies x 16..20, z 16..20 (tile translate 2) and is 6 blocks high; camera looks from the south
    await control({uuid: A, x: 18, y: 64, z: 13, yaw: 0, pitch: 0});
    await control({uuid: B, name: "Bob", x: 12, y: 64, z: 24, yaw: 180, pitch: 0});
    await sleep(900);
    assert.ok(await marker(A) && await marker(B));
});
await page.screenshot({path: `${OUT}/02-occlusion-two-players.png`});

await step("dimension change hides the player and jumps on return", async () => {
    await control({uuid: B, x: 2, y: 70, z: 3, yaw: 0, pitch: 0, world: "minecraft:the_nether"});
    await page.waitForFunction(uuid => window.bluemap.playerMarkerManager.getPlayerMarkerSet(false).getPlayerMarker(uuid).visible === false, B, {timeout: 3000});
    const sampling = sampleX(B, 900);
    await control({uuid: B, x: 14, y: 64, z: 26, yaw: 0, pitch: 0, world: "minecraft:overworld"});
    const xs = await sampling;
    await eventually(async () => {
        const m = await marker(B);
        assert.equal(m.visible, true);
        assert.ok(near(m.x, 14), `x ${m.x}`);
    });
    assert.equal(xs.filter(x => x > 2.5 && x < 13.5).length, 0, "no interpolation from the nether-position");
});

await step("respawn nearby is a discontinuity (no interpolation)", async () => {
    const before = await marker(B);
    const sampling = sampleX(B, 900);
    await control({uuid: B, x: 17, y: 64, z: 26, yaw: 0, pitch: 0, respawn: 1});
    const xs = await sampling;
    await eventually(async () => assert.equal((await marker(B)).generation, before.generation + 1));
    assert.equal(xs.filter(x => x > 14.01 && x < 16.99).length, 0, `interpolated: ${xs.filter(x => x > 14.01 && x < 16.99).slice(0, 5)}`);
});

await step("stale (older) response is ignored", async () => {
    await control({uuid: B, x: 13, y: 64, z: 26, yaw: 0, pitch: 0});
    await sleep(300);
    await control({uuid: B, x: 14, y: 64, z: 26, yaw: 0, pitch: 0});
    await page.waitForFunction(
        uuid => Math.abs(window.bluemap.playerMarkerManager.getPlayerMarkerSet(false).getPlayerMarker(uuid).position.x - 14) < 1e-3,
        B, {timeout: 3000});

    // the next poll gets the response of the x=13 sample (older serverTime)
    const servedBefore = (await control({status: 1})).staleServed;
    await control({stale: 1});
    const xs = await sampleX(B, 1200);
    assert.equal((await control({status: 1})).staleServed, servedBefore + 1, "stale response was not served");
    assert.equal(xs.filter(x => x < 13.999).length, 0, `went back to ${Math.min(...xs)}`);
});

await step("disconnect removes marker and model", async () => {
    await control({leave: A});
    await page.waitForFunction(uuid => !window.bluemap.playerMarkerManager.getPlayerMarkerSet(false).getPlayerMarker(uuid), A, {timeout: 3000});
    const models = await page.evaluate(() => {
        let n = 0;
        window.bluemap.mapViewer.markers.traverse(o => { if (o.name === "bm-player-model") n++; });
        return n;
    });
    assert.equal(models, 1, "only Bob's model is left in the scene");
});

await step("player updates did not reload any map tiles", async () => {
    const loads = await page.evaluate(() => window.__tileLoads);
    assert.equal(loads, tileLoadsBaseline, `tile loads during live updates: ${loads - tileLoadsBaseline}`);
});

await step("live endpoint unavailable: players are removed, map keeps working", async () => {
    await control({down: 1});
    await page.waitForFunction(() => window.bluemap.playerMarkerManager.getPlayerMarkerSet(false).markers.size === 0, null, {timeout: 5000});
    assert.equal(await page.evaluate(() => window.bluemap.mapViewer.map.isLoaded), true);
    await page.screenshot({path: `${OUT}/03-live-endpoint-down.png`});
    await control({down: 0});
    // MarkerManager retries after max(interval, 15s) after a failure
    await page.waitForFunction(uuid => !!window.bluemap.playerMarkerManager.getPlayerMarkerSet(false).getPlayerMarker(uuid), B, {timeout: 25000});
});

await step("close-up: player-models with rotation, one partly behind the pillar", async () => {
    await control({uuid: A, name: "Alice", x: 20.4, y: 64, z: 14.5, yaw: 200, bodyYaw: 180, pitch: 0});
    await control({uuid: B, x: 13.5, y: 64, z: 22.5, yaw: -60, bodyYaw: -30, pitch: 35});
    await page.goto(`${BASE}/#world:17:64:19:12:0.35:1.1:0:0:perspective`);
    await page.waitForFunction(() => window.bluemap?.mapViewer?.map?.isLoaded, null, {timeout: 60000});
    await page.waitForFunction(() => [...window.bluemap.mapViewer.map.hiresTileManager.tiles.values()].some(t => t.model), null, {timeout: 60000});
    await page.waitForFunction(uuids => uuids.every(u => !!window.bluemap.playerMarkerManager?.getPlayerMarkerSet(false)?.getPlayerMarker(u)), [A, B], {timeout: 5000});
    await sleep(1500);
    await page.screenshot({path: `${OUT}/04-closeup.png`});
});


// ---------------------------------------------------------------------------------------------------------------
// skins & model-geometry (visual): a color-coded skin, screenshot-pixels at projected face-quadrants
// ---------------------------------------------------------------------------------------------------------------

const PARTS = ["head", "body", "rightArm", "leftArm", "rightLeg", "leftLeg"];
const FACES = ["right", "left", "top", "bottom", "front", "back"];

/** same formula as LiveE2EServer.skinColor */
function skinColor(layer, part, face, quadrant) {
    const id = ((layer * 6 + PARTS.indexOf(part)) * 6 + FACES.indexOf(face)) * 4 + quadrant;
    return [30 + (id % 8) * 30, 30 + (Math.floor(id / 8) % 8) * 30, 30 + Math.floor(id / 64) * 45];
}

/** minimal PNG decoder (8 bit RGB/RGBA, non-interlaced) for the screenshots */
function decodePng(buffer) {
    let pos = 8, width, height, colorType, idat = [];
    while (pos < buffer.length) {
        const length = buffer.readUInt32BE(pos), type = buffer.toString("ascii", pos + 4, pos + 8);
        const data = buffer.subarray(pos + 8, pos + 8 + length);
        if (type === "IHDR") {
            width = data.readUInt32BE(0); height = data.readUInt32BE(4);
            assert.equal(data[8], 8, "bit depth"); colorType = data[9]; assert.equal(data[12], 0, "interlace");
        } else if (type === "IDAT") idat.push(data);
        pos += 12 + length;
    }
    const bpp = colorType === 6 ? 4 : 3, stride = width * bpp, raw = inflateSync(Buffer.concat(idat));
    const out = Buffer.alloc(height * stride);
    for (let y = 0; y < height; y++) {
        const filter = raw[y * (stride + 1)];
        for (let x = 0; x < stride; x++) {
            const r = raw[y * (stride + 1) + 1 + x];
            const a = x >= bpp ? out[y * stride + x - bpp] : 0, b = y > 0 ? out[(y - 1) * stride + x] : 0;
            const c = x >= bpp && y > 0 ? out[(y - 1) * stride + x - bpp] : 0;
            let v;
            switch (filter) {
                case 0: v = r; break;
                case 1: v = r + a; break;
                case 2: v = r + b; break;
                case 3: v = r + ((a + b) >> 1); break;
                case 4: { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
                          v = r + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c); break; }
                default: throw new Error("bad png filter " + filter);
            }
            out[y * stride + x] = v & 0xFF;
        }
    }
    return {width, height, pixel: (x, y) => { const i = Math.round(y) * stride + Math.round(x) * bpp; return [out[i], out[i + 1], out[i + 2]]; }};
}

/**
 * Projects points on the faces of the players base-layer meshes to screen-coordinates.
 * The expected Minecraft orientation of the face-rectangles (image-x / image-y directions) is written down here
 * on purpose instead of using PlayerModelLayout.js.
 */
const projectQuadrants = (uuid, faceList) => page.evaluate(([uuid, faceList]) => {
    const orientation = {
        front: {n: [0, 0, 1], ix: [1, 0, 0], iy: [0, -1, 0]},
        back:  {n: [0, 0, -1], ix: [-1, 0, 0], iy: [0, -1, 0]},
        right: {n: [-1, 0, 0], ix: [0, 0, 1], iy: [0, -1, 0]},
        left:  {n: [1, 0, 0], ix: [0, 0, -1], iy: [0, -1, 0]},
        top:   {n: [0, 1, 0], ix: [1, 0, 0], iy: [0, 0, 1]},
    };
    const mv = window.bluemap.mapViewer, marker = mv.markers.markerSets.get("bm-players").markers.get("bm-player-" + uuid);
    marker.updateMatrixWorld(true);
    mv.camera.updateMatrixWorld();
    const rect = mv.renderer.domElement.getBoundingClientRect();
    const V = window.BlueMap.Three.Vector3;
    const result = [];
    for (const [part, face] of faceList) {
        const mesh = marker.model.getObjectByName(part + "-base");
        const {width, height, depth} = mesh.geometry.parameters, half = [width / 2, height / 2, depth / 2];
        const o = orientation[face];
        for (let q = 0; q < 4; q++) {
            const fx = q % 2 === 0 ? 0.25 : 0.75, fy = q < 2 ? 0.25 : 0.75;
            const local = [0, 1, 2].map(i =>
                o.n[i] * (half[i] + 0.02) +              // just in front of the face
                o.ix[i] * (fx - 0.5) * 2 * half[i] +     // along image-x
                o.iy[i] * (fy - 0.5) * 2 * half[i]);     // along image-y
            const world = mesh.localToWorld(new V(local[0], local[1], local[2]));
            const ndc = world.clone().project(mv.camera);
            result.push({part, face, quadrant: q, x: rect.left + (ndc.x + 1) / 2 * rect.width, y: rect.top + (1 - ndc.y) / 2 * rect.height});
        }
    }
    return result;
}, [uuid, faceList]);

const colorClose = (a, b, tolerance = 14) => a.every((v, i) => Math.abs(v - b[i]) <= tolerance);

async function screenshotPixels(name) {
    const buffer = await page.screenshot({path: `${OUT}/${name}.png`});
    return decodePng(buffer);
}

/** checks every projected quadrant against the color-coded skin (base layer, optional overrides) */
function checkQuadrants(png, points, expectedOverride = () => null) {
    const wrong = [];
    for (const p of points) {
        const expected = expectedOverride(p) || skinColor(0, p.part, p.face, p.quadrant);
        const actual = png.pixel(p.x, p.y);
        if (!colorClose(actual, expected)) wrong.push(`${p.part}/${p.face}/q${p.quadrant}: expected ${expected} got ${actual} at ${Math.round(p.x)},${Math.round(p.y)}`);
    }
    assert.deepEqual(wrong, [], wrong.join("\n"));
}

/** camera close to C (standing at 8.5 / 64 / 8.5 on the test-tile), via the normal page-address */
async function viewPlayerC(angle) {
    await page.goto(`${BASE}/#world:8.5:64.9:8.5:5:0:${angle}:0:0:perspective`);
    await page.waitForFunction(() => window.bluemap?.mapViewer?.map?.isLoaded, null, {timeout: 60000});
    await page.addStyleTag({content: ".bm-marker-player { display: none !important; }"}); // css head-marker would cover the model
    await page.waitForFunction(uuid => {
        const m = window.bluemap.playerMarkerManager?.getPlayerMarkerSet(false)?.getPlayerMarker(uuid);
        return m && m.model.displayedSkin && !m.model.displayedSkin.isDefault && m.model.displayedSkin.state === "loaded";
    }, C, {timeout: 10000});
    await sleep(1200);
}

const hatOverride = p => (p.part === "head" && p.face === "front" && (p.quadrant === 0 || p.quadrant === 2)) ? skinColor(1, "head", "front", 0) : null;

await step("skin (classic): front view – every front face, quadrant orientation and the hat-overlay", async () => {
    await control({uuid: C, name: "Carol", x: 8.5, y: 64, z: 8.5, yaw: 0, bodyYaw: 0, pitch: 0, skin: "classic"});
    await viewPlayerC(1.45);
    const points = await projectQuadrants(C, PARTS.map(part => [part, "front"]));
    checkQuadrants(await screenshotPixels("05-skin-front"), points, hatOverride);
});

await step("skin (classic): back view", async () => {
    await control({uuid: C, x: 8.5, y: 64, z: 8.5, yaw: 180, bodyYaw: 180, pitch: 0, skin: "classic"});
    await sleep(1200);
    const points = await projectQuadrants(C, PARTS.map(part => [part, "back"]));
    checkQuadrants(await screenshotPixels("06-skin-back"), points);
});

await step("skin (classic): left and right side", async () => {
    // facing -x: the camera (south) sees the players left side
    await control({uuid: C, x: 8.5, y: 64, z: 8.5, yaw: 90, bodyYaw: 90, pitch: 0, skin: "classic"});
    await sleep(1200);
    // (the side faces of the body are completely covered by the arms in a side view)
    let points = await projectQuadrants(C, [["head", "left"], ["leftArm", "left"], ["leftLeg", "left"]]);
    checkQuadrants(await screenshotPixels("07-skin-left"), points);

    await control({uuid: C, x: 8.5, y: 64, z: 8.5, yaw: -90, bodyYaw: -90, pitch: 0, skin: "classic"});
    await sleep(1200);
    points = await projectQuadrants(C, [["head", "right"], ["rightArm", "right"], ["rightLeg", "right"]]);
    checkQuadrants(await screenshotPixels("08-skin-right"), points);
});

await step("skin (classic): top view", async () => {
    await control({uuid: C, x: 8.5, y: 64, z: 8.5, yaw: 0, bodyYaw: 0, pitch: 0, skin: "classic"});
    await viewPlayerC(0);
    const points = await projectQuadrants(C, [["head", "top"], ["rightArm", "top"], ["leftArm", "top"]]);
    checkQuadrants(await screenshotPixels("09-skin-top"), points);
});

/** screen-position of a point (pixels) in the space of a bone (relative to its joint, so it follows the animation) */
const projectBonePoint = (uuid, bone, px, py, pz) => page.evaluate(([uuid, bone, px, py, pz]) => {
    const mv = window.bluemap.mapViewer, marker = mv.markers.markerSets.get("bm-players").markers.get("bm-player-" + uuid);
    marker.updateMatrixWorld(true);
    mv.camera.updateMatrixWorld();
    const rect = mv.renderer.domElement.getBoundingClientRect();
    const V = window.BlueMap.Three.Vector3;
    const ndc = marker.model.parts[bone].localToWorld(new V(px, py, pz)).project(mv.camera);
    return {x: rect.left + (ndc.x + 1) / 2 * rect.width, y: rect.top + (1 - ndc.y) / 2 * rect.height};
}, [uuid, bone, px, py, pz]);

await step("skin (slim): 3 px arms, the rest of the body unchanged", async () => {
    await control({uuid: C, x: 8.5, y: 64, z: 8.5, yaw: 0, bodyYaw: 0, pitch: 0, skin: "classic"});
    await viewPlayerC(1.45);
    // 2.5 px outside of the shoulder-joint: inside the classic right arm (joint -3..+1), outside the slim one (-2..+1)
    // (in the space of the arm-bone, so the idle-animation of the arm does not matter)
    let probe = await projectBonePoint(C, "rightArm", -2.5, -6, 2.05);
    let png = await screenshotPixels("10-classic-arm");
    const armColors = [0, 1, 2, 3].map(q => skinColor(0, "rightArm", "front", q));
    assert.ok(armColors.some(c => colorClose(png.pixel(probe.x, probe.y), c)), "classic arm covers x = -7.5");

    await control({uuid: C, x: 8.5, y: 64, z: 8.5, yaw: 0, bodyYaw: 0, pitch: 0, skin: "slim"});
    await page.waitForFunction(uuid => window.bluemap.playerMarkerManager.getPlayerMarkerSet(false).getPlayerMarker(uuid).model.displayedVariant === "slim", C, {timeout: 10000});
    await sleep(1200);
    probe = await projectBonePoint(C, "rightArm", -2.5, -6, 2.05);
    png = await screenshotPixels("11-slim-front");
    assert.ok(!armColors.some(c => colorClose(png.pixel(probe.x, probe.y), c)), "slim arm does not cover x = -7.5");
    const points = await projectQuadrants(C, PARTS.map(part => [part, "front"]));
    checkQuadrants(png, points, hatOverride);
});

await step("skin: missing skin-image falls back to the default skin from textures.json", async () => {
    await control({uuid: C, x: 8.5, y: 64, z: 8.5, yaw: 0, bodyYaw: 0, pitch: 0, skin: "broken"});
    await page.waitForFunction(uuid => {
        const model = window.bluemap.playerMarkerManager.getPlayerMarkerSet(false).getPlayerMarker(uuid).model;
        return model.skin?.state === "failed" && model.displayedSkin?.isDefault;
    }, C, {timeout: 10000});
    await sleep(1200);
    const center = (await projectQuadrants(C, [["head", "front"]]))[0];
    const png = await screenshotPixels("12-default-skin");
    assert.ok(colorClose(png.pixel(center.x, center.y), [128, 128, 128]), `default skin pixel ${png.pixel(center.x, center.y)}`);
});

await step("skin: replaced and released textures are disposed, other players keep theirs", async () => {
    await control({uuid: C, x: 8.5, y: 64, z: 8.5, yaw: 0, bodyYaw: 0, pitch: 0, skin: "classic"});
    await page.waitForFunction(uuid => window.bluemap.playerMarkerManager.getPlayerMarkerSet(false).getPlayerMarker(uuid).model.displayedSkin?.state === "loaded"
        && !window.bluemap.playerMarkerManager.getPlayerMarkerSet(false).getPlayerMarker(uuid).model.displayedSkin.isDefault, C, {timeout: 10000});
    const cacheUrls = await page.evaluate(() => [...window.bluemap.playerMarkerManager.skinCache.entries.keys()]);
    assert.ok(cacheUrls.some(u => u.includes(C) && u.endsWith("v=0c")), cacheUrls.join(","));
    assert.ok(!cacheUrls.some(u => u.endsWith("v=0b") || u.endsWith("v=05")), "previous skins of C released: " + cacheUrls.join(","));

    await control({leave: C});
    await page.waitForFunction(uuid => !window.bluemap.playerMarkerManager.getPlayerMarkerSet(false).getPlayerMarker(uuid), C, {timeout: 5000});
    const after = await page.evaluate(() => [...window.bluemap.playerMarkerManager.skinCache.entries.keys()]);
    assert.ok(!after.some(u => u.includes(C)), "skin of the disconnected player disposed: " + after.join(","));
});

await step("no uncaught errors in the page", async () => {
    assert.deepEqual(pageErrors, []);
});

await browser.close();

const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} steps passed`);
process.exit(failed.length ? 1 : 0);
