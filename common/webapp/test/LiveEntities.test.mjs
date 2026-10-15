// Unit-tests for src/js/markers/LiveEntityData.js and the EntityMarker (BlueMap Live)
// Run with: npm test

import {test} from "node:test";
import assert from "node:assert/strict";
import {PerspectiveCamera, Vector3} from "three";

import {
    droppedItemMotion, entityKind, parseEntitiesResponse, parseEntity, projectileDirection,
} from "../src/js/markers/LiveEntityData.js";
import {EntityMarker} from "../src/js/markers/EntityMarker.js";
import {ItemAssetCache} from "../src/js/markers/player/ItemAssetCache.js";

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
    assert.equal(entityKind(parseEntity(raw({type: "minecraft:arrow", item: {id: "minecraft:arrow"}}))), "projectile");
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

    const arrow = new EntityMarker("bm-entity-3", cache());
    arrow.updateFromData(parseEntity(raw({type: "minecraft:arrow", item: {id: "minecraft:arrow"}, velocity: {x: 30, y: 0, z: 0}})), 250);
    await flush();
    arrow.step(0.05, camera);
    arrow.updateMatrixWorld(true);
    // the item-diagonal (tail (0,0) -> tip (1,1)) points along +x (the flight-direction)
    const tail = arrow.view.content.localToWorld(new Vector3(0, 0, 0.5));
    const tip = arrow.view.content.localToWorld(new Vector3(1, 1, 0.5));
    const along = tip.sub(tail).normalize();
    assert.ok(along.x > 0.99, `arrow direction ${along.toArray()}`);
});
