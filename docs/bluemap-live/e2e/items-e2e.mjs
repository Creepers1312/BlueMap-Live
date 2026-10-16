// BlueMap Live – browser end-to-end test for held items and item-animations (NOT part of the BlueMap build).
// Drives the ORIGINAL built BlueMap webapp in Chromium against LiveE2EServer, which serves item-assets baked by the
// real java ItemModelBaker from a small color-coded resource-pack (E2EItemResources.java).
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

const D = "d0d0d0d0-0000-4000-8000-000000000004";
const E = "e0e0e0e0-0000-4000-8000-000000000005";
const NETHER = "minecraft:the_nether", OVERWORLD = "minecraft:overworld";

// the colors of E2EItemResources (rgb)
const COLORS = {sword: [0, 255, 255], stone: [255, 128, 0], shield: [0, 200, 0], bowPulling: [255, 0, 255], crossbowArrow: [255, 255, 255], apple: [255, 0, 0]};

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

const posD = {x: 8.5, y: 64, z: 8.5};
const playerD = (extra = {}) => control({uuid: D, name: "Dave", ...posD, yaw: 0, bodyYaw: 0, pitch: 0, skin: "classic", ...extra});

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

/** waits until a condition on a player-marker holds */
const waitForMarker = (uuid, expr, timeout = 10000) => page.waitForFunction(([uuid, expr]) => {
    const m = window.bluemap.playerMarkerManager?.getPlayerMarkerSet(false)?.getPlayerMarker(uuid);
    return !!m && new Function("m", `return (${expr});`)(m);
}, [uuid, expr], {timeout});

const evalMarker = (uuid, expr) => page.evaluate(([uuid, expr]) => {
    const m = window.bluemap.playerMarkerManager?.getPlayerMarkerSet(false)?.getPlayerMarker(uuid);
    return m ? new Function("m", `return (${expr});`)(m) : null;
}, [uuid, expr]);

const sample = (uuid, ms, expr) => page.evaluate(([uuid, ms, expr]) => new Promise(resolve => {
    const get = new Function("m", `return (${expr});`);
    const values = [];
    const end = performance.now() + ms;
    const frame = () => {
        const m = window.bluemap.playerMarkerManager?.getPlayerMarkerSet(false)?.getPlayerMarker(uuid);
        if (m) values.push(get(m));
        if (performance.now() < end) requestAnimationFrame(frame); else resolve(values);
    };
    requestAnimationFrame(frame);
}), [uuid, ms, expr]);

const slotMeshes = side => `(() => { let n = 0; m.model.itemSlots.${side}.content.traverse(o => { if (o.isMesh) n++; }); return n; })()`;
const cacheIds = () => page.evaluate(() => [...window.bluemap.playerMarkerManager.itemCache.entries.keys()].sort());

/** screen-position of the center of the item in a hand */
const projectItem = (uuid, side) => page.evaluate(([uuid, side]) => {
    const mv = window.bluemap.mapViewer;
    const marker = window.bluemap.playerMarkerManager.getPlayerMarkerSet(false).getPlayerMarker(uuid);
    marker.updateMatrixWorld(true);
    mv.camera.updateMatrixWorld();
    const rect = mv.renderer.domElement.getBoundingClientRect();
    const V = window.BlueMap.Three.Vector3;
    const ndc = marker.model.itemSlots[side].content.localToWorld(new V(0.5, 0.5, 0.5)).project(mv.camera);
    return {x: rect.left + (ndc.x + 1) / 2 * rect.width, y: rect.top + (1 - ndc.y) / 2 * rect.height};
}, [uuid, side]);

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

/** counts the pixels in a box around a point that have the hue of a color (any brightness of the vanilla face-shading) */
async function countColor(name, center, color, radius = 60) {
    const png = decodePng(await page.screenshot({path: `${OUT}/${name}.png`}));
    const length = Math.hypot(...color);
    let count = 0;
    for (let y = Math.max(0, center.y - radius); y < Math.min(png.height, center.y + radius); y++) {
        for (let x = Math.max(0, center.x - radius); x < Math.min(png.width, center.x + radius); x++) {
            const p = png.pixel(x, y);
            const l = Math.hypot(...p);
            if (l < 60) continue;
            const cos = (p[0] * color[0] + p[1] * color[1] + p[2] * color[2]) / (l * length);
            if (cos > 0.985) count++;
        }
    }
    return count;
}

const camera = () => page.evaluate(() => {
    const cm = window.bluemap.mapViewer.controlsManager;
    return [cm.position.x, cm.position.y, cm.position.z, cm.distance, cm.rotation, cm.angle];
});

