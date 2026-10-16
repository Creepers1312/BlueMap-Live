// Unit-tests for the mob-models of BlueMap Live (src/js/markers/mob/*, the mob-part of LiveEntityData and EntityMarker)
// Run with: npm test

import {test} from "node:test";
import assert from "node:assert/strict";

import {buildPartGeometry, cuboidQuads} from "../src/js/markers/mob/MobModelGeometry.js";
import {createSkinBoxGeometry} from "../src/js/markers/player/PlayerModelGeometry.js";
import {ANIMATIONS, biped, createTransform, meleeAttack} from "../src/js/markers/mob/MobAnimations.js";
import {
    creeperSwelling, creeperWhiteOverlay, deathAngle, isLayerShown, layerTextures, limbTarget, MOB_TYPES, sheepWoolColor, slimeScale, VANILLA_MODELS,
    villagerTextures,
} from "../src/js/markers/mob/MobTypes.js";
import {MobAssetCache} from "../src/js/markers/mob/MobAssetCache.js";
import {MobModel} from "../src/js/markers/mob/MobModel.js";
import {placeholderLabel} from "../src/js/markers/mob/PlaceholderModel.js";
import {entityKind, parseEntity, parseMob} from "../src/js/markers/LiveEntityData.js";
import {EntityMarker} from "../src/js/markers/EntityMarker.js";

const flush = () => new Promise(r => setTimeout(r, 0));
const PI = Math.PI;

/** face-normal (world-space) + corner (world-space, relative to the box-center, rounded) -> uv in texture-pixels */
function uvMap(positions, uvs, toWorld, width, height, flipV) {
    const map = new Map();
    for (let t = 0; t < positions.length / 9; t++) {
        const p = i => toWorld([positions[t * 9 + i * 3], positions[t * 9 + i * 3 + 1], positions[t * 9 + i * 3 + 2]]);
        const [a, b, c] = [p(0), p(1), p(2)];
        const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
        const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
        const axis = n.map(Math.abs).indexOf(Math.max(...n.map(Math.abs)));
        for (let i = 0; i < 3; i++) {
            const position = p(i);
            const sign = Math.sign(position[axis]);
            const key = `${axis}${sign}|${position.map(x => Math.round(x * 100) / 100).join(",")}`;
            const uv = [uvs[(t * 3 + i) * 2] * width, (flipV ? 1 - uvs[(t * 3 + i) * 2 + 1] : uvs[(t * 3 + i) * 2 + 1]) * height];
            map.set(key, uv.map(x => Math.round(x * 100) / 100).join(","));
        }
    }
    return map;
}

