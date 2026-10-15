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
 * An entry ending with "/" includes all textures of that folder (villager-types, -professions and -levels).
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
            Map.entry("minecraft:piglin_brute", List.of("minecraft:entity/piglin/piglin_brute"))
    );

}
