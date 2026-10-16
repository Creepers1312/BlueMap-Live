import {test} from "node:test";
import assert from "node:assert/strict";

import {chestPoint, chestTexture, CHEST_LIDS, lidHideBoxes, lidPitch, parseContainers, stepProgress} from "../src/js/markers/ChestLids.js";
import {ChestLidView, MAX_HIDDEN_BOXES} from "../src/js/markers/ChestLidView.js";
import {parseEntitiesResponse} from "../src/js/markers/LiveEntityData.js";
import {Vector3} from "three";

const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);

test("chest-lids: vanilla ChestLidAnimator and the lid-pitch of ChestBlockEntityRenderer", () => {
    assert.equal(stepProgress(0, true), 0.1);
    assert.equal(stepProgress(1, true), 1);
    assert.equal(stepProgress(0.05, false), 0);
    close(lidPitch(0), 0);
    close(lidPitch(1), -Math.PI / 2);
    close(lidPitch(0.5), -(1 - 0.125) * Math.PI / 2);
    assert.deepEqual(CHEST_LIDS.single[0].box, [1, 0, 0, 14, 5, 14]);
});

test("chest-lids: christmas-textures from December 24 to 26 (not for ender- and trapped chests)", () => {
    assert.equal(chestTexture("minecraft:entity/chest/normal_left", new Date(2026, 11, 25)), "minecraft:entity/chest/christmas_left");
    assert.equal(chestTexture("minecraft:entity/chest/normal", new Date(2026, 11, 27)), "minecraft:entity/chest/normal");
    assert.equal(chestTexture("minecraft:entity/chest/ender", new Date(2026, 11, 25)), "minecraft:entity/chest/ender");
    assert.equal(chestTexture("minecraft:entity/chest/trapped", new Date(2026, 11, 25)), "minecraft:entity/chest/trapped");
});

test("chest-lids: the chest-frame is turned like the renderer (-asRotation around the block-center)", () => {
    // the front (z = 16) of a south-facing chest is south, of a north-facing chest north, of an east-facing chest east
    const front = facing => chestPoint(8, 0, 16, facing);
    assert.deepEqual(front("south").map(v => +v.toFixed(9)), [0.5, 0, 1]);
    assert.deepEqual(front("north").map(v => +v.toFixed(9)), [0.5, 0, 0]);
    assert.deepEqual(front("east").map(v => +v.toFixed(9)), [1, 0, 0.5]);
    assert.deepEqual(front("west").map(v => +v.toFixed(9)), [0, 0, 0.5]);
});

test("chest-lids: hidden parts of the tile-chest: above the base (y 10) and the lock in front of it", () => {
    const [lid, lock] = lidHideBoxes({position: {x: 10, y: 64, z: -5}, facing: "west"});
    [10, 64 + 10.02 / 16, -5].forEach((v, i) => close(lid.min[i], v));
    [11, 64 + 16.01 / 16, -4].forEach((v, i) => close(lid.max[i], v));
    // facing west: the lock is on the west side (x 0..1/16), the base-front (x = 1/16) stays visible
    assert.ok(lock.min[0] < 10 && lock.max[0] < 10 + 1 / 16 - 0.001, JSON.stringify(lock));
    assert.ok(lock.min[1] > 64 + 6.9 / 16 && lock.max[1] < 64 + 10.1 / 16);
});

test("chest-lids: the containers of the entities-response are validated", () => {
    assert.deepEqual(parseContainers([{x: 1, y: 2, z: 3, texture: "minecraft:entity/chest/normal_left", facing: "north", part: "left"},
        {x: 1, y: 2, z: 3, texture: "minecraft:entity/zombie/zombie", facing: "north"}, {x: 1, y: 2, z: 3, texture: "minecraft:entity/chest/ender", facing: "up"}]),
    [{position: {x: 1, y: 2, z: 3}, texture: "minecraft:entity/chest/normal_left", facing: "north", part: "left"}]);
    assert.deepEqual(parseEntitiesResponse({protocol: 1, entities: []}).containers, []);
    assert.equal(parseEntitiesResponse({protocol: 1, entities: [], containers: [{x: 0, y: 0, z: 0, texture: "minecraft:entity/chest/ender",
        facing: "south"}]}).containers.length, 1);
});

function fakeTextures(state = "loaded") {
    const released = [];
    return {
        released,
        acquire: key => ({key, state}),
        release: entry => released.push(entry.key),
        retry: () => {},
        material: entry => entry.state === "loaded" ? {isMaterial: true, key: entry.key} : null,
    };
}

function uniforms() {
    return {hiddenBoxesMin: {value: Array.from({length: 16}, () => new Vector3())},
        hiddenBoxesMax: {value: Array.from({length: 16}, () => new Vector3())}, hiddenBoxCount: {value: 0}};
}

const chest = (x, part = "single") => ({position: {x, y: 64, z: 0}, texture: "minecraft:entity/chest/normal", facing: "south", part});

test("chest-lid-view: opens in 10 ticks, closes again, then the lid and its texture are removed", () => {
    const textures = fakeTextures();
    const view = new ChestLidView(textures);
    const u = uniforms();
    view.setOpen([chest(0)]);
    assert.equal(view.step(0.05), true);
    view.applyHiddenBoxes(u);
    assert.equal(u.hiddenBoxCount.value, 2, "the tile-lid is hidden while the lid is drawn");
    for (let i = 0; i < 10; i++) view.step(0.05);
    const lid = view.lids.get("0,64,0");
    assert.equal(lid.progress, 1);
    close(lid.pivot.rotation.x, -Math.PI / 2);
    assert.equal(view.step(0.05), false, "an open lid that does not move needs no high fps");
    view.setOpen([]);
    for (let i = 0; i < 12; i++) view.step(0.05);
    assert.equal(view.lids.size, 0);
    assert.deepEqual(textures.released, ["minecraft:entity/chest/normal"]);
    view.applyHiddenBoxes(u);
    assert.equal(u.hiddenBoxCount.value, 0);
});

test("chest-lid-view: no hidden boxes while the texture is loading, at most 16 boxes", () => {
    const view = new ChestLidView(fakeTextures("loading"));
    const u = uniforms();
    view.setOpen([chest(0)]);
    view.step(0.05);
    view.applyHiddenBoxes(u);
    assert.equal(u.hiddenBoxCount.value, 0, "the closed tile-lid stays until the lid can be drawn");

    const many = new ChestLidView(fakeTextures());
    many.setOpen(Array.from({length: 12}, (_, i) => chest(i * 2)));
    many.step(0.05);
    many.applyHiddenBoxes(u);
    assert.equal(u.hiddenBoxCount.value, MAX_HIDDEN_BOXES);
});