// --- load the original webapp, close to the player (camera south of him, looking north at his front) ---
await playerD();
await page.goto(`${BASE}/#world:8.5:64.9:8.5:5:0:1.45:0:0:perspective`);
await page.waitForFunction(() => window.bluemap?.mapViewer?.map?.isLoaded, null, {timeout: 60000});
await page.addStyleTag({content: ".bm-marker-player { display: none !important; }"}); // css head-marker would cover the model
await page.evaluate(() => window.__bmLiveNoReload = true);
await waitForMarker(D, "m.model.hasSkin && m.model.displayedSkin && !m.model.displayedSkin.isDefault");

await step("empty hands: no item-meshes, nothing loaded", async () => {
    assert.equal(await evalMarker(D, slotMeshes("right")), 0);
    assert.equal(await evalMarker(D, slotMeshes("left")), 0);
    assert.deepEqual(await cacheIds(), []);
});

await step("sword in the main hand: baked vanilla handheld-model at the right hand (pixels)", async () => {
    const before = await countColor("20-empty", await projectItem(D, "right"), COLORS.sword);
    await playerD({main: "minecraft:diamond_sword"});
    await waitForMarker(D, slotMeshes("right") + " > 0");
    await sleep(800);
    const count = await countColor("21-sword", await projectItem(D, "right"), COLORS.sword);
    assert.equal(before, 0);
    assert.ok(count > 30, `sword pixels at the right hand: ${count}`);
    assert.equal(await evalMarker(D, slotMeshes("left")), 0, "the off hand is empty");
    assert.ok(Math.abs(await evalMarker(D, "m.model.parts.rightArm.rotation.x") - (-Math.PI / 10)) < 0.12, "vanilla ITEM arm-pose");
});

await step("item-switch sword -> stone: block-model, the sword is released", async () => {
    await playerD({main: "minecraft:stone"});
    await waitForMarker(D, "m.model.itemSlots.right.itemId === 'minecraft:stone' && " + slotMeshes("right") + " > 0");
    await sleep(800);
    const center = await projectItem(D, "right");
    assert.ok(await countColor("22-stone", center, COLORS.stone) > 30, "stone pixels");
    assert.equal(await countColor("22-stone", center, COLORS.sword), 0, "no sword anymore");
    assert.deepEqual(await cacheIds(), ["minecraft:stone"], "the sword-asset is released");
});

await step("shield in the off hand, blocking: override + vanilla BLOCK-pose of the left arm", async () => {
    await playerD({main: "none", off: "minecraft:shield"});
    await waitForMarker(D, slotMeshes("left") + " === 2");
    assert.equal(await evalMarker(D, "m.model.itemSlots.left.modelIndex"), 0, "not blocking: base model");
    await playerD({off: "minecraft:shield", use: "off", useAction: "block", useTicks: 10});
    await waitForMarker(D, "m.model.itemSlots.left.modelIndex === 1");
    await sleep(800);
    assert.ok(await evalMarker(D, "m.model.parts.leftArm.rotation.x") < -0.6, "arm in front of the body");
    assert.ok(await countColor("23-shield", await projectItem(D, "left"), COLORS.shield, 90) > 100, "shield pixels");
});

/** like the server: a new sample every 250 ms (5 ticks) with the increasing use-time */
async function useFor(ms, params) {
    for (let ticks = 0; ticks <= ms / 50; ticks += 5) {
        await playerD({...params, useTicks: ticks});
        await sleep(250);
    }
}

await step("bow drawing: both arms forward, the pull-overrides follow the use-time", async () => {
    await playerD({main: "minecraft:bow", off: "none", use: "main", useAction: "bow", useTicks: 0});
    await waitForMarker(D, "m.model.itemSlots.right.modelIndex >= 1");
    const indices = sample(D, 1800, "m.model.itemSlots.right.modelIndex");
    await useFor(2000, {main: "minecraft:bow", use: "main", useAction: "bow"});
    await indices.then(values => indices.values = values);
    const values = indices.values;
    assert.ok(values.includes(1) && values.includes(3), `pulling_0 .. pulling_2: ${[...new Set(values)]}`);
    assert.ok(await evalMarker(D, "m.model.parts.rightArm.rotation.x") < -1.3 && await evalMarker(D, "m.model.parts.leftArm.rotation.x") < -1.3);
    assert.ok(await countColor("24-bow", await projectItem(D, "right"), COLORS.bowPulling) > 10, "pulling-texture");
    // released
    await playerD({main: "minecraft:bow"});
    await waitForMarker(D, "m.model.itemSlots.right.modelIndex === 0");
});

