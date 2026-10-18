// BlueMap Live – browser end-to-end test for the live entities (dropped items, thrown items, arrows)
// (NOT part of the BlueMap build). Drives the ORIGINAL built BlueMap webapp in Chromium against LiveE2EServer.
// Usage: see docs/bluemap-live/e2e/README.md (restart the server before every run)

import {createRequire} from "node:module";
import assert from "node:assert/strict";
import {mkdirSync} from "node:fs";
import {inflateSync} from "node:zlib";

const require = createRequire(import.meta.url);
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || "playwright");

const BASE = process.env.E2E_BASE || "http://127.0.0.1:8100";
const OUT = process.env.E2E_OUT || "e2e-out";
mkdirSync(OUT, {recursive: true});

// the colors of E2EItemResources (rgb)
const COLORS = {diamond: [128, 128, 255], snowball: [128, 255, 255], arrow: [255, 128, 192]};

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
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
const page = await browser.newPage({viewport: {width: 1280, height: 800}});
// these steps check the movement itself: the samples are applied when they arrive (no playback-buffer,
// see playback-e2e.mjs for the buffer)
await page.addInitScript(() => {
    const off = setInterval(() => {
        if (!window.bluemap?.setLivePlaybackDelay) return;
        window.bluemap.setLivePlaybackDelay(0);
        clearInterval(off);
    }, 5);
});

const pageErrors = [];
page.on("pageerror", e => pageErrors.push(e.message));
page.on("console", msg => {
    if (msg.type() === "error" && !msg.text().includes("404") && !msg.text().includes("Failed to load resource")) {
        pageErrors.push(msg.text());
    }
});

const entityExpr = (id, expr) => page.evaluate(([id, expr]) => {
    const set = window.bluemap.mapViewer.markers.markerSets.get("bm-entities");
    const m = set?.markers.get("bm-entity-" + id);
    return m ? new Function("m", `return (${expr});`)(m) : null;
}, [id, expr]);

const waitForEntity = (id, expr, timeout = 10000) => page.waitForFunction(([id, expr]) => {
    const set = window.bluemap.mapViewer.markers.markerSets.get("bm-entities");
    const m = set?.markers.get("bm-entity-" + id);
    return !!m && new Function("m", `return (${expr});`)(m);
}, [id, expr], {timeout});

const meshes = "(() => { let n = 0; m.traverse(o => { if (o.isMesh) n++; }); return n; })()";

const sample = (id, ms, expr) => page.evaluate(([id, ms, expr]) => new Promise(resolve => {
    const get = new Function("m", `return (${expr});`);
    const values = [];
    const end = performance.now() + ms;
    const frame = () => {
        const m = window.bluemap.mapViewer.markers.markerSets.get("bm-entities")?.markers.get("bm-entity-" + id);
        if (m) values.push(get(m));
        if (performance.now() < end) requestAnimationFrame(frame); else resolve(values);
    };
    requestAnimationFrame(frame);
}), [id, ms, expr]);

const project = id => page.evaluate(id => {
    const mv = window.bluemap.mapViewer;
    const m = mv.markers.markerSets.get("bm-entities").markers.get("bm-entity-" + id);
    m.updateMatrixWorld(true);
    mv.camera.updateMatrixWorld();
    const rect = mv.renderer.domElement.getBoundingClientRect();
    const V = window.BlueMap.Three.Vector3;
    const ndc = m.view.content.localToWorld(new V(0.5, 0.5, 0.5)).project(mv.camera);
    return {x: rect.left + (ndc.x + 1) / 2 * rect.width, y: rect.top + (1 - ndc.y) / 2 * rect.height};
}, id);

// screenshot decoding (same decoder as player-e2e.mjs)
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

