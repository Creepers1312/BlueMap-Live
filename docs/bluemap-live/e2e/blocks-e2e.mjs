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

// --- block-previews ---

const previews = () => page.evaluate(() => {
    const mgr = window.bluemap.entityMarkerManager;
    return {count: mgr.blockPreviews.previews.size, meshes: mgr.blockView.meshes.length,
        hidden: window.bluemap.mapViewer.data.uniforms.hiddenBlockCount.value};
});

/** pixels close to the orange of the test-stone around a world-position */
async function orangeAt(name, x, y, z, radius = 20) {
    const png = decodePng(await page.screenshot({path: `${OUT}/${name}.png`}));
    const p = await screen(x, y, z);
    let count = 0;
    for (let py = p.y - radius; py < p.y + radius; py++) for (let px = p.x - radius; px < p.x + radius; px++) {
        const [r, g, b] = png.pixel(px, py);
        if (r > 120 && g > 30 && g < r * 0.75 && b < 60) count++;
    }
    return count;
}

await step("placed block: the preview is drawn at once (block-model from the resource-pack), before the tile is rendered", async () => {
    const before = await orangeAt("b20-before", 6.5, 64.5, 8.5);
    const start = Date.now();
    await control({block: "6,64,8", state: "minecraft:stone", n: "minecraft:grass_block,-,-,-,-,-"});
    await page.waitForFunction(() => window.bluemap.entityMarkerManager.blockView.meshes.length > 0, null, {timeout: 5000});
    const took = Date.now() - start;
    await sleep(200);
    const after = await orangeAt("b21-placed", 6.5, 64.5, 8.5);
    assert.ok(took < 1500, "shown after " + took + " ms");
    assert.ok(after > before + 100, `stone pixels: ${before} -> ${after}`);
    const state = await previews();
    assert.deepEqual([state.count, state.hidden], [1, 1]);
    assert.ok(state.meshes >= 1, "the stone (and the grass-face below it: the test-models have no cullfaces)");
});

await step("removed block: the block is hidden in the tile, the face of the neighbor below is drawn in the hole", async () => {
    const before = await orangeAt("b22-before", 9.5, 64, 11.5, 45);
    await control({block: "9,63,11", state: "minecraft:air", n: "minecraft:stone,-,-,-,-,-"});
    await page.waitForFunction(() => window.bluemap.entityMarkerManager.blockPreviews.previews.size === 2, null, {timeout: 5000});
    await sleep(300);
    const after = await orangeAt("b23-removed", 9.5, 64, 11.5, 45);
    assert.equal((await previews()).hidden, 2);
    assert.ok(after > before + 30, `the stone-face below in the hole: ${before} -> ${after}`);
});

await step("a rendered tile from older chunk-data does not confirm the previews", async () => {
    await control({tileUpdate: "0,0", chunks: "0,0,1000000000"});
    await sleep(3000);
    assert.equal((await previews()).count, 2);
});

await step("the rendered tile with the changes confirms the previews: removed after the tile was loaded again", async () => {
    await control({tileUpdate: "0,0", chunks: "0,0,now"});
    await page.waitForFunction(() => window.bluemap.entityMarkerManager.blockPreviews.previews.size === 0, null, {timeout: 6000});
    await sleep(100);
    assert.deepEqual(await previews(), {count: 0, meshes: 0, hidden: 0});
});

/** pixels of the magenta lid of the test-chest (block-model) around a world-position */
async function chestLidAt(name, x, y, z, radius = 20) {
    const png = decodePng(await page.screenshot({path: `${OUT}/${name}.png`}));
    const p = await screen(x, y, z);
    let count = 0;
    for (let py = p.y - radius; py < p.y + radius; py++) for (let px = p.x - radius; px < p.x + radius; px++) {
        const [r, g, b] = png.pixel(px, py);
        if (r > 120 && b > 120 && g < r * 0.5 && g < b * 0.5) count++;
    }
    return count;
}

