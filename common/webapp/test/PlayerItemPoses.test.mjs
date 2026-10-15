// Unit-tests for src/js/markers/player/PlayerItemPoses.js and the item-poses of the PlayerAnimator
// Run with: npm test

import {test} from "node:test";
import assert from "node:assert/strict";

import {applyArmPoses, armPoses, itemPredicates, selectItemModel} from "../src/js/markers/player/PlayerItemPoses.js";
import {PlayerAnimator} from "../src/js/markers/player/PlayerAnimator.js";
import {parsePlayer} from "../src/js/markers/LivePlayerData.js";

const PI = Math.PI;
const item = (id, extra = {}) => ({id, glint: false, customModelData: null, charged: false, firework: false, ...extra});
const state = (extra = {}) => ({leftHanded: false, mainHand: null, offHand: null, fishing: false, use: null, useTicks: 0, swinging: false, ...extra});
const arms = () => ({right: {pitch: 0.4, yaw: 0}, left: {pitch: -0.4, yaw: 0}});
const head = {pitch: 0, yaw: 0};

test("arm-poses: empty hands, held items, main hand left", () => {
    assert.deepEqual(armPoses(state()), {right: "empty", left: "empty"});
    assert.deepEqual(armPoses(state({mainHand: item("minecraft:diamond_sword")})), {right: "item", left: "empty"});
    assert.deepEqual(armPoses(state({mainHand: item("minecraft:diamond_sword"), offHand: item("minecraft:shield")})), {right: "item", left: "item"});
    assert.deepEqual(armPoses(state({leftHanded: true, mainHand: item("minecraft:diamond_sword")})), {right: "empty", left: "item"},
        "the main hand is the left arm");
});

test("arm-poses: used items (vanilla UseAction -> ArmPose)", () => {
    const use = (action, mainHand = true) => ({mainHand, action});
    assert.equal(armPoses(state({offHand: item("minecraft:shield"), use: use("block", false)})).left, "block");
    assert.equal(armPoses(state({mainHand: item("minecraft:bow"), use: use("bow")})).right, "bow_and_arrow");
    assert.equal(armPoses(state({mainHand: item("minecraft:trident"), use: use("spear")})).right, "throw_spear");
    assert.equal(armPoses(state({mainHand: item("minecraft:crossbow"), use: use("crossbow")})).right, "crossbow_charge");
    assert.equal(armPoses(state({mainHand: item("minecraft:spyglass"), use: use("spyglass")})).right, "spyglass");
    assert.equal(armPoses(state({mainHand: item("minecraft:goat_horn"), use: use("toot_horn")})).right, "toot_horn");
    assert.equal(armPoses(state({mainHand: item("minecraft:brush"), use: use("brush")})).right, "brush");
    assert.equal(armPoses(state({mainHand: item("minecraft:apple"), use: use("eat")})).right, "eat");
    assert.equal(armPoses(state({mainHand: item("minecraft:potion"), use: use("drink")})).right, "eat");
    assert.equal(armPoses(state({mainHand: item("minecraft:stick"), use: use("none")})).right, "item");

    // two-handed: the other hand only holds its item
    assert.deepEqual(armPoses(state({mainHand: item("minecraft:bow"), offHand: item("minecraft:torch"), use: use("bow")})),
        {right: "bow_and_arrow", left: "item"});
    // charged crossbow (not swinging) is held with both hands
    assert.equal(armPoses(state({mainHand: item("minecraft:crossbow", {charged: true})})).right, "crossbow_hold");
    assert.equal(armPoses(state({mainHand: item("minecraft:crossbow", {charged: true}), swinging: true})).right, "item");
});

