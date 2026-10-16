// BlueMap Live – browser end-to-end test for the map-switch (dimension change) and the player-animations
// (NOT part of the BlueMap build). Drives the ORIGINAL built BlueMap webapp in Chromium against LiveE2EServer.
// Usage: see docs/bluemap-live/e2e/README.md (restart the server before every run)

import {createRequire} from "node:module";
import assert from "node:assert/strict";

const require = createRequire(import.meta.url);
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || "playwright");

const BASE = process.env.E2E_BASE || "http://127.0.0.1:8100";

const A = "069a79f4-44e9-4726-a5be-fca90e38aaf5"; // no skin -> default skin
const D = "d0d0d0d0-0000-4000-8000-000000000004"; // own (classic) skin

const OVERWORLD = "minecraft:overworld", NETHER = "minecraft:the_nether";
const WALK = 4.317, SPRINT = 5.612, SNEAK = 1.31;

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

// the players stand next to each other on the test-tile, in front of the camera
const posA = {x: 6.5, y: 64, z: 8.5}, posD = {x: 10.5, y: 64, z: 8.5};
const playerA = (extra = {}) => control({uuid: A, name: "Alice", ...posA, yaw: 0, bodyYaw: 0, pitch: 0, skin: "none", ...extra});
const playerD = (extra = {}) => control({uuid: D, name: "Dave", ...posD, yaw: 0, bodyYaw: 0, pitch: 0, skin: "classic", ...extra});

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

/** state of a player-marker (and its model / animation) in the page */
const marker = uuid => page.evaluate(uuid => {
    const app = window.bluemap;
    const m = app.playerMarkerManager?.getPlayerMarkerSet(false)?.getPlayerMarker(uuid);
    if (!m) return null;
    const bone = name => ({
        rx: m.model.parts[name].rotation.x, ry: m.model.parts[name].rotation.y, rz: m.model.parts[name].rotation.z,
        y: m.model.parts[name].position.y, z: m.model.parts[name].position.z,
    });
    return {
        visible: m.visible,
        modelVisible: m.model.visible,
        hasSkin: m.model.hasSkin,
        displayedDefault: m.model.displayedSkin?.isDefault ?? null,
        variant: m.model.displayedVariant,
        world: m.lastPlayerData?.world,
        limbSpeed: m.animator.limbSpeed,
        sneakWeight: m.animator.sneakWeight,
        airWeight: m.animator.airWeight,
        head: bone("head"), body: bone("body"),
        rightArm: bone("rightArm"), leftArm: bone("leftArm"),
        rightLeg: bone("rightLeg"), leftLeg: bone("leftLeg"),
        rootY: m.model.root.position.y,
    };
}, uuid);

/** everything that must not exist twice */
const sceneCounts = () => page.evaluate(() => {
    const app = window.bluemap;
    let models = 0, playerSets = 0;
    app.mapViewer.markers.traverse(o => {
        if (o.isPlayerModel) models++;
        if (o.data?.id === "bm-players") playerSets++;
    });
    const set = app.playerMarkerManager?.getPlayerMarkerSet(false);
    return {
        models,
        playerSets,
        markers: set?.markers.size ?? 0,
        skinEntries: app.playerMarkerManager?.skinCache.entries.size ?? 0,
        setUsesManagerCache: set?.skinCache === app.playerMarkerManager?.skinCache,
        map: app.mapViewer.map?.data.id,
        notReloaded: window.__bmLiveNoReload === true,
    };
});

/** samples a value of a player-marker on every animation-frame for the given time */
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

/** waits until a condition on a player-marker holds */
const waitForMarker = (uuid, expr, timeout = 10000) => page.waitForFunction(([uuid, expr]) => {
    const m = window.bluemap.playerMarkerManager?.getPlayerMarkerSet(false)?.getPlayerMarker(uuid);
    return !!m && new Function("m", `return (${expr});`)(m);
}, [uuid, expr], {timeout});

const SHOWN = "m.visible && m.model.visible && m.model.hasSkin";
const switchMap = mapId => page.evaluate(id => window.bluemap.switchMap(id, false), mapId);

// --- load the original webapp ---
await playerA();
await playerD();
await page.goto(`${BASE}/#world:8.5:64.9:8.5:12:0:1.3:0:0:perspective`);
await page.waitForFunction(() => window.bluemap?.mapViewer?.map?.isLoaded, null, {timeout: 60000});
// survives map-switches, but not a page-reload
await page.evaluate(() => window.__bmLiveNoReload = true);

await step("start: both players shown on the overworld map", async () => {
    await waitForMarker(A, SHOWN);
    await waitForMarker(D, SHOWN + " && !m.model.displayedSkin.isDefault");
    const c = await sceneCounts();
    assert.deepEqual([c.models, c.playerSets, c.markers], [2, 1, 2]);
});