async function countColor(name, center, color, radius = 60) {
    const png = decodePng(await page.screenshot({path: `${OUT}/${name}.png`}));
    const length = Math.hypot(...color);
    let count = 0;
    for (let y = Math.max(0, center.y - radius); y < Math.min(png.height, center.y + radius); y++) {
        for (let x = Math.max(0, center.x - radius); x < Math.min(png.width, center.x + radius); x++) {
            const p = png.pixel(x, y);
            const l = Math.hypot(...p);
            if (l < 60) continue;
            if ((p[0] * color[0] + p[1] * color[1] + p[2] * color[2]) / (l * length) > 0.985) count++;
        }
    }
    return count;
}

const itemCacheIds = () => page.evaluate(() => [...window.bluemap.entityMarkerManager.itemCache.entries.keys()].sort());

// --- load the original webapp close to the test-tile ---
await page.goto(`${BASE}/#world:8.5:64.5:9.5:6:0:1.2:0:0:perspective`);
await page.waitForFunction(() => window.bluemap?.mapViewer?.map?.isLoaded, null, {timeout: 60000});
await page.evaluate(() => window.__bmLiveNoReload = true);
// the camera may still be adjusted to the terrain after loading: wait until it stands still (stable pixel-tests)
await page.evaluate(() => new Promise(resolve => {
    let last = "", stable = 0;
    const check = () => {
        const p = window.bluemap.mapViewer.camera.position.toArray().map(v => v.toFixed(3)).join();
        stable = p === last ? stable + 1 : 0;
        last = p;
        if (stable >= 5) resolve(); else setTimeout(check, 200);
    };
    check();
}));

await step("no entities: an empty entity-set, nothing loaded", async () => {
    await page.waitForFunction(() => window.bluemap.entityMarkerManager?.getEntityMarkerSet(false), null, {timeout: 10000});
    assert.equal(await page.evaluate(() => window.bluemap.entityMarkerManager.getEntityMarkerSet(false).markers.size), 0);
    assert.deepEqual(await itemCacheIds(), []);
});

await step("dropped item: item-model with the ground-transformation, bobbing and rotating (pixels)", async () => {
    await control({entity: 1, type: "minecraft:item", x: 8.5, y: 64, z: 10, item: "minecraft:diamond", ground: 1});
    await waitForEntity(1, meshes + " > 0");
    await sleep(800);
    assert.ok(await countColor("30-dropped-item", await project(1), COLORS.diamond) > 20, "diamond pixels");
    const heights = await sample(1, 1500, "m.body.position.y");
    const rotations = await sample(1, 300, "m.body.rotation.y");
    assert.ok(Math.max(...heights) - Math.min(...heights) > 0.02, "bobbing");
    assert.ok(rotations.at(-1) > rotations[0], "rotating");
    assert.equal(await entityExpr(1, "m.data.listed"), false, "not listed in the marker-menu");
    // vanilla ground-transformation of item/generated: scale 0.5 (a 16 px item is half a block)
    assert.deepEqual(await entityExpr(1, "m.view.scale.toArray()"), [0.5, 0.5, 0.5], "ground-scale");
    const url = await page.evaluate(() => [...window.bluemap.entityMarkerManager.itemCache.entries.values()][0].url);
    assert.match(url, /diamond\.json\?v=\d+$/, "asset-url with version (no stale browser-cache after updates)");
});

await step("markers.json-updates (every 10 s) keep the entity-set and its markers", async () => {
    await page.evaluate(() => window.__entityBefore = window.bluemap.mapViewer.markers.markerSets.get("bm-entities").markers.get("bm-entity-1"));
    await page.evaluate(() => window.bluemap.markerFileManager.update());
    await sleep(300);
    const same = await page.evaluate(() => window.bluemap.mapViewer.markers.markerSets.get("bm-entities")?.markers.get("bm-entity-1") === window.__entityBefore);
    assert.equal(same, true, "the same marker (not removed and recreated)");
});

