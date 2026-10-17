// BlueMap Live – Phase 2 regression check (NOT part of the BlueMap build).
// Renders the same test-map with the same camera in two webapp builds (e.g. original mc1.21.1 vs. bluemap-live)
// without any players and writes one screenshot per build. Compare them afterwards (see README.md).
// Usage: E2E_BASES="http://127.0.0.1:8101,http://127.0.0.1:8100" node regression-e2e.mjs

import {createRequire} from "node:module";
import {mkdirSync} from "node:fs";

const require = createRequire(import.meta.url);
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || "playwright");

const BASES = (process.env.E2E_BASES || "http://127.0.0.1:8101,http://127.0.0.1:8100").split(",");
const OUT = process.env.E2E_OUT || "e2e-out";
mkdirSync(OUT, {recursive: true});

const browser = await chromium.launch({
    args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});

for (let i = 0; i < BASES.length; i++) {
    const page = await browser.newPage({viewport: {width: 1280, height: 800}});
    const errors = [];
    page.on("pageerror", e => errors.push(e.message));

    // camera via the normal page-address: map:x:y:z:distance:rotation:angle:tilt:ortho:view
    await page.goto(`${BASES[i]}/#world:18:64:18:30:0.5:1:0:0:perspective`);
    await page.waitForFunction(() => window.bluemap?.mapViewer?.map?.isLoaded, null, {timeout: 60000});
    await page.waitForFunction(() => [...window.bluemap.mapViewer.map.hiresTileManager.tiles.values()].some(t => t.model), null, {timeout: 60000});
    await new Promise(r => setTimeout(r, 3000));

    const info = await page.evaluate(() => ({
        markerSets: [...window.bluemap.mapViewer.markers.markerSets.keys()],
        players: window.bluemap.playerMarkerManager?.getPlayerMarkerSet(false)?.markers.size ?? null,
        views: window.bluemap.mapViewer.map.data.views,
    }));
    const file = `${OUT}/regression-${i}.png`;
    await page.screenshot({path: file});
    console.log(JSON.stringify({base: BASES[i], file, errors, ...info}));
    await page.close();
}

await browser.close();