test("vanilla cuboids map the texture like the (in-game verified) player-model", () => {
    // the head (8x8x8 at uv 0,0) and an arm (4x12x4 at uv 40,16) of a 64x64 texture
    for (const [box, uv, size] of [[[-4, -8, -4, 8, 8, 8], [0, 0], [8, 8, 8]], [[-3, -2, -2, 4, 12, 4], [40, 16], [4, 12, 4]]]) {
        const mob = buildPartGeometry([{uv, box}], [64, 64]);
        // vanilla model-space -> world (flip -1,-1,1 and the body-yaw of 180°): (x, -y, -z), centered
        const center = [box[0] + box[3] / 2, box[1] + box[4] / 2, box[2] + box[5] / 2];
        const mobWorld = p => [p[0] - center[0], -(p[1] - center[1]), -(p[2] - center[2])];
        const mobMap = uvMap(mob.getAttribute("position").array, mob.getAttribute("uv").array, mobWorld, 64, 64, true);

        const player = createSkinBoxGeometry(size, uv);
        const index = player.getIndex().array;
        const pos = player.getAttribute("position").array, puv = player.getAttribute("uv").array;
        const positions = [], uvs = [];
        for (const i of index) {
            positions.push(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
            uvs.push(puv[i * 2], puv[i * 2 + 1]);
        }
        const playerMap = uvMap(positions, uvs, p => p, 64, 64, true);

        assert.equal(mobMap.size, 24, "6 faces with 4 corners");
        for (const [key, value] of playerMap) assert.equal(mobMap.get(key), value, `uv at ${key}`);
    }
});

test("mirrored cuboids swap the x-side of the texture", () => {
    const normal = cuboidQuads({uv: [0, 16], box: [-2, 0, -2, 4, 12, 4]}, [64, 32]);
    const mirrored = cuboidQuads({uv: [0, 16], box: [-2, 0, -2, 4, 12, 4], mirror: true}, [64, 32]);
    // the west-face of the mirrored cuboid is at +x (where the east-face of the normal one is) with the west-uvs
    const xOf = quad => quad.corners[0].position[0];
    assert.equal(xOf(normal[2]), -2);
    assert.equal(xOf(mirrored[2]), 2);
    assert.deepEqual(new Set(mirrored[2].corners.map(c => c.uv.join())), new Set(normal[2].corners.map(c => c.uv.join())));
    // dilation enlarges the box, the uvs stay
    const big = cuboidQuads({uv: [0, 0], box: [-4, -8, -4, 8, 8, 8], dilation: 0.5}, [64, 64]);
    assert.equal(Math.min(...big.flatMap(q => q.corners.map(c => c.position[0]))), -4.5);
    assert.deepEqual(big[0].corners.map(c => c.uv), cuboidQuads({uv: [0, 0], box: [-4, -8, -4, 8, 8, 8]}, [64, 64])[0].corners.map(c => c.uv));
});

test("all mob-types reference existing model-layers and animations", () => {
    for (const [type, mob] of Object.entries(MOB_TYPES)) {
        assert.ok(ANIMATIONS[mob.animation], `${type}: animation ${mob.animation}`);
        for (const layer of mob.layers) {
            const model = VANILLA_MODELS.models[layer.model];
            assert.ok(model, `${type}: model ${layer.model}`);
            const textures = layerTextures(layer, {variant: null, baby: false, flags: new Set()});
            assert.ok(textures.length > 0 && textures.every(t => /^minecraft:entity\/[a-z0-9_/]+$/.test(t)), `${type}: ${textures}`);
        }
        // the animation runs on the parts of the main layer
        const parts = {};
        const collect = (p, prefix) => { for (const n in p) { parts[prefix + n] = createTransform(p[n]); if (p[n].children) collect(p[n].children, prefix + n + "/"); } };
        collect(VANILLA_MODELS.models[mob.layers[0].model].parts, "");
        ANIMATIONS[mob.animation](parts, {
            limbAngle: 1, limbDistance: 0.5, age: 10, headYaw: 20, headPitch: 10, swingProgress: 0,
            flags: new Set(["attacking"]), mainHand: {id: "minecraft:bow"}, leftHanded: false, wingAngle: 0.3,
        });
        for (const [name, t] of Object.entries(parts)) {
            for (const key of ["pitch", "yaw", "roll", "pivotX", "pivotY", "pivotZ"]) assert.ok(Number.isFinite(t[key]), `${type} ${name}.${key}`);
        }
    }
});

const input = (extra = {}) => ({
    limbAngle: 0, limbDistance: 0, age: 0, headYaw: 0, headPitch: 0, swingProgress: 0,
    flags: new Set(), mainHand: null, leftHanded: false, wingAngle: 0, ...extra,
});
const partsOf = layer => {
    const parts = {};
    const collect = (p, prefix) => { for (const n in p) { parts[prefix + n] = createTransform(p[n]); if (p[n].children) collect(p[n].children, prefix + n + "/"); } };
    collect(VANILLA_MODELS.models[layer].parts, "");
    return parts;
};

test("vanilla animations: zombies hold the arms forward, skeletons aim, legs swing opposite", () => {
    const zombie = partsOf("minecraft:zombie#main");
    ANIMATIONS.zombie(zombie, input());
    assert.ok(Math.abs(zombie.right_arm.pitch - -PI / 2.25) < 1e-9, "arms forward (not attacking)");
    ANIMATIONS.zombie(zombie, input({flags: new Set(["attacking"])}));
    assert.ok(Math.abs(zombie.right_arm.pitch - -PI / 1.5) < 1e-9, "arms raised while attacking");
    assert.equal(zombie.hat.pitch, zombie.head.pitch, "the hat follows the head");

    const skeleton = partsOf("minecraft:skeleton#main");
    ANIMATIONS.skeleton(skeleton, input({flags: new Set(["attacking"]), mainHand: {id: "minecraft:bow"}, headPitch: 10}));
    assert.ok(Math.abs(skeleton.right_arm.pitch - (-PI / 2 + 10 * PI / 180)) < 0.06, "bow: arms to the look-direction");
    ANIMATIONS.skeleton(skeleton, input());
    assert.ok(Math.abs(skeleton.right_arm.pitch) < 0.06, "not attacking: arms hang down");

    const cow = partsOf("minecraft:cow#main");
    ANIMATIONS.quadruped(cow, input({limbAngle: 1, limbDistance: 1, headYaw: 30}));
    assert.ok(Math.abs(cow.right_hind_leg.pitch + cow.left_hind_leg.pitch) < 1e-9, "hind legs opposite");
    assert.ok(Math.abs(cow.right_hind_leg.pitch + cow.right_front_leg.pitch) < 1e-9, "diagonal legs together");
    assert.ok(Math.abs(cow.head.yaw - PI / 6) < 1e-9);
    assert.ok(Math.abs(cow.body.pitch - 1.5707964) < 1e-6, "the body keeps its rotation from the model");

    const spider = partsOf("minecraft:spider#main");
    ANIMATIONS.spider(spider, input());
    assert.ok(Math.abs(spider.right_hind_leg.roll - -PI / 4) < 1e-9 && Math.abs(spider.left_front_leg.yaw - PI / 4) < 1e-9);

    const chicken = partsOf("minecraft:chicken#main");
    ANIMATIONS.chicken(chicken, input({wingAngle: 0.8}));
    assert.equal(chicken.right_wing.roll, 0.8);
    assert.equal(chicken.left_wing.roll, -0.8);

    const enderman = partsOf("minecraft:enderman#main");
    ANIMATIONS.enderman(enderman, input({limbAngle: 0, limbDistance: 1}));
    assert.ok(Math.abs(enderman.right_leg.pitch) <= 0.4 + 1e-9, "legs clamped");
    ANIMATIONS.enderman(enderman, input({flags: new Set(["angry"])}));
    assert.equal(enderman.head.pivotY, -18, "angry: the head is raised (mouth open)");

    const left = {pitch: 0, yaw: 0, roll: 0}, right = {pitch: 0, yaw: 0, roll: 0};
    meleeAttack(left, right, false, 0, 0);
    assert.ok(Math.abs(right.yaw - -0.1) < 1e-9 && Math.abs(left.yaw - 0.1) < 1e-9);
});

test("mob-types: textures, variants, colors and renderer-values", () => {
    assert.deepEqual(villagerTextures("villager", "desert/farmer/3", false), [
        "minecraft:entity/villager/villager", "minecraft:entity/villager/type/desert",
        "minecraft:entity/villager/profession/farmer", "minecraft:entity/villager/profession_level/gold",
    ]);
    assert.deepEqual(villagerTextures("villager", "plains/nitwit/1", false).length, 3, "nitwits have no level");
    assert.deepEqual(villagerTextures("villager", "plains/farmer/1", true).length, 2, "babies have no profession");
    assert.deepEqual(villagerTextures("villager", null, false), ["minecraft:entity/villager/villager", "minecraft:entity/villager/type/plains"]);

    assert.equal(sheepWoolColor("white"), 0xE6E6E6);
    assert.equal(sheepWoolColor("red"), 0x84221C);
    assert.equal(sheepWoolColor("unknown"), 0xE6E6E6);
    const mooshroom = MOB_TYPES["minecraft:mooshroom"].layers[0];
    assert.deepEqual(layerTextures(mooshroom, {variant: "brown"}), ["minecraft:entity/cow/brown_mooshroom"]);
    assert.deepEqual(layerTextures(mooshroom, {variant: null}), ["minecraft:entity/cow/red_mooshroom"]);

    const fur = MOB_TYPES["minecraft:sheep"].layers[1];
    assert.equal(isLayerShown(fur, {flags: new Set(), baby: false}), true);
    assert.equal(isLayerShown(fur, {flags: new Set(["sheared"]), baby: false}), false);
    const saddle = MOB_TYPES["minecraft:pig"].layers[1];
    assert.equal(isLayerShown(saddle, {flags: new Set(), baby: false}), false);
    assert.equal(isLayerShown(saddle, {flags: new Set(["saddled"]), baby: false}), true);

    assert.equal(deathAngle(0), 0);
    assert.equal(deathAngle(20), 90);
    assert.equal(deathAngle(20, 180), 180);
    assert.ok(deathAngle(5) > 0 && deathAngle(5) < 90);
    assert.equal(slimeScale(4), 0.999 * 4);
    assert.equal(limbTarget(0.1), 0.4);
    assert.equal(limbTarget(1), 1);
    assert.equal(placeholderLabel("minecraft:magma_cube"), "Magma Cube");
    assert.deepEqual(creeperSwelling(0), {horizontal: 1, vertical: 1});
    // white flashing: every 0.1 of the fuse, at least level 7 (0.5 * 15), at most 15
    assert.equal(creeperWhiteOverlay(0), 0);
    assert.equal(creeperWhiteOverlay(0.05), 0);
    assert.equal(creeperWhiteOverlay(0.15), 7);
    assert.equal(creeperWhiteOverlay(0.25), 0);
    assert.equal(creeperWhiteOverlay(0.95), 14);
    const swollen = creeperSwelling(1);
    assert.ok(swollen.horizontal > 1.39 && swollen.horizontal < 1.42 && swollen.vertical > 1.08 && swollen.vertical < 1.12, JSON.stringify(swollen));
});

test("mob-data is parsed and validated, living entities are mobs or placeholders", () => {
    const mob = parseMob({bodyYaw: 90, headYaw: 100, hurtTime: 99, deathTime: 5, baby: true, variant: "../x",
        size: 2, width: 0.6, height: 1.95, flags: ["attacking", "<b>", 5], equipment: {mainHand: {id: "minecraft:bow"}, mainArm: "left"}});
    assert.equal(mob.hurtTime, 10, "clamped");
    assert.equal(mob.deathTime, 5);
    assert.equal(mob.variant, null, "invalid variant");
    assert.deepEqual([...mob.flags], ["attacking"]);
    assert.equal(mob.equipment.mainHand.id, "minecraft:bow");
    assert.equal(mob.equipment.leftHanded, true);
    assert.equal(parseMob(null), null);

    const zombie = parseEntity({id: 1, type: "minecraft:zombie", position: {x: 0, y: 64, z: 0}, mob: {bodyYaw: 0}});
    assert.equal(entityKind(zombie), "mob");
    const allay = parseEntity({id: 2, type: "minecraft:ender_dragon", position: {x: 0, y: 64, z: 0}, mob: {bodyYaw: 0}});
    assert.equal(entityKind(allay), "placeholder");
    const item = parseEntity({id: 3, type: "minecraft:item", position: {x: 0, y: 64, z: 0}, item: {id: "minecraft:stone"}});
    assert.equal(entityKind(item), "item", "no mob-data: as before");
});

/** a mob-cache with fake loaders (no network, no images) */
function fakeMobCache(textures, composed = []) {
    return new MobAssetCache("/assets/entities/",
        url => Promise.resolve({format: 1, textures: Object.fromEntries(Object.entries(textures).map(([k]) => [k, "data:image/png;base64,AAAA"]))}),
        url => Promise.resolve({width: 64, height: 64, url}),
        () => 0,
        images => { composed.push(images.length); return {width: 64, height: 64}; });
}

test("the mob-asset-cache shares textures and materials, composes villager-textures", async () => {
    const composed = [];
    const cache = fakeMobCache({"minecraft:entity/zombie/zombie": 1, "minecraft:entity/villager/villager": 1, "minecraft:entity/villager/type/plains": 1}, composed);
    const entry = cache.acquire("minecraft:zombie");
    assert.equal(cache.material(entry, ["minecraft:entity/zombie/zombie"]), null, "not loaded yet");
    await flush(); await flush();
    assert.equal(entry.state, "loaded");
    const material = cache.material(entry, ["minecraft:entity/zombie/zombie"]);
    assert.ok(material);
    assert.equal(material.alphaTest, 0.1);
    assert.equal(cache.material(entry, ["minecraft:entity/zombie/zombie"]), material, "shared");
    assert.notEqual(cache.material(entry, ["minecraft:entity/zombie/zombie"], "cutout", null, true), material, "hurt-material");
    assert.equal(cache.material(entry, ["minecraft:entity/zombie/husk"]), null, "missing texture");
    assert.equal(cache.material(entry, ["minecraft:entity/zombie/zombie"], "cutout", 0xFF0000).color.getHex(), 0xFF0000, "tint");

    cache.material(entry, ["minecraft:entity/villager/villager", "minecraft:entity/villager/type/plains"]);
    assert.deepEqual(composed, [2], "two textures drawn onto each other");
    assert.ok(cache.material(entry, ["minecraft:entity/villager/villager", "minecraft:entity/villager/profession/x"]), "missing overlays are left out");
    assert.equal(cache.material(entry, ["minecraft:entity/villager/x", "minecraft:entity/villager/villager"]), null, "the base is required");

    assert.equal(cache.acquire("minecraft:zombie"), entry);
    cache.release(entry);
    cache.release(entry);
    assert.equal(cache.entries.size, 0, "released");
});

test("the mob-model follows the vanilla renderer: parts, layers, baby-scales, death-rotation", async () => {
    const cache = fakeMobCache({"minecraft:entity/sheep/sheep": 1, "minecraft:entity/sheep/sheep_fur": 1});
    const model = new MobModel("minecraft:sheep", MOB_TYPES["minecraft:sheep"], cache, null);
    assert.equal(model.visible, false, "hidden until the textures are loaded");
    await flush(); await flush();
    assert.equal(model.visible, true);
    assert.equal(model.layerViews.length, 2);
    assert.ok(model.layerViews[0].bones.has("head") && model.layerViews[1].bones.has("body"));

    model.setState({variant: "red", baby: false, flags: new Set(), size: 0}, {mainHand: null, offHand: null, leftHanded: false});
    const fur = model.layerViews[1].meshes[0];
    assert.equal(fur.visible, true);
    assert.equal(fur.material.color.getHex(), 0x84221C, "the wool-color");
    assert.deepEqual(model.flip.scale.toArray(), [-1, -1, 1], "vanilla scale(-1, -1, 1)");
    assert.equal(model.offset.position.y, -1.501);

    model.setState({variant: "red", baby: false, flags: new Set(["sheared"]), size: 0}, {mainHand: null, offHand: null, leftHanded: false});
    assert.equal(fur.visible, false, "sheared: no wool");

    model.setState({variant: "red", baby: true, flags: new Set(), size: 0}, {mainHand: null, offHand: null, leftHanded: false});
    assert.equal(model.bodyGroup.scale.x, 0.5, "baby: body half size");
    assert.equal(model.bodyGroup.position.y, 12, "and moved down by 24 / 2 px");
    assert.equal(model.headGroup.scale.x, 1, "sheep: the head is not scaled (only moved)");
    assert.deepEqual(model.headGroup.position.toArray(), [0, 8, 4]);

    model.animate({limbAngle: 0, limbDistance: 0, age: 0, headYaw: 45, headPitch: 0, swingProgress: 0, flags: new Set(),
        mainHand: null, leftHanded: false, wingAngle: 0}, 90, 20, true);
    assert.ok(Math.abs(model.yawGroup.rotation.y - PI / 2) < 1e-9, "rotation 180 - bodyYaw");
    assert.ok(Math.abs(model.deathGroup.rotation.z - PI / 2) < 1e-9, "dead: lying on the side");
    assert.ok(Math.abs(model.layerViews[0].bones.get("head").rotation.y - PI / 4) < 1e-9, "head-yaw");
    assert.ok(Math.abs(model.layerViews[1].bones.get("head").rotation.y - PI / 4) < 1e-9, "the wool follows the head");
    assert.notEqual(model.layerViews[0].meshes[0].material, cache.material(model.asset, ["minecraft:entity/sheep/sheep"]), "hurt-material");

    model.dispose();
    assert.equal(cache.entries.size, 0);
});

test("the mob-model hides the parts vanilla does not render, scales slimes and holds items", async () => {
    const cache = fakeMobCache({"minecraft:entity/piglin/piglin": 1, "minecraft:entity/slime/slime": 1});
    const piglin = new MobModel("minecraft:piglin", MOB_TYPES["minecraft:piglin"], cache, null);
    assert.equal(piglin.layerViews[0].bones.has("cloak"), false);
    assert.equal(piglin.layerViews[0].bones.has("ear"), false);
    assert.ok(piglin.layerViews[0].bones.has("head/left_ear"));

    const slime = new MobModel("minecraft:slime", MOB_TYPES["minecraft:slime"], cache, null);
    slime.setState({variant: null, baby: false, flags: new Set(), size: 4}, {mainHand: null, offHand: null, leftHanded: false});
    assert.ok(Math.abs(slime.flip.scale.y - -0.999 * 4) < 1e-9);
    piglin.dispose();
    slime.dispose();
});

test("an entity-marker shows a mob: interpolated, walking, hurt and dying", async () => {
    const cache = fakeMobCache({"minecraft:entity/cow/cow": 1});
    const marker = new EntityMarker("bm-entity-1", null, null, cache);
    let time = 1000;
    const sample = (x, extra = {}, mob = {}) => parseEntity({
        id: 1, type: "minecraft:cow", position: {x, y: 64, z: 0}, time: time += 250, onGround: true, ...extra,
        mob: {bodyYaw: 0, headYaw: 0, ...mob},
    });
    marker.updateFromData(sample(0), 250);
    await flush(); await flush();
    assert.ok(marker.view.isMobModel);
    marker.step(0.05, null);

    // walks 1 block in 250 ms (4 blocks per second): the legs move
    marker.updateFromData(sample(1, {}, {bodyYaw: 90}), 250);
    for (let i = 0; i < 5; i++) marker.step(0.05, null);
    assert.ok(Math.abs(marker.position.x - 1) < 1e-9);
    assert.ok(marker.limbSpeed > 0.5, `walking (${marker.limbSpeed})`);
    assert.ok(Math.abs(marker.rotation3.body - 90) < 1e-9, "rotation interpolated to the target");

    // hurt for 10 ticks
    marker.updateFromData(sample(1, {}, {bodyYaw: 90, hurtTime: 10}), 250);
    marker.step(0.05, null);
    assert.equal(marker.view.hurt, true);
    for (let i = 0; i < 12; i++) marker.step(0.05, null);
    assert.equal(marker.view.hurt, false, "hurt-overlay ends after 0.5 s");

    // dying: lies down within 20 ticks, stays red
    marker.updateFromData(sample(1, {}, {bodyYaw: 90, deathTime: 1}), 250);
    for (let i = 0; i < 25; i++) marker.step(0.05, null);
    assert.ok(Math.abs(marker.view.deathGroup.rotation.z - PI / 2) < 1e-9);
    assert.equal(marker.view.hurt, true);
    marker.dispose();
});

test("an entity-marker shows a placeholder for living entities without a model", () => {
    const marker = new EntityMarker("bm-entity-2", null, null, fakeMobCache({}));
    marker.updateFromData(parseEntity({id: 2, type: "minecraft:ender_dragon", position: {x: 0, y: 64, z: 0},
        mob: {bodyYaw: 90, width: 0.35, height: 0.6, hurtTime: 5}}), 250);
    marker.step(0.05, null);
    assert.ok(marker.view.isPlaceholderModel);
    assert.equal(marker.view.fill.scale.y, 0.6);
    assert.ok(Math.abs(marker.view.box.rotation.y - -PI / 2) < 1e-9);
    marker.dispose();
});

test("mooshroom-mushrooms and the carried block of the enderman are block-models (item-assets), creepers flash white", async () => {
    const {ItemAssetCache} = await import("../src/js/markers/player/ItemAssetCache.js");
    const requested = [];
    const quads = [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0, 1, 0, -1];
    const items = new ItemAssetCache("i/", url => {
        requested.push(url.substring(0, url.indexOf("?")));
        const empty = url.includes("block/dandelion_missing");
        return Promise.resolve({format: 1, textures: ["data:image/png;base64,AA"], models: empty ? [] : [{type: "quads", quads, display: {}}]});
    }, () => Promise.resolve({width: 16, height: 16}));
    const cache = fakeMobCache({"minecraft:entity/cow/red_mooshroom": 1, "minecraft:entity/enderman/enderman": 1,
        "minecraft:entity/enderman/enderman_eyes": 1, "minecraft:entity/creeper/creeper": 1});
    const input = {limbAngle: 0, limbDistance: 0, age: 0, headYaw: 0, headPitch: 0, swingProgress: 0, flags: new Set(),
        mainHand: null, leftHanded: false, wingAngle: 0};
    const noItems = {mainHand: null, offHand: null, leftHanded: false};

    const cow = new MobModel("minecraft:mooshroom", MOB_TYPES["minecraft:mooshroom"], cache, items);
    await flush(); await flush();
    cow.setState({variant: "red", baby: false, flags: new Set(), size: 0, models: ["minecraft:block/red_mushroom"]}, noItems);
    cow.animate(input, 0, 0, false);
    await flush(); await flush();
    cow.animate(input, 0, 0, false);
    assert.equal(cow.blocks.length, 3, "two on the back, one on the head");
    assert.ok(cow.blocks.every(b => b.view.visible && b.view.itemId === "minecraft:block/red_mushroom"));
    assert.ok(requested.includes("i/minecraft/block/red_mushroom.json"));
    cow.setState({variant: "red", baby: true, flags: new Set(), size: 0, models: ["minecraft:block/red_mushroom"]}, noItems);
    cow.animate(input, 0, 0, false);
    assert.ok(cow.blocks.every(b => !b.view.visible), "babies have no mushrooms");
    cow.dispose();

    const enderman = new MobModel("minecraft:enderman", MOB_TYPES["minecraft:enderman"], cache, items);
    await flush(); await flush();
    const carrying = {variant: null, baby: false, flags: new Set(["carrying"]), size: 0, models: ["minecraft:block/dandelion_missing"]};
    enderman.setState(carrying, noItems);
    for (let i = 0; i < 4; i++) {
        enderman.animate({...input, flags: carrying.flags}, 0, 0, false);
        await flush();
    }
    assert.equal(enderman.blocks[0].view.view.itemId, "minecraft:dandelion_missing", "no block-model: the item-model");
    assert.equal(enderman.blocks[0].view.visible, true);
    enderman.dispose();

    const creeper = new MobModel("minecraft:creeper", MOB_TYPES["minecraft:creeper"], cache, null);
    await flush(); await flush();
    creeper.setState({variant: null, baby: false, flags: new Set(), size: 0, models: []}, noItems);
    creeper.animate(input, 0, 0, false, 0.15);
    assert.equal(creeper.white, 7);
    assert.ok(Math.abs(creeper.layerViews[0].meshes[0].material.userData.whiteOverlay - 7 / 15 * 0.75) < 1e-9);
    creeper.animate(input, 0, 0, false, 0.25);
    assert.equal(creeper.layerViews[0].meshes[0].material.userData.whiteOverlay, undefined, "flashing");
    creeper.dispose();
});

const mainParts = type => {
    const parts = {};
    const collect = (p, prefix) => { for (const n in p) { parts[prefix + n] = createTransform(p[n]); if (p[n].children) collect(p[n].children, prefix + n + "/"); } };
    collect(VANILLA_MODELS.models[MOB_TYPES[type].layers[0].model].parts, "");
    return parts;
};
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, `${msg}: ${a} != ${b}`);

