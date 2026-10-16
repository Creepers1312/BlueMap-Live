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
 *     type?: "cutout" | "bright" | "translucent" | "eyes" | "energy",
 *     tint?: "sheep" | function(mob): number | null,   the wool-color of the sheep, or a color (0xRRGGBB)
 *     flag?: string, unlessFlag?: string, adult?: boolean  only shown with / without this flag, only for adults
 *     flagPrefix?: string               only shown with a flag that starts with this prefix (e.g. "collar_")
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
 *     armorLayers?: {inner: string, outer: string},  the armor-models (default: the player armor-models)
 *     lyingAngle?: number,              vanilla LivingEntityRenderer.getLyingAngle (degrees, default 90)
 *     slime?: boolean,                  scaled by the size (vanilla SlimeEntityRenderer)
 *     creeper?: boolean,                swells before the explosion (vanilla CreeperEntityRenderer)
 *     mushrooms?: boolean,              the mushrooms of the mooshroom (block-model from mob.models)
 *     carriedBlock?: boolean,           the block of the enderman (block-model from mob.models)
 *     headItem?: boolean | "villager",  vanilla HeadFeatureRenderer: an item on the head (villager: 3 px higher)
 *     headItemScale?: number[]          the scale the renderer passes to the HeadFeatureRenderer
 * }}
 */

/** vanilla PiglinEntityRenderer: the HeadFeatureRenderer-scale */
const PIGLIN_HEAD_SCALE = [1.0019531, 1, 1.0019531];

const biped = (animation, model, texture, extra = {}) => ({
    animation, layers: [{model, texture}], child: BIPED_CHILD, headParts: ["head"], arms: true, headItem: true, ...extra,
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
const PIGLIN_ARMOR = {inner: "minecraft:piglin#inner_armor", outer: "minecraft:piglin#outer_armor"};

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
        headItem: "villager",
        armorLayers: {inner: "minecraft:zombie_villager#inner_armor", outer: "minecraft:zombie_villager#outer_armor"},
        layers: [{model: "minecraft:zombie_villager#main", texture: mob => villagerTextures("zombie_villager", mob.variant, mob.baby)}],
    },
    "minecraft:piglin": biped("piglin", "minecraft:piglin#main", E + "piglin/piglin", {hidden: PLAYER_HIDDEN, armorLayers: PIGLIN_ARMOR, headItemScale: PIGLIN_HEAD_SCALE}),
    "minecraft:piglin_brute": biped("piglin", "minecraft:piglin_brute#main", E + "piglin/piglin_brute", {hidden: PLAYER_HIDDEN, armorLayers: PIGLIN_ARMOR, headItemScale: PIGLIN_HEAD_SCALE}),
    "minecraft:zombified_piglin": biped("zombified_piglin", "minecraft:zombified_piglin#main", E + "piglin/zombified_piglin", {hidden: PLAYER_HIDDEN, armorLayers: PIGLIN_ARMOR, headItemScale: PIGLIN_HEAD_SCALE}),

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
        animation: "quadruped", mushrooms: true, child: [false, 10, 4, 2, 2, 24], headParts: ["head"],
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
        animation: "enderman", carriedBlock: true,
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
        animation: "villager", scale: 0.9375, babyScale: 0.5, headItem: "villager",
        layers: [{model: "minecraft:villager#main", texture: mob => villagerTextures("villager", mob.variant, mob.baby)}],
    },
};

// ---- further mobs of 1.21 ----

const simple = (animation, model, texture, extra = {}) => ({animation, layers: [{model, texture}], ...extra});

/** vanilla HorseEntityRenderer: the markings (HorseMarking -> texture-name) */
const HORSE_MARKINGS = {white: "white", white_field: "whitefield", white_dots: "whitedots", black_dots: "blackdots"};

const TROPICAL_SMALL = ["kob", "sunstreak", "snooper", "dasher", "brinely", "spotty"];
const TROPICAL_LARGE = ["flopper", "stripey", "glitter", "blockfish", "betty", "clayfish"];

