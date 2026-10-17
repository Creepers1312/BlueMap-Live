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
package de.bluecolored.bluemap.common.live;

import com.flowpowered.math.vector.Vector3i;

import java.util.Set;

/**
 * An opened container whose lid the webapp animates (BlueMap Live, see docs/bluemap-live/phase-11.md): the tile shows
 * the closed chest, the webapp hides its lid there and draws the vanilla lid (ChestBlockEntityRenderer) instead.
 *
 * @param position the block-position
 * @param texture the texture of the chest-model, see {@link #TEXTURES} (vanilla TexturedRenderLayers.getChestTextureId)
 * @param facing the facing of the chest (north, east, south, west)
 * @param part "single", "left" or "right" (vanilla ChestType)
 */
public record OpenContainer(Vector3i position, String texture, String facing, String part) {

    /** vanilla TexturedRenderLayers: entity/chest/(normal|trapped|christmas)[_left|_right] and ender */
    public static final Set<String> TEXTURES = Set.of(
            "minecraft:entity/chest/normal", "minecraft:entity/chest/normal_left", "minecraft:entity/chest/normal_right",
            "minecraft:entity/chest/trapped", "minecraft:entity/chest/trapped_left", "minecraft:entity/chest/trapped_right",
            "minecraft:entity/chest/christmas", "minecraft:entity/chest/christmas_left", "minecraft:entity/chest/christmas_right",
            "minecraft:entity/chest/ender"
    );

    public static final Set<String> FACINGS = Set.of("north", "east", "south", "west");
    public static final Set<String> PARTS = Set.of("single", "left", "right");

}
