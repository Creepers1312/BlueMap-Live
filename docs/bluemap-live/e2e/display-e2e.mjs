// BlueMap Live – browser end-to-end test for the display-settings of the live-data (entity-radius and -distance, particles, block-preview)
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



const entityShown = id => page.evaluate(id => {
    const m = window.bluemap.mapViewer.markers.markerSets.get("bm-entities")?.markers.get("bm-entity-" + id);
    return m ? m.body.visible : null;
}, id);
const openSettings = async () => {
    await page.evaluate(() => {
        window.bluemap.appState.menu.isOpen = true;
        window.bluemap.appState.menu.pageStack = [{id: "settings", title: "Settings"}];
    });
    await sleep(500);
};

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



const PLAYER = "069a79f4-44e9-4726-a5be-fca90e38aaf5";

await step("the settings-menu shows the live display-settings, the radius-slider goes up to the server-radius", async () => {
    await control({uuid: PLAYER, name: "Notch", x: 8.5, y: 64, z: 10});
    await control({entity: 40, type: "minecraft:zombie", mob: 1, x: 12.5, y: 64, z: 10});
    await control({entity: 41, type: "minecraft:zombie", mob: 1, x: 28.5, y: 64, z: 10});
    await page.waitForFunction(() => window.bluemap.mapViewer.markers.markerSets.get("bm-entities")?.markers.size === 2, null, {timeout: 10000});
    await page.waitForFunction(() => window.bluemap.appState.live.serverRadius === 30, null, {timeout: 10000});
    await openSettings();
    const labels = await page.evaluate(() => document.body.innerText);
    for (const label of ["Entities", "Particles", "block preview"]) assert.ok(labels.toLowerCase().includes(label.toLowerCase()), label + " in the menu");
    // the group of the display-settings, scrolled into view
    await page.evaluate(() => [...document.querySelectorAll(".group")].find(g => g.innerText.includes("Entities"))?.scrollIntoView());
    await sleep(300);
    await page.screenshot({path: `${OUT}/d01-settings.png`});
    assert.equal(await entityShown(40), true);
    assert.equal(await entityShown(41), true);
});

await step("entity-radius around the players: further entities are hidden, the maximum shows all", async () => {
    await page.evaluate(() => window.bluemap.setLiveDisplay("entityRadius", 10));
    await sleep(300);
    assert.equal(await entityShown(40), true, "4 blocks from the player");
    assert.equal(await entityShown(41), false, "20 blocks from the player");
    await page.evaluate(() => window.bluemap.setLiveDisplay("entityRadius", null));
    await sleep(300);
    assert.equal(await entityShown(41), true);
});

await step("entity-distance from the camera", async () => {
    await page.evaluate(() => window.bluemap.setLiveDisplay("entityDistance", 50));
    // 290 blocks in front of the camera
    const far = await page.evaluate(() => {
        const camera = window.bluemap.mapViewer.camera;
        const dir = camera.getWorldDirection(new window.BlueMap.Three.Vector3());
        const length = Math.hypot(dir.x, dir.z) || 1;
        return {x: camera.position.x + dir.x / length * 290, z: camera.position.z + dir.z / length * 290};
    });
    await control({entity: 42, type: "minecraft:zombie", mob: 1, x: far.x, y: 64, z: far.z});
    await page.waitForFunction(() => window.bluemap.mapViewer.markers.markerSets.get("bm-entities")?.markers.has("bm-entity-42"), null, {timeout: 10000});
    await sleep(300);
    assert.equal(await entityShown(42), false, "290 blocks in front of the camera");
    await page.evaluate(() => window.bluemap.setLiveDisplay("entityDistance", 1000));
    await sleep(300);
    assert.equal(await entityShown(42), true);
    assert.equal(await page.evaluate(() => window.bluemap.setLiveDisplay("entityDistance", 5000) || window.bluemap.appState.live.entityDistance), 1000, "clamped");
});

await step("particles off: no effects; block-preview off: no previews and no hidden blocks", async () => {
    await page.evaluate(() => window.bluemap.setLiveDisplay("particles", false));
    await control({effect: "explosion", x: 8.5, y: 64.5, z: 10, power: 4, destroy: 1});
    await sleep(1500);
    assert.equal(await page.evaluate(() => window.bluemap.entityMarkerManager.particleSystem.count), 0);
    await page.evaluate(() => window.bluemap.setLiveDisplay("particles", true));

    await control({block: "6,64,8", state: "minecraft:stone"});
    await page.waitForFunction(() => window.bluemap.entityMarkerManager.blockPreviews.previews.size === 1, null, {timeout: 5000});
    await page.evaluate(() => window.bluemap.setLiveDisplay("blockPreview", false));
    await sleep(300);
    assert.equal(await page.evaluate(() => window.bluemap.entityMarkerManager.blockPreviews.previews.size), 0);
    assert.equal(await page.evaluate(() => window.bluemap.mapViewer.data.uniforms.hiddenBlockCount.value), 0);
    await page.evaluate(() => window.bluemap.setLiveDisplay("blockPreview", true));
});

await step("the settings are saved with the user-settings and loaded again", async () => {
    await page.evaluate(() => {
        window.bluemap.settings.useCookies = true;
        window.bluemap.setLiveDisplay("entityRadius", 12);
        window.bluemap.setLiveDisplay("particles", false);
        window.bluemap.saveUserSettings();
        window.bluemap.setLiveDisplay("entityRadius", null);
        window.bluemap.setLiveDisplay("particles", true);
        window.bluemap.loadUserSettings();
    });
    const live = await page.evaluate(() => ({r: window.bluemap.appState.live.entityRadius, p: window.bluemap.appState.live.particles}));
    assert.deepEqual(live, {r: 12, p: false});
    await page.evaluate(() => {
        window.bluemap.setLiveDisplay("entityRadius", null);
        window.bluemap.setLiveDisplay("particles", true);
        window.bluemap.saveUserSettings();
    });
});

await step("no uncaught errors", async () => {
    assert.deepEqual(pageErrors, []);
});

await browser.close();

const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} steps passed`);
process.exit(failed.length ? 1 : 0);
