// Unit-tests for the worn armor of BlueMap Live (src/js/markers/mob/ArmorView.js, TextureAssetCache.js)
// Run with: npm test

import {test} from "node:test";
import assert from "node:assert/strict";
import {Box3} from "three";

import {ItemAssetCache, ASSET_VERSION} from "../src/js/markers/player/ItemAssetCache.js";
import {TextureAssetCache} from "../src/js/markers/mob/TextureAssetCache.js";
import {PlayerSkinCache} from "../src/js/markers/player/PlayerSkinCache.js";
import {PlayerModel} from "../src/js/markers/player/PlayerModel.js";
import {MobModel} from "../src/js/markers/mob/MobModel.js";
import {MobAssetCache} from "../src/js/markers/mob/MobAssetCache.js";
import {MOB_TYPES} from "../src/js/markers/mob/MobTypes.js";
import {ARMOR_SLOTS} from "../src/js/markers/mob/ArmorView.js";

const flush = () => new Promise(r => setTimeout(r, 0));

function itemCache(loaded) {
    const items = new ItemAssetCache("maps/world/assets/items/", () => Promise.reject(new Error("404")), () => Promise.reject(new Error("no")));
    items.textureCache = new TextureAssetCache("maps/world/assets/textures/", url => {
        loaded.push(url);
        return Promise.resolve({width: 64, height: 32, url});
    });
    return items;
}

const IRON_HELMET = {head: [{texture: "minecraft:models/armor/iron_layer_1", color: null}]};
const LEATHER_PANTS = {legs: [
    {texture: "minecraft:models/armor/leather_layer_2", color: 0x3355FF},
    {texture: "minecraft:models/armor/leather_layer_2_overlay", color: null},
]};

const armorMeshes = root => {
    const result = [];
    root.traverse(o => { if (o.isMesh && o.name.startsWith("armor-")) result.push(o); });
    return result;
};

/** the bounds of meshes in the space of an object (pixels for the player-root) */
function bounds(meshes, space) {
    space.updateMatrixWorld(true);
    const box = new Box3();
    const inverse = space.matrixWorld.clone().invert();
    for (const mesh of meshes) {
        mesh.geometry.computeBoundingBox();
        box.union(mesh.geometry.boundingBox.clone().applyMatrix4(mesh.matrixWorld).applyMatrix4(inverse));
    }
    return box;
}

test("vanilla armor-slots: parts and models like ArmorFeatureRenderer.setVisible", () => {
    assert.deepEqual(ARMOR_SLOTS.head, {model: "outer", parts: ["head", "hat"]});
    assert.deepEqual(ARMOR_SLOTS.legs.model, "inner", "the leggings use the inner model");
    assert.deepEqual(ARMOR_SLOTS.feet.parts, ["right_leg", "left_leg"]);
});

test("player-armor: helmet around the head, leggings dyed, texture-assets with version, released", async () => {
    const loaded = [];
    const items = itemCache(loaded);
    const skins = new PlayerSkinCache(url => Promise.resolve({width: 64, height: 64, src: url}));
    const model = new PlayerModel(skins, items);
    model.setSkin("skins/x.png", "classic");
    await flush();

    model.setArmor({...IRON_HELMET, ...LEATHER_PANTS});
    await flush();
    assert.deepEqual(loaded.sort(), [
        `maps/world/assets/textures/minecraft/models/armor/iron_layer_1.png?v=${ASSET_VERSION}`,
        `maps/world/assets/textures/minecraft/models/armor/leather_layer_2.png?v=${ASSET_VERSION}`,
        `maps/world/assets/textures/minecraft/models/armor/leather_layer_2_overlay.png?v=${ASSET_VERSION}`,
    ]);

    const meshes = armorMeshes(model);
    assert.equal(meshes.length, 2 + 3 * 2, "helmet: head + hat, leggings: body + 2 legs per layer");
    assert.ok(meshes.every(m => m.visible), "visible after loading");

    // the helmet (outer model, dilation 1) surrounds the head (x -4..4, y 24..32, z -4..4 px)
    const helmet = bounds(meshes.filter(m => m.name === "armor-head-head"), model.root);
    assert.deepEqual(helmet.min.toArray().map(v => Math.round(v * 100) / 100), [-5, 23, -5]);
    assert.deepEqual(helmet.max.toArray().map(v => Math.round(v * 100) / 100), [5, 33, 5]);

    // dyed leather layer, the overlay is not tinted
    const pants = meshes.filter(m => m.name === "armor-legs-right_leg");
    assert.equal(pants[0].material.color.getHex(), 0x3355FF);
    assert.equal(pants[1].material.color.getHex(), 0xFFFFFF);

    // the armor follows the animated bones
    model.parts.rightLeg.rotation.x = 0.5;
    model.updateMatrixWorld(true);
    assert.equal(pants[0].parent.parent, model.parts.rightLeg);

    // same armor: nothing rebuilt; no armor: removed and released
    model.setArmor({...IRON_HELMET, ...LEATHER_PANTS});
    assert.equal(armorMeshes(model)[0], meshes[0]);
    model.setArmor(null);
    assert.equal(armorMeshes(model).length, 0);
    assert.equal(items.textures.entries.size, 0);

    // the skin-meshes stay when the variant changes, the armor too
    model.setArmor(IRON_HELMET);
    await flush();
    model.setSkin("skins/y.png", "slim");
    await flush();
    assert.equal(armorMeshes(model).length, 2);
    model.dispose();
});

