// BlueMap Live – browser end-to-end test for the live mobs (vanilla mob-models, animations, placeholder)
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
const COLORS = {skull: [255, 64, 255], stone: [255, 128, 0], mushroom: [255, 32, 128], grass: [64, 255, 64], iron: [160, 255, 0], leather: [51, 85, 255], zombie: [48, 144, 96], cow: [128, 64, 32], wool: [132, 34, 28], villager: [192, 128, 64], farmer: [255, 0, 192], sword: [0, 255, 255]};

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

const project = (id, height = 1) => page.evaluate(([id, height]) => {
    const mv = window.bluemap.mapViewer;
    const m = mv.markers.markerSets.get("bm-entities").markers.get("bm-entity-" + id);
    m.updateMatrixWorld(true);
    mv.camera.updateMatrixWorld();
    const rect = mv.renderer.domElement.getBoundingClientRect();
    const V = window.BlueMap.Three.Vector3;
    const ndc = m.localToWorld(new V(0, height, 0)).project(mv.camera);
    return {x: rect.left + (ndc.x + 1) / 2 * rect.width, y: rect.top + (1 - ndc.y) / 2 * rect.height};
}, [id, height]);

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

const mobCacheTypes = () => page.evaluate(() => [...window.bluemap.entityMarkerManager.mobCache.entries.keys()].sort());

/** pixels that are mixed with red (the vanilla hurt-overlay: 30% red) */
async function countHurt(name, center, base, radius = 70) {
    const png = decodePng(await page.screenshot({path: `${OUT}/${name}.png`}));
    const expected = base.map((c, i) => c * 0.7 + (i === 0 ? 255 * 0.3 : 0));
    let count = 0;
    for (let y = Math.max(0, center.y - radius); y < Math.min(png.height, center.y + radius); y++) {
        for (let x = Math.max(0, center.x - radius); x < Math.min(png.width, center.x + radius); x++) {
            const p = png.pixel(x, y);
            if (Math.hypot(p[0] - expected[0], p[1] - expected[1], p[2] - expected[2]) < 12) count++;
        }
    }
    return count;
}

const mob = (id, type, x, z, extra = {}) => control({entity: id, type, x, y: 64, z, mob: 1, ...extra});

// --- load the original webapp close to the test-tile ---
await page.goto(`${BASE}/#world:8.5:64.5:9.5:9:0:1.2:0:0:perspective`);
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
await page.waitForFunction(() => window.bluemap.entityMarkerManager?.getEntityMarkerSet(false), null, {timeout: 10000});

await step("zombie: vanilla model with the pack-texture, arms forward, holds its sword", async () => {
    await mob(10, "minecraft:zombie", 8.5, 9.5, {bodyYaw: 0, main: "minecraft:diamond_sword"});
    await waitForEntity(10, "m.view?.isMobModel && m.view.visible");
    await sleep(800);
    // the camera may still settle after loading: measured again a few times
    let zombieCenter, zombiePixels = 0;
    for (let i = 0; i < 5 && zombiePixels <= 200; i++) {
        if (i > 0) await sleep(500);
        zombieCenter = await project(10);
        zombiePixels = await countColor("40-zombie", zombieCenter, COLORS.zombie, 90);
    }
    assert.ok(zombiePixels > 200, `zombie-texture pixels: ${zombiePixels} at ${JSON.stringify(zombieCenter)}`);
    const pitch = await entityExpr(10, "m.view.layerViews[0].bones.get('right_arm').rotation.x");
    assert.ok(Math.abs(pitch - -Math.PI / 2.25) < 0.06, `arms forward (${pitch})`);
    const item = await entityExpr(10, "[m.view.itemSlots.right.itemId, m.view.itemSlots.left.itemId]");
    assert.deepEqual(item, ["minecraft:diamond_sword", null]);
    assert.ok(await countColor("40-zombie-sword", await project(10, 1.2), COLORS.sword, 120) > 3, "sword pixels");
    assert.deepEqual(await mobCacheTypes(), ["minecraft:zombie"]);
});

await step("walking: interpolated movement, the legs swing, the body turns smoothly", async () => {
    await mob(10, "minecraft:zombie", 9.5, 9.5, {bodyYaw: 90, main: "minecraft:diamond_sword"});
    const legs = await sample(10, 600, "m.view.layerViews[0].bones.get('right_leg').rotation.x");
    const yaws = await sample(10, 300, "m.rotation3.body");
    assert.ok(Math.max(...legs) - Math.min(...legs) > 0.3, `legs swing (${Math.min(...legs)}..${Math.max(...legs)})`);
    assert.ok(new Set(yaws.map(y => y.toFixed(2))).size > 1 || Math.abs(yaws.at(-1) - 90) < 1e-6, "body-yaw interpolated");
    await waitForEntity(10, "Math.abs(m.position.x - 9.5) < 1e-6 && m.limbSpeed < 0.05", 8000);
});