await step("charged crossbow: CROSSBOW_HOLD-pose and the charged override", async () => {
    await playerD({main: "minecraft:crossbow", charged: 1});
    await waitForMarker(D, "m.model.itemSlots.right.modelIndex === 2 && m.animator.armPoses.right === 'crossbow_hold'");
    await sleep(500);
    assert.ok(await evalMarker(D, "m.model.parts.leftArm.rotation.x") < -1.2, "both hands hold the crossbow");
    await playerD({main: "minecraft:crossbow", charged: 0, use: "main", useAction: "crossbow", useTicks: 0});
    await waitForMarker(D, "m.animator.armPoses.right === 'crossbow_charge' && m.model.itemSlots.right.modelIndex === 1");
    await playerD({main: "none", charged: 0});
});

await step("eating (approximation): the arm goes to the mouth and bobs", async () => {
    await playerD({main: "minecraft:apple", use: "main", useAction: "eat", useTicks: 0});
    await waitForMarker(D, "m.animator.armPoses.right === 'eat'");
    await sleep(300);
    const values = await sample(D, 1200, "m.model.parts.rightArm.rotation.x");
    assert.ok(Math.max(...values) < -0.9, "arm lifted");
    assert.ok(Math.max(...values) - Math.min(...values) > 0.04, "bobbing");
    await playerD({main: "minecraft:apple"});
    await waitForMarker(D, "m.animator.armPoses.right === 'item'");
});

await step("attack: the swing-kind from the server, swing with the held item", async () => {
    await playerD({main: "minecraft:diamond_sword"});
    const swing = sample(D, 1500, "m.model.parts.rightArm.rotation.x");
    await playerD({main: "minecraft:diamond_sword", swing: "right", swingKind: "attack"});
    const values = await swing;
    assert.ok(Math.min(...values) < -1, `swing (${Math.min(...values)})`);
    assert.equal(await evalMarker(D, "m.animator.swingKind"), "attack");
    assert.equal(await evalMarker(D, slotMeshes("right") + " > 0"), true, "the sword stays in the hand");
});

await step("left-handed player: the main hand item is in the left hand", async () => {
    await playerD({main: "minecraft:diamond_sword", leftHanded: 1});
    await waitForMarker(D, "m.model.itemSlots.left.itemId === 'minecraft:diamond_sword' && m.model.itemSlots.right.itemId === null");
    await sleep(800);
    assert.ok(await countColor("25-left-handed", await projectItem(D, "left"), COLORS.sword) > 30);
    await playerD({main: "minecraft:diamond_sword", leftHanded: 0});
    await waitForMarker(D, "m.model.itemSlots.right.itemId === 'minecraft:diamond_sword'");
});

await step("slim arms: the item-joint is shifted half a pixel (vanilla)", async () => {
    await playerD({main: "minecraft:diamond_sword", skin: "slim"});
    await waitForMarker(D, "m.model.displayedVariant === 'slim' && Math.abs(m.model.itemSlots.right.anchor.position.x + 4.5) < 1e-6");
    await playerD({main: "minecraft:diamond_sword", skin: "classic"});
    await waitForMarker(D, "m.model.displayedVariant === 'classic' && Math.abs(m.model.itemSlots.right.anchor.position.x + 5) < 1e-6");
});

await step("two players with different items, shared and released assets", async () => {
    await control({uuid: E, name: "Eve", x: 6.5, y: 64, z: 8.5, yaw: 0, pitch: 0, main: "minecraft:stone", off: "minecraft:diamond_sword"});
    await waitForMarker(E, slotMeshes("right") + " > 0 && " + slotMeshes("left") + " > 0");
    assert.deepEqual(await cacheIds(), ["minecraft:diamond_sword", "minecraft:stone"], "the sword-asset is shared");
    assert.equal(await page.evaluate(() => window.bluemap.playerMarkerManager.itemCache.entries.get("minecraft:diamond_sword").refs), 2);
    assert.equal(await evalMarker(D, "m.model.itemSlots.right.itemId"), "minecraft:diamond_sword");
    await control({leave: E});
    await page.waitForFunction(uuid => !window.bluemap.playerMarkerManager.getPlayerMarker(uuid), E, {timeout: 10000});
    assert.deepEqual(await cacheIds(), ["minecraft:diamond_sword"], "Eve's stone is released");
});

