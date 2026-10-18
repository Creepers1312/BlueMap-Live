// Unit-tests for src/js/markers/LiveEntityData.js and the EntityMarker (BlueMap Live)
// Run with: npm test

import {test} from "node:test";
import assert from "node:assert/strict";
import {PerspectiveCamera, Vector3} from "three";

import {
    droppedItemMotion, entityKind, parseEntitiesResponse, parseEntity, projectileAngles, projectileDirection, projectilePhysics,
} from "../src/js/markers/LiveEntityData.js";
import {EntityMarker} from "../src/js/markers/EntityMarker.js";
import {buildArrowGeometry, ItemAssetCache} from "../src/js/markers/player/ItemAssetCache.js";
import {LIVE_PLAYBACK} from "../src/js/markers/LivePlayback.js";

// these tests apply every sample at once (the playback-buffer is tested in LivePlayback.test.mjs)
LIVE_PLAYBACK.delay = 0;

const flush = () => new Promise(r => setTimeout(r, 0));

const raw = (extra = {}) => ({
    id: 7, type: "minecraft:item", position: {x: 1, y: 64, z: 2}, rotation: {yaw: 0, pitch: 0},
    velocity: {x: 0, y: 0, z: 0}, time: 1000, onGround: true, item: {id: "minecraft:diamond"}, ...extra,
});

test("entities are parsed and validated", () => {
    const e = parseEntity(raw());
    assert.equal(e.id, 7);
    assert.equal(e.type, "minecraft:item");
    assert.deepEqual(e.position, {x: 1, y: 64, z: 2});
    assert.equal(e.onGround, true);
    assert.equal(e.item.id, "minecraft:diamond");

    assert.equal(parseEntity(raw({id: "7"})), null);
    assert.equal(parseEntity(raw({type: "<b>"})), null);
    assert.equal(parseEntity(raw({position: {x: NaN, y: 0, z: 0}})), null);
    assert.equal(parseEntity(raw({item: {id: "../evil"}})).item, null, "invalid item-ids are dropped");
    assert.deepEqual(parseEntity(raw({velocity: null, rotation: null})).velocity, {x: 0, y: 0, z: 0});

    const r = parseEntitiesResponse({protocol: 1, serverTime: 5, updateInterval: 250, entities: [raw(), raw({id: null}), 5]});
    assert.equal(r.entities.length, 1);
    assert.equal(r.invalid, 2);
    assert.equal(r.updateInterval, 250);
    assert.equal(parseEntitiesResponse({players: []}), null, "no entities-data");
    assert.equal(parseEntitiesResponse({protocol: 99, entities: [raw()]}).entities.length, 0, "newer protocol: nothing shown");
});

test("render-kinds: dropped items, arrow-like projectiles, thrown items, others not (yet)", () => {
    assert.equal(entityKind(parseEntity(raw())), "item");
    assert.equal(entityKind(parseEntity(raw({type: "minecraft:arrow", item: {id: "minecraft:arrow"}}))), "arrow", "vanilla arrow-model");
    assert.equal(entityKind(parseEntity(raw({type: "minecraft:spectral_arrow", item: null}))), "arrow");
    assert.equal(entityKind(parseEntity(raw({type: "minecraft:trident", item: {id: "minecraft:trident"}}))), "projectile");
    assert.equal(entityKind(parseEntity(raw({type: "minecraft:snowball", item: {id: "minecraft:snowball"}}))), "thrown");
    assert.equal(entityKind(parseEntity(raw({type: "minecraft:zombie", item: null}))), null);
});

test("projectile direction from the velocity, or from the vanilla projectile-rotation when stuck", () => {
    const flying = projectileDirection(parseEntity(raw({velocity: {x: 0, y: -30, z: 40}})));
    assert.ok(Math.abs(flying.y + 0.6) < 1e-9 && Math.abs(flying.z - 0.8) < 1e-9);
    // stuck: yaw = atan2(x, z) = 90° -> +x, pitch 0
    const stuck = projectileDirection(parseEntity(raw({rotation: {yaw: 90, pitch: 0}})));
    assert.ok(Math.abs(stuck.x - 1) < 1e-9 && Math.abs(stuck.z) < 1e-9);
});