await step("a placed chest (still a preview) is opened: the closed lid of the preview is hidden like in the tile", async () => {
    await control({block: "13,64,6", state: "minecraft:chest", n: "minecraft:grass_block,-,-,-,-,-"});
    await page.waitForFunction(() => window.bluemap.entityMarkerManager.blockView.meshes.length > 0, null, {timeout: 5000});
    await sleep(200);
    const closed = await chestLidAt("b26-chest-preview", 13.5, 64 + 13 / 16, 6.5);
    assert.ok(closed > 100, "the closed lid of the preview: " + closed);
    await control({container: "13,64,6", texture: "minecraft:entity/chest/normal", facing: "south"});
    await page.waitForFunction(() => {
        const lid = [...window.bluemap.entityMarkerManager.chestLids.lids.values()][0];
        return lid && lid.mesh && lid.progress === 1;
    }, null, {timeout: 8000});
    await sleep(200);
    const open = await chestLidAt("b27-chest-preview-open", 13.5, 64 + 13 / 16, 6.5);
    assert.ok(open < closed * 0.2, `closed lid pixels: ${closed} -> ${open}`);
    await control({closeContainer: "13,64,6"});
    await page.waitForFunction(() => window.bluemap.entityMarkerManager.chestLids.lids.size === 0, null, {timeout: 8000});
    assert.ok(await chestLidAt("b28-chest-preview-closed", 13.5, 64 + 13 / 16, 6.5) > closed * 0.8, "the closed lid is shown again");
    await page.evaluate(() => window.bluemap.entityMarkerManager.blockPreviews.previews.forEach(p => p.added -= 1801000));
    await page.waitForFunction(() => window.bluemap.entityMarkerManager.blockPreviews.previews.size === 0, null, {timeout: 3000});
});

await step("previews are one-sided like the tiles: from inside a previewed block the camera looks through it", async () => {
    await control({block: "8,64,9", state: "minecraft:stone"});
    await page.waitForFunction(() => window.bluemap.entityMarkerManager.blockPreviews.previews.has("8,64,9"), null, {timeout: 5000});
    await sleep(300);
    const outside = await orangeAt("b29-preview-outside", 8.5, 64.5, 9.5, 40);
    // the camera in the middle of the block (free flight)
    await page.evaluate(() => { window.location.hash = "#world:8.5:64.5:9.5:0:0:1.2:0:0:free"; });
    await sleep(800);
    const png = decodePng(await page.screenshot({path: `${OUT}/b30-preview-inside.png`}));
    let inside = 0;
    for (let y = 300; y < 500; y++) for (let x = 540; x < 740; x++) {
        const [r, g, b] = png.pixel(x, y);
        if (r > 120 && g > 30 && g < r * 0.75 && b < 60) inside++;
    }
    await page.evaluate(() => { window.location.hash = "#world:8.5:64.5:9.5:6:0:1.2:0:0:perspective"; });
    await sleep(800);
    assert.ok(outside > 100, "seen from outside: " + outside);
    assert.ok(inside < 2000, "the inside faces (back-faces) are not drawn: " + inside + " of 40000 pixels");
    await page.evaluate(() => window.bluemap.entityMarkerManager.blockPreviews.previews.forEach(p => p.added -= 1801000));
    await page.waitForFunction(() => window.bluemap.entityMarkerManager.blockPreviews.previews.size === 0, null, {timeout: 3000});
});

await step("a preview without a render of its tile stays after 90 s (e.g. the game is paused), it is discarded after 30 min", async () => {
    await control({block: "7,64,6", state: "minecraft:stone"});
    await page.waitForFunction(() => window.bluemap.entityMarkerManager.blockPreviews.previews.size === 1, null, {timeout: 5000});
    await page.evaluate(() => window.bluemap.entityMarkerManager.blockPreviews.previews.forEach(p => p.added -= 91000));
    await sleep(500);
    assert.equal((await previews()).count, 1, "still shown after 90 s");
    await page.evaluate(() => window.bluemap.entityMarkerManager.blockPreviews.previews.forEach(p => p.added -= 1801000));
    await page.waitForFunction(() => window.bluemap.entityMarkerManager.blockPreviews.previews.size === 0, null, {timeout: 3000});
    assert.equal((await previews()).hidden, 0);
});