await step("moving entity is interpolated, a far jump is not", async () => {
    await control({entity: 1, type: "minecraft:item", x: 9.5, y: 64, z: 10, item: "minecraft:diamond"});
    const xs = await sample(1, 800, "m.position.x");
    assert.ok(xs.some(x => x > 8.55 && x < 9.45), "in between");
    await waitForEntity(1, "Math.abs(m.position.x - 9.5) < 1e-6");
    await control({entity: 1, type: "minecraft:item", x: 90, y: 64, z: 10, item: "minecraft:diamond"});
    const jump = await sample(1, 600, "m.position.x");
    assert.ok(!jump.some(x => x > 10 && x < 89), "no flight over the map");
    await control({entity: 1, type: "minecraft:item", x: 8.5, y: 64, z: 10, item: "minecraft:diamond"});
});

await step("thrown item (snowball) faces the camera, fireballs are bigger", async () => {
    // one sample at rest (a single sample of a flying snowball would fall below the ground within the prediction-time)
    await control({entity: 2, type: "minecraft:snowball", x: 7.5, y: 65, z: 11, item: "minecraft:snowball", ground: 1});
    await waitForEntity(2, meshes + " > 0");
    await sleep(500);
    const angle = await page.evaluate(() => {
        const m = window.bluemap.mapViewer.markers.markerSets.get("bm-entities").markers.get("bm-entity-2");
        return m.body.quaternion.angleTo(window.bluemap.mapViewer.camera.quaternion);
    });
    assert.ok(angle < 1e-3, `billboard (${angle})`);
    assert.ok(await countColor("31-snowball", await project(2), COLORS.snowball) > 10, "snowball pixels");
    await control({entity: 3, type: "minecraft:fireball", x: 6, y: 66, z: 12, item: "minecraft:snowball"});
    await waitForEntity(3, "m.body.scale.x === 3");
});

/** the direction of the vanilla arrow-model (along its +x) in world-space */
const arrowAxis = id => entityExpr(id, `(() => {
    m.updateMatrixWorld(true);
    const V = window.BlueMap.Three.Vector3;
    const back = m.view.content.localToWorld(new V(0.5, 0.5, 0.5)), front = m.view.content.localToWorld(new V(1.5, 0.5, 0.5));
    return front.sub(back).normalize().toArray();
})()`);

await step("arrow: vanilla arrow-model (entity-asset with the pack-texture), rotated along the flight", async () => {
    await control({entity: 4, type: "minecraft:arrow", x: 9, y: 65, z: 10.5, vx: 40, vy: 0, vz: 0});
    await waitForEntity(4, meshes + " > 0");
    const kind = await entityExpr(4, "[m.kind, m.view.itemId, m.view.entry.models[0].type]");
    assert.deepEqual(kind, ["arrow", "minecraft:arrow", "arrow"]);
    await control({entity: 4, type: "minecraft:arrow", x: 9, y: 65, z: 10.5, ground: 1, yaw: 90, pitch: 0}); // stuck along +x
    await waitForEntity(4, "!m.predicting");
    const axis = await arrowAxis(4);
    assert.ok(axis[0] > 0.99, `along +x: ${axis}`);
    await sleep(500);
    assert.ok(await countColor("34-arrow", await project(4), COLORS.arrow, 80) > 5, "arrow-texture pixels");
});

await step("flying arrow is predicted smoothly between the samples (no still frames), resting arrows stay", async () => {
    // fired along +x: 2 blocks per tick, one sample only (like the 250 ms sampling of the server)
    await control({removeEntity: 4});
    await page.waitForFunction(() => !window.bluemap.mapViewer.markers.markerSets.get("bm-entities").markers.has("bm-entity-4"), null, {timeout: 10000});
    await control({entity: 5, type: "minecraft:arrow", x: 0, y: 70, z: 10, vx: 40, vy: 10, vz: 0});
    await waitForEntity(5, "m.predicting");
    const xs = await sample(5, 400, "m.position.x");
    const distinct = new Set(xs.map(x => x.toFixed(3))).size;
    assert.ok(distinct >= Math.min(6, xs.length - 1), `moves every frame: ${distinct} positions in ${xs.length} frames`);
    assert.ok(Math.max(...xs) > 3, "flies on between the samples");
    const axis = await arrowAxis(5);
    assert.ok(axis[0] > 0.8, `points along the flight: ${axis}`);

    // lands: resting where the server says
    await control({entity: 5, type: "minecraft:arrow", x: 12, y: 66, z: 10, ground: 1, yaw: 90, pitch: -20});
    await waitForEntity(5, "!m.predicting");
    await sleep(800);
    const rest = await entityExpr(5, "m.position.toArray()");
    assert.ok(Math.abs(rest[0] - 12) < 1e-3 && Math.abs(rest[1] - 66) < 1e-3, `rests at ${rest}`);
    await control({removeEntity: 5});
});