test("vanilla dropped-item motion: bobbing between 0 and 0.2 blocks, one radian per second", () => {
    let min = 1, max = -1;
    for (let t = 0; t < 200; t++) {
        const {bob} = droppedItemMotion(t, 0.3);
        min = Math.min(min, bob);
        max = Math.max(max, bob);
    }
    assert.ok(min >= 0 && max <= 0.2 + 1e-9 && max - min > 0.19);
    assert.ok(Math.abs(droppedItemMotion(20, 0).rotation - 1) < 1e-9);
});

// --- marker ---

const QUAD = [0, 0, 0.5, 1, 0, 0.5, 1, 1, 0.5, 0, 1, 0.5, 0, 1, 1, 1, 1, 0, 0, 0, 0, -1];
const asset = {format: 1, textures: ["data:image/png;base64,AAAA"], models: [
    {type: "quads", quads: QUAD, display: {ground: {rotation: [0, 0, 0], translation: [0, 2, 0], scale: [0.5, 0.5, 0.5]}}},
]};
const cache = () => new ItemAssetCache("items/", () => Promise.resolve(asset), () => Promise.resolve({width: 16, height: 16}));
const meshCount = marker => { let n = 0; marker.traverse(o => { if (o.isMesh) n++; }); return n; };

test("entity-marker: dropped item bobs and rotates, interpolates, releases its item", async () => {
    const items = cache();
    const marker = new EntityMarker("bm-entity-7", items);
    marker.updateFromData(parseEntity(raw()), 250);
    await flush();
    marker.step(0.05, null);
    assert.equal(meshCount(marker), 1);
    assert.deepEqual(marker.position.toArray(), [1, 64, 2], "first update: no interpolation");
    assert.equal(marker.data.listed, false, "entities are not listed in the marker-menu");
    assert.ok(Math.abs(marker.view.scale.y - 0.5) < 1e-9, "ground display-transformation");
    const y0 = marker.body.position.y, r0 = marker.body.rotation.y;
    marker.step(0.5, null);
    assert.notEqual(marker.body.position.y, y0, "bobbing");
    assert.ok(marker.body.rotation.y > r0, "rotating");
    assert.ok(marker.body.position.y >= 0.125 - 1e-9, "lifted by 0.25 * ground-scale (vanilla)");

    marker.updateFromData(parseEntity(raw({position: {x: 2, y: 64, z: 2}, time: 1250})), 250);
    assert.equal(marker.step(0.1, null), true, "moving");
    assert.ok(marker.position.x > 1 && marker.position.x < 2);
    marker.step(0.5, null);
    assert.equal(marker.position.x, 2);
    assert.equal(marker.step(0.1, null), false, "arrived");

    marker.updateFromData(parseEntity(raw({position: {x: 100, y: 64, z: 2}, time: 1500})), 250);
    assert.equal(marker.position.x, 100, "far jumps are not interpolated");

    marker.dispose();
    assert.equal(items.entries.size, 0, "item released");
});

test("entity-marker: thrown items face the camera, arrows point along their flight", async () => {
    const camera = new PerspectiveCamera();
    camera.position.set(0, 80, 0);
    camera.lookAt(0, 64, 10);

    const thrown = new EntityMarker("bm-entity-1", cache());
    thrown.updateFromData(parseEntity(raw({type: "minecraft:snowball", item: {id: "minecraft:snowball"}})), 250);
    thrown.step(0.05, camera);
    assert.ok(thrown.body.quaternion.angleTo(camera.quaternion) < 1e-6, "billboard");

    const big = new EntityMarker("bm-entity-2", cache());
    big.updateFromData(parseEntity(raw({type: "minecraft:fireball", item: {id: "minecraft:fire_charge"}})), 250);
    big.step(0.05, camera);
    assert.equal(big.body.scale.x, 3, "vanilla fireball-scale");

    // the trident is still the flat item along the flight
    const trident = new EntityMarker("bm-entity-3", cache());
    trident.updateFromData(parseEntity(raw({type: "minecraft:trident", item: {id: "minecraft:trident"}, velocity: {x: 30, y: 0, z: 0}, onGround: false})), 250);
    await flush();
    trident.step(0.01, camera);
    trident.updateMatrixWorld(true);
    const tail = trident.view.content.localToWorld(new Vector3(0, 0, 0.5));
    const tip = trident.view.content.localToWorld(new Vector3(1, 1, 0.5));
    assert.ok(tip.sub(tail).normalize().x > 0.99, "trident along +x");
});

