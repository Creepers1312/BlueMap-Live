// BlueMap Live – browser end-to-end test for the QoL-features (phase 13): entity-filter, name-tags, health-bars,
// world-clock, quality-presets, live-indicator, follow-camera, weather
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

await step("entity-filter: categories from the spawn-group, switched off categories are hidden", async () => {
    await control({uuid: PLAYER, name: "Notch", x: 8.5, y: 64, z: 10, health: 15, maxHealth: 20, precipitation: "rain"});
    await control({entity: 50, type: "minecraft:zombie", mob: 1, x: 10.5, y: 64, z: 8, group: "monster", health: 10, maxHealth: 20});
    await control({entity: 51, type: "minecraft:cow", mob: 1, x: 6.5, y: 64, z: 8, group: "creature", health: 10, maxHealth: 10, mobName: "Berta"});
    await control({entity: 52, type: "minecraft:item", x: 8.5, y: 64, z: 6, item: "minecraft:diamond", ground: 1});
    await page.waitForFunction(() => window.bluemap.mapViewer.markers.markerSets.get("bm-entities")?.markers.size === 3, null, {timeout: 10000});
    await sleep(500);
    assert.equal(await entityShown(50), true);
    await page.evaluate(() => window.bluemap.setLiveDisplay("category.hostile", false));
    await sleep(300);
    assert.deepEqual([await entityShown(50), await entityShown(51), await entityShown(52)], [false, true, true]);
    await page.evaluate(() => window.bluemap.setLiveDisplay("category.items", false));
    await sleep(300);
    assert.deepEqual([await entityShown(50), await entityShown(51), await entityShown(52)], [false, true, false]);
    await page.evaluate(() => { window.bluemap.setLiveDisplay("category.hostile", true); window.bluemap.setLiveDisplay("category.items", true); });
    await sleep(300);
    assert.deepEqual([await entityShown(50), await entityShown(51), await entityShown(52)], [true, true, true]);
});

await step("the filter-switches are in the settings-menu", async () => {
    await openSettings();
    const text = await page.evaluate(() => document.body.innerText);
    for (const label of ["Hostile mobs", "Animals", "Boats and minecarts", "Name tags", "Health bars"]) assert.ok(text.includes(label), label);
    await page.evaluate(() => [...document.querySelectorAll(".group")].find(g => g.innerText.includes("Filter entities"))?.scrollIntoView());
    await sleep(300);
    await page.screenshot({path: `${OUT}/q01-filter.png`});
    await page.evaluate(() => window.bluemap.appState.menu.isOpen = false);
    await sleep(300);
});

const labelOf = id => page.evaluate(id => {
    const m = window.bluemap.mapViewer.markers.markerSets.get("bm-entities")?.markers.get("bm-entity-" + id);
    if (!m || !m.label) return null;
    const el = m.label.element;
    return {shown: el.style.display !== "none" && el.isConnected, name: el.querySelector(".bm-entity-name").textContent,
        nameShown: el.querySelector(".bm-entity-name").style.display !== "none",
        health: el.querySelector(".bm-health").style.display !== "none" ? el.querySelector(".bm-health-text").textContent : null};
}, id);

await step("name-tags: a named mob shows its name, unnamed mobs have no label; switched off: none", async () => {
    await sleep(300);
    assert.deepEqual(await labelOf(51), {shown: true, name: "Berta", nameShown: true, health: null});
    assert.equal(await labelOf(50), null);
    await page.screenshot({path: `${OUT}/q02-nametag.png`});
    await page.evaluate(() => window.bluemap.setLiveDisplay("nameTags", false));
    await sleep(300);
    assert.equal(await labelOf(51), null);
    await page.evaluate(() => window.bluemap.setLiveDisplay("nameTags", true));
});

await step("health-bars: mobs and players show their health in hearts", async () => {
    await page.evaluate(() => window.bluemap.setLiveDisplay("healthBars", true));
    await sleep(300);
    assert.deepEqual(await labelOf(50), {shown: true, name: "", nameShown: false, health: "♥ 5 / 10"});
    assert.deepEqual(await labelOf(51), {shown: true, name: "Berta", nameShown: true, health: "♥ 5 / 5"});
    const player = await page.evaluate(() => {
        const el = document.querySelector(".bm-marker-player .bm-player-health");
        return {display: el.style.display, width: el.firstElementChild.style.width};
    });
    assert.deepEqual(player, {display: "", width: "75%"});
    await page.screenshot({path: `${OUT}/q03-health.png`});
    // the name of the player is hidden with the name-tags
    await page.evaluate(() => window.bluemap.setLiveDisplay("nameTags", false));
    await sleep(300);
    assert.equal(await page.evaluate(() => document.querySelector(".bm-marker-player").getAttribute("name-data")), "hidden");
    await page.evaluate(() => { window.bluemap.setLiveDisplay("nameTags", true); window.bluemap.setLiveDisplay("healthBars", false); });
    await sleep(300);
    assert.equal(await page.evaluate(() => document.querySelector(".bm-marker-player .bm-player-health").style.display), "none");
    assert.equal(await page.evaluate(() => document.querySelector(".bm-marker-player").getAttribute("name-data")), "shown");
});

await step("labels are removed with their entity", async () => {
    await control({removeEntity: 51});
    await page.waitForFunction(() => !window.bluemap.mapViewer.markers.markerSets.get("bm-entities")?.markers.get("bm-entity-51"), null, {timeout: 10000});
    assert.equal(await page.evaluate(() => [...document.querySelectorAll(".bm-entity-name")].filter(e => e.textContent === "Berta").length), 0);
});

//__MORE__

await step("no uncaught errors", async () => {
    assert.deepEqual(pageErrors, []);
});

await browser.close();

const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} steps passed`);
process.exit(failed.length ? 1 : 0);
