/*
 * This file is part of BlueMap, licensed under the MIT License (MIT).
 *
 * Copyright (c) Blue (Lukas Rieger) <https://bluecolored.de>
 * Copyright (c) contributors
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 */

/*
 * The mobs that are rendered with their vanilla model (BlueMap Live, see docs/bluemap-live/phase-6.md):
 * per entity-type the model-layers with their textures, the animation and the renderer-transformations of the
 * vanilla entity-renderers (1.21). No three.js, so it can be unit-tested with node.
 */

import VANILLA_MODELS from "./vanilla-mob-models.json" with {type: "json"};

export {VANILLA_MODELS};

const E = "minecraft:entity/";

/**
 * vanilla AnimalModel: how a baby is rendered (the head bigger than the body)
 * [headScaled, childHeadYOffset, childHeadZOffset, invertedChildHeadScale, invertedChildBodyScale, childBodyYOffset]
 */
const BIPED_CHILD = [true, 16, 0, 2, 2, 24];

/**
 * @typedef MobLayer {{
 *     model: string,                    the model-layer in vanilla-mob-models.json
 *     texture: string | function(mob): string,
 *     type?: "cutout" | "translucent" | "eyes" | "energy",
 *     tint?: "sheep",                   the wool-color of the sheep
 *     flag?: string, unlessFlag?: string, adult?: boolean  only shown with / without this flag, only for adults
 * }}
 * @typedef MobType {{
 *     animation: string,                see MobAnimations.ANIMATIONS
 *     layers: MobLayer[],
 *     scale?: number,                   vanilla EntityRenderer.scale
 *     babyScale?: number,               renderers that scale babies themselves (villager)
 *     child?: Array,                    vanilla AnimalModel-parameters for babies
 *     headParts?: string[],             the head-parts of AnimalModel (scaled separately for babies)
 *     hidden?: string[],                parts that are not rendered by the vanilla renderer
 *     arms?: boolean,                   held items are shown (vanilla HeldItemFeatureRenderer)
 *     slimArms?: boolean,               skeleton-arms (2 px): vanilla SkeletonEntityModel.setArmAngle shifts the item by 1 px
 *     lyingAngle?: number,              vanilla LivingEntityRenderer.getLyingAngle (degrees, default 90)
 *     slime?: boolean,                  scaled by the size (vanilla SlimeEntityRenderer)
 *     creeper?: boolean                 swells before the explosion (vanilla CreeperEntityRenderer)
 * }}
 */

const biped = (animation, model, texture, extra = {}) => ({
    animation, layers: [{model, texture}], child: BIPED_CHILD, headParts: ["head"], arms: true, ...extra,
});

/** "type/profession/level" -> the textures of vanilla VillagerClothingFeatureRenderer (in drawing-order) */
export function villagerTextures(folder, variant, baby) {
    const textures = [E + folder + "/" + folder];
    const [type, profession, level] = (variant || "plains/none/1").split("/");
    textures.push(E + folder + "/type/" + type);
    if (profession && profession !== "none" && !baby) {
        textures.push(E + folder + "/profession/" + profession);
        const levelName = VILLAGER_LEVELS[Number(level)];
        if (profession !== "nitwit" && levelName) textures.push(E + folder + "/profession_level/" + levelName);
    }
    return textures;
}

/** vanilla VillagerClothingFeatureRenderer.LEVEL_TO_ID */
const VILLAGER_LEVELS = {1: "stone", 2: "iron", 3: "gold", 4: "emerald", 5: "diamond"};

const PLAYER_HIDDEN = ["ear", "cloak"];

