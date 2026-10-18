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

await step("world-clock: time and weather of the world in the control-bar, runs with the cycle", async () => {
    await control({dayTime: 6000, rain: 0, thunder: 0, cycle: 1});
    await control({uuid: PLAYER, name: "Notch", x: 8.5, y: 64, z: 10, health: 15, maxHealth: 20});
    await page.waitForFunction(() => document.querySelector(".world-clock .world-clock-time")?.textContent.startsWith("12:0"), null, {timeout: 10000});
    assert.equal(await page.evaluate(() => document.querySelector(".world-clock-icon").classList.contains("weather-sun")), true);
    await control({dayTime: 18000, rain: 1, thunder: 1, cycle: 0, moonPhase: 4});
    await control({uuid: PLAYER, name: "Notch", x: 8.5, y: 64, z: 10});
    await page.waitForFunction(() => document.querySelector(".world-clock .world-clock-time")?.textContent === "00:00", null, {timeout: 10000});
    const clock = await page.evaluate(() => ({thunder: document.querySelector(".world-clock-icon").classList.contains("weather-thunder"),
        title: document.querySelector(".world-clock").title}));
    assert.equal(clock.thunder, true);
    assert.ok(clock.title.includes("Thunderstorm") && clock.title.includes("New moon"), clock.title);
    await page.screenshot({path: `${OUT}/q04-clock.png`, clip: {x: 600, y: 0, width: 680, height: 50}});
    await control({dayTime: "none"});
    await control({uuid: PLAYER, name: "Notch", x: 8.5, y: 64, z: 10});
    await page.waitForFunction(() => !document.querySelector(".world-clock"), null, {timeout: 10000});
});

await step("live-indicator: green while players.json arrives, red when the endpoint is down, green again", async () => {
    await page.waitForFunction(() => document.querySelector(".live-indicator")?.classList.contains("live-live"), null, {timeout: 10000});
    await control({down: 1});
    await page.waitForFunction(() => document.querySelector(".live-indicator")?.classList.contains("live-delayed"), null, {timeout: 10000});
    await page.waitForFunction(() => document.querySelector(".live-indicator")?.classList.contains("live-offline"), null, {timeout: 20000});
    assert.equal(await page.evaluate(() => document.querySelector(".live-indicator").title), "No connection to the live data");
    await page.screenshot({path: `${OUT}/q05-offline.png`, clip: {x: 600, y: 0, width: 680, height: 50}});
    await control({down: 0});
    await page.waitForFunction(() => document.querySelector(".live-indicator")?.classList.contains("live-live"), null, {timeout: 25000});
});

await step("quality-presets: set resolution, render-distances, frame-rate, entity-distance and particles together", async () => {
    const state = () => page.evaluate(() => ({ss: window.bluemap.mapViewer.data.superSampling, fps: window.bluemap.appState.live.fpsLimit,
        dist: window.bluemap.appState.live.entityDistance, particles: window.bluemap.appState.live.particles,
        hires: window.bluemap.mapViewer.data.loadedHiresViewDistance}));
    await openSettings();
    const clickPreset = name => page.evaluate(name => [...document.querySelectorAll(".simple-button")].find(b => b.innerText.trim() === name).click(), name);
    await clickPreset("Performance");
    await sleep(300);
    assert.deepEqual(await state(), {ss: 0.5, fps: 30, dist: 150, particles: false, hires: 60});
    const active = () => page.evaluate(() => [...document.querySelectorAll(".simple-button.active")].map(b => b.innerText.trim()));
    assert.ok((await active()).includes("Performance"));
    await page.evaluate(() => [...document.querySelectorAll(".group")].find(g => g.innerText.includes("Preset"))?.scrollIntoView());
    await sleep(300);
    await page.screenshot({path: `${OUT}/q06-presets.png`});
    await clickPreset("Beautiful");
    await sleep(300);
    const beautiful = await state();
    assert.deepEqual({...beautiful, hires: undefined}, {ss: 2, fps: 0, dist: 600, particles: true, hires: undefined});
    // changed by hand: no preset is active
    await page.evaluate(() => window.bluemap.setFpsLimit(60));
    await sleep(300);
    assert.ok(!(await active()).includes("Beautiful"));
    await clickPreset("Balanced");
    await sleep(300);
    assert.deepEqual({...(await state()), hires: undefined}, {ss: 1, fps: 60, dist: 300, particles: true, hires: undefined});
    await page.evaluate(() => window.bluemap.appState.menu.isOpen = false);
});

