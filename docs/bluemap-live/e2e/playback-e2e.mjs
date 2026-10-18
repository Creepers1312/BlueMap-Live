// BlueMap Live – browser end-to-end test for the playback-buffer of the live-data (smooth movement although the
// responses arrive unevenly, like over the internet) and the frame-rate-limit (NOT part of the BlueMap build).
// Drives the ORIGINAL built BlueMap webapp in Chromium against LiveE2EServer.
// Usage: see docs/bluemap-live/e2e/README.md (restart the server before every run)

import {createRequire} from "node:module";
import assert from "node:assert/strict";

const require = createRequire(import.meta.url);
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || "playwright");

const BASE = process.env.E2E_BASE || "http://127.0.0.1:8100";
const A = "069a79f4-44e9-4726-a5be-fca90e38aaf5";

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

const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
const page = await browser.newPage({viewport: {width: 900, height: 600}});
const pageErrors = [];
page.on("pageerror", e => pageErrors.push(e.message));
page.on("console", msg => {
    if (msg.type() === "error" && !msg.text().includes("404") && !msg.text().includes("Failed to load resource")) pageErrors.push(msg.text());
});

// an uneven connection: every players.json-response is held back by 0..350 ms (reproducible)
let jitterIndex = 0;
let jitterOn = true;
await page.route("**/live/players.json*", async route => {
    const delay = jitterOn ? ((jitterIndex++ * 7919) % 36) * 10 : 0;
    await sleep(delay);
    await route.continue();
});

await page.goto(`${BASE}/#world:12:64:8.5:30:0:1:0:0:perspective`);
await page.waitForFunction(() => window.bluemap?.mapViewer?.map?.isLoaded, null, {timeout: 60000});

/**
 * Moves the player along x with 4 blocks per second (one sample every 250 ms) and records the displayed x of the
 * marker in every rendered frame. Returns the longest stop (ms) and the biggest jump (blocks) while it moves.
 */
async function measure() {
    let x = 0;
    await control({uuid: A, name: "Runner", x, y: 64, z: 8.5, yaw: -90, bodyYaw: -90, pitch: 0, respawn: 1});
    await sleep(1500);
    await page.evaluate(() => {
        window.__frames = [];
        window.__onFrame = () => {
            const m = window.bluemap.playerMarkerManager.getPlayerMarkerSet(false)?.getPlayerMarker("069a79f4-44e9-4726-a5be-fca90e38aaf5");
            if (m) window.__frames.push([performance.now(), m.position.x]);
        };
        window.bluemap.events.addEventListener("bluemapRenderFrame", window.__onFrame);
    });
    const start = Date.now();
    for (let i = 1; i <= 32; i++) {
        x = i;
        await control({uuid: A, x, y: 64, z: 8.5, yaw: -90, bodyYaw: -90, pitch: 0, vx: 4, vy: 0, vz: 0});
        const next = start + i * 250;
        await sleep(Math.max(0, next - Date.now()));
    }
    await sleep(1200);
    const frames = await page.evaluate(() => {
        window.bluemap.events.removeEventListener("bluemapRenderFrame", window.__onFrame);
        return window.__frames;
    });
    // only while it moves (between 2 and 30 blocks)
    const moving = frames.filter(([, fx]) => fx > 2 && fx < 30);
    let longestStop = 0, stopStart = null, biggestJump = 0;
    for (let i = 1; i < moving.length; i++) {
        const dx = moving[i][1] - moving[i - 1][1];
        biggestJump = Math.max(biggestJump, dx);
        if (dx < 1e-4) {
            if (stopStart === null) stopStart = moving[i - 1][0];
            longestStop = Math.max(longestStop, moving[i][0] - stopStart);
        } else stopStart = null;
    }
    const frameTimes = moving.slice(1).map((f, i) => f[0] - moving[i][0]);
    const frameTime = frameTimes.sort((a, b) => a - b)[Math.floor(frameTimes.length / 2)] || 16;
    return {longestStop: Math.round(longestStop), biggestJump: Math.round(biggestJump * 100) / 100, frames: moving.length,
        frameTime: Math.round(frameTime)};
}

let buffered, unbuffered;

await step("default: the live-data is played back with 400 ms delay", async () => {
    assert.equal(await page.evaluate(() => window.bluemap.appState.live.delay), 400);
});

await step("uneven responses (0..350 ms late): with the buffer the player moves without stops", async () => {
    buffered = await measure();
    console.log("      buffered:  ", JSON.stringify(buffered));
    assert.ok(buffered.frames > 20, "enough frames");
    // 4 blocks per second: a stop longer than about 2 frames would be visible
    assert.ok(buffered.longestStop <= Math.max(120, 2.5 * buffered.frameTime), `longest stop ${buffered.longestStop} ms`);
});

await step("the same connection without buffer (setting \"off\"): stops and jumps (previous behavior)", async () => {
    await page.evaluate(() => window.bluemap.setLivePlaybackDelay(0));
    unbuffered = await measure();
    console.log("      unbuffered:", JSON.stringify(unbuffered));
    assert.ok(unbuffered.longestStop > buffered.longestStop, "the buffer removes the stops");
});

await step("the delay and the frame-rate-limit are saved and loaded with the user-settings", async () => {
    // the test-server disables cookies (settings.json), like the original they are then neither saved nor loaded
    const saved = await page.evaluate(async () => {
        const app = window.bluemap;
        app.settings.useCookies = true;
        app.setLivePlaybackDelay(750);
        app.setFpsLimit(30);
        app.saveUserSettings();
        const stored = [localStorage.getItem("bluemap-livePlaybackDelay"), localStorage.getItem("bluemap-fpsLimit")];
        app.setLivePlaybackDelay(400);
        app.setFpsLimit(0);
        await app.loadUserSettings();
        app.settings.useCookies = false;
        return {stored, live: {delay: app.appState.live.delay, fpsLimit: app.appState.live.fpsLimit}, viewer: app.mapViewer.data.fpsLimit};
    });
    assert.deepEqual(saved, {stored: ["750", "30"], live: {delay: 750, fpsLimit: 30}, viewer: 30});
});

await step("frame-rate-limit 30: while something moves the map renders at most about 30 frames per second", async () => {
    const fps = await page.evaluate(async () => {
        let frames = 0;
        const count = () => frames++;
        window.bluemap.events.addEventListener("bluemapRenderFrame", count);
        const until = performance.now() + 2000;
        while (performance.now() < until) {
            window.bluemap.mapViewer.redraw();
            await new Promise(r => setTimeout(r, 50));
        }
        window.bluemap.events.removeEventListener("bluemapRenderFrame", count);
        return frames / 2;
    });
    console.log("      fps:", fps);
    assert.ok(fps <= 33, `${fps} fps`);
    await page.evaluate(() => { window.bluemap.setFpsLimit(0); window.bluemap.setLivePlaybackDelay(400); window.bluemap.saveUserSettings(); });
});

await step("no uncaught errors", async () => {
    assert.deepEqual(pageErrors, []);
});

await browser.close();
const passed = results.filter(r => r.ok).length;
console.log(`\n${passed}/${results.length} steps passed`);
process.exit(passed === results.length ? 0 : 1);