test("arm-poses: vanilla angles", () => {
    let a = arms();
    applyArmPoses(a, {right: "item", left: "empty"}, state({mainHand: item("minecraft:stick")}), head, false);
    assert.ok(Math.abs(a.right.pitch - (0.4 * 0.5 - PI / 10)) < 1e-9, "ITEM: half the walking-swing, slightly forward");
    assert.equal(a.left.pitch, -0.4, "the empty arm keeps the walking-swing");

    a = arms();
    applyArmPoses(a, {right: "bow_and_arrow", left: "item"}, state({mainHand: item("minecraft:bow"), use: {mainHand: true, action: "bow"}}), {pitch: 0.2, yaw: 0.1}, false);
    assert.ok(Math.abs(a.right.pitch - (-PI / 2 + 0.2)) < 1e-9 && Math.abs(a.left.pitch - (-PI / 2 + 0.2)) < 1e-9, "both arms forward along the view");
    assert.ok(Math.abs(a.right.yaw - (-0.1 + 0.1)) < 1e-9 && Math.abs(a.left.yaw - (0.1 + 0.1 + 0.4)) < 1e-9);

    a = arms();
    applyArmPoses(a, {right: "empty", left: "block"}, state({offHand: item("minecraft:shield"), use: {mainHand: false, action: "block"}}), head, false);
    assert.ok(Math.abs(a.left.yaw - 30 * PI / 180) < 1e-9, "the left arm holds the shield in front of the body");
    assert.equal(a.right.pitch, 0.4, "while using only the using arm is posed");

    // crossbow charge: the pulling arm moves with the progress
    const start = arms(), end = arms();
    const charging = {mainHand: item("minecraft:crossbow"), use: {mainHand: true, action: "crossbow"}};
    applyArmPoses(start, {right: "crossbow_charge", left: "empty"}, state({...charging, useTicks: 0}), head, false);
    applyArmPoses(end, {right: "crossbow_charge", left: "empty"}, state({...charging, useTicks: 25}), head, false);
    assert.ok(Math.abs(start.left.yaw - 0.4) < 1e-9 && Math.abs(end.left.yaw - 0.85) < 1e-9);
    assert.ok(Math.abs(end.left.pitch + PI / 2) < 1e-9);
});

test("item-model predicates and override selection (vanilla rules)", () => {
    const bow = item("minecraft:bow");
    const p = itemPredicates(state({mainHand: bow, use: {mainHand: true, action: "bow"}, useTicks: 13}), true);
    assert.equal(p.pulling, 1);
    assert.ok(Math.abs(p.pull - 0.65) < 1e-9);
    assert.equal(itemPredicates(state({mainHand: bow}), true).pulling, 0, "not used");
    assert.equal(itemPredicates(state({mainHand: bow, offHand: bow, use: {mainHand: true, action: "bow"}}), false).pulling, 0,
        "only the used hand");

    const models = [{}, {predicate: {pulling: 1}}, {predicate: {pulling: 1, pull: 0.65}}, {predicate: {pulling: 1, pull: 0.9}}];
    assert.equal(selectItemModel(models, {pulling: 0, pull: 0}), 0);
    assert.equal(selectItemModel(models, {pulling: 1, pull: 0.1}), 1);
    assert.equal(selectItemModel(models, {pulling: 1, pull: 0.7}), 2, "the last matching override wins");
    assert.equal(selectItemModel(models, {pulling: 1, pull: 1.2}), 3);

    assert.equal(itemPredicates(state({offHand: item("minecraft:shield"), use: {mainHand: false, action: "block"}}), false).blocking, 1);
    assert.equal(itemPredicates(state({mainHand: item("minecraft:trident"), use: {mainHand: true, action: "spear"}}), true).throwing, 1);
    const crossbow = itemPredicates(state({mainHand: item("minecraft:crossbow", {charged: true, firework: true})}), true);
    assert.equal(crossbow.charged, 1);
    assert.equal(crossbow.firework, 1);
    assert.equal(itemPredicates(state({mainHand: item("minecraft:stick", {customModelData: 7})}), true).custom_model_data, 7);

    // cast: the rod in the main hand, or in the off hand if the main hand has none
    const rod = item("minecraft:fishing_rod");
    assert.equal(itemPredicates(state({mainHand: rod, offHand: rod, fishing: true}), true).cast, 1);
    assert.equal(itemPredicates(state({mainHand: rod, offHand: rod, fishing: true}), false).cast, 0);
    assert.equal(itemPredicates(state({offHand: rod, fishing: true}), false).cast, 1);
    assert.equal(itemPredicates(state({mainHand: rod}), true).cast, 0);
});

// --- animator ---

function player(extra = {}) {
    return parsePlayer({
        uuid: "069a79f4-44e9-4726-a5be-fca90e38aaf5", position: {x: 0, y: 64, z: 0},
        velocity: {x: 0, y: 0, z: 0},
        state: {sneaking: false, sprinting: false, onGround: true, swimming: false, flying: false, fallFlying: false},
        ...extra,
    });
}