// --- dimension change ---

await step("overworld -> nether: after the map-switch both models are shown without reload (default and own skin)", async () => {
    await playerA({world: NETHER});
    await playerD({world: NETHER});
    await switchMap("world_the_nether");
    await waitForMarker(A, SHOWN + " && m.model.displayedSkin.isDefault");
    await waitForMarker(D, SHOWN + " && !m.model.displayedSkin.isDefault");
    const c = await sceneCounts();
    assert.equal(c.map, "world_the_nether");
    assert.equal(c.notReloaded, true, "page was not reloaded");
    assert.equal(c.setUsesManagerCache, true, "the player-set uses the skin-cache of the current map");
    assert.deepEqual([c.models, c.playerSets, c.markers], [2, 1, 2], "no duplicate models, sets or markers");
    assert.equal(c.skinEntries, 1, "only Daves skin is cached");
});

await step("nether -> overworld: models shown again without reload", async () => {
    await playerA({world: OVERWORLD});
    await playerD({world: OVERWORLD});
    await switchMap("world");
    await waitForMarker(A, SHOWN + " && m.model.displayedSkin.isDefault");
    await waitForMarker(D, SHOWN + " && !m.model.displayedSkin.isDefault");
    const c = await sceneCounts();
    assert.equal(c.notReloaded, true);
    assert.deepEqual([c.models, c.playerSets, c.markers, c.skinEntries], [2, 1, 2, 1]);
});

await step("follow-player: the dimension change of the followed player switches the map automatically", async () => {
    await page.evaluate(uuid => {
        const app = window.bluemap;
        app.mapViewer.controlsManager.controls.followPlayerMarker(app.playerMarkerManager.getPlayerMarker(uuid));
    }, A);
    await playerA({world: NETHER});
    await page.waitForFunction(() => window.bluemap.mapViewer.map?.data.id === "world_the_nether", null, {timeout: 15000});
    await waitForMarker(A, SHOWN);
    const following = await page.evaluate(uuid =>
        window.bluemap.mapViewer.controlsManager.controls.data.followingPlayer?.playerUuid === uuid, A);
    assert.equal(following, true, "still following the player on the new map");

    await playerA({world: OVERWORLD});
    await page.waitForFunction(() => window.bluemap.mapViewer.map?.data.id === "world", null, {timeout: 15000});
    await waitForMarker(A, SHOWN);
    await page.evaluate(() => window.bluemap.mapViewer.controlsManager.controls.stopFollowingPlayerMarker());
    const c = await sceneCounts();
    assert.equal(c.notReloaded, true);
    assert.deepEqual([c.models, c.playerSets, c.markers], [2, 1, 2]);
});

await step("rapid switching between the dimensions: no duplicates, no leaked skins", async () => {
    for (let i = 0; i < 6; i++) {
        const nether = i % 2 === 0;
        await playerA({world: nether ? NETHER : OVERWORLD});
        await playerD({world: nether ? NETHER : OVERWORLD});
        await switchMap(nether ? "world_the_nether" : "world");
        await sleep(100);
    }
    // ends on the overworld map
    await waitForMarker(A, SHOWN);
    await waitForMarker(D, SHOWN + " && !m.model.displayedSkin.isDefault");
    const c = await sceneCounts();
    assert.equal(c.map, "world");
    assert.equal(c.notReloaded, true);
    assert.deepEqual([c.models, c.playerSets, c.markers, c.skinEntries], [2, 1, 2, 1]);
});

await step("player in the other dimension is hidden, without a map-switch", async () => {
    await playerA({world: NETHER});
    await waitForMarker(A, "!m.visible");
    await playerA({world: OVERWORLD});
    await waitForMarker(A, SHOWN);
});

await step("remove and re-add a player: a new model, no duplicate", async () => {
    await control({leave: A});
    await page.waitForFunction(uuid => !window.bluemap.playerMarkerManager.getPlayerMarker(uuid), A, {timeout: 10000});
    let c = await sceneCounts();
    assert.deepEqual([c.models, c.markers], [1, 1]);
    await playerA();
    await waitForMarker(A, SHOWN);
    c = await sceneCounts();
    assert.deepEqual([c.models, c.playerSets, c.markers], [2, 1, 2]);
});

// --- animations ---

const amplitude = values => Math.max(...values.map(Math.abs));

