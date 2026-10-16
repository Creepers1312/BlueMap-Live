// BlueMap Live – browser end-to-end test for the live block-changes (tiles rendered again are loaded again)
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

const requests = [];
page.on("request", request => {
    const url = request.url();
    if (url.includes("/tiles/")) requests.push({url, time: Date.now()});
});

/** the max height of the loaded hires-tile 0,0 (the pillar of the test-tile), null if not loaded */
const tileTop = () => page.evaluate(() => {
    const manager = window.bluemap.mapViewer.map.hiresTileManager;
    const tile = [...manager.tiles.values()].find(t => t.x === 0 && t.z === 0);
    if (!tile || !tile.model) return null;
    tile.model.geometry.computeBoundingBox();
    return tile.model.geometry.boundingBox.max.y;
});

// --- load the original webapp close to the test-tile ---
// lowres-tiles of the test-tile (empty images), so their reload can be seen
await control({lowresTiles: 1});
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



await step("hires-tile 0,0 is loaded, live/tiles.json is requested", async () => {
    await page.waitForFunction(() => {
        const tile = [...window.bluemap.mapViewer.map.hiresTileManager.tiles.values()].find(t => t.x === 0 && t.z === 0);
        return tile && tile.model;
    }, null, {timeout: 20000});
    assert.equal(await tileTop(), 70);
    await page.waitForFunction(() => window.bluemap.liveTileUpdater && window.bluemap.liveTileUpdater.lastId !== null, null, {timeout: 10000});
});

await step("a changed tile is loaded again within seconds, without a gap (the old model stays until the new one is there)", async () => {
    const gaps = page.evaluate(() => new Promise(resolve => {
        let missing = 0;
        const end = performance.now() + 5000;
        const frame = () => {
            const tile = [...window.bluemap.mapViewer.map.hiresTileManager.tiles.values()].find(t => t.x === 0 && t.z === 0);
            if (!tile || !tile.model) missing++;
            if (performance.now() < end) requestAnimationFrame(frame); else resolve(missing);
        };
        requestAnimationFrame(frame);
    }));
    const start = Date.now();
    await control({tileUpdate: "0,0", pillar: 78});
    await page.waitForFunction(() => {
        const tile = [...window.bluemap.mapViewer.map.hiresTileManager.tiles.values()].find(t => t.x === 0 && t.z === 0);
        if (!tile || !tile.model) return false;
        tile.model.geometry.computeBoundingBox();
        return tile.model.geometry.boundingBox.max.y === 78;
    }, null, {timeout: 6000});
    const took = Date.now() - start;
    assert.ok(took < 4000, "reloaded after " + took + " ms");
    assert.equal(await gaps, 0, "frames without the tile");
    const live = requests.filter(r => r.url.includes("tiles/0/x0/z0.prbm?live"));
    assert.equal(live.length, 1, "requested once with a new cache-hash: " + live.map(r => r.url));
    await page.screenshot({path: `${OUT}/b01-reloaded.png`});
});

await step("the same change is not loaded twice; a tile that is not loaded is not requested", async () => {
    await control({tileUpdate: "40,40"});
    await sleep(3000);
    assert.equal(requests.filter(r => r.url.includes("?live")).length, 1);
    assert.equal(requests.filter(r => r.url.includes("x40")).length, 0);
});