test("mob-attacks: swing- and attack-ticks are parsed", () => {
    assert.deepEqual([parseMob({}).swingTicks, parseMob({}).attackTicks], [-1, 0]);
    assert.deepEqual([parseMob({swingTicks: 3, attackTicks: 10}).swingTicks, parseMob({swingTicks: 3, attackTicks: 10}).attackTicks], [3, 10]);
    assert.equal(parseMob({swingTicks: 99}).swingTicks, 6);
    assert.equal(parseMob({swingTicks: -5}).swingTicks, -1);
    assert.equal(parseMob({attackTicks: 99}).attackTicks, 20);
});

test("mob-attacks: iron golem, hoglin and ravager like their vanilla models", () => {
    const golem = mainParts("minecraft:iron_golem");
    ANIMATIONS.ironGolem(golem, input({attackTicks: 10}));
    near(golem.right_arm.pitch, -0.5, "golem arms at the start"); // -2 + 1.5 * wrap(10, 10)
    ANIMATIONS.ironGolem(golem, input({attackTicks: 5}));
    near(golem.right_arm.pitch, -3.5, "golem arms raised highest at the half");
    near(golem.left_arm.pitch, -3.5, "both arms");

    const hoglin = mainParts("minecraft:hoglin");
    ANIMATIONS.hoglin(hoglin, input());
    near(hoglin.head.pitch, 0.87266463, "hoglin head at rest");
    ANIMATIONS.hoglin(hoglin, input({attackTicks: 5}));
    near(hoglin.head.pitch, -PI / 9, "hoglin head thrown up");

    const ravager = mainParts("minecraft:ravager");
    ANIMATIONS.ravager(ravager, input({attackTicks: 10}));
    near(ravager.neck.pivotZ, 5.5, "ravager neck at the start like the model");
    ANIMATIONS.ravager(ravager, input({attackTicks: 5}));
    near(ravager.neck.pivotZ, -6.5, "ravager neck lunged forward by 12 px");
    near(ravager["neck/head/mouth"].pitch, PI / 20 * Math.sin(PI / 2), "mouth");
    ANIMATIONS.ravager(ravager, input());
    near(ravager.neck.pivotZ, 5.5, "ravager neck back");
});