await step("idle -> walk -> idle", async () => {
    let s = await marker(D);
    assert.equal(s.limbSpeed, 0, "idle");
    assert.ok(Math.abs(s.rightLeg.rx) < 1e-6, "legs still while idle");

    await playerD({vx: WALK});
    await waitForMarker(D, "m.animator.limbSpeed > 0.8");
    const right = await sample(D, 1500, "m.model.parts.rightLeg.rotation.x");
    const pairs = await sample(D, 500, "[m.model.parts.rightLeg.rotation.x, m.model.parts.leftLeg.rotation.x]");
    assert.ok(amplitude(right) > 0.8, `walking leg amplitude ${amplitude(right)}`);
    assert.ok(right.some(v => v > 0.3) && right.some(v => v < -0.3), "legs swing forward and back");
    for (const [r, l] of pairs) assert.ok(Math.abs(r + l) < 1e-6, "legs opposite");

    await playerD({vx: 0});
    await waitForMarker(D, "m.animator.limbSpeed === 0");
    s = await marker(D);
    assert.ok(Math.abs(s.rightLeg.rx) < 1e-6, "legs back at rest");
});

await step("walk -> sprint -> walk", async () => {
    await playerD({vx: WALK});
    await waitForMarker(D, "m.animator.limbSpeed > 0.85");
    const walk = (await marker(D)).limbSpeed;
    await playerD({vx: SPRINT, sprinting: 1});
    await waitForMarker(D, "m.animator.limbSpeed > 0.99");
    const sprintAmp = amplitude(await sample(D, 1500, "m.model.parts.rightLeg.rotation.x"));
    await playerD({vx: WALK});
    await waitForMarker(D, "m.animator.limbSpeed < 0.87");
    const walkAmp = amplitude(await sample(D, 1500, "m.model.parts.rightLeg.rotation.x"));
    assert.ok(walk < 0.87, `walk limb-speed ${walk}`);
    assert.ok(sprintAmp > walkAmp, `sprint amplitude ${sprintAmp} > walk ${walkAmp}`);
});

await step("walk -> sneak -> walk", async () => {
    await playerD({vx: SNEAK, sneaking: 1});
    await waitForMarker(D, "m.animator.sneakWeight > 0.999");
    const s = await marker(D);
    assert.ok(Math.abs(s.body.rx - 0.5) < 0.01, `body leans forward (${s.body.rx})`);
    assert.ok(Math.abs(s.head.y - 19.8) < 0.01, `head lower (${s.head.y})`);
    assert.ok(Math.abs(s.rightLeg.z + 4) < 0.01, "legs back");
    assert.ok(s.rootY < -0.12, "model lower");
    assert.ok(s.limbSpeed > 0.2 && s.limbSpeed < 0.3, `slow sneak-walk (${s.limbSpeed})`);

    await playerD({vx: WALK});
    await waitForMarker(D, "m.animator.sneakWeight < 0.001");
    const w = await marker(D);
    assert.ok(Math.abs(w.body.rx) < 0.01 && Math.abs(w.head.y - 24) < 0.01 && Math.abs(w.rootY) < 0.01, "back to walking");
});

await step("idle -> punch -> idle (reliable swing-counter from the server)", async () => {
    await playerD({vx: 0});
    await waitForMarker(D, "m.animator.limbSpeed === 0");
    const before = await sample(D, 600, "m.model.parts.rightArm.rotation.x");
    assert.ok(amplitude(before) < 0.15, "idle arm");

    const swing = sample(D, 1500, "m.model.parts.rightArm.rotation.x");
    await playerD({vx: 0, swing: "right"});
    const values = await swing;
    assert.ok(Math.min(...values) < -0.6, `right arm swings forward (${Math.min(...values)})`);
    await waitForMarker(D, "m.animator.swingTime < 0");
    const after = await sample(D, 400, "m.model.parts.rightArm.rotation.x");
    assert.ok(amplitude(after) < 0.15, "back to idle");
    // unchanged counter -> no second swing
    await playerD({vx: 0});
    const again = await sample(D, 800, "m.model.parts.rightArm.rotation.x");
    assert.ok(amplitude(again) < 0.15, "no repeated swing");
});

await step("walk -> jump -> landing", async () => {
    await playerD({vx: WALK});
    await playerD({vx: WALK, vy: 6, ground: 0});
    await waitForMarker(D, "m.animator.airWeight > 0.9");
    const air = await marker(D);
    assert.ok(air.rightArm.rz < -0.1 && air.leftArm.rz > 0.1, "arms spread in the air");
    await playerD({vx: WALK, vy: -8, ground: 0});
    await sleep(500);
    await playerD({vx: WALK});
    await waitForMarker(D, "m.animator.airWeight < 0.01");
    assert.ok((await marker(D)).limbSpeed > 0.8, "keeps walking after landing");
});

await step("dimension change while walking: the model on the new map is animated", async () => {
    await playerD({vx: WALK, world: NETHER});
    await playerA({world: NETHER});
    await switchMap("world_the_nether");
    await waitForMarker(D, SHOWN + " && m.animator.limbSpeed > 0.8");
    assert.ok(amplitude(await sample(D, 1000, "m.model.parts.rightLeg.rotation.x")) > 0.8);
    await playerD({vx: WALK, world: OVERWORLD});
    await playerA({world: OVERWORLD});
    await switchMap("world");
    await waitForMarker(D, SHOWN + " && m.animator.limbSpeed > 0.8");
    await waitForMarker(A, SHOWN);
});