await step("follow-camera: first-person at the eyes (own model hidden), shoulder behind the head, back to normal", async () => {
    await control({uuid: PLAYER, name: "Notch", x: 8.5, y: 64, z: 12, yaw: 180, pitch: 0, skin: "classic"});
    await sleep(1500);
    await page.evaluate(() => window.bluemap.setLiveDisplay("followMode", "firstPerson"));
    await page.evaluate(uuid => window.bluemap.followPlayer(window.bluemap.playerMarkerManager.getPlayerMarker(uuid)), PLAYER);
    // the camera follows the played-back position (under load a bit later)
    await page.waitForFunction(() => Math.abs(window.bluemap.mapViewer.camera.position.z - 12) < 0.05 &&
        window.bluemap.appState.controls.state === "free", null, {timeout: 8000}).catch(() => {});
    const cam = () => page.evaluate(uuid => {
        const c = window.bluemap.mapViewer.camera.position;
        const m = window.bluemap.playerMarkerManager.getPlayerMarker(uuid);
        return {x: c.x, y: c.y, z: c.z, state: window.bluemap.appState.controls.state, model: m.model.visible, hidden: m.firstPersonHidden};
    }, PLAYER);
    let c = await cam();
    assert.equal(c.state, "free");
    assert.ok(Math.abs(c.x - 8.5) < 0.05 && Math.abs(c.y - 65.62) < 0.05 && Math.abs(c.z - 12) < 0.05, JSON.stringify(c));
    assert.equal(c.hidden, true);
    assert.equal(c.model, false, "the own model is not drawn around the camera");
    await page.screenshot({path: `${OUT}/q07-firstperson.png`});
    // the player walks: the camera goes along
    await control({uuid: PLAYER, name: "Notch", x: 8.5, y: 64, z: 10, yaw: 180, pitch: 0, skin: "classic"});
    await page.waitForFunction(() => Math.abs(window.bluemap.mapViewer.camera.position.z - 10) < 0.05, null, {timeout: 5000});

    // shoulder: facing north (yaw 180), behind is south (+z), right is east (+x)
    await page.evaluate(() => window.bluemap.setLiveDisplay("followMode", "shoulder"));
    await sleep(500);
    c = await cam();
    assert.ok(Math.abs(c.x - 9.25) < 0.05 && Math.abs(c.y - 65.97) < 0.05 && Math.abs(c.z - 13.5) < 0.05, JSON.stringify(c));
    assert.equal(c.hidden, false);
    assert.equal(c.model, true, "the model is in front of the camera");
    await page.screenshot({path: `${OUT}/q08-shoulder.png`});

    await page.evaluate(() => window.bluemap.setLiveDisplay("followMode", "firstPerson"));
    await sleep(300);
    await page.evaluate(() => window.bluemap.freeFlightControls.stopFollowingPlayerMarker());
    await sleep(300);
    c = await cam();
    assert.equal(c.hidden, false, "shown again when the camera stops following");
    await page.evaluate(() => window.bluemap.setLiveDisplay("followMode", "map"));
});

const weather = () => page.evaluate(() => {
    const v = window.bluemap.weatherView;
    return {active: v.active, sun: v.sun.visible, sunOpacity: v.sun.material.opacity, moon: v.moon.visible, stars: v.stars.visible,
        clouds: v.clouds.visible, cloudOpacity: v.clouds.material.opacity, drops: v.drops.visible, precipitation: v.precipitation,
        moonPhase: v.moonPhase};
});
const centerPixel = async name => {
    const png = decodePng(await page.screenshot({path: `${OUT}/${name}.png`, clip: {x: 630, y: 390, width: 20, height: 20}}));
    const [r, g, b] = png.pixel(10, 10);
    return {r, g, b};
};
// looking straight up in the free-flight view, above the clouds (they cover the sky from below like in vanilla)
const lookUp = () => page.evaluate(() => {
    window.bluemap.setFreeFlight(0);
    return new Promise(resolve => setTimeout(() => {
        const cm = window.bluemap.mapViewer.controlsManager;
        cm.position.set(8, 300, 8); // above the clouds
        cm.rotation = 0;
        cm.angle = Math.PI;
        window.bluemap.mapViewer.redraw();
        setTimeout(resolve, 600);
    }, 300));
});