test("mob-attacks: the hand-swing turns the body to the swinging arm (main or off hand)", () => {
    const zombie = mainParts("minecraft:zombie");
    biped(zombie, input({swingProgress: 0.3}));
    const mainYaw = zombie.body.yaw;
    assert.ok(Math.abs(mainYaw) > 0.05, "body turns");
    biped(zombie, input({swingProgress: 0.3, swingOffHand: true}));
    near(zombie.body.yaw, -mainYaw, "off-hand: the other direction");
    biped(zombie, input());
    near(zombie.body.yaw, 0, "no swing");
});

test("mob-attacks: the entity-marker runs swing and attack between the samples, without restarting them", async () => {
    const cache = fakeMobCache({"minecraft:entity/zombie/zombie": 1, "minecraft:entity/iron_golem/iron_golem": 1});
    const zombie = new EntityMarker("bm-entity-30", null, null, cache);
    let time = 1000;
    const sample = (type, mob = {}) => parseEntity({
        id: 30, type, position: {x: 0, y: 64, z: 0}, time: time += 250, onGround: true, mob: {bodyYaw: 0, headYaw: 0, ...mob},
    });
    zombie.updateFromData(sample("minecraft:zombie"), 250);
    await flush(); await flush();
    zombie.step(0.05, null);
    assert.equal(zombie.animationInput.swingProgress, 0);

    zombie.updateFromData(sample("minecraft:zombie", {swingTicks: 1}), 250);
    zombie.step(0.05, null);
    near(zombie.animationInput.swingProgress, 2 / 6, "swing from the sampled progress");
    zombie.step(0.1, null);
    // the next sample of the same swing does not restart it
    zombie.updateFromData(sample("minecraft:zombie", {swingTicks: 4}), 250);
    zombie.step(0.05, null);
    near(zombie.animationInput.swingProgress, 5 / 6, "same swing continues");
    zombie.step(0.1, null);
    assert.equal(zombie.animationInput.swingProgress, 0, "ends after 6 ticks");
    zombie.updateFromData(sample("minecraft:zombie", {swingTicks: 0}), 250);
    zombie.step(0.05, null);
    near(zombie.animationInput.swingProgress, 1 / 6, "a new swing starts");
    zombie.dispose();

    const golem = new EntityMarker("bm-entity-31", null, null, cache);
    golem.updateFromData(sample("minecraft:iron_golem", {attackTicks: 10}), 250);
    await flush(); await flush();
    golem.step(0.25, null);
    near(golem.animationInput.attackTicks, 5, "counts down locally");
    golem.updateFromData(sample("minecraft:iron_golem", {attackTicks: 5}), 250);
    golem.step(0.05, null);
    near(golem.animationInput.attackTicks, 4, "not restarted by the next sample");
    golem.step(1, null);
    assert.equal(golem.animationInput.attackTicks, 0);
    golem.dispose();
});