await step("dimension change (map-switch) with items: shown on the new map without reload, old resources disposed", async () => {
    const oldCacheDisposed = () => page.evaluate(() => window.__oldItemCache.disposed && window.__oldItemCache.entries.size === 0);
    await page.evaluate(() => window.__oldItemCache = window.bluemap.playerMarkerManager.itemCache);
    await playerD({main: "minecraft:diamond_sword", world: NETHER});
    await page.evaluate(() => window.bluemap.switchMap("world_the_nether", false));
    await waitForMarker(D, "m.visible && m.model.visible && " + slotMeshes("right") + " > 0");
    assert.equal(await oldCacheDisposed(), true);
    assert.deepEqual(await cacheIds(), ["minecraft:diamond_sword"]);

    await playerD({main: "minecraft:diamond_sword", world: OVERWORLD});
    await page.evaluate(() => window.bluemap.switchMap("world", false));
    await waitForMarker(D, "m.visible && m.model.visible && " + slotMeshes("right") + " > 0");
    assert.equal(await page.evaluate(() => window.__bmLiveNoReload), true, "no page-reload");
    const models = await page.evaluate(() => { let n = 0; window.bluemap.mapViewer.markers.traverse(o => { if (o.isPlayerModel) n++; }); return n; });
    assert.equal(models, 1, "no duplicate models");
});

await step("remove and re-add a player with items", async () => {
    await control({leave: D});
    await page.waitForFunction(uuid => !window.bluemap.playerMarkerManager.getPlayerMarker(uuid), D, {timeout: 10000});
    assert.deepEqual(await cacheIds(), [], "everything released");
    await playerD({main: "minecraft:diamond_sword"});
    await waitForMarker(D, "m.model.hasSkin && " + slotMeshes("right") + " > 0");
});

await step("item-asset not yet available on the server: shown as soon as it exists (retry without timer)", async () => {
    await control({itemsDown: 1});
    await playerD({main: "minecraft:apple"});
    await waitForMarker(D, "m.model.itemSlots.right.entry && m.model.itemSlots.right.entry.state === 'failed'");
    assert.equal(await evalMarker(D, slotMeshes("right")), 0);
    await control({itemsDown: 0});
    await waitForMarker(D, slotMeshes("right") + " > 0", 15000);
    await sleep(800);
    assert.ok(await countColor("26-apple", await projectItem(D, "right"), COLORS.apple) > 10);
});

await step("close to the 3d-model the head-icon is faded out (the name stays), from far away it is shown", async () => {
    // (this suite hides the whole css-marker for the pixel-checks, the attribute and the computed style are checked)
    const icon = () => page.evaluate(uuid => {
        const m = window.bluemap.playerMarkerManager.getPlayerMarker(uuid);
        const element = m.element;
        return {
            model: element.getAttribute("model-data"),
            opacity: getComputedStyle(element.getElementsByTagName("img")[0]).opacity,
            name: element.getElementsByClassName("bm-player-name")[0].textContent,
        };
    }, D);
    await page.waitForFunction(uuid => window.bluemap.playerMarkerManager.getPlayerMarker(uuid).element.getAttribute("model-data") === "near", D);
    await sleep(500); // css-transition
    let near = await icon();
    assert.equal(near.opacity, "0", "head-icon faded out");
    assert.equal(near.name, "Dave", "name unchanged");

    // zoom out via the normal page-address (hash-navigation, no reload)
    await page.evaluate(() => location.hash = "#world:8.5:64.9:8.5:300:0:1.45:0:0:perspective");
    await page.waitForFunction(uuid => window.bluemap.playerMarkerManager.getPlayerMarker(uuid).element.getAttribute("model-data") === "none", D, {timeout: 10000});
    await sleep(500);
    assert.equal((await icon()).opacity, "1", "head-icon shown again");

    await page.evaluate(() => location.hash = "#world:8.5:64.9:8.5:5:0:1.45:0:0:perspective");
    await page.waitForFunction(uuid => window.bluemap.playerMarkerManager.getPlayerMarker(uuid).element.getAttribute("model-data") === "near", D, {timeout: 10000});
});

await step("held items do not move the camera, no page-reload, no errors", async () => {
    // (the camera-height is adapted to the terrain after loading and after map-switches, so it is compared here)
    const before = await camera();
    await playerD({main: "minecraft:bow", off: "minecraft:shield", use: "off", useAction: "block"});
    await sleep(600);
    await playerD({main: "minecraft:diamond_sword", off: "none", swing: "right", swingKind: "attack"});
    await sleep(600);
    assert.deepEqual(await camera(), before);
    assert.equal(await page.evaluate(() => window.__bmLiveNoReload), true);
    assert.deepEqual(pageErrors, []);
});

await browser.close();

const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} steps passed`);
process.exit(failed.length ? 1 : 0);
