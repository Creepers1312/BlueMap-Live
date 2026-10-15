// Unit-tests for the mob-models of BlueMap Live (src/js/markers/mob/*, the mob-part of LiveEntityData and EntityMarker)
// Run with: npm test

import {test} from "node:test";
import assert from "node:assert/strict";

import {buildPartGeometry, cuboidQuads} from "../src/js/markers/mob/MobModelGeometry.js";
import {createSkinBoxGeometry} from "../src/js/markers/player/PlayerModelGeometry.js";
import {ANIMATIONS, createTransform, meleeAttack} from "../src/js/markers/mob/MobAnimations.js";
import {
    creeperSwelling, deathAngle, isLayerShown, layerTextures, limbTarget, MOB_TYPES, sheepWoolColor, slimeScale, VANILLA_MODELS,
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
    const allay = parseEntity({id: 2, type: "minecraft:allay", position: {x: 0, y: 64, z: 0}, mob: {bodyYaw: 0}});
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
    const sample = (x, extra = {}, mob = {}) => parseEntity({
        id: 1, type: "minecraft:cow", position: {x, y: 64, z: 0}, time: 1000 + x * 1000, onGround: true, ...extra,
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
    marker.updateFromData(parseEntity({id: 2, type: "minecraft:allay", position: {x: 0, y: 64, z: 0},
        mob: {bodyYaw: 90, width: 0.35, height: 0.6, hurtTime: 5}}), 250);
    marker.step(0.05, null);
    assert.ok(marker.view.isPlaceholderModel);
    assert.equal(marker.view.fill.scale.y, 0.6);
    assert.ok(Math.abs(marker.view.box.rotation.y - -PI / 2) < 1e-9);
    marker.dispose();
});