/** vanilla WolfVariant: the wild/tame/angry textures, "pale" is the original wolf.png */
function wolfTexture(mob) {
    const variant = mob.variant || "pale";
    const base = variant === "pale" ? "wolf" : "wolf_" + variant;
    return E + "wolf/" + base + (mob.flags.has("angry") ? "_angry" : mob.flags.has("tame") ? "_tame" : "");
}

const ILLAGER = {scale: 0.9375, arms: true, hidden: [], headItem: true};

Object.assign(MOB_TYPES, {
    "minecraft:allay": simple("allay", "minecraft:allay#main", E + "allay/allay"),
    "minecraft:armadillo": simple("generic", "minecraft:armadillo#main", E + "armadillo"),
    "minecraft:axolotl": simple("generic", "minecraft:axolotl#main", mob => E + "axolotl/axolotl_" + (mob.variant || "lucy")),
    "minecraft:bat": simple("bat", "minecraft:bat#main", E + "bat", {scale: 0.35}),
    "minecraft:bee": simple("bee", "minecraft:bee#main",
        mob => E + "bee/bee" + (mob.flags.has("angry") ? "_angry" : "") + (mob.flags.has("nectar") ? "_nectar" : "")),
    "minecraft:blaze": simple("blaze", "minecraft:blaze#main", E + "blaze"),
    "minecraft:bogged": {
        ...biped("bogged", "minecraft:bogged#main", E + "skeleton/bogged", {slimArms: true}),
        layers: [
            {model: "minecraft:bogged#main", texture: E + "skeleton/bogged"},
            {model: "minecraft:bogged#outer", texture: E + "skeleton/bogged_overlay"},
        ],
    },
    "minecraft:breeze": simple("breeze", "minecraft:breeze#main", E + "breeze/breeze"),
    "minecraft:camel": simple("camel", "minecraft:camel#main", E + "camel/camel"),
    "minecraft:cat": {
        ...simple("cat", "minecraft:cat#main", mob => E + "cat/" + (mob.variant || "tabby"), {scale: 0.8}),
        layers: [
            {model: "minecraft:cat#main", texture: mob => E + "cat/" + (mob.variant || "tabby")},
            // vanilla CatCollarFeatureRenderer: tamed cats, the collar-model (dilation 0.01) in the collar-color
            {model: "minecraft:cat#collar", texture: E + "cat/cat_collar", flagPrefix: "collar_", tint: mob => dyeColor(flagValue(mob, "collar_"))},
        ],
    },
    "minecraft:ocelot": simple("ocelot", "minecraft:ocelot#main", E + "cat/ocelot"),
    "minecraft:cod": simple("fish", "minecraft:cod#main", E + "fish/cod"),
    "minecraft:dolphin": simple("dolphin", "minecraft:dolphin#main", E + "dolphin"),
    "minecraft:donkey": simple("horse", "minecraft:donkey#main", E + "horse/donkey", {scale: 0.87}),
    "minecraft:mule": simple("horse", "minecraft:mule#main", E + "horse/mule", {scale: 0.92}),
    "minecraft:horse": {
        animation: "horse", scale: 1.1,
        layers: [
            {model: "minecraft:horse#main", texture: mob => E + "horse/horse_" + ((mob.variant || "white").split("/")[0])},
            {model: "minecraft:horse#main", texture: mob => E + "horse/horse_markings_" + (HORSE_MARKINGS[(mob.variant || "").split("/")[1]] || "none"),
                markings: true},
            // vanilla HorseArmorFeatureRenderer: equestrian armor (armor-model, dilation 0.1), leather in its dye-color
            {model: "minecraft:horse#armor", flagPrefix: "armor_", texture: mob => E + "horse/armor/horse_armor_" + horseArmor(mob),
                tint: mob => horseArmorColor(mob)},
        ],
    },
    "minecraft:skeleton_horse": simple("horse", "minecraft:skeleton_horse#main", E + "horse/horse_skeleton"),
    "minecraft:zombie_horse": simple("horse", "minecraft:zombie_horse#main", E + "horse/horse_zombie"),
    "minecraft:elder_guardian": simple("guardian", "minecraft:elder_guardian#main", E + "guardian_elder", {scale: 2.35}),
    "minecraft:guardian": simple("guardian", "minecraft:guardian#main", E + "guardian"),
    "minecraft:endermite": simple("endermite", "minecraft:endermite#main", E + "endermite"),
    "minecraft:evoker": simple("illager", "minecraft:evoker#main", E + "illager/evoker", ILLAGER),
    "minecraft:illusioner": simple("illager", "minecraft:illusioner#main", E + "illager/illusioner", ILLAGER),
    "minecraft:pillager": simple("illager", "minecraft:pillager#main", E + "illager/pillager", ILLAGER),
    "minecraft:vindicator": simple("illager", "minecraft:vindicator#main", E + "illager/vindicator", ILLAGER),
    "minecraft:fox": simple("fox", "minecraft:fox#main", mob => E + "fox/" + (mob.variant === "snow" ? "snow_fox" : "fox")),
    "minecraft:frog": simple("frog", "minecraft:frog#main", mob => E + "frog/" + (mob.variant || "temperate") + "_frog"),
    "minecraft:ghast": simple("ghast", "minecraft:ghast#main", mob => E + "ghast/ghast" + (mob.flags.has("shooting") ? "_shooting" : ""), {scale: 4.5}),
    "minecraft:giant": biped("zombie", "minecraft:giant#main", E + "zombie/zombie", {scale: 6, headItem: false}),
    // vanilla GlowSquidEntityRenderer.getBlockLight: block-light 15 (while not darkened by damage): always fully lit
    "minecraft:glow_squid": {
        ...simple("squid", "minecraft:glow_squid#main", E + "squid/glow_squid"),
        layers: [{model: "minecraft:glow_squid#main", texture: E + "squid/glow_squid", type: "bright"}],
    },
    "minecraft:squid": simple("squid", "minecraft:squid#main", E + "squid/squid"),
    "minecraft:goat": simple("generic", "minecraft:goat#main", E + "goat/goat"),
    "minecraft:hoglin": simple("hoglin", "minecraft:hoglin#main", E + "hoglin/hoglin"),
    "minecraft:zoglin": simple("hoglin", "minecraft:zoglin#main", E + "hoglin/zoglin"),
    "minecraft:iron_golem": simple("ironGolem", "minecraft:iron_golem#main", E + "iron_golem/iron_golem"),
    "minecraft:llama": {
        ...simple("llama", "minecraft:llama#main", mob => E + "llama/" + (mob.variant || "creamy")),
        layers: [
            {model: "minecraft:llama#main", texture: mob => E + "llama/" + (mob.variant || "creamy")},
            // vanilla LlamaDecorFeatureRenderer: the carpet (decor-model, dilation 0.5), the trader-llama's own decor
            {model: "minecraft:llama#decor", flagPrefix: "carpet_",
                texture: mob => E + "llama/decor/" + (flagValue(mob, "carpet_") === "trader" ? "trader_llama" : flagValue(mob, "carpet_"))},
        ],
    },
    "minecraft:trader_llama": {
        ...simple("llama", "minecraft:trader_llama#main", mob => E + "llama/" + (mob.variant || "creamy")),
        layers: [
            {model: "minecraft:trader_llama#main", texture: mob => E + "llama/" + (mob.variant || "creamy")},
            // vanilla LlamaDecorFeatureRenderer: the carpet (decor-model, dilation 0.5), the trader-llama's own decor
            {model: "minecraft:llama#decor", flagPrefix: "carpet_",
                texture: mob => E + "llama/decor/" + (flagValue(mob, "carpet_") === "trader" ? "trader_llama" : flagValue(mob, "carpet_"))},
        ],
    },
    "minecraft:magma_cube": simple("slime", "minecraft:magma_cube#main", E + "slime/magmacube", {slime: true}),
    "minecraft:panda": simple("panda", "minecraft:panda#main", mob => E + "panda/" + (mob.variant && mob.variant !== "normal" ? mob.variant + "_panda" : "panda")),
    "minecraft:parrot": simple("parrot", "minecraft:parrot#main", mob => E + "parrot/parrot_" + (mob.variant === "gray" ? "grey" : mob.variant || "red_blue")),
    "minecraft:phantom": {
        animation: "phantom",
        layers: [
            {model: "minecraft:phantom#main", texture: E + "phantom"},
            {model: "minecraft:phantom#main", texture: E + "phantom_eyes", type: "eyes"},
        ],
    },
    "minecraft:polar_bear": simple("polarBear", "minecraft:polar_bear#main", E + "bear/polarbear", {scale: 1.2}),
    // vanilla PufferfishEntityRenderer: the model of the puff-state (small, medium, big), switched while it lives
    "minecraft:pufferfish": {
        ...simple("pufferfish", "minecraft:pufferfish_small#main", E + "fish/pufferfish"),
        select: mob => mob.flags.has("puff_2") ? "minecraft:pufferfish_big" : mob.flags.has("puff_1") ? "minecraft:pufferfish_medium" : "minecraft:pufferfish_small",
        dynamicSelect: true,
    },
    "minecraft:pufferfish_small": simple("pufferfish", "minecraft:pufferfish_small#main", E + "fish/pufferfish"),
    "minecraft:pufferfish_medium": simple("pufferfish", "minecraft:pufferfish_medium#main", E + "fish/pufferfish"),
    "minecraft:pufferfish_big": simple("pufferfish", "minecraft:pufferfish_big#main", E + "fish/pufferfish"),
    "minecraft:rabbit": simple("generic", "minecraft:rabbit#main", mob => E + "rabbit/" + (mob.variant === "evil" ? "caerbannog" : mob.variant || "brown")),
    "minecraft:ravager": simple("ravager", "minecraft:ravager#main", E + "illager/ravager"),
    "minecraft:salmon": simple("salmon", "minecraft:salmon#main", E + "fish/salmon"),
    "minecraft:shulker": simple("shulker", "minecraft:shulker#main", E + "shulker/shulker"),
    "minecraft:silverfish": simple("silverfish", "minecraft:silverfish#main", E + "silverfish"),
    "minecraft:sniffer": simple("generic", "minecraft:sniffer#main", E + "sniffer/sniffer"),
    "minecraft:snow_golem": simple("snowGolem", "minecraft:snow_golem#main", E + "snow_golem"),
    "minecraft:strider": {
        animation: "strider",
        layers: [
            {model: "minecraft:strider#main", texture: mob => E + "strider/strider" + (mob.flags.has("cold") ? "_cold" : "")},
            {model: "minecraft:strider#main", texture: E + "strider/strider_saddle", flag: "saddled"},
        ],
    },
    "minecraft:tadpole": simple("fish", "minecraft:tadpole#main", E + "tadpole/tadpole"),
    "minecraft:tropical_fish": {
        animation: "fish",
        select: mob => TROPICAL_LARGE.includes(mob.variant) ? "minecraft:tropical_fish_large" : "minecraft:tropical_fish_small",
        layers: [{model: "minecraft:tropical_fish_small#main", texture: E + "fish/tropical_a"}],
    },
    "minecraft:tropical_fish_small": {
        animation: "fish",
        // vanilla TropicalFishEntityRenderer (the body in the base-color), TropicalFishColorFeatureRenderer (the pattern)
        layers: [
            {model: "minecraft:tropical_fish_small#main", texture: E + "fish/tropical_a", tint: mob => dyeColor(flagValue(mob, "base_"))},
            {model: "minecraft:tropical_fish_small#main", texture: mob => E + "fish/tropical_a_pattern_" + (TROPICAL_SMALL.indexOf(mob.variant) + 1 || 1),
                tint: mob => dyeColor(flagValue(mob, "pattern_"))},
        ],
    },
    "minecraft:tropical_fish_large": {
        animation: "fish",
        layers: [
            {model: "minecraft:tropical_fish_large#main", texture: E + "fish/tropical_b", tint: mob => dyeColor(flagValue(mob, "base_"))},
            {model: "minecraft:tropical_fish_large#main", texture: mob => E + "fish/tropical_b_pattern_" + (TROPICAL_LARGE.indexOf(mob.variant) + 1 || 1),
                tint: mob => dyeColor(flagValue(mob, "pattern_"))},
        ],
    },
    "minecraft:turtle": simple("generic", "minecraft:turtle#main", E + "turtle/big_sea_turtle"),
    "minecraft:vex": simple("allay", "minecraft:vex#main", mob => E + "illager/vex" + (mob.flags.has("charging") ? "_charging" : "")),
    "minecraft:wandering_trader": simple("villager", "minecraft:wandering_trader#main", E + "wandering_trader", {scale: 0.9375, headItem: true}),
    "minecraft:warden": simple("generic", "minecraft:warden#main", E + "warden/warden"),
    "minecraft:witch": simple("villager", "minecraft:witch#main", E + "witch", {scale: 0.9375}),
    "minecraft:wither": simple("wither", "minecraft:wither#main", E + "wither/wither", {scale: 2}),
    "minecraft:wolf": {
        ...simple("wolf", "minecraft:wolf#main", wolfTexture),
        layers: [
            {model: "minecraft:wolf#main", texture: wolfTexture},
            // vanilla WolfCollarFeatureRenderer: tamed wolves, the wolf-model in the collar-color
            {model: "minecraft:wolf#main", texture: E + "wolf/wolf_collar", flagPrefix: "collar_", tint: mob => dyeColor(flagValue(mob, "collar_"))},
        ],
    },
});

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
 * vanilla DyeColor.getEntityColor (1.21): the color of a dye (verified against Minecraft like the models).
 * @param dye {string | null} - e.g. "light_blue", white if unknown
 * @returns {number} rgb (0xRRGGBB)
 */