await step("a block without a preview (water: no model) keeps the old block in the tile instead of a flickering hole", async () => {
    await control({block: "12,63,12", state: "minecraft:water[level=0]"});
    await page.waitForFunction(() => window.bluemap.entityMarkerManager.blockPreviews.previews.size === 1, null, {timeout: 5000});
    await sleep(1500); // the model is requested (and not found)
    assert.equal((await previews()).hidden, 0, "not hidden while nothing is drawn");
    await control({block: "12,63,12", state: "minecraft:air"});
    await page.waitForFunction(() => window.bluemap.mapViewer.data.uniforms.hiddenBlockCount.value === 1, null, {timeout: 5000});
    await page.evaluate(() => window.bluemap.entityMarkerManager.blockPreviews.previews.forEach(p => p.added -= 1801000));
    await page.waitForFunction(() => window.bluemap.entityMarkerManager.blockPreviews.previews.size === 0, null, {timeout: 3000});
});

/** the mean brightness (r + g + b) of the top-face of a block */
async function topBrightness(name, x, y, z) {
    const png = decodePng(await page.screenshot({path: `${OUT}/${name}.png`}));
    const p = await screen(x + 0.5, y + 1, z + 0.5);
    let sum = 0, n = 0;
    for (let py = p.y - 3; py <= p.y + 3; py++) for (let px = p.x - 3; px <= p.x + 3; px++) {
        const [r, g, b] = png.pixel(px, py);
        sum += r + g + b;
        n++;
    }
    return sum / n;
}

await step("the previews are lit like the tiles: sky- and block-light of the server, light-emitting previews light the map", async () => {
    await control({dayTime: 18000, cycle: 0});
    await control({uuid: "069a79f4-44e9-4726-a5be-fca90e38aaf5", name: "Notch", x: 20, y: 64, z: 20});
    await page.waitForFunction(() => window.bluemap.appState.worldTime.available, null, {timeout: 10000});
    await page.evaluate(() => window.bluemap.setWorldTimeLighting(true));
    const n = "minecraft:grass_block,-,-,-,-,-";
    await control({block: "5,64,8", state: "minecraft:stone", n, sky: 15, blockLight: 0, luminance: 0});
    await control({block: "8,64,8", state: "minecraft:stone", n, sky: 0, blockLight: 0, luminance: 0});
    await page.waitForFunction(() => window.bluemap.entityMarkerManager.blockPreviews.previews.size === 2, null, {timeout: 5000});
    await sleep(500);
    const outdoors = await topBrightness("b30-outdoors", 5, 64, 8), cave = await topBrightness("b30-cave", 8, 64, 8);
    assert.ok(outdoors > cave * 2, `outdoors ${outdoors} > cave ${cave} (only the ambient light)`);

    await control({block: "11,64,8", state: "minecraft:stone", n, sky: 15, blockLight: 14, luminance: 14});
    await page.waitForFunction(() => window.bluemap.mapViewer.data.uniforms.dynamicLightCount.value >= 1, null, {timeout: 5000});
    await sleep(500);
    const lit = await topBrightness("b31-torch", 8, 64, 8);
    assert.ok(lit > cave * 2, `the cave-block 3 blocks from the light-emitting preview: ${cave} -> ${lit}`);

    // rendered: the tile has the block-light, the dynamic light is removed with the previews
    await control({tileUpdate: "0,0", chunks: "0,0,now"});
    await page.waitForFunction(() => window.bluemap.entityMarkerManager.blockPreviews.previews.size === 0, null, {timeout: 6000});
    await sleep(300);
    assert.equal(await page.evaluate(() => window.bluemap.mapViewer.data.uniforms.dynamicLightCount.value), 0);
    await page.evaluate(() => window.bluemap.setWorldTimeLighting(false));
});

await step("no uncaught errors", async () => {
    assert.deepEqual(pageErrors, []);
});

await browser.close();

const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} steps passed`);
process.exit(failed.length ? 1 : 0);
