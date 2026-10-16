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
package de.bluecolored.bluemap.common.plugin.items;

import java.util.List;
import java.util.Map;

/**
 * The textures of the mobs that the webapp renders with their vanilla model (BlueMap Live, see
 * docs/bluemap-live/phase-6.md): the texture-paths of the vanilla entity-renderers (1.21).
 * An entry ending with "/" (or "_") includes all textures with that prefix (variants, e.g. villager-types, cat-variants).
 */
final class MobTextures {

    private MobTextures() {}

    static final Map<String, List<String>> TEXTURES = Map.ofEntries(
            Map.entry("minecraft:zombie", List.of("minecraft:entity/zombie/zombie")),
            Map.entry("minecraft:husk", List.of("minecraft:entity/zombie/husk")),
            Map.entry("minecraft:drowned", List.of("minecraft:entity/zombie/drowned", "minecraft:entity/zombie/drowned_outer_layer")),
            Map.entry("minecraft:skeleton", List.of("minecraft:entity/skeleton/skeleton")),
            Map.entry("minecraft:stray", List.of("minecraft:entity/skeleton/stray", "minecraft:entity/skeleton/stray_overlay")),
            Map.entry("minecraft:wither_skeleton", List.of("minecraft:entity/skeleton/wither_skeleton")),
            Map.entry("minecraft:creeper", List.of("minecraft:entity/creeper/creeper", "minecraft:entity/creeper/creeper_armor")),
            Map.entry("minecraft:pig", List.of("minecraft:entity/pig/pig", "minecraft:entity/pig/pig_saddle")),
            Map.entry("minecraft:cow", List.of("minecraft:entity/cow/cow")),
            Map.entry("minecraft:mooshroom", List.of("minecraft:entity/cow/red_mooshroom", "minecraft:entity/cow/brown_mooshroom")),
            Map.entry("minecraft:sheep", List.of("minecraft:entity/sheep/sheep", "minecraft:entity/sheep/sheep_fur")),
            Map.entry("minecraft:chicken", List.of("minecraft:entity/chicken")),
            Map.entry("minecraft:spider", List.of("minecraft:entity/spider/spider", "minecraft:entity/spider_eyes")),
            Map.entry("minecraft:cave_spider", List.of("minecraft:entity/spider/cave_spider", "minecraft:entity/spider_eyes")),
            Map.entry("minecraft:enderman", List.of("minecraft:entity/enderman/enderman", "minecraft:entity/enderman/enderman_eyes")),
            Map.entry("minecraft:slime", List.of("minecraft:entity/slime/slime")),
            Map.entry("minecraft:villager", List.of("minecraft:entity/villager/")),
            Map.entry("minecraft:zombie_villager", List.of("minecraft:entity/zombie_villager/")),
            Map.entry("minecraft:piglin", List.of("minecraft:entity/piglin/piglin")),
            Map.entry("minecraft:zombified_piglin", List.of("minecraft:entity/piglin/zombified_piglin")),
            Map.entry("minecraft:piglin_brute", List.of("minecraft:entity/piglin/piglin_brute")),
            // further mobs of 1.21 (folders: all variants)
            Map.entry("minecraft:allay", List.of("minecraft:entity/allay/allay")),
            Map.entry("minecraft:armadillo", List.of("minecraft:entity/armadillo")),
            Map.entry("minecraft:axolotl", List.of("minecraft:entity/axolotl/")),
            Map.entry("minecraft:bat", List.of("minecraft:entity/bat")),
            Map.entry("minecraft:bee", List.of("minecraft:entity/bee/")),
            Map.entry("minecraft:blaze", List.of("minecraft:entity/blaze")),
            Map.entry("minecraft:bogged", List.of("minecraft:entity/skeleton/bogged", "minecraft:entity/skeleton/bogged_overlay")),
            Map.entry("minecraft:breeze", List.of("minecraft:entity/breeze/breeze")),
            Map.entry("minecraft:camel", List.of("minecraft:entity/camel/camel")),
            Map.entry("minecraft:cat", List.of("minecraft:entity/cat/")),
            Map.entry("minecraft:ocelot", List.of("minecraft:entity/cat/ocelot")),
            Map.entry("minecraft:cod", List.of("minecraft:entity/fish/cod")),
            Map.entry("minecraft:dolphin", List.of("minecraft:entity/dolphin")),
            Map.entry("minecraft:donkey", List.of("minecraft:entity/horse/donkey")),
            Map.entry("minecraft:mule", List.of("minecraft:entity/horse/mule")),
            Map.entry("minecraft:horse", List.of("minecraft:entity/horse/")),
            Map.entry("minecraft:skeleton_horse", List.of("minecraft:entity/horse/horse_skeleton")),
            Map.entry("minecraft:zombie_horse", List.of("minecraft:entity/horse/horse_zombie")),
            Map.entry("minecraft:elder_guardian", List.of("minecraft:entity/guardian_elder")),
            Map.entry("minecraft:guardian", List.of("minecraft:entity/guardian")),
            Map.entry("minecraft:endermite", List.of("minecraft:entity/endermite")),
            Map.entry("minecraft:evoker", List.of("minecraft:entity/illager/evoker")),
            Map.entry("minecraft:illusioner", List.of("minecraft:entity/illager/illusioner")),
            Map.entry("minecraft:pillager", List.of("minecraft:entity/illager/pillager")),
            Map.entry("minecraft:vindicator", List.of("minecraft:entity/illager/vindicator")),
            Map.entry("minecraft:fox", List.of("minecraft:entity/fox/")),
            Map.entry("minecraft:frog", List.of("minecraft:entity/frog/")),
            Map.entry("minecraft:ghast", List.of("minecraft:entity/ghast/")),
            Map.entry("minecraft:giant", List.of("minecraft:entity/zombie/zombie")),
            Map.entry("minecraft:glow_squid", List.of("minecraft:entity/squid/glow_squid")),
            Map.entry("minecraft:squid", List.of("minecraft:entity/squid/squid")),
            Map.entry("minecraft:goat", List.of("minecraft:entity/goat/goat")),
            Map.entry("minecraft:hoglin", List.of("minecraft:entity/hoglin/hoglin")),
            Map.entry("minecraft:zoglin", List.of("minecraft:entity/hoglin/zoglin")),
            Map.entry("minecraft:iron_golem", List.of("minecraft:entity/iron_golem/iron_golem")),
            Map.entry("minecraft:llama", List.of("minecraft:entity/llama/")),
            Map.entry("minecraft:trader_llama", List.of("minecraft:entity/llama/")),
            Map.entry("minecraft:magma_cube", List.of("minecraft:entity/slime/magmacube")),
            Map.entry("minecraft:panda", List.of("minecraft:entity/panda/")),
            Map.entry("minecraft:parrot", List.of("minecraft:entity/parrot/")),
            Map.entry("minecraft:phantom", List.of("minecraft:entity/phantom", "minecraft:entity/phantom_eyes")),
            Map.entry("minecraft:polar_bear", List.of("minecraft:entity/bear/polarbear")),
            Map.entry("minecraft:pufferfish", List.of("minecraft:entity/fish/pufferfish")),
            Map.entry("minecraft:rabbit", List.of("minecraft:entity/rabbit/")),
            Map.entry("minecraft:ravager", List.of("minecraft:entity/illager/ravager")),
            Map.entry("minecraft:salmon", List.of("minecraft:entity/fish/salmon")),
            Map.entry("minecraft:shulker", List.of("minecraft:entity/shulker/shulker")),
            Map.entry("minecraft:silverfish", List.of("minecraft:entity/silverfish")),
            Map.entry("minecraft:sniffer", List.of("minecraft:entity/sniffer/sniffer")),
            Map.entry("minecraft:snow_golem", List.of("minecraft:entity/snow_golem")),
            Map.entry("minecraft:strider", List.of("minecraft:entity/strider/")),
            Map.entry("minecraft:tadpole", List.of("minecraft:entity/tadpole/tadpole")),
            Map.entry("minecraft:tropical_fish", List.of("minecraft:entity/fish/tropical_")),
            Map.entry("minecraft:turtle", List.of("minecraft:entity/turtle/big_sea_turtle")),
            Map.entry("minecraft:vex", List.of("minecraft:entity/illager/vex", "minecraft:entity/illager/vex_charging")),
            Map.entry("minecraft:wandering_trader", List.of("minecraft:entity/wandering_trader")),
            Map.entry("minecraft:warden", List.of("minecraft:entity/warden/warden")),
            Map.entry("minecraft:witch", List.of("minecraft:entity/witch")),
            Map.entry("minecraft:wither", List.of("minecraft:entity/wither/wither")),
            Map.entry("minecraft:wolf", List.of("minecraft:entity/wolf/"))
    );

}