await step("hurt: the vanilla red overlay for 0.5 s, then the normal texture", async () => {
    await mob(10, "minecraft:zombie", 9.5, 9.5, {bodyYaw: 90, hurt: 10, main: "minecraft:diamond_sword"});
    await waitForEntity(10, "m.view.hurt");
    assert.ok(await countHurt("41-zombie-hurt", await project(10), COLORS.zombie, 90) > 100, "red-tinted zombie pixels");
    await mob(10, "minecraft:zombie", 9.5, 9.5, {bodyYaw: 90, main: "minecraft:diamond_sword"});
    await waitForEntity(10, "!m.view.hurt", 3000);
    await sleep(300);
    assert.ok(await countHurt("42-zombie-healed", await project(10), COLORS.zombie, 90) < 20, "no red anymore");
});

await step("death: the mob tips over to the side within one second (vanilla 20 ticks), red", async () => {
    await mob(10, "minecraft:zombie", 9.5, 9.5, {bodyYaw: 90, death: 1});
    await waitForEntity(10, "m.view.deathGroup.rotation.z > 1.5", 3000);
    assert.equal(await entityExpr(10, "m.view.hurt"), true);
    await control({removeEntity: 10});
    await page.waitForFunction(() => !window.bluemap.mapViewer.markers.markerSets.get("bm-entities").markers.has("bm-entity-10"), null, {timeout: 10000});
    assert.deepEqual(await mobCacheTypes(), [], "textures released");
});

await step("quadrupeds: cow; sheep with the vanilla wool-color, sheared without wool", async () => {
    await mob(11, "minecraft:cow", 7, 9.5, {bodyYaw: 0, w: 0.9, h: 1.4});
    await mob(12, "minecraft:sheep", 10, 9.5, {bodyYaw: 0, variant: "red", w: 0.9, h: 1.3});
    await waitForEntity(11, "m.view.visible");
    await waitForEntity(12, "m.view.visible");
    await sleep(800);
    assert.ok(await countColor("43-cow", await project(11, 0.9), COLORS.cow, 70) > 100, "cow pixels");
    assert.ok(await countColor("44-sheep-red", await project(12, 0.9), COLORS.wool, 70) > 100, "red wool (white texture * vanilla red)");
    await mob(12, "minecraft:sheep", 10, 9.5, {bodyYaw: 0, variant: "red", flags: "sheared", w: 0.9, h: 1.3});
    await waitForEntity(12, "!m.view.layerViews[1].meshes[0].visible");
    await sleep(500);
    assert.ok(await countColor("45-sheep-sheared", await project(12, 0.9), COLORS.wool, 70) < 10, "no wool");
    await control({removeEntity: 11});
    await control({removeEntity: 12});
});

await step("villager: base, type and profession drawn onto each other (vanilla clothing-layers)", async () => {
    await mob(13, "minecraft:villager", 8.5, 9.5, {bodyYaw: 0, variant: "plains/farmer/1"});
    await waitForEntity(13, "m.view.visible");
    await sleep(800);
    const center = await project(13, 1.2);
    assert.ok(await countColor("46-villager", center, COLORS.farmer, 90) > 30, "profession pixels (head)");
    assert.ok(await countColor("46-villager", center, COLORS.villager, 90) > 30, "base pixels");
    await control({removeEntity: 13});
});

await step("unknown living entity: a placeholder with its hitbox and name", async () => {
    await mob(14, "minecraft:ender_dragon", 8.5, 9.5, {bodyYaw: 0, w: 0.35, h: 0.6});
    await waitForEntity(14, "m.view?.isPlaceholderModel");
    const state = await entityExpr(14, "[m.kind, m.view.fill.scale.y, !!m.view.label]");
    assert.deepEqual(state, ["placeholder", 0.6, true]);
    await sleep(500);
    await page.screenshot({path: `${OUT}/47-placeholder.png`});
    await control({removeEntity: 14});
});