export function dyeColor(dye) {
    const colors = VANILLA_MODELS.dyeColors;
    const color = colors[dye] || colors.white;
    return parseInt(color.substring(1), 16);
}

/** the material of the horse-armor (flag "armor_iron"), not the color-flag */
function horseArmor(mob) {
    for (const flag of mob.flags) if (flag.startsWith("armor_") && !flag.startsWith("armor_color_")) return flag.substring(6);
    return null;
}

/** the dye-color of dyeable horse-armor (flag "armor_color_a06540"), null if not dyeable */
function horseArmorColor(mob) {
    const color = flagValue(mob, "armor_color_");
    return color && /^[0-9a-f]{6}$/.test(color) ? parseInt(color, 16) : null;
}

/**
 * @param mob {{flags: Set<string>}}
 * @param prefix {string}
 * @returns {string | null} the rest of the first flag with this prefix (e.g. "base_" -> "light_blue")
 */
export function flagValue(mob, prefix) {
    for (const flag of mob.flags) if (flag.startsWith(prefix)) return flag.substring(prefix.length);
    return null;
}

/**
 * @param layer {MobLayer}
 * @param mob {object}
 * @returns {number | null} the color the layer is tinted with
 */
export function layerTint(layer, mob) {
    if (layer.tint === "sheep") return sheepWoolColor(mob.variant);
    if (typeof layer.tint === "function") return layer.tint(mob);
    return null;
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
    if (layer.flagPrefix && flagValue(mob, layer.flagPrefix) === null) return false;
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

/**
 * vanilla CreeperEntityRenderer.getAnimationCounter: the white overlay of an igniting creeper, flashing every
 * 0.1 of the fuse-progress, at least half; as vanilla overlay-level (OverlayTexture.getU: (int) (progress * 15)).
 * @param fuse {number} - vanilla getClientFuseTime
 * @returns {number} 0 (none) .. 15
 */
export function creeperWhiteOverlay(fuse) {
    if (!(fuse > 0) || Math.floor(fuse * 10) % 2 === 0) return 0;
    return Math.floor(Math.min(Math.max(fuse, 0.5), 1) * 15);
}
