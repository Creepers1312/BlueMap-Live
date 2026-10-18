// BlueMap Live – Phase 8 browser end-to-end test (NOT part of the BlueMap build).
// The map-lighting follows the day-night-cycle of the world (an option next to the day/night-switch).
// Usage: see docs/bluemap-live/e2e/README.md

import {createRequire} from "node:module";
import assert from "node:assert/strict";
import {mkdirSync} from "node:fs";

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
    return res.json();
}

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

const sunlight = () => page.evaluate(() => window.bluemap.mapViewer.data.uniforms.sunlightStrength.value);
const waitSunlight = (value, timeout = 5000) => page.waitForFunction(value =>
    Math.abs(window.bluemap.mapViewer.data.uniforms.sunlightStrength.value - value) < 0.01, value, {timeout});
const clockButtons = () => page.locator(".control-bar .world-time-switch").count();

// the mean brightness of the center of the map
async function brightness() {
    await page.waitForTimeout(500);
    const png = await page.screenshot({clip: {x: 440, y: 250, width: 400, height: 300}});
    return page.evaluate(async b64 => {
        const img = new Image();
        img.src = "data:image/png;base64," + b64;
        await img.decode();
        const c = document.createElement("canvas");
        c.width = img.width; c.height = img.height;
        const ctx = c.getContext("2d");
        ctx.drawImage(img, 0, 0);
        const d = ctx.getImageData(0, 0, c.width, c.height).data;
        let sum = 0;
        for (let i = 0; i < d.length; i += 4) sum += d[i] + d[i + 1] + d[i + 2];
        return sum / (d.length / 4) / 3;
    }, png.toString("base64"));
}

await control({dayTime: "none"});
await page.goto(`${BASE}/#world:18:64:18:30:0:1:0:0:perspective`);
await page.waitForFunction(() => window.bluemap?.mapViewer?.map?.isLoaded, null, {timeout: 30000});
await page.waitForTimeout(1500);

await step("without a world-time (old server, nether, end) there is no clock-button and the lighting stays", async () => {
    assert.equal(await clockButtons(), 0);
    assert.equal(await page.evaluate(() => window.bluemap.appState.worldTime.available), false);
    assert.equal(await sunlight(), 1);
});

let dayBrightness;
await step("with a world-time the clock-button appears next to the day/night-switch, off by default", async () => {
    dayBrightness = await brightness();
    await control({dayTime: 18000, cycle: 0});
    await page.waitForFunction(() => window.bluemap.appState.worldTime.available, null, {timeout: 5000});
    assert.equal(await clockButtons(), 1);
    const order = await page.evaluate(() => {
        const sw = document.querySelector(".control-bar .day-night-switch");
        return sw.nextElementSibling?.classList.contains("world-time-switch");
    });
    assert.ok(order, "clock-button directly after the day/night-switch");
    await page.waitForTimeout(1200);
    assert.equal(await sunlight(), 1);
});

await step("clock-button: midnight darkens the map like Minecraft (sky-light 4/15)", async () => {
    await page.click(".control-bar .world-time-switch");
    await waitSunlight(4 / 15);
    assert.equal(await page.evaluate(() => window.bluemap.appState.worldTime.enabled), true);
    const night = await brightness();
    assert.ok(night < dayBrightness * 0.8, `night ${night} darker than day ${dayBrightness}`);
    await page.screenshot({path: `${OUT}/worldtime-night.png`});
});

await step("the map follows new samples: noon is full daylight, rain darker", async () => {
    await control({dayTime: 6000, cycle: 1});
    await waitSunlight(1);
    await control({dayTime: 6000, rain: 1, cycle: 1});
    await waitSunlight((15 - (1 - 11 / 16) * 11) / 15);
});

await step("the setting is saved and loaded with the other user-settings (useCookies)", async () => {
    // the test-server disables cookies (settings.json), like the original they are then neither saved nor loaded
    const saved = await page.evaluate(async () => {
        const app = window.bluemap;
        app.settings.useCookies = true;
        app.saveUserSettings();
        const value = localStorage.getItem("bluemap-worldTime");
        app.appState.worldTime.enabled = false;
        await app.loadUserSettings();
        app.settings.useCookies = false;
        return {value, enabled: app.appState.worldTime.enabled};
    });
    assert.deepEqual(saved, {value: "true", enabled: true});
});

await step("the day/night-switch ends the world-time mode and works like before", async () => {
    await control({dayTime: 6000, cycle: 0});
    await waitSunlight(1);
    await page.click(".control-bar .day-night-switch");
    await waitSunlight(0.25);
    assert.equal(await page.evaluate(() => window.bluemap.appState.worldTime.enabled), false);
    await page.waitForTimeout(1500);
    assert.equal(await sunlight(), 0.25, "the world-time does not override the own switch");
});

await step("settings-menu: the switch turns the mode on", async () => {
    await page.evaluate(() => window.bluemap.appState.menu.openPage("settings", "Settings"));
    const sw = page.locator(".side-menu .switch-button", {hasText: "Day/night cycle of the world"});
    await sw.click();
    await waitSunlight(1);
    assert.equal(await page.evaluate(() => window.bluemap.appState.worldTime.enabled), true);
    await page.evaluate(() => window.bluemap.appState.menu.closeAll());
});

await step("without a world-time again (other world) the button disappears", async () => {
    await control({dayTime: "none"});
    await page.waitForFunction(() => !window.bluemap.appState.worldTime.available, null, {timeout: 5000});
    assert.equal(await clockButtons(), 0);
});

await step("no uncaught errors in the page", async () => {
    assert.deepEqual(pageErrors, []);
});

await browser.close();

const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} steps passed`);
process.exit(failed.length ? 1 : 0);