await step("classic -> slim while walking: animation continues on the slim pivots", async () => {
    await playerD({vx: WALK, skin: "slim"});
    await waitForMarker(D, "m.model.displayedVariant === 'slim'");
    const s = await marker(D);
    assert.ok(Math.abs(s.rightArm.y - 21.5) < 1e-6, `slim shoulder (${s.rightArm.y})`);
    assert.ok(amplitude(await sample(D, 1000, "m.model.parts.rightLeg.rotation.x")) > 0.8);
    await playerD({vx: WALK, skin: "classic"});
    await waitForMarker(D, "m.model.displayedVariant === 'classic'");
    assert.ok(Math.abs((await marker(D)).rightArm.y - 22) < 1e-6, "classic shoulder");
});

await step("several players animate independently", async () => {
    await playerA({sneaking: 1});
    await playerD({vx: WALK});
    await waitForMarker(A, "m.animator.sneakWeight > 0.999");
    const a = await marker(A), d = await marker(D);
    assert.equal(a.limbSpeed, 0);
    assert.ok(Math.abs(a.body.rx - 0.5) < 0.01, "Alice sneaks");
    assert.ok(d.limbSpeed > 0.8 && Math.abs(d.body.rx) < 0.01, "Dave walks");
    await playerA();
});

await step("hurt: red overlay for 0.5 s like vanilla, the held item and other players untinted", async () => {
    await playerD({hurt: 1});
    await playerA({hurt: 7});
    await waitForMarker(D, "m.animator.lastHurtCount === 1");
    const isHurt = uuid => page.evaluate(uuid => {
        const m = window.bluemap.playerMarkerManager.getPlayerMarker(uuid);
        return m.model.hurt;
    }, uuid);
    assert.equal(await isHurt(D), false, "the first known counter is no hurt");
    await playerD({hurt: 2});
    await waitForMarker(D, "m.model.hurt");
    assert.equal(await isHurt(A), false, "other player untinted");
    const hurtMaterial = await page.evaluate(uuid => {
        const m = window.bluemap.playerMarkerManager.getPlayerMarker(uuid);
        return m.model.parts.body.children[0].material.customProgramCacheKey?.() ?? null;
    }, D);
    assert.equal(hurtMaterial, "bluemap-live-entity-hurt");
    await waitForMarker(D, "!m.model.hurt", 3000);
});

await step("animations use the existing render-loop: high fps only while a model moves", async () => {
    const countFrames = ms => page.evaluate(ms => new Promise(resolve => {
        let frames = 0;
        const listener = () => frames++;
        window.bluemap.events.addEventListener("bluemapRenderFrame", listener);
        setTimeout(() => {
            window.bluemap.events.removeEventListener("bluemapRenderFrame", listener);
            resolve(frames);
        }, ms);
    }), ms);

    // ms since the last redraw-request (MapViewer.redraw() switches the existing render-loop to high fps for 1s)
    const sinceRedraw = () => page.evaluate(() => Date.now() - window.bluemap.mapViewer.lastRedrawChange);

    await playerD({vx: WALK});
    await waitForMarker(D, "m.animator.limbSpeed > 0.8");
    const moving = await countFrames(2000);
    assert.ok(await sinceRedraw() < 500, "high fps is requested while a model moves");
    await playerD({vx: 0});
    await waitForMarker(D, "m.animator.limbSpeed === 0");
    await sleep(1500);
    const idle = await countFrames(2000);
    // (in software-rendering the frame-rate is limited, so the frame-counts are only informative)
    console.log(`      rendered frames in 2s: moving ${moving}, idle ${idle}`);
    assert.ok(await sinceRedraw() > 3000, "no redraw-requests while all models stand still (idle animation on the normal frame-rate)");
    assert.ok(idle <= 45, `idle stays on the normal low frame-rate (${idle})`);
});

await step("player updates and animations do not move the camera", async () => {
    const camera = () => page.evaluate(() => {
        const cm = window.bluemap.mapViewer.controlsManager;
        return [cm.position.x, cm.position.y, cm.position.z, cm.distance, cm.rotation, cm.angle];
    });
    const before = await camera();
    await playerD({vx: WALK, swing: "right"});
    await playerA({sneaking: 1});
    await sleep(1500);
    await playerD({vx: 0});
    await playerA();
    await sleep(500);
    assert.deepEqual(await camera(), before);
});

await step("no page-reload and no uncaught errors during the whole test", async () => {
    assert.equal((await sceneCounts()).notReloaded, true);
    assert.deepEqual(pageErrors, []);
});

await browser.close();

const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} steps passed`);
process.exit(failed.length ? 1 : 0);