const run = (animator, seconds, fps = 60) => {
    let active = false;
    for (let i = 0; i < Math.round(seconds * fps); i++) active = animator.step(1 / fps);
    return active;
};

test("animator: item-switch blends the arm-pose, empty hands go back to the normal pose", () => {
    const a = new PlayerAnimator();
    a.setTarget(player());
    run(a, 0.5);
    const empty = a.pose.parts.rightArm.rx;

    a.setTarget(player({equipment: {mainHand: {id: "minecraft:diamond_sword"}}}));
    a.step(1 / 60);
    const firstFrame = a.pose.parts.rightArm.rx;
    assert.ok(firstFrame < empty && firstFrame > empty - PI / 10 + 0.05, "blended, no jump");
    run(a, 0.5);
    assert.ok(Math.abs(a.pose.parts.rightArm.rx - (empty * 0.5 - PI / 10)) < 0.06, "ITEM pose reached");
    assert.equal(a.pose.items.right.item.id, "minecraft:diamond_sword");
    assert.equal(a.pose.items.left.item, null);
    assert.equal(a.step(1 / 60), false, "holding still is not active");

    a.setTarget(player({equipment: {}}));
    run(a, 0.5);
    assert.ok(Math.abs(a.pose.parts.rightArm.rx - empty) < 0.06);
    assert.equal(a.pose.items.right.item, null);
});

test("animator: bow drawing runs with an own clock between the samples and selects the pull-state", () => {
    const a = new PlayerAnimator();
    const bow = {equipment: {mainHand: {id: "minecraft:bow"}}};
    a.setTarget(player({...bow, use: {hand: "main", action: "bow", ticks: 0}}));
    assert.equal(run(a, 0.5), true, "drawing is active");
    assert.equal(a.pose.items.right.predicates.pulling, 1);
    assert.ok(Math.abs(a.pose.items.right.predicates.pull - 0.5) < 0.02, "0.5 s = 10 ticks = pull 0.5");
    assert.ok(Math.abs(a.pose.parts.rightArm.rx - (-PI / 2)) < 0.1, "arm forward");

    // the next sample (ticks a bit behind the own clock) is not applied as a jump
    a.setTarget(player({...bow, use: {hand: "main", action: "bow", ticks: 9}}));
    const before = a.pose.items.right.predicates.pull;
    a.step(1 / 60);
    assert.ok(a.pose.items.right.predicates.pull >= before, "no jump back");

    // released
    a.setTarget(player(bow));
    run(a, 0.5);
    assert.equal(a.pose.items.right.predicates.pulling, 0);
});

test("animator: eating/drinking (approximation) bobs the using arm, the other arm is unchanged", () => {
    const a = new PlayerAnimator();
    a.setTarget(player({equipment: {offHand: {id: "minecraft:apple"}}, use: {hand: "off", action: "eat", ticks: 0}}));
    let min = 0, max = -10;
    for (let i = 0; i < 60; i++) {
        a.step(1 / 60);
        if (i > 20) {
            min = Math.min(min, a.pose.parts.leftArm.rx);
            max = Math.max(max, a.pose.parts.leftArm.rx);
        }
    }
    assert.ok(max < -1, "the left (off hand) arm is lifted to the mouth");
    assert.ok(max - min > 0.05, "bobbing");
    assert.ok(Math.abs(a.pose.parts.rightArm.rx) < 0.1, "the right arm stays");
});

test("animator: high frame-rate only for uses that change over time", () => {
    const a = new PlayerAnimator();
    a.setTarget(player({equipment: {offHand: {id: "minecraft:shield"}}, use: {hand: "off", action: "block", ticks: 0}}));
    run(a, 0.5);
    assert.equal(a.step(1 / 60), false, "holding the shield up is a static pose");
    a.setTarget(player({equipment: {mainHand: {id: "minecraft:bow"}}, use: {hand: "main", action: "bow", ticks: 0}}));
    run(a, 0.5);
    assert.equal(a.step(1 / 60), true, "drawing a bow changes the item-model");
});

test("animator: reset keeps the items, snaps the arm-pose", () => {
    const a = new PlayerAnimator();
    a.setTarget(player({equipment: {mainHand: {id: "minecraft:diamond_sword"}}}));
    a.reset();
    a.step(1 / 60);
    assert.ok(Math.abs(a.pose.parts.rightArm.rx - (-PI / 10)) < 0.06, "pose without blending after a teleport");
});