test("mob-armor: zombies wear armor on the armor-model bones, piglins use their own armor-models", async () => {
    const loaded = [];
    const items = itemCache(loaded);
    const mobs = new MobAssetCache("e/", () => Promise.resolve({textures: {"minecraft:entity/zombie/zombie": "data:image/png;base64,AA"}}),
        () => Promise.resolve({width: 64, height: 64}), () => 0, () => ({}));
    const zombie = new MobModel("minecraft:zombie", MOB_TYPES["minecraft:zombie"], mobs, items);
    zombie.setState({variant: null, baby: false, flags: new Set(), size: 0},
        {mainHand: null, offHand: null, leftHanded: false, armor: {...IRON_HELMET, feet: [{texture: "minecraft:models/armor/iron_layer_1", color: null}]}});
    await flush();
    const meshes = armorMeshes(zombie);
    assert.equal(meshes.length, 4);
    assert.ok(meshes.every(m => m.visible));
    const outer = zombie.layerViews.find(v => v.armor && v.layer.model === "minecraft:player#outer_armor");
    assert.ok(outer.bones.get("head").children.includes(meshes.find(m => m.name === "armor-head-head")));

    // the armor-bones follow the animation (arms forward like the zombie)
    zombie.animate({limbAngle: 0, limbDistance: 0, age: 0, headYaw: 30, headPitch: 0, swingProgress: 0, flags: new Set(),
        mainHand: null, leftHanded: false, wingAngle: 0}, 0, 0, false);
    assert.ok(Math.abs(outer.bones.get("head").rotation.y - Math.PI / 6) < 1e-9);
    zombie.dispose();
    assert.equal(items.textures.entries.size, 0, "released");

    const piglin = new MobModel("minecraft:piglin", MOB_TYPES["minecraft:piglin"], mobs, items);
    assert.ok(piglin.layerViews.some(v => v.armor && v.layer.model === "minecraft:piglin#outer_armor"));
    piglin.dispose();
});

test("armor-glint: the glint-layer gets the vanilla glint-material, moved by the texture-matrix", async () => {
    const {glintMatrix, GLINT_TEXTURE} = await import("../src/js/markers/mob/TextureAssetCache.js");
    const {Matrix3, Vector3, CustomBlending, EqualDepth, SrcColorFactor, OneFactor} = await import("three");
    // t = 0: only rotation (10 degrees) and scale 0.16
    const m = glintMatrix(new Matrix3(), 0);
    const p = new Vector3(1, 0, 1).applyMatrix3(m);
    assert.ok(Math.abs(p.x - Math.cos(0.17453292) * 0.16) < 1e-9 && Math.abs(p.y - Math.sin(0.17453292) * 0.16) < 1e-9);
    // 5 seconds: t = 5000 * 0.5 * 8 = 20000 -> u = 20000/110000, v = 20000/30000
    const q = new Vector3(0, 0, 1).applyMatrix3(glintMatrix(new Matrix3(), 5000));
    assert.ok(Math.abs(q.x + 20000 / 110000) < 1e-9 && Math.abs(q.y - 20000 / 30000) < 1e-9);

    const cache = new TextureAssetCache("t/", () => Promise.resolve({width: 64, height: 32}));
    const entry = cache.acquire(GLINT_TEXTURE);
    await new Promise(r => setTimeout(r, 0));
    const glint = cache.glintMaterial(entry);
    assert.equal(glint.blending, CustomBlending);
    assert.equal(glint.blendSrc, SrcColorFactor);
    assert.equal(glint.blendDst, OneFactor);
    assert.equal(glint.depthFunc, EqualDepth);
    assert.equal(glint.depthWrite, false);
    assert.ok(Math.abs(glint.color.r - 0.75) < 1e-9, "glint-strength");
    assert.equal(cache.glintMaterial(entry), glint, "shared");
    cache.release(entry);
});