await step("a flying arrow stops at the impact predicted by the server (no flight through the block)", async () => {
    await control({entity: 6, type: "minecraft:arrow", x: 2, y: 66, z: 10, vx: 40, vy: 0, vz: 0, impact: "6,65.9,10,2"});
    await waitForEntity(6, "m.predicting");
    const xs = await sample(6, 600, "m.position.x");
    assert.ok(Math.max(...xs) <= 6 + 1e-6, `never behind the block: max x ${Math.max(...xs)}`);
    await waitForEntity(6, "m.impacted && Math.abs(m.position.x - 6) < 1e-3");
    await control({removeEntity: 6});
});

await step("removed entities disappear and release their items, shared items stay", async () => {
    assert.deepEqual(await itemCacheIds(), ["minecraft:diamond", "minecraft:snowball"]);
    await control({removeEntity: 2});
    await control({removeEntity: 3});
    await page.waitForFunction(() => !window.bluemap.mapViewer.markers.markerSets.get("bm-entities").markers.has("bm-entity-2"), null, {timeout: 10000});
    await page.waitForFunction(() => !window.bluemap.mapViewer.markers.markerSets.get("bm-entities").markers.has("bm-entity-3"), null, {timeout: 10000});
    assert.deepEqual(await itemCacheIds(), ["minecraft:diamond"], "snowball released");
});

await step("the entity-set can be hidden like other marker-sets", async () => {
    await page.evaluate(() => window.bluemap.mapViewer.markers.markerSets.get("bm-entities").visible = false);
    await sleep(800);
    assert.equal(await countColor("32-hidden", await project(1), COLORS.diamond), 0);
    await page.evaluate(() => window.bluemap.mapViewer.markers.markerSets.get("bm-entities").visible = true);
    await sleep(800);
    assert.ok(await countColor("33-shown", await project(1), COLORS.diamond) > 20);
});

await step("map-switch: entities of the other map, old resources disposed, no duplicate sets, no reload", async () => {
    await page.evaluate(() => window.__oldEntityManager = window.bluemap.entityMarkerManager);
    await page.evaluate(() => window.bluemap.switchMap("world_the_nether", false));
    await page.waitForFunction(() => window.bluemap.entityMarkerManager !== window.__oldEntityManager, null, {timeout: 10000});
    await sleep(1000);
    const nether = await page.evaluate(() => ({
        markers: window.bluemap.mapViewer.markers.markerSets.get("bm-entities")?.markers.size ?? 0,
        oldDisposed: window.__oldEntityManager.disposed && window.__oldEntityManager.itemCache.entries.size === 0,
    }));
    assert.deepEqual(nether, {markers: 0, oldDisposed: true});

    await page.evaluate(() => window.bluemap.switchMap("world", false));
    await waitForEntity(1, meshes + " > 0");
    const sets = await page.evaluate(() => { let n = 0; window.bluemap.mapViewer.markers.traverse(o => { if (o.data?.id === "bm-entities") n++; }); return n; });
    assert.equal(sets, 1);
    assert.equal(await page.evaluate(() => window.__bmLiveNoReload), true);
});

await step("no uncaught errors", async () => {
    assert.deepEqual(pageErrors, []);
});

await browser.close();

const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} steps passed`);
process.exit(failed.length ? 1 : 0);