await step("armor: a zombie and a player wear helmet and dyed leather-leggings (vanilla armor-models and layers)", async () => {
    await mob(15, "minecraft:zombie", 8.5, 9.5, {bodyYaw: 0, armor: "head:iron,legs:leather:3355ff"});
    await waitForEntity(15, "m.view.visible && m.view.armor.pieces.length === 3 && m.view.armor.pieces.every(p => p.entry.state === 'loaded')");
    await sleep(800);
    assert.ok(await countColor("48-zombie-armor", await project(15, 1.75), COLORS.iron, 60) > 50, "helmet pixels");
    assert.ok(await countColor("48-zombie-armor", await project(15, 0.5), COLORS.leather, 60) > 50, "dyed leggings pixels");
    await control({removeEntity: 15});
    await page.waitForFunction(() => !window.bluemap.mapViewer.markers.markerSets.get("bm-entities").markers.has("bm-entity-15"), null, {timeout: 10000});
    assert.equal(await page.evaluate(() => window.bluemap.entityMarkerManager.itemCache.textures.entries.size), 0, "armor-textures released");

    const A = "00000000-0000-0000-0000-00000000a001";
    await control({uuid: A, name: "Armored", x: 8.5, y: 64, z: 9.5, yaw: 0, pitch: 0, armor: "head:iron,legs:leather:3355ff"});
    await page.waitForFunction(uuid => {
        const m = window.bluemap.mapViewer.markers.markerSets.get("bm-players")?.markers.get("bm-player-" + uuid);
        return m && m.model.armor && m.model.armor.pieces.length === 3 && m.model.armor.pieces.every(p => p.entry.state === "loaded");
    }, A, {timeout: 10000});
    await sleep(800);
    const center = await page.evaluate(([uuid, height]) => {
        const mv = window.bluemap.mapViewer;
        const m = mv.markers.markerSets.get("bm-players").markers.get("bm-player-" + uuid);
        m.updateMatrixWorld(true);
        const rect = mv.renderer.domElement.getBoundingClientRect();
        // the center of the helmet
        const helmet = m.model.getObjectByName("armor-head-head");
        const box = new window.BlueMap.Three.Box3().setFromObject(helmet);
        const ndc = box.getCenter(new window.BlueMap.Three.Vector3()).project(mv.camera);
        return {x: rect.left + (ndc.x + 1) / 2 * rect.width, y: rect.top + (1 - ndc.y) / 2 * rect.height};
    }, [A, 1.6]);
    assert.ok(await countColor("49-player-armor", center, COLORS.iron, 60) > 50, "player-helmet pixels");
    await control({leave: A});
});

await step("mooshroom with its mushrooms, enderman with the carried block (block-models), igniting creeper flashes white", async () => {
    await mob(16, "minecraft:mooshroom", 8.5, 9.5, {bodyYaw: 90, variant: "red", models: "minecraft:block/red_mushroom", w: 0.9, h: 1.4});
    await waitForEntity(16, "m.view.visible && m.view.blocks.length === 3 && m.view.blocks.every(b => b.view.content.children.length > 0)");
    await sleep(800);
    assert.ok(await countColor("50-mooshroom", await project(16, 1.2), COLORS.mushroom, 80) > 20, "mushroom pixels");
    await control({removeEntity: 16});

    await mob(17, "minecraft:enderman", 8.5, 9.5, {bodyYaw: 0, flags: "carrying", models: "minecraft:block/grass_block", w: 0.6, h: 2.9});
    await waitForEntity(17, "m.view.visible && m.view.blocks[0].view.view.content.children.length > 0");
    await sleep(800);
    assert.ok(await countColor("51-enderman-block", await project(17, 1.6), COLORS.grass, 90) > 20, "carried-block pixels");
    await control({removeEntity: 17});

    await mob(18, "minecraft:creeper", 8.5, 9.5, {bodyYaw: 0, flags: "fusing", w: 0.6, h: 1.7});
    await waitForEntity(18, "m.view.visible");
    const whites = await sample(18, 1500, "m.view.white");
    assert.ok(whites.some(w => w >= 7) && whites.some(w => w === 0), `flashing white: ${[...new Set(whites)]}`);
    const scale = await entityExpr(18, "m.view.flip.scale.x");
    assert.ok(scale < -1.2, `swollen (${scale})`);
    await control({removeEntity: 18});
});

await step("attacks: the zombie swings its arm (body turns), the iron golem strikes with both arms", async () => {
    await mob(19, "minecraft:zombie", 8.5, 9.5, {bodyYaw: 0, main: "minecraft:diamond_sword"});
    await waitForEntity(19, "m.view.visible");
    await sleep(300);
    await mob(19, "minecraft:zombie", 8.5, 9.5, {bodyYaw: 0, main: "minecraft:diamond_sword", swing: 0});
    const body = await sample(19, 600, "m.view.layerViews[0].bones.get('body').rotation.y");
    assert.ok(Math.max(...body.map(Math.abs)) > 0.1, `body turns with the swing (${Math.min(...body)}..${Math.max(...body)})`);
    assert.ok(Math.abs(body.at(-1)) < 1e-6, "back after the swing");
    await control({removeEntity: 19});

    await mob(20, "minecraft:iron_golem", 8.5, 9.5, {bodyYaw: 0, w: 1.4, h: 2.7});
    await waitForEntity(20, "m.view.visible");
    await sleep(300);
    const rest = await entityExpr(20, "m.view.layerViews[0].bones.get('right_arm').rotation.x");
    await mob(20, "minecraft:iron_golem", 8.5, 9.5, {bodyYaw: 0, w: 1.4, h: 2.7, attack: 10});
    const arms = await sample(20, 700, "[m.view.layerViews[0].bones.get('right_arm').rotation.x, m.view.layerViews[0].bones.get('left_arm').rotation.x]");
    const right = arms.map(a => a[0]);
    assert.ok(Math.max(...right.map(r => Math.abs(r - rest))) > 2.5, `arms raised (rest ${rest}, ${Math.min(...right)}..${Math.max(...right)})`);
    assert.ok(arms.every(a => Math.abs(a[0] - a[1]) < 1e-6), "both arms together");
    assert.ok(Math.abs(right.at(-1) - rest) < 1e-6, "back at rest after 10 ticks");
    await control({removeEntity: 20});
});