test("pufferfish: the model of the puff-state, replaced while it lives (vanilla PufferfishEntityRenderer)", async () => {
    const cache = fakeMobCache({"minecraft:entity/fish/pufferfish": 1});
    const marker = new EntityMarker("bm-entity-40", null, null, cache);
    let time = 1000;
    const sample = flags => parseEntity({
        id: 40, type: "minecraft:pufferfish", position: {x: 0, y: 64, z: 0}, time: time += 250, onGround: false,
        mob: {bodyYaw: 0, headYaw: 0, flags},
    });
    marker.updateFromData(sample([]), 250);
    await flush(); await flush();
    assert.equal(marker.mobTypeKey, "minecraft:pufferfish_small");
    const small = marker.view;
    marker.updateFromData(sample(["puff_1"]), 250);
    assert.equal(marker.mobTypeKey, "minecraft:pufferfish_medium");
    assert.notEqual(marker.view, small, "a new model");
    assert.equal(marker.body.children.filter(c => c.isMobModel).length, 1, "the old model is removed");
    marker.updateFromData(sample(["puff_2"]), 250);
    assert.equal(marker.mobTypeKey, "minecraft:pufferfish_big");
    const big = marker.view;
    marker.updateFromData(sample(["puff_2"]), 250);
    assert.equal(marker.view, big, "kept while the state stays");
    await flush(); await flush();
    marker.step(0.05, null);
    marker.dispose();

    const parts = mainParts("minecraft:pufferfish_big");
    ANIMATIONS.pufferfish(parts, input({age: 10}));
    near(parts.right_blue_fin.roll, -0.2 + 0.4 * Math.sin(2), "blue fin");
});

