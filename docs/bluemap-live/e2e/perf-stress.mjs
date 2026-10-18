// BlueMap Live – performance measurement (NOT part of the BlueMap build, no pass/fail): a stress-scene against
// LiveE2EServer (20 players, 120 mobs, 60 items, 30 block-previews, rain, health-bars) and a CPU-profile of the page.
// Prints the JS-time of the render-function per frame (median, 90 %) and writes <out>.cpuprofile (Chrome DevTools).
// Usage: java ... LiveE2EServer <webapp-dist> 8100 &  then  node perf-stress.mjs <out>  (PLAYWRIGHT_MODULE, CHROMIUM_PATH)
import {createRequire} from "node:module";
import {writeFileSync} from "node:fs";
const require = createRequire(import.meta.url);
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const BASE = process.env.E2E_BASE || "http://127.0.0.1:8100", OUT = process.argv[2] || "perf-stress";
const c = p => fetch(`${BASE}/control?${new URLSearchParams(p)}`);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const browser = await chromium.launch({executablePath: process.env.CHROMIUM_PATH || undefined, args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"]});
const page = await browser.newPage({viewport: {width: 1280, height: 800}});
await page.goto(`${BASE}/#world:16:64:16:60:0.8:0.9:0:0:perspective`);
await page.waitForFunction(() => window.bluemap?.mapViewer?.map?.isLoaded, null, {timeout: 60000});
const PLAYERS = 20, MOBS = 120, ITEMS = 60;
const types = ["minecraft:zombie", "minecraft:cow", "minecraft:sheep", "minecraft:villager", "minecraft:creeper", "minecraft:skeleton"];
async function sample(t) {
  const jobs = [];
  for (let i = 0; i < PLAYERS; i++) {
    const a = t * 0.3 + i;
    jobs.push(c({uuid: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`, name: "P" + i, x: 16 + Math.cos(a) * 10, y: 64, z: 16 + Math.sin(a) * 10,
      yaw: (a * 57) % 360, pitch: 0, main: i % 2 ? "minecraft:diamond" : "none", health: 15, maxHealth: 20, precipitation: "rain"}));
  }
  await Promise.all(jobs);
  const e = [];
  for (let i = 0; i < MOBS; i++) {
    const a = t * 0.2 + i * 0.7;
    e.push(c({entity: 100 + i, type: types[i % types.length], mob: 1, x: 4 + (i % 12) * 2.5 + Math.cos(a), y: 64, z: 4 + Math.floor(i / 12) * 2.5 + Math.sin(a),
      bodyYaw: (a * 57) % 360, group: i % 2 ? "monster" : "creature", health: 10, maxHealth: 20}));
  }
  for (let i = 0; i < ITEMS; i++) e.push(c({entity: 1000 + i, type: "minecraft:item", item: "minecraft:diamond", x: 5 + (i % 10) * 2, y: 64, z: 30 + Math.floor(i / 10), ground: 1}));
  await Promise.all(e);
}
await c({dayTime: 13000, rain: 1, thunder: 0, cycle: 1, moonPhase: 0});
for (let t = 0; t < 3; t++) { await sample(t); await sleep(300); }
await page.evaluate(() => { window.bluemap.setWorldTimeLighting(true); window.bluemap.setLiveDisplay("healthBars", true); });
for (let i = 0; i < 30; i++) await c({block: `${2 + (i % 10)},64,${2 + Math.floor(i / 10)}`, state: "minecraft:stone", sky: 15, blockLight: 0, luminance: i % 7 ? 0 : 14});
await sleep(2000);
// frame-times (js only: the render-loop of the map-viewer)
await page.evaluate(() => {
  const mv = window.bluemap.mapViewer; const orig = mv.render.bind(mv); window.__times = []; window.__frames = 0;
  mv.render = delta => { const s = performance.now(); orig(delta); window.__times.push(performance.now() - s); };
  const count = () => { window.__frames++; requestAnimationFrame(count); }; requestAnimationFrame(count); window.__start = performance.now();
});
const client = await page.context().newCDPSession(page);
await client.send("Profiler.enable");
await client.send("Profiler.setSamplingInterval", {interval: 200});
await client.send("Profiler.start");
const keep = (async () => { for (let t = 3; t < 23; t++) { await sample(t); await sleep(250); } })();
await sleep(8000);
const {profile} = await client.send("Profiler.stop");
await keep;
writeFileSync(OUT + ".cpuprofile", JSON.stringify(profile));
const stats = await page.evaluate(() => { const t = window.__times.slice(5).sort((a, b) => a - b); return {fps: window.__frames / ((performance.now() - window.__start) / 1000), frames: t.length, median: t[t.length >> 1], p90: t[Math.floor(t.length * 0.9)], max: t[t.length - 1],
  entities: window.bluemap.mapViewer.markers.markerSets.get("bm-entities")?.markers.size, players: window.bluemap.playerMarkerManager.getPlayerMarkerSet(false)?.markers.size}; });
console.log(JSON.stringify(stats));
await browser.close();