const arrowAsset = {format: 1, textures: ["data:image/png;base64,AAAA"], models: [{type: "arrow", texture: 0, display: {}}]};
const arrowCache = () => new ItemAssetCache("entities/", () => Promise.resolve(arrowAsset), () => Promise.resolve({width: 32, height: 32}));

/** the direction of the arrow-model (vanilla: along +x) in world-space */
function arrowAxis(marker) {
    marker.updateMatrixWorld(true);
    const content = marker.view.content;
    const back = content.localToWorld(new Vector3(0.5, 0.5, 0.5)), front = content.localToWorld(new Vector3(1.5, 0.5, 0.5));
    return front.sub(back).normalize();
}

test("vanilla arrow-model: fletching and four shaft-quads, 0.9 blocks long, pointing along +x", () => {
    const geometry = buildArrowGeometry();
    const position = geometry.getAttribute("position");
    assert.equal(position.count, 6 * 6, "two fletching-quads + four shaft-quads");
    let minX = Infinity, maxX = -Infinity;
    for (let i = 0; i < position.count; i++) {
        minX = Math.min(minX, position.getX(i));
        maxX = Math.max(maxX, position.getX(i));
    }
    assert.ok(Math.abs(minX + 12 * 0.05625) < 1e-6 && Math.abs(maxX - 4 * 0.05625) < 1e-6, `${minX} .. ${maxX}`);
});

test("arrows: vanilla rotation from the flight-direction, the flight is predicted between samples", async () => {
    const arrow = new EntityMarker("bm-entity-9", cache(), arrowCache());
    // fired along +z and upwards: 2 blocks per tick forward, 1 up
    arrow.updateFromData(parseEntity(raw({type: "minecraft:arrow", item: null, position: {x: 0, y: 64, z: 0}, velocity: {x: 0, y: 20, z: 40}, onGround: false})), 250);
    await flush();
    arrow.step(0.001, null);
    let axis = arrowAxis(arrow);
    const expected = new Vector3(0, 20, 40).normalize();
    assert.ok(axis.distanceTo(expected) < 1e-3, `rotated like vanilla (yaw ${projectileAngles(expected).yaw}): ${axis.toArray()}`);

    // 0.25 s = 5 ticks of vanilla physics (drag 0.99, gravity 0.05 per tick)
    let z = 0, vz = 2, y = 64, vy = 1;
    for (let i = 0; i < 5; i++) {
        z += vz; y += vy;
        vz *= 0.99; vy = vy * 0.99 - 0.05;
    }
    for (let i = 0; i < 25; i++) arrow.step(0.01, null);
    assert.ok(Math.abs(arrow.position.z - z) < 0.05 && Math.abs(arrow.position.y - y) < 0.05,
        `predicted ${arrow.position.toArray()} expected ${[0, y, z]}`);
    axis = arrowAxis(arrow);
    assert.ok(axis.y < expected.y, "the arrow turns down while it falls");

    // the next sample (a bit different) is not a jump: the difference is blended away
    const before = arrow.position.clone();
    arrow.updateFromData(parseEntity(raw({type: "minecraft:arrow", item: null, position: {x: 0, y: y + 0.3, z: z - 0.2},
        velocity: {x: 0, y: vy * 20, z: vz * 20}, time: 1250, onGround: false})), 250);
    arrow.step(0.001, null);
    assert.ok(arrow.position.distanceTo(before) < 0.1, "no jump at the new sample");

    // stuck in a block (sent as resting): no flight anymore
    arrow.updateFromData(parseEntity(raw({type: "minecraft:arrow", item: null, position: {x: 0, y: 66, z: 12},
        rotation: {yaw: 0, pitch: -30}, onGround: true, time: 1500})), 250);
    for (let i = 0; i < 100; i++) arrow.step(0.01, null);
    assert.ok(arrow.position.distanceTo(new Vector3(0, 66, 12)) < 1e-6, "rests where it is stuck");
    assert.equal(arrow.step(0.01, null), false, "not moving");
    axis = arrowAxis(arrow);
    assert.ok(axis.z > 0.8 && axis.y < -0.4, `stuck arrow keeps its rotation: ${axis.toArray()}`);

    arrow.dispose();
});