test("tropical fish: the body in the base-color, the pattern in the pattern-color (vanilla DyeColor.getEntityColor)", async () => {
    const {layerTint, dyeColor} = await import("../src/js/markers/mob/MobTypes.js");
    const mob = {variant: "kob", flags: new Set(["base_orange", "pattern_light_blue"])};
    const [body, pattern] = MOB_TYPES["minecraft:tropical_fish_small"].layers;
    assert.equal(layerTint(body, mob), 0xf9801d);
    assert.equal(layerTint(pattern, mob), 0x3ab3da);
    assert.equal(dyeColor("unknown"), 0xf9fffe, "white if unknown");
    const large = MOB_TYPES["minecraft:tropical_fish_large"].layers;
    assert.equal(layerTint(large[1], {flags: new Set(["pattern_black"])}), 0x1d1d21);
    // the sheep keeps its wool-colors
    assert.equal(layerTint(MOB_TYPES["minecraft:sheep"].layers[1], {variant: "orange", flags: new Set()}), 0xba6015);
});

test("poses: sitting wolf, cat and fox, sleeping fox and lying cat like the vanilla models", () => {
    const wolf = mainParts("minecraft:wolf");
    ANIMATIONS.wolf(wolf, input({flags: new Set(["sitting", "tame"])}));
    near(wolf.body.pitch, 0.7853982, "wolf body");
    near(wolf.body.pivotY, 18, "wolf body pivot");
    near(wolf.right_hind_leg.pitch, 4.712389, "wolf hind legs");
    near(wolf.upper_body.pitch, 1.2566371, "wolf neck");
    const standingWolf = mainParts("minecraft:wolf");
    ANIMATIONS.wolf(standingWolf, input());
    near(standingWolf.body.pivotY, 14, "standing wolf like the model-data");

    const cat = mainParts("minecraft:cat");
    ANIMATIONS.cat(cat, input({flags: new Set(["sitting"])}));
    near(cat.body.pitch, 0.7853982, "cat body");
    near(cat.body.pivotY, 8, "12 - 4");
    near(cat.tail2.pitch, 2.670354, "cat tail");
    near(cat.left_hind_leg.pivotY, 21, "cat hind leg");
    const lying = mainParts("minecraft:cat");
    ANIMATIONS.cat(lying, input({cat: {sleep: 1, tailCurl: 1, headDown: 0}}));
    near(lying.head.roll, -1.2707963, "lying cat head");
    near(lying.left_front_leg.pitch, -1.2707963, "lying cat leg");
    near(lying.tail1.pitch, 0.8, "curled tail");

    const fox = mainParts("minecraft:fox");
    ANIMATIONS.fox(fox, input({flags: new Set(["sleeping"])}));
    near(fox.body.roll, -1.5707964, "sleeping fox on its side");
    near(fox.head.yaw, -2.0943952, "head turned");
    assert.equal(fox.left_front_leg.visible, false, "legs hidden");
    const sittingFox = mainParts("minecraft:fox");
    ANIMATIONS.fox(sittingFox, input({flags: new Set(["sitting"])}));
    near(sittingFox.body.pitch, 0.5235988, "sitting fox");
    near(sittingFox.right_hind_leg.pivotY, 21.5, "sitting fox hind leg");
});