/** @type {Object<string, MobType>} */
export const MOB_TYPES = {
    "minecraft:zombie": biped("zombie", "minecraft:zombie#main", E + "zombie/zombie"),
    "minecraft:husk": biped("zombie", "minecraft:husk#main", E + "zombie/husk", {scale: 1.0625}),
    "minecraft:drowned": {
        ...biped("drowned", "minecraft:drowned#main", E + "zombie/drowned"),
        layers: [
            {model: "minecraft:drowned#main", texture: E + "zombie/drowned"},
            {model: "minecraft:drowned#outer", texture: E + "zombie/drowned_outer_layer"},
        ],
    },
    "minecraft:skeleton": biped("skeleton", "minecraft:skeleton#main", E + "skeleton/skeleton", {slimArms: true}),
    "minecraft:stray": {
        ...biped("skeleton", "minecraft:stray#main", E + "skeleton/stray", {slimArms: true}),
        layers: [
            {model: "minecraft:stray#main", texture: E + "skeleton/stray"},
            {model: "minecraft:stray#outer", texture: E + "skeleton/stray_overlay"},
        ],
    },
    "minecraft:wither_skeleton": biped("skeleton", "minecraft:wither_skeleton#main", E + "skeleton/wither_skeleton", {scale: 1.2, slimArms: true}),
    "minecraft:zombie_villager": {
        ...biped("zombie", "minecraft:zombie_villager#main", null),
        layers: [{model: "minecraft:zombie_villager#main", texture: mob => villagerTextures("zombie_villager", mob.variant, mob.baby)}],
    },
    "minecraft:piglin": biped("piglin", "minecraft:piglin#main", E + "piglin/piglin", {hidden: PLAYER_HIDDEN}),
    "minecraft:piglin_brute": biped("piglin", "minecraft:piglin_brute#main", E + "piglin/piglin_brute", {hidden: PLAYER_HIDDEN}),
    "minecraft:zombified_piglin": biped("zombified_piglin", "minecraft:zombified_piglin#main", E + "piglin/zombified_piglin", {hidden: PLAYER_HIDDEN}),

    "minecraft:creeper": {
        animation: "creeper", creeper: true,
        layers: [
            {model: "minecraft:creeper#main", texture: E + "creeper/creeper"},
            {model: "minecraft:creeper#armor", texture: E + "creeper/creeper_armor", type: "energy", flag: "charged"},
        ],
    },
    "minecraft:pig": {
        animation: "quadruped", child: [false, 4, 4, 2, 2, 24], headParts: ["head"],
        layers: [
            {model: "minecraft:pig#main", texture: E + "pig/pig"},
            {model: "minecraft:pig#saddle", texture: E + "pig/pig_saddle", flag: "saddled"},
        ],
    },
    "minecraft:cow": {
        animation: "quadruped", child: [false, 10, 4, 2, 2, 24], headParts: ["head"],
        layers: [{model: "minecraft:cow#main", texture: E + "cow/cow"}],
    },
    "minecraft:mooshroom": {
        animation: "quadruped", child: [false, 10, 4, 2, 2, 24], headParts: ["head"],
        layers: [{model: "minecraft:mooshroom#main", texture: mob => E + "cow/" + (mob.variant === "brown" ? "brown" : "red") + "_mooshroom"}],
    },
    "minecraft:sheep": {
        animation: "quadruped", child: [false, 8, 4, 2, 2, 24], headParts: ["head"],
        layers: [
            {model: "minecraft:sheep#main", texture: E + "sheep/sheep"},
            {model: "minecraft:sheep#fur", texture: E + "sheep/sheep_fur", tint: "sheep", unlessFlag: "sheared"},
        ],
    },
    "minecraft:chicken": {
        animation: "chicken", child: [false, 5, 2, 2, 2, 24], headParts: ["head", "beak", "red_thing"],
        layers: [{model: "minecraft:chicken#main", texture: E + "chicken"}],
    },
    "minecraft:spider": {
        animation: "spider", lyingAngle: 180,
        layers: [
            {model: "minecraft:spider#main", texture: E + "spider/spider"},
            {model: "minecraft:spider#main", texture: E + "spider_eyes", type: "eyes"},
        ],
    },
    "minecraft:cave_spider": {
        animation: "spider", scale: 0.7, lyingAngle: 180,
        layers: [
            {model: "minecraft:cave_spider#main", texture: E + "spider/cave_spider"},
            {model: "minecraft:cave_spider#main", texture: E + "spider_eyes", type: "eyes"},
        ],
    },
    "minecraft:enderman": {
        animation: "enderman",
        layers: [
            {model: "minecraft:enderman#main", texture: E + "enderman/enderman"},
            {model: "minecraft:enderman#main", texture: E + "enderman/enderman_eyes", type: "eyes"},
        ],
    },
    "minecraft:slime": {
        animation: "slime", slime: true,
        layers: [
            {model: "minecraft:slime#main", texture: E + "slime/slime"},
            {model: "minecraft:slime#outer", texture: E + "slime/slime", type: "translucent"},
        ],
    },
    "minecraft:villager": {
        animation: "villager", scale: 0.9375, babyScale: 0.5,
        layers: [{model: "minecraft:villager#main", texture: mob => villagerTextures("villager", mob.variant, mob.baby)}],
    },
};