await step("tropical fish: the body in the base-color, the pattern over it in the pattern-color", async () => {
    // pattern 2 (sunstreak) has no texture in the test-pack: only the body in its base-color
    await mob(21, "minecraft:tropical_fish", 8.5, 9.5, {bodyYaw: 90, variant: "sunstreak", flags: "base_orange,pattern_light_blue", w: 0.5, h: 0.4});
    await waitForEntity(21, "m.view.visible");
    await sleep(800);
    const orange = await countColor("60-fish-base", await project(21, 0.2), [249, 128, 29], 60);
    assert.ok(orange > 10, `orange body pixels: ${orange}`);
    await control({removeEntity: 21});
    // pattern 1 (kob) covers the whole texture: the pattern-color
    await mob(22, "minecraft:tropical_fish", 8.5, 9.5, {bodyYaw: 90, variant: "kob", flags: "base_orange,pattern_light_blue", w: 0.5, h: 0.4});
    await waitForEntity(22, "m.view.visible");
    await sleep(800);
    const blue = await countColor("61-fish-pattern", await project(22, 0.2), [58, 179, 218], 60);
    assert.ok(blue > 10, `light-blue pattern pixels: ${blue}`);
    await control({removeEntity: 22});
});

await step("head-item: a block on the head of a zombie follows the head (vanilla HeadFeatureRenderer)", async () => {
    await mob(23, "minecraft:zombie", 8.5, 9.5, {bodyYaw: 0, head: "minecraft:stone"});
    await waitForEntity(23, "m.view.visible && m.view.headSlot.itemId === 'minecraft:stone' && m.view.headSlot.content.children.length > 0", 10000);
    await sleep(800);
    const stone = await countColor("62-head-stone", await project(23, 1.9), COLORS.stone, 70);
    assert.ok(stone > 30, `stone pixels on the head: ${stone}`);
    const below = await countColor("62-head-stone", await project(23, 0.6), COLORS.stone, 25);
    assert.ok(below < 5, `not at the legs: ${below}`);
    await control({removeEntity: 23});
});

await step("head-item: a skeleton-skull on the head of a zombie (skull-model, vanilla HeadFeatureRenderer skull-branch)", async () => {
    await mob(24, "minecraft:zombie", 8.5, 9.5, {bodyYaw: 0, head: "minecraft:skeleton_skull"});
    await waitForEntity(24, "m.view.visible && m.view.headSlot.skull.itemId === 'minecraft:skeleton_skull' && m.view.headSlot.skull.meshes.some(x => x.visible)", 10000);
    await sleep(800);
    const skull = await countColor("63-head-skull", await project(24, 1.9), COLORS.skull, 70);
    assert.ok(skull > 30, `skull pixels on the head: ${skull}`);
    assert.equal(await entityExpr(24, "m.view.headSlot.content.children.length"), 0, "no item-model for the skull");
    await control({removeEntity: 24});
});

await step("armor-glint: enchanted armor shimmers and keeps the map rendering (vanilla ARMOR_ENTITY_GLINT)", async () => {
    await mob(25, "minecraft:zombie", 8.5, 9.5, {bodyYaw: 0, armor: "chest:iron:glint"});
    await waitForEntity(25, "m.view.visible && m.view.armor.hasGlint", 10000);
    await sleep(1500);
    const shot = async () => decodePng(await page.screenshot());
    const center = await project(25, 1.2);
    const a = await shot();
    await sleep(700);
    const b = await shot();
    let changed = 0;
    for (let y = center.y - 40; y < center.y + 40; y++) for (let x = center.x - 40; x < center.x + 40; x++) {
        const p = a.pixel(x, y), q = b.pixel(x, y);
        if (Math.abs(p[0] - q[0]) + Math.abs(p[1] - q[1]) + Math.abs(p[2] - q[2]) > 30) changed++;
    }
    assert.ok(changed > 20, `the glint moves without any other movement (${changed} pixels changed)`);
    await control({removeEntity: 25});
});

await step("no uncaught errors", async () => {
    assert.deepEqual(pageErrors, []);
});

await browser.close();

const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} steps passed`);
process.exit(failed.length ? 1 : 0);