await step("lowres-tiles are loaded again when their change was saved", async () => {
    const before = requests.length;
    await control({tileUpdate: "0,0", lowres: 1});
    await sleep(3000);
    const lowres = requests.slice(before).filter(r => /tiles\/[123]\/x0\/z0\.png\?live/.test(r.url)).map(r => r.url.replace(/^.*tiles\//, ""));
    assert.ok(lowres.length >= 1, "lowres requested again: " + JSON.stringify(requests.slice(before).map(r => r.url.replace(/^.*tiles\//, ""))));
});

await step("after a map-switch the changed tile is loaded with its new cache-hash (not the old one from the browser-cache)", async () => {
    await page.evaluate(() => window.bluemap.switchMap("world_the_nether", false));
    await sleep(1000);
    const before = requests.length;
    await page.evaluate(() => window.bluemap.switchMap("world", false));
    await page.waitForFunction(() => {
        const tile = [...window.bluemap.mapViewer.map.hiresTileManager.tiles.values()].find(t => t.x === 0 && t.z === 0);
        return tile && tile.model;
    }, null, {timeout: 20000});
    const again = requests.slice(before).filter(r => r.url.includes("tiles/0/x0/z0.prbm"));
    assert.ok(again.length >= 1 && again.every(r => r.url.includes("?live")), JSON.stringify(again.map(r => r.url)));
    assert.equal(await tileTop(), 78);
});

await step("opening the map: earlier changes are not loaded again (the tiles are current)", async () => {
    await page.reload();
    await page.waitForFunction(() => window.bluemap?.mapViewer?.map?.isLoaded, null, {timeout: 60000});
    const start = Date.now();
    await page.waitForFunction(() => window.bluemap.liveTileUpdater && window.bluemap.liveTileUpdater.lastId !== null, null, {timeout: 10000});
    await sleep(3000);
    assert.equal(requests.filter(r => r.time >= start && r.url.includes("?live")).length, 0);
    assert.equal(await page.evaluate(() => window.bluemap.liveTileUpdater.reloaded), 0);
});

// --- chests ---

const lids = () => page.evaluate(() => {
    const mgr = window.bluemap.entityMarkerManager;
    return [...mgr.chestLids.lids.values()].map(lid => ({key: lid.container.position.x + "," + lid.container.position.y + "," +
        lid.container.position.z, mesh: !!lid.mesh, pitch: lid.pivot.rotation.x, progress: lid.progress, texture: lid.entry && lid.entry.key}));
});
const hiddenBoxes = () => page.evaluate(() => window.bluemap.mapViewer.data.uniforms.hiddenBoxCount.value);

/** the screen-position of a world-position */
const screen = (x, y, z) => page.evaluate(([x, y, z]) => {
    const mv = window.bluemap.mapViewer;
    mv.camera.updateMatrixWorld();
    const rect = mv.renderer.domElement.getBoundingClientRect();
    const ndc = new window.BlueMap.Three.Vector3(x, y, z).project(mv.camera);
    return {x: rect.left + (ndc.x + 1) / 2 * rect.width, y: rect.top + (1 - ndc.y) / 2 * rect.height};
}, [x, y, z]);

await step("opened chest: the vanilla lid opens in 10 ticks with the chest-texture, the tile-lid is hidden", async () => {
    await control({container: "8,64,10", texture: "minecraft:entity/chest/normal", facing: "south"});
    await page.waitForFunction(() => {
        const lid = [...window.bluemap.entityMarkerManager.chestLids.lids.values()][0];
        return lid && lid.mesh && lid.progress === 1;
    }, null, {timeout: 8000});
    const [lid] = await lids();
    assert.equal(lid.key, "8,64,10");
    assert.ok(Math.abs(lid.pitch + Math.PI / 2) < 1e-6, "fully open: " + lid.pitch);
    assert.equal(await hiddenBoxes(), 2);
    await sleep(200);
    const png = decodePng(await page.screenshot({path: `${OUT}/b10-chest-open.png`}));
    // the open lid stands up above the back of the chest (z 1/16), its color is the test-texture
    const p = await screen(8.5, 64 + 15 / 16, 10 + 3 / 16);
    let colored = 0;
    for (let y = p.y - 25; y < p.y + 25; y++) for (let x = p.x - 25; x < p.x + 25; x++) {
        const [r, g, b] = png.pixel(x, y);
        if (r > g + 30 && g > b + 15) colored++;
    }
    assert.ok(colored > 50, "lid pixels: " + colored);
});

await step("closed chest: the lid closes, then it is removed and the tile-lid is shown again", async () => {
    await control({closeContainer: "8,64,10"});
    await page.waitForFunction(() => window.bluemap.entityMarkerManager.chestLids.lids.size === 0, null, {timeout: 8000});
    assert.equal(await hiddenBoxes(), 0);
    assert.equal(await page.evaluate(() => window.bluemap.entityMarkerManager.itemCache.textures.entries.has("minecraft:entity/chest/normal")), false,
        "the texture is released");
});

await step("double chest (both halves) and an ender chest", async () => {
    await control({container: "8,64,12", texture: "minecraft:entity/chest/normal_left", facing: "east", part: "left"});
    await control({container: "8,64,13", texture: "minecraft:entity/chest/normal_right", facing: "east", part: "right"});
    await control({container: "10,64,12", texture: "minecraft:entity/chest/ender", facing: "north"});
    await page.waitForFunction(() => [...window.bluemap.entityMarkerManager.chestLids.lids.values()].filter(l => l.mesh && l.progress === 1).length === 3,
        null, {timeout: 8000});
    assert.deepEqual((await lids()).map(l => l.texture.replace("minecraft:entity/chest/", "")).sort(), ["ender", "normal_left", "normal_right"]);
    assert.equal(await hiddenBoxes(), 6);
    await page.screenshot({path: `${OUT}/b11-double-ender.png`});
    for (const c of ["8,64,12", "8,64,13", "10,64,12"]) await control({closeContainer: c});
    await page.waitForFunction(() => window.bluemap.entityMarkerManager.chestLids.lids.size === 0, null, {timeout: 8000});
});

await step("no uncaught errors", async () => {
    assert.deepEqual(pageErrors, []);
});

await browser.close();

const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} steps passed`);
process.exit(failed.length ? 1 : 0);