test("poses: a mob in a bed is turned by the bed and moved to the head-end (vanilla LivingEntityRenderer)", async () => {
    const {bedPose} = await import("../src/js/markers/LiveEntityData.js");
    const villager = parseMob({bodyYaw: 30, flags: ["in_bed", "bed_north"], bedOffset: 1.52});
    assert.deepEqual(bedPose(villager), {yaw: 270, x: -0, z: 1.52});
    assert.deepEqual(bedPose(parseMob({bodyYaw: 30, flags: ["in_bed"]})), {yaw: 30, x: 0, z: 0}, "unknown bed: the body-yaw");
    assert.equal(bedPose(parseMob({flags: ["sleeping"]})), null, "the sleeping fox is not in a bed");

    const cache = fakeMobCache({"minecraft:entity/villager/villager": 1});
    const model = new MobModel("minecraft:villager", MOB_TYPES["minecraft:villager"], cache, null);
    model.setState(villager, {mainHand: null, offHand: null, leftHanded: false, armor: null});
    model.animate(input({flags: villager.flags, bed: bedPose(villager)}), 30, 0, false);
    near(model.yawGroup.rotation.y, 270 * PI / 180, "turned by the bed");
    near(model.deathGroup.rotation.z, PI / 2, "lying");
    near(model.poseGroup.rotation.y, 270 * PI / 180, "and turned by 270");
    near(model.yawGroup.position.z, 1.52, "moved to the head-end");
    model.animate(input(), 30, 0, false);
    near(model.yawGroup.rotation.y, 150 * PI / 180, "standing again: 180 - body-yaw");
    near(model.poseGroup.rotation.y, 0, "no pose");
    model.dispose();
});

test("poses: sitting and lying panda, standing polar bear like the vanilla models and renderers", () => {
    const panda = mainParts("minecraft:panda");
    ANIMATIONS.panda(panda, input({panda: {sit: 1, lie: 0}}));
    near(panda.body.pitch, 1.7407963, "sitting panda body");
    near(panda.right_hind_leg.roll, 0.5707964, "hind legs spread");
    const bear = mainParts("minecraft:polar_bear");
    ANIMATIONS.polarBear(bear, input({warning: 1}));
    near(bear.body.pitch, PI / 2 - PI * 0.35, "standing up");
    near(bear.body.pivotY, 11, "body raised");
    near(bear.head.pivotY, -14, "head up (10 * 0 - 14 * 1)");
    const standing = mainParts("minecraft:polar_bear");
    ANIMATIONS.polarBear(standing, input());
    near(standing.body.pivotY, 9, "on all fours like the model-data");

    const cache = fakeMobCache({"minecraft:entity/panda/panda": 1});
    const model = new MobModel("minecraft:panda", MOB_TYPES["minecraft:panda"], cache, null);
    model.setState(parseMob({}), {mainHand: null, offHand: null, leftHanded: false, armor: null});
    model.animate(input({panda: {sit: 1, lie: 0}, entityPitch: 0}), 0, 0, false);
    near(model.poseGroup.rotation.x, PI / 2, "tilted back by 90");
    near(model.poseGroup.position.y, 0.8, "up by 0.8 (the -1 is rotated into z)");
    near(model.poseGroup.position.z, -1, "");
    model.animate(input({panda: {sit: 0, lie: 1}, entityPitch: 0}), 0, 0, false);
    near(model.poseGroup.rotation.x, PI, "on its back");
    near(model.poseGroup.position.y, 1.3, "lifted by 1.3");
    model.dispose();
});

