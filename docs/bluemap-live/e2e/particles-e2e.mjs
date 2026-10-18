// BlueMap Live – browser end-to-end test for the particles and effects (explosions, potions, clouds, fire)
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


const manager = expr => page.evaluate(expr => new Function("mgr", `return (${expr});`)(window.bluemap.entityMarkerManager), expr);
const particleCount = () => manager("mgr.particleSystem.count");
const waitFor = (expr, timeout = 10000) => page.waitForFunction(expr => {
    const mgr = window.bluemap.entityMarkerManager;
    return mgr && new Function("mgr", `return (${expr});`)(mgr);
}, expr, {timeout});

/** the screen-position of a world-position */
const screen = (x, y, z) => page.evaluate(([x, y, z]) => {
    const mv = window.bluemap.mapViewer;
    mv.camera.updateMatrixWorld();
    const rect = mv.renderer.domElement.getBoundingClientRect();
    const ndc = new window.BlueMap.Three.Vector3(x, y, z).project(mv.camera);
    return {x: rect.left + (ndc.x + 1) / 2 * rect.width, y: rect.top + (1 - ndc.y) / 2 * rect.height};
}, [x, y, z]);

/** pixels close to a color (with any brightness) */
async function countColor(name, center, color, radius = 120) {
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

/** gray pixels (the lit explosion-sprites are gray 0.4..1 like vanilla; sky, grass and the black void are not gray) */
async function countBright(name, center, radius = 150) {
    const png = decodePng(await page.screenshot({path: `${OUT}/${name}.png`}));
    let count = 0;
    for (let y = Math.max(0, center.y - radius); y < Math.min(png.height, center.y + radius); y++) {
        for (let x = Math.max(0, center.x - radius); x < Math.min(png.width, center.x + radius); x++) {
            const [r, g, b] = png.pixel(x, y);
            if (Math.min(r, g, b) > 80 && Math.max(r, g, b) - Math.min(r, g, b) < 12) count++;
        }
    }
    return count;
}

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


await step("small explosion (a ghast-fireball, power 1): one explosion-particle of half size, the atlas is loaded", async () => {
    await control({effect: "explosion", x: 8.5, y: 64.5, z: 10, power: 1, destroy: 1});
    await waitFor("mgr.particleSystem.count > 0");
    assert.deepEqual(await manager("mgr.particleSystem.particles.map(p => p.scale)"), [1]);
    await waitFor("mgr.particleSystem.count === 0", 3000);
    await waitFor("mgr.particleView.layout !== null && mgr.particleView.layout.cells.size === 42", 10000);
});

await step("explosion of a creeper (power 3, blocks destroyed): the emitter, 6 x 8 lit explosion-sprites from the resource-pack", async () => {
    const before = await countBright("p00-before", await screen(8.5, 64.5, 10));
    await control({effect: "explosion", x: 8.5, y: 64.5, z: 10, power: 3, destroy: 1});
    await waitFor("mgr.particleSystem.particles.filter(p => p.sheet === 'lit').length >= 30");
    const lit = await manager("mgr.particleSystem.particles.filter(p => p.sheet === 'lit').length");
    assert.ok(lit <= 48, "at most 48: " + lit);
    const during = await countBright("p01-explosion", await screen(8.5, 64.5, 10));
    assert.ok(during > before + 2000, `explosion pixels: ${before} -> ${during}`);
    assert.equal(await manager("mgr.particleView.layout.cells.size"), 42, "all particle-textures in the atlas");
    // vanilla: 8 ticks of the emitter plus at most 9 ticks per sprite
    await waitFor("mgr.particleSystem.count === 0", 3000);
    // the group is hidden in the frame after the last particle is gone
    await waitFor("!mgr.particleView.group.visible", 1000).catch(() => {});
    assert.equal(await manager("mgr.particleView.group.visible"), false, "nothing drawn afterwards");
});

await step("the same effect is shown only once (it stays in the data for some seconds)", async () => {
    await sleep(1500);
    assert.equal(await particleCount(), 0);
});

await step("splash-potion (instant damage, red): 100 colored spell-particles rising from the block", async () => {
    await control({effect: "instant_splash", x: 8.5, y: 64, z: 10, color: "a9656a"});
    await waitFor("mgr.particleSystem.count >= 90");
    const textures = await manager("[...new Set(mgr.particleSystem.particles.map(p => p.texture.replace(/_\\d+$/, '')))]");
    assert.deepEqual(textures, ["minecraft:particle/spell"]);
    await sleep(150);
    const reddish = await countColor("p02-splash", await screen(8.5, 64.6, 10), [0xa9, 0x65, 0x6a]);
    assert.ok(reddish > 20, "potion-colored pixels: " + reddish);
    await waitFor("mgr.particleSystem.count === 0", 5000);
});

await step("potion-swirls of a mob: entity_effect-particles in the color of the effect", async () => {
    await control({entity: 20, type: "minecraft:zombie", mob: 1, x: 7, y: 64, z: 10, swirls: "FF33EBFF"});
    await waitFor("mgr.particleSystem.count >= 3", 8000);
    const colors = await manager("[...new Set(mgr.particleSystem.particles.map(p => [p.red, p.green, p.blue].map(v => Math.round(v * 255)).join()))]");
    assert.deepEqual(colors, ["51,235,255"]);
    const textures = await manager("[...new Set(mgr.particleSystem.particles.map(p => p.texture.replace(/_\\d+$/, '')))]");
    assert.deepEqual(textures, ["minecraft:particle/effect"]);
    const ys = await manager("mgr.particleSystem.particles.map(p => p.y)");
    assert.ok(ys.every(y => y >= 64 && y < 64 + 1.95 + 1), "on the body: " + ys);
    await control({entity: 20, type: "minecraft:zombie", mob: 1, x: 7, y: 64, z: 10});
    await waitFor("mgr.particleSystem.count === 0", 5000);
});

await step("lingering-potion cloud: only particles (no model), ceil(pi r^2) per tick on the disk", async () => {
    await control({entity: 21, type: "minecraft:area_effect_cloud", x: 8.5, y: 64, z: 10, cloud: "2,FF7DBEE8", ground: 1});
    await waitFor("mgr.particleSystem.count > 100");
    const marker = await page.evaluate(() => {
        const m = window.bluemap.mapViewer.markers.markerSets.get("bm-entities").markers.get("bm-entity-21");
        let meshes = 0;
        m.traverse(o => { if (o.isMesh) meshes++; });
        return {kind: m.kind, meshes};
    });
    assert.deepEqual(marker, {kind: "particles", meshes: 0});
    const distances = await manager("mgr.particleSystem.particles.map(p => Math.hypot(p.prevX - 8.5, p.prevZ - 10))");
    assert.ok(Math.max(...distances) < 2.6, "within the radius (plus the small drift): " + Math.max(...distances));
    await sleep(200);
    assert.ok(await countColor("p03-cloud", await screen(8.5, 64.2, 10), [0x7d, 0xbe, 0xe8]) > 30, "cloud-colored pixels");
    await control({removeEntity: 21});
    await waitFor("mgr.particleSystem.count === 0", 5000);
});

await step("burning mob: the fire-layers of vanilla renderFire, animated, full-bright", async () => {
    await control({entity: 22, type: "minecraft:zombie", mob: 1, x: 8.5, y: 64, z: 10, fire: 1});
    await waitFor("mgr.particleView.lit && mgr.particleView.lit.count === 6", 8000);
    await sleep(200);
    const orange = await countColor("p04-fire", await screen(8.5, 65, 10), [255, 128, 0]);
    assert.ok(orange > 200, "fire pixels: " + orange);
    const frames = await manager("mgr.particleView.lit.uvs.slice(0, 2).join()");
    await sleep(300);
    assert.notEqual(await manager("mgr.particleView.lit.uvs.slice(0, 2).join()"), frames, "the frames change (animated)");
    await control({entity: 22, type: "minecraft:zombie", mob: 1, x: 8.5, y: 64, z: 10});
    await waitFor("mgr.particleView.group.visible === false", 3000);
});

await step("burning player and player with potion-swirls", async () => {
    await control({uuid: "069a79f4-44e9-4726-a5be-fca90e38aaf5", name: "Notch", x: 8.5, y: 64, z: 10, fire: 1, swirls: "FFF82423"});
    await waitFor("mgr.particleView.lit && mgr.particleView.lit.count >= 6", 8000);
    await waitFor("mgr.particleSystem.count >= 2", 8000);
    await control({uuid: "069a79f4-44e9-4726-a5be-fca90e38aaf5", name: "Notch", x: 8.5, y: 64, z: 10});
    await waitFor("mgr.particleSystem.count === 0 && mgr.particleView.group.visible === false", 6000);
    await control({leave: "069a79f4-44e9-4726-a5be-fca90e38aaf5"});
});

await step("death-poof: 20 poof-particles when a dying mob is removed", async () => {
    await control({entity: 23, type: "minecraft:zombie", mob: 1, x: 8.5, y: 64, z: 10, death: 19});
    await page.waitForFunction(() => window.bluemap.mapViewer.markers.markerSets.get("bm-entities").markers.get("bm-entity-23")?.dying);
    await control({removeEntity: 23});
    await waitFor("mgr.particleSystem.count === 20");
    const textures = await manager("[...new Set(mgr.particleSystem.particles.map(p => p.texture.replace(/_\\d+$/, '')))]");
    assert.deepEqual(textures, ["minecraft:particle/generic"]);
    await waitFor("mgr.particleSystem.count === 0", 6000);
    // a living mob that is removed (e.g. out of range): no poof
    await control({entity: 24, type: "minecraft:zombie", mob: 1, x: 8.5, y: 64, z: 10});
    await page.waitForFunction(() => window.bluemap.mapViewer.markers.markerSets.get("bm-entities").markers.get("bm-entity-24"));
    await control({removeEntity: 24});
    await page.waitForFunction(() => !window.bluemap.mapViewer.markers.markerSets.get("bm-entities").markers.get("bm-entity-24"));
    await sleep(300);
    assert.equal(await particleCount(), 0);
});

await step("hidden entity-set: no particles and no effects", async () => {
    await page.evaluate(() => window.bluemap.mapViewer.markers.markerSets.get("bm-entities").visible = false);
    await control({effect: "explosion", x: 8.5, y: 64.5, z: 10, power: 4, destroy: 1});
    await control({entity: 25, type: "minecraft:zombie", mob: 1, x: 8.5, y: 64, z: 10, fire: 1, swirls: "FF33EBFF"});
    await sleep(1500);
    assert.equal(await particleCount(), 0);
    assert.equal(await manager("mgr.particleView.group.visible"), false);
    await page.evaluate(() => window.bluemap.mapViewer.markers.markerSets.get("bm-entities").visible = true);
    await control({removeEntity: 25});
    await sleep(800);
});

await step("with the playback-delay: an entity is removed together with its explosion (not before it)", async () => {
    await page.evaluate(() => window.bluemap.setLivePlaybackDelay(750));
    await control({entity: 26, type: "minecraft:creeper", mob: 1, x: 8.5, y: 64, z: 10, w: 0.6, h: 1.7});
    await page.waitForFunction(() => window.bluemap.mapViewer.markers.markerSets.get("bm-entities").markers.get("bm-entity-26"));
    // fresh samples (the test-server keeps the sample-time of an entity until it is sent again)
    for (let i = 0; i < 6; i++) {
        await control({entity: 26, type: "minecraft:creeper", mob: 1, x: 8.5, y: 64, z: 10, w: 0.6, h: 1.7});
        await sleep(250);
    }
    await control({removeEntity: 26});
    await control({effect: "explosion", x: 8.5, y: 64, z: 10, power: 3, destroy: 1});
    const start = Date.now();
    // the next responses do not list it anymore, but it is shown until the playback reaches that sample
    await sleep(400);
    const stillThere = await page.evaluate(() => !!window.bluemap.mapViewer.markers.markerSets.get("bm-entities").markers.get("bm-entity-26"));
    const particlesEarly = await particleCount();
    await page.waitForFunction(() => !window.bluemap.mapViewer.markers.markerSets.get("bm-entities").markers.get("bm-entity-26"), null, {timeout: 5000});
    const removedAfter = Date.now() - start;
    await waitFor("mgr.particleSystem.count > 0", 3000);
    const explodedAfter = Date.now() - start;
    assert.equal(stillThere, true, "still drawn after 400 ms");
    assert.equal(particlesEarly, 0, "the explosion is not shown before the playback-time");
    assert.ok(Math.abs(explodedAfter - removedAfter) < 600, `removed ${removedAfter} ms, exploded ${explodedAfter} ms`);
    await page.evaluate(() => window.bluemap.setLivePlaybackDelay(0));
    await waitFor("mgr.particleSystem.count === 0", 4000);
});

await step("effects of the last seconds are not shown when the map is opened", async () => {
    await control({effect: "explosion", x: 8.5, y: 64.5, z: 10, power: 4, destroy: 1});
    await sleep(3500);
    await page.reload();
    await page.waitForFunction(() => window.bluemap?.mapViewer?.map?.isLoaded, null, {timeout: 60000});
    await page.waitForFunction(() => window.bluemap.entityMarkerManager?.getEntityMarkerSet(false), null, {timeout: 10000});
    await sleep(1500);
    assert.equal(await particleCount(), 0);
});

await step("no uncaught errors", async () => {
    assert.deepEqual(pageErrors, []);
});

await browser.close();

const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} steps passed`);
process.exit(failed.length ? 1 : 0);