/**
 * vanilla SheepEntity.getRgbColor (1.21): the wool-color of a dye (verified against Minecraft like the models).
 * @param dye {string | null} - e.g. "light_blue"
 * @returns {number} rgb (0xRRGGBB)
 */
export function sheepWoolColor(dye) {
    const colors = VANILLA_MODELS.sheepWoolColors;
    const color = colors[dye] || colors.white;
    return parseInt(color.substring(1), 16);
}

/**
 * The textures (in drawing-order) of a layer for a mob.
 * @param layer {MobLayer}
 * @param mob {{variant: string | null, baby: boolean}}
 * @returns {string[]}
 */
export function layerTextures(layer, mob) {
    const texture = typeof layer.texture === "function" ? layer.texture(mob) : layer.texture;
    return Array.isArray(texture) ? texture : [texture];
}

/**
 * @param layer {MobLayer}
 * @param mob {{flags: Set<string>, baby: boolean}}
 * @returns {boolean} if the layer is shown
 */
export function isLayerShown(layer, mob) {
    if (layer.flag && !mob.flags.has(layer.flag)) return false;
    if (layer.unlessFlag && mob.flags.has(layer.unlessFlag)) return false;
    return !(layer.adult && mob.baby);
}

/**
 * vanilla LivingEntityRenderer.setupTransforms: the death-rotation (degrees around z) after deathTime ticks.
 * @param deathTicks {number} - vanilla deathTime + tickDelta
 * @param lyingAngle {number} - vanilla getLyingAngle
 * @returns {number} degrees
 */
export function deathAngle(deathTicks, lyingAngle = 90) {
    if (!(deathTicks > 0)) return 0;
    const f = Math.sqrt(Math.max(0, (deathTicks - 1) / 20 * 1.6));
    return Math.min(f, 1) * lyingAngle;
}

/**
 * vanilla SlimeEntityRenderer.scale without the squish (the stretch is not known): 0.999 * size.
 * @param size {number}
 * @returns {number}
 */
export function slimeScale(size) {
    return 0.999 * Math.max(1, size || 1);
}

/**
 * vanilla LivingEntityRenderer: the limb-speed of the walking-animation per tick from the horizontal movement
 * (LimbAnimator.updateLimbs(min(distance * 4, 1), 0.4)).
 * @param blocksPerTick {number}
 * @returns {number}
 */
export function limbTarget(blocksPerTick) {
    return Math.min(Math.max(blocksPerTick, 0) * 4, 1);
}

/** vanilla CreeperEntity: the fuse-time in ticks (fuseTime = 30) */
export const CREEPER_FUSE_TICKS = 30;

/**
 * vanilla CreeperEntityRenderer.scale: the swelling before the explosion.
 * @param fuse {number} - vanilla getClientFuseTime (currentFuseTime / (fuseTime - 2))
 * @returns {{horizontal: number, vertical: number}}
 */
export function creeperSwelling(fuse) {
    const h = 1 + Math.sin(fuse * 100) * fuse * 0.01;
    let g = Math.min(Math.max(fuse, 0), 1);
    g *= g;
    g *= g;
    return {horizontal: (1 + g * 0.4) * h, vertical: (1 + g * 0.1) / h};
}