test("head-items: a carved pumpkin on the head follows the head (vanilla HeadFeatureRenderer)", () => {
    const cache = fakeMobCache({"minecraft:entity/zombie/zombie": 1});
    const items = {acquire: () => ({state: "loading", listeners: new Set(), models: []}), release() {}, retry() {}};
    const zombie = new MobModel("minecraft:zombie", MOB_TYPES["minecraft:zombie"], cache, null);
    assert.equal(zombie.headSlot, null, "no item-cache: no slot");
    zombie.dispose();

    assert.equal(MOB_TYPES["minecraft:zombie"].headItem, true);
    assert.equal(MOB_TYPES["minecraft:villager"].headItem, "villager");
    assert.equal(MOB_TYPES["minecraft:giant"].headItem, false, "the giant-renderer has no head-feature");
    assert.deepEqual(MOB_TYPES["minecraft:piglin"].headItemScale, [1.0019531, 1, 1.0019531]);
    assert.equal(MOB_TYPES["minecraft:cow"].headItem, undefined);
});

test("feature-layers: collars of tamed wolves and cats, llama-carpets, horse-armor (vanilla feature-renderers)", async () => {
    const {isLayerShown, layerTint, layerTextures} = await import("../src/js/markers/mob/MobTypes.js");
    const find = (type, model, texture) => MOB_TYPES[type].layers.find(l => l.model === model && (!texture || String(l.texture).includes(texture)));
    const wolfCollar = find("minecraft:wolf", "minecraft:wolf#main", "wolf_collar");
    assert.equal(isLayerShown(wolfCollar, {flags: new Set(["tame"]), baby: false}), false, "no collar-flag (wild or untamed)");
    const red = {flags: new Set(["tame", "collar_red"]), baby: false};
    assert.equal(isLayerShown(wolfCollar, red), true);
    assert.equal(layerTint(wolfCollar, red), 0xb02e26);
    const catCollar = find("minecraft:cat", "minecraft:cat#collar");
    assert.equal(layerTint(catCollar, {flags: new Set(["collar_blue"])}), 0x3c44aa);

    const decor = find("minecraft:llama", "minecraft:llama#decor");
    assert.deepEqual(layerTextures(decor, {flags: new Set(["carpet_lime"]), baby: false}), ["minecraft:entity/llama/decor/lime"]);
    const traderDecor = find("minecraft:trader_llama", "minecraft:llama#decor");
    assert.deepEqual(layerTextures(traderDecor, {flags: new Set(["carpet_trader"]), baby: false}), ["minecraft:entity/llama/decor/trader_llama"]);
    assert.equal(isLayerShown(decor, {flags: new Set(), baby: false}), false, "no carpet");

    const armor = find("minecraft:horse", "minecraft:horse#armor");
    const leather = {flags: new Set(["armor_color_a06540", "armor_leather"]), variant: "white/none", baby: false};
    assert.deepEqual(layerTextures(armor, leather), ["minecraft:entity/horse/armor/horse_armor_leather"], "not the color-flag");
    assert.equal(layerTint(armor, leather), 0xa06540);
    assert.equal(layerTint(armor, {flags: new Set(["armor_diamond"])}), null, "not dyeable");
    // the feature-layers are verified against Minecraft like the other layers (model-check)
    for (const layer of ["minecraft:cat#collar", "minecraft:llama#decor", "minecraft:horse#armor"]) assert.ok(VANILLA_MODELS.models[layer], layer);
});

test("warden: emissive layers with their parts and pulsating alphas (vanilla WardenFeatureRenderer)", async () => {
    const W = "minecraft:entity/warden/";
    const cache = fakeMobCache({[W + "warden"]: 1, [W + "warden_bioluminescent_layer"]: 1, [W + "warden_pulsating_spots_1"]: 1,
        [W + "warden_pulsating_spots_2"]: 1});
    const model = new MobModel("minecraft:warden", MOB_TYPES["minecraft:warden"], cache, null);
    await flush(); await flush();
    model.setState(parseMob({}), {mainHand: null, offHand: null, leftHanded: false, armor: null});
    const [main, bio, spots1, spots2] = model.layerViews;
    assert.equal(main.meshes.length, 10, "all parts with cuboids");
    assert.equal(bio.meshes.length, 5, "head and limbs");
    assert.equal(spots1.meshes.length, 6, "body, head and limbs");
    model.animate(input({age: 0}), 0, 0, false);
    near(spots1.ownMaterial.opacity, 0.25, "spots 1 at age 0");
    near(spots2.ownMaterial.opacity, 0, "spots 2 in the other phase");
    assert.notEqual(spots1.ownMaterial, spots1.ownMaterialBase, "own material (the alpha differs per warden)");
    model.animate(input({age: Math.PI / 0.045}), 0, 0, false);
    near(spots1.ownMaterial.opacity, 0, "spots 1 half a period later");
    near(spots2.ownMaterial.opacity, 0.25, "spots 2");
    near(bio.ownMaterial.opacity, 1, "bioluminescent layer");
    model.dispose();
});