await step("live weather: only in the world-time mode, sun at noon (textures of the resource-pack)", async () => {
    await control({dayTime: 6000, rain: 0, thunder: 0, cycle: 0});
    await control({uuid: PLAYER, name: "Notch", x: 8.5, y: 64, z: 10});
    await page.waitForFunction(() => window.bluemap.appState.worldTime.available, null, {timeout: 10000});
    await page.evaluate(() => window.bluemap.setWorldTimeLighting(false));
    await sleep(300);
    assert.equal((await weather()).active, false, "not without the world-time mode");
    await page.evaluate(() => window.bluemap.setWorldTimeLighting(true));
    await page.waitForFunction(() => window.bluemap.weatherView.sun.visible && window.bluemap.weatherView.clouds.visible, null, {timeout: 15000});
    const w = await weather();
    assert.deepEqual({active: w.active, sun: w.sun, stars: w.stars, drops: w.drops}, {active: true, sun: true, stars: false, drops: false});
    await lookUp();
    await page.screenshot({path: `${OUT}/q09-sky-noon.png`});
    const pixel = await centerPixel("q09-sun");
    // the sun is added to the sky (vanilla: additive), the yellow test-sun on the light-blue sky (r 128) is white
    assert.ok(pixel.r > 240 && pixel.g > 240, "the sun straight up at noon: " + JSON.stringify(pixel));
});

await step("live weather: midnight with stars and the moon-phase of the world", async () => {
    await control({dayTime: 18000, rain: 0, thunder: 0, cycle: 0, moonPhase: 2});
    await control({uuid: PLAYER, name: "Notch", x: 8.5, y: 64, z: 10});
    await page.waitForFunction(() => window.bluemap.weatherView.moonPhase === 2 && window.bluemap.weatherView.stars.visible, null, {timeout: 10000});
    await sleep(500);
    await page.screenshot({path: `${OUT}/q10-sky-night.png`});
    const pixel = await centerPixel("q10-moon");
    // phase 2 of the test-texture is blue
    assert.ok(pixel.b > 150 && pixel.r < 120 && pixel.g < 120, "the moon (phase 2) straight up at midnight: " + JSON.stringify(pixel));
});

await step("live weather: rain hides sun and moon, snow where the nearest player has snow, lightning in a thunderstorm", async () => {
    await control({dayTime: 6000, rain: 1, thunder: 0, cycle: 0});
    await control({uuid: PLAYER, name: "Notch", x: 8.5, y: 64, z: 10, health: 20, precipitation: "rain"});
    await page.evaluate(() => window.bluemap.resetCamera());
    await page.waitForFunction(() => window.bluemap.weatherView.drops.visible, null, {timeout: 10000});
    let w = await weather();
    assert.equal(w.precipitation, "rain");
    assert.equal(w.sunOpacity, 0);
    await sleep(500);
    await page.screenshot({path: `${OUT}/q11-rain.png`});
    await control({uuid: PLAYER, name: "Notch", x: 8.5, y: 64, z: 10, health: 20, precipitation: "snow"});
    await page.waitForFunction(() => window.bluemap.weatherView.precipitation === "snow", null, {timeout: 10000});
    await sleep(500);
    await page.screenshot({path: `${OUT}/q12-snow.png`});
    await control({uuid: PLAYER, name: "Notch", x: 8.5, y: 64, z: 10, health: 20, precipitation: "none"});
    await page.waitForFunction(() => !window.bluemap.weatherView.drops.visible, null, {timeout: 10000});

    await control({dayTime: 6000, rain: 1, thunder: 1, cycle: 0});
    await control({uuid: PLAYER, name: "Notch", x: 8.5, y: 64, z: 10, health: 20, precipitation: "rain"});
    await sleep(1500);
    const base = await page.evaluate(() => window.bluemap.mapViewer.data.uniforms.sunlightStrength.value);
    const flash = await page.evaluate(() => new Promise(resolve => {
        window.bluemap.weatherView.nextFlash = 0;
        let max = 0;
        const t0 = performance.now();
        const sample = () => {
            max = Math.max(max, window.bluemap.mapViewer.data.uniforms.sunlightStrength.value);
            if (performance.now() - t0 < 700) requestAnimationFrame(sample); else resolve(max);
        };
        sample();
    }));
    assert.ok(flash > base + 0.2, `the map is lit by the flash: ${base} -> ${flash}`);
    await sleep(800);
    const after = await page.evaluate(() => window.bluemap.mapViewer.data.uniforms.sunlightStrength.value);
    assert.ok(Math.abs(after - base) < 0.01, "back to the world-time lighting");
});