test("arrows stop where the server predicted the impact on a block (no flight through walls)", async () => {
    const arrow = new EntityMarker("bm-entity-10", cache(), arrowCache());
    // along +z with 2 blocks per tick, the wall is hit after 2.5 ticks at z = 5
    arrow.updateFromData(parseEntity(raw({type: "minecraft:arrow", item: null, position: {x: 0, y: 64, z: 0},
        velocity: {x: 0, y: 0, z: 40}, onGround: false, impact: {x: 0, y: 63.9, z: 5, ticks: 2.5}})), 250);
    await flush();
    const zs = [];
    for (let i = 0; i < 40; i++) {
        arrow.step(0.01, null);
        zs.push(arrow.position.z);
    }
    assert.ok(Math.max(...zs) <= 5 + 1e-9, `never behind the wall: max z ${Math.max(...zs)}`);
    assert.ok(Math.abs(arrow.position.z - 5) < 1e-9 && Math.abs(arrow.position.y - 63.9) < 1e-9, "rests at the impact");
    assert.ok(zs.some(z => z > 1 && z < 4.9), "flies until then");
    assert.equal(arrow.step(0.01, null), false, "not moving anymore");

    assert.equal(parseEntity(raw({impact: {x: 1, y: 2, z: 3, ticks: -1}})).impact, null, "invalid impact");
    arrow.dispose();
});

test("the same sample again (cached live/entities.json) does not restart the motion", async () => {
    const arrow = new EntityMarker("bm-entity-11", cache(), arrowCache());
    const sample = () => parseEntity(raw({type: "minecraft:arrow", item: null, position: {x: 0, y: 64, z: 0},
        velocity: {x: 0, y: 0, z: 40}, onGround: false, time: 5000}));
    arrow.updateFromData(sample(), 250);
    for (let i = 0; i < 10; i++) arrow.step(0.01, null);
    const z = arrow.position.z;
    arrow.updateFromData(sample(), 250);
    arrow.step(0.01, null);
    assert.ok(arrow.position.z > z, `flies on (${z} -> ${arrow.position.z})`);
    arrow.dispose();
});

test("projectile-physics like vanilla", () => {
    assert.deepEqual(projectilePhysics("minecraft:arrow"), {gravity: 0.05, drag: 0.99});
    assert.deepEqual(projectilePhysics("minecraft:snowball"), {gravity: 0.03, drag: 0.99});
    assert.deepEqual(projectilePhysics("minecraft:fireball"), {gravity: 0, drag: 1});
});

import {withinPlayerRadius} from "../src/js/markers/LiveDisplay.js";

test("live-display: entities within the chosen radius around the shown players", () => {
    const players = [{x: 0, y: 64, z: 0}, {x: 100, y: 64, z: 0}];
    assert.equal(withinPlayerRadius({x: 5, y: 64, z: 0}, players, null), true, "null: all");
    assert.equal(withinPlayerRadius({x: 5, y: 64, z: 0}, players, 10), true);
    assert.equal(withinPlayerRadius({x: 50, y: 64, z: 0}, players, 10), false);
    assert.equal(withinPlayerRadius({x: 95, y: 64, z: 0}, players, 10), true, "the nearest player counts");
    assert.equal(withinPlayerRadius({x: 0, y: 64, z: 0}, [], 10), false, "no shown player: nothing");
    assert.equal(parseEntitiesResponse({protocol: 1, entities: [], radius: 64}).radius, 64);
    assert.equal(parseEntitiesResponse({protocol: 1, entities: []}).radius, null);
});

import {entityCategory, LIVE_DISPLAY, LIVE_DISPLAY_KEYS, liveDisplayValue, setLiveDisplayValue} from "../src/js/markers/LiveDisplay.js";

test("live-display: the entity-categories of the filter", () => {
    assert.equal(entityCategory("minecraft:zombie", "mob", "monster"), "hostile");
    assert.equal(entityCategory("minecraft:cow", "mob", "creature"), "animals");
    assert.equal(entityCategory("minecraft:cod", "mob", "water_ambient"), "animals");
    assert.equal(entityCategory("minecraft:villager", "mob", "misc"), "other");
    assert.equal(entityCategory("minecraft:zombie", "mob", null), "other", "an older server without groups");
    assert.equal(entityCategory("minecraft:item", "item", null), "items");
    assert.equal(entityCategory("minecraft:arrow", "arrow", null), "items");
    assert.equal(entityCategory("minecraft:oak_boat", null, null), "vehicles");
    assert.equal(entityCategory("minecraft:chest_minecart", null, null), "vehicles");
    assert.equal(entityCategory("minecraft:bamboo_raft", null, null), "vehicles");
    assert.equal(entityCategory("minecraft:area_effect_cloud", "particles", null), null, "clouds belong to the particles");
});

