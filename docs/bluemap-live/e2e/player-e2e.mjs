// BlueMap Live – Phase 2 browser end-to-end test (NOT part of the BlueMap build).
// Drives the ORIGINAL built BlueMap webapp in Chromium against LiveE2EServer and checks the live-player pipeline.
// Usage: see docs/bluemap-live/e2e/README.md

import {createRequire} from "node:module";
import assert from "node:assert/strict";
import {mkdirSync} from "node:fs";

const require = createRequire(import.meta.url);
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || "playwright");

const BASE = process.env.E2E_BASE || "http://127.0.0.1:8100";
const OUT = process.env.E2E_OUT || "e2e-out";
mkdirSync(OUT, {recursive: true});

const A = "069a79f4-44e9-4726-a5be-fca90e38aaf5";
const B = "853c80ef-3c37-49fd-aa49-938b674adae6";

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

await step("player joins -> marker with 3d placeholder in the original marker-scene", async () => {
    await control({uuid: A, name: "Alice", x: 10, y: 64, z: 24, yaw: 0, pitch: 0});
    await page.waitForFunction(uuid => !!window.bluemap.playerMarkerManager?.getPlayerMarkerSet(false)?.getPlayerMarker(uuid), A, {timeout: 5000});
    const m = await marker(A);
    assert.ok(near(m.x, 10) && near(m.y, 65.8) && near(m.z, 24), `position ${m.x},${m.y},${m.z}`);
    assert.equal(m.modelInMarker, true);
    assert.equal(m.meshes, 3);
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
        window.bluemap.mapViewer.markers.traverse(o => { if (o.name === "bm-player-placeholder-model") n++; });
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

await step("close-up: placeholder-models with rotation, one partly behind the pillar", async () => {
    await control({uuid: A, name: "Alice", x: 20.4, y: 64, z: 14.5, yaw: 200, bodyYaw: 180, pitch: 0});
    await control({uuid: B, x: 13.5, y: 64, z: 22.5, yaw: -60, bodyYaw: -30, pitch: 35});
    await page.goto(`${BASE}/#world:17:64:19:12:0.35:1.1:0:0:perspective`);
    await page.waitForFunction(() => window.bluemap?.mapViewer?.map?.isLoaded, null, {timeout: 60000});
    await page.waitForFunction(() => [...window.bluemap.mapViewer.map.hiresTileManager.tiles.values()].some(t => t.model), null, {timeout: 60000});
    await page.waitForFunction(uuids => uuids.every(u => !!window.bluemap.playerMarkerManager?.getPlayerMarkerSet(false)?.getPlayerMarker(u)), [A, B], {timeout: 5000});
    await sleep(1500);
    await page.screenshot({path: `${OUT}/04-closeup.png`});
});

await step("no uncaught errors in the page", async () => {
    assert.deepEqual(pageErrors, []);
});

await browser.close();

const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} steps passed`);
process.exit(failed.length ? 1 : 0);