await step("live weather: clouds see-through from above, switched off in the settings", async () => {
    const w = await weather();
    assert.equal(w.clouds, true);
    assert.ok(w.cloudOpacity < 0.5, "from the map-view above the clouds: " + w.cloudOpacity);
    // the (checkered) clouds are drawn over the black void around the test-tile
    const png = decodePng(await page.screenshot({path: `${OUT}/q13-clouds-above.png`}));
    let gray = 0;
    for (let y = 100; y < 700; y += 10) for (let x = 100; x < 1180; x += 10) {
        const [r, g, b] = png.pixel(x, y);
        if (r > 8 && Math.abs(r - g) < 8 && Math.abs(r - b) < 8) gray++; // dark storm-clouds
    }
    assert.ok(gray > 500, "cloud-pixels: " + gray);
    await page.evaluate(() => window.bluemap.setLiveDisplay("weather", false));
    await sleep(300);
    assert.equal((await weather()).active, false);
    await page.evaluate(() => { window.bluemap.setLiveDisplay("weather", true); window.bluemap.setWorldTimeLighting(false); });
    await sleep(300);
    assert.equal((await weather()).active, false);
});

await step("settings-popup: opened from the menu, 6 tabs with the groups, settings work there, closed with Escape", async () => {
    await page.evaluate(() => document.querySelector(".control-bar .menu-button")?.click());
    await sleep(400);
    await page.evaluate(() => [...document.querySelectorAll(".side-menu .simple-button")].find(b => b.innerText.trim() === "Settings")?.click());
    await page.waitForSelector(".bm-settings-modal", {timeout: 5000});
    await sleep(500); // the side-menu fades out (0.3 s)
    assert.equal(await page.evaluate(() => !!document.querySelector(".side-menu")), false, "the side-menu is closed");
    const tabs = await page.evaluate(() => [...document.querySelectorAll(".bm-settings-modal-tab")].map(t => t.innerText.trim()));
    assert.deepEqual(tabs, ["View", "Live", "Entities", "Light & weather", "Controls", "General"]);
    const groupsOf = async i => {
        await page.evaluate(i => document.querySelectorAll(".bm-settings-modal-tab")[i].click(), i);
        await sleep(200);
        return page.evaluate(() => [...document.querySelectorAll(".bm-settings-modal .group > .title")].map(t => t.innerText));
    };
    const all = [];
    for (let i = 0; i < tabs.length; i++) all.push(...await groupsOf(i));
    // every group of the settings is in exactly one tab
    assert.equal(new Set(all).size, all.length);
    assert.ok(all.length >= 14, all.join(", "));
    assert.ok((await groupsOf(2)).includes("Filter entities"));
    // a switch in the popup changes the setting
    await page.evaluate(() => [...document.querySelectorAll(".bm-settings-modal .switch-button")].find(b => b.innerText.includes("Hostile mobs")).click());
    await sleep(200);
    assert.equal(await page.evaluate(() => window.bluemap.appState.live.categories.hostile), false);
    await page.evaluate(() => [...document.querySelectorAll(".bm-settings-modal .switch-button")].find(b => b.innerText.includes("Hostile mobs")).click());
    await page.screenshot({path: `${OUT}/q14-settings-popup.png`});
    await page.keyboard.press("Escape");
    await sleep(400);
    assert.equal(await page.evaluate(() => !!document.querySelector(".bm-settings-modal")), false);
});

//__MORE__

await step("no uncaught errors", async () => {
    assert.deepEqual(pageErrors, []);
});

await browser.close();

const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} steps passed`);
process.exit(failed.length ? 1 : 0);