test("live-display: settings are validated, categories and switches are saved under their keys", () => {
    assert.ok(LIVE_DISPLAY_KEYS.includes("category.hostile") && LIVE_DISPLAY_KEYS.includes("healthBars"));
    assert.equal(setLiveDisplayValue("category.hostile", false), true);
    assert.equal(LIVE_DISPLAY.categories.hostile, false);
    assert.equal(liveDisplayValue("category.hostile"), false);
    setLiveDisplayValue("category.hostile", "garbage");
    assert.equal(LIVE_DISPLAY.categories.hostile, true);
    assert.equal(setLiveDisplayValue("category.evil", false), false);
    assert.equal(setLiveDisplayValue("unknown", 1), false);
    setLiveDisplayValue("healthBars", "yes");
    assert.equal(LIVE_DISPLAY.healthBars, false, "off unless true");
    setLiveDisplayValue("nameTags", undefined);
    assert.equal(LIVE_DISPLAY.nameTags, true, "on unless false");
    setLiveDisplayValue("entityDistance", 5000);
    assert.equal(LIVE_DISPLAY.entityDistance, 1000);
    setLiveDisplayValue("entityDistance", 300);
});

import {formatHearts, healthColor, healthFraction, labelContent} from "../src/js/markers/EntityLabel.js";

test("entity-label: name-tags and health-bars follow the settings", () => {
    const on = {nameTags: true, healthBars: true}, names = {nameTags: true, healthBars: false};
    assert.equal(labelContent(null, 10, 20, names), null, "an unnamed mob without health-bars has no label");
    assert.deepEqual(labelContent("Bob", 10, 20, names), {name: "Bob", health: null, maxHealth: null, fraction: null});
    assert.deepEqual(labelContent("Bob", 10, 20, on), {name: "Bob", health: 10, maxHealth: 20, fraction: 0.5});
    assert.deepEqual(labelContent("Bob", 10, 20, {nameTags: false, healthBars: true}), {name: null, health: 10, maxHealth: 20, fraction: 0.5});
    assert.equal(labelContent(null, null, null, on), null, "an older server without health");
    assert.equal(healthFraction(30, 20), 1);
    assert.equal(healthFraction(5, 0), null);
    assert.equal(formatHearts(15), "7.5");
    assert.equal(formatHearts(20), "10");
    assert.equal(healthColor(1), "hsl(120, 80%, 45%)");
    assert.equal(healthColor(0), "hsl(0, 80%, 45%)");
});

import {eyeHeight, followCameraPose, viewDirection} from "../src/js/controls/FollowCamera.js";

test("follow-camera: eye-height, first-person at the eyes, shoulder behind and right of the head", () => {
    assert.equal(eyeHeight(null), 1.62);
    assert.equal(eyeHeight({sneaking: true}), 1.27);
    assert.equal(eyeHeight({swimming: true, sneaking: true}), 0.4);
    const d = viewDirection(0, 0);
    assert.deepEqual([d.x, d.y, d.z].map(v => Math.abs(+v.toFixed(9))), [0, 0, 1], "yaw 0 looks south (+z)");
    const eye = {x: 10, y: 65.62, z: 0};
    const first = followCameraPose("firstPerson", eye, 0, 0);
    assert.deepEqual(first.position, eye);
    assert.ok(Math.abs(first.rotation + Math.PI) < 1e-9 && Math.abs(first.angle - Math.PI / 2) < 1e-9, "like FreeFlightControls");
    // facing south: behind is north (-z), right is west (-x)
    const shoulder = followCameraPose("shoulder", eye, 0, 0).position;
    assert.deepEqual([shoulder.x, shoulder.y, shoulder.z].map(v => +v.toFixed(6)), [9.25, 65.97, -3.5]);
    // looking down: the camera is above
    assert.ok(followCameraPose("shoulder", eye, 0, 60).position.y > eye.y + 2);
});
