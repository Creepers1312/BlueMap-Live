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

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import org.jetbrains.annotations.Nullable;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

/** BlueMap Live: the block-assets of the previews of changed blocks (see docs/bluemap-live/phase-11.md) */
public class BlockModelBakerTest {

    static class BlockResources extends ItemModelBakerTest.TestResources {
        BlockResources() {
            models.put("minecraft:block/slab", """
                    {"elements": [{"from": [0, 0, 0], "to": [16, 8, 16], "faces": {
                      "down": {"texture": "#bottom", "cullface": "down"}, "up": {"texture": "#top"},
                      "north": {"texture": "#side", "cullface": "north"}, "south": {"texture": "#side", "cullface": "south"},
                      "west": {"texture": "#side", "cullface": "west"}, "east": {"texture": "#side", "cullface": "east"}}}]}""");
            models.put("minecraft:block/stone_slab", """
                    {"parent": "minecraft:block/slab", "textures": {"bottom": "minecraft:block/stone", "top": "minecraft:block/stone", "side": "minecraft:block/stone"}}""");
            models.put("minecraft:block/cube_cull", """
                    {"elements": [{"from": [0, 0, 0], "to": [16, 16, 16], "faces": {
                      "down": {"texture": "#all", "cullface": "down"}, "up": {"texture": "#all", "cullface": "up"},
                      "north": {"texture": "#all", "cullface": "north"}, "south": {"texture": "#all", "cullface": "south"},
                      "west": {"texture": "#all", "cullface": "west"}, "east": {"texture": "#all", "cullface": "east", "tintindex": 0}}}]}""");
            models.put("minecraft:block/full_stone", """
                    {"parent": "minecraft:block/cube_cull", "textures": {"all": "minecraft:block/stone"}}""");
            models.put("minecraft:block/full_glass", """
                    {"parent": "minecraft:block/cube_cull", "textures": {"all": "minecraft:block/glass"}}""");
            textures.put("minecraft:block/glass", ItemModelBakerTest.square(16, 0, 0, 1, 16));
            models.put("minecraft:block/fire_floor", """
                    {"parent": "minecraft:block/cube_cull", "textures": {"all": "minecraft:block/fire_0"}}""");
            // an animated texture: 4 frames of 16x16 below each other
            textures.put("minecraft:block/fire_0", ItemModelBakerTest.square(16, 0, 0, 16, 16));
            strips.put("minecraft:block/fire_0", new java.awt.image.BufferedImage(16, 64, java.awt.image.BufferedImage.TYPE_INT_ARGB));
        }

        final java.util.Map<String, java.awt.image.BufferedImage> strips = new java.util.HashMap<>();

        @Override
        public @Nullable java.awt.image.BufferedImage textureFrames(String key) {
            return strips.containsKey(key) ? strips.get(key) : texture(key);
        }

        @Override
        public @Nullable String textureMeta(String key) {
            return key.equals("minecraft:block/fire_0") ? "{\"animation\": {\"frametime\": 2, \"frames\": [3, 1, {\"index\": 0, \"time\": 5}]}}" : null;
        }

        @Override
        public @Nullable String blockStateJson(String key) {
            return switch (key) {
                case "minecraft:stone_slab" -> """
                        {"variants": {"type=bottom": {"model": "minecraft:block/stone_slab"},
                          "type=top": {"model": "minecraft:block/stone_slab", "x": 180}}}""";
                case "minecraft:stone" -> """
                        {"variants": {"": {"model": "minecraft:block/full_stone"}}}""";
                case "minecraft:fire" -> """
                        {"variants": {"": {"model": "minecraft:block/fire_floor"}}}""";
                case "minecraft:glass" -> """
                        {"variants": {"": {"model": "minecraft:block/full_glass"}}}""";
                case "minecraft:furnace" -> """
                        {"variants": {"facing=east": {"model": "minecraft:block/stone_slab", "y": 90}}}""";
                default -> null;
            };
        }
    }

    private static JsonObject bake(String state) throws Exception {
        return JsonParser.parseString(new ItemModelBaker(new BlockResources()).bakeBlock(state)).getAsJsonObject();
    }

    @Test
    public void testVariantsWithCullfacesAndFullCubes() throws Exception {
        JsonObject stone = bake("minecraft:stone");
        assertEquals("minecraft:stone", stone.get("state").getAsString());
        assertTrue(stone.get("full").getAsBoolean(), "6 whole culled faces with an opaque texture");
        JsonArray quads = stone.getAsJsonArray("quads");
        assertEquals(6 * 23, quads.size());
        // the order of vanilla's ResourceModelRenderer: down first; the east-face is tinted
        assertEquals(1, quads.get(22).getAsInt(), "cullface down = 1");
        assertEquals(0, quads.get(5 * 23 + 21).getAsInt(), "tintindex of the east-face");

        assertFalse(bake("minecraft:glass").get("full").getAsBoolean(), "transparent texture");
        JsonObject slab = bake("minecraft:stone_slab[type=bottom]");
        assertFalse(slab.get("full").getAsBoolean());
        assertEquals(6 * 23, slab.getAsJsonArray("quads").size());
    }

    @Test
    public void testVariantRotationTurnsPositionsAndCullfaces() throws Exception {
        // x: 180 turns the bottom-slab upside down: its "down"-face (cullface down) is now at the top (cullface up)
        JsonArray quads = bake("minecraft:stone_slab[type=top]").getAsJsonArray("quads");
        assertEquals(2, quads.get(22).getAsInt(), "cullface turned to up = 2");
        for (int i = 0; i < 4; i++) assertEquals(1, quads.get(i * 3 + 1).getAsDouble(), 1e-6, "y of the turned bottom-face");
        // y: 90 turns north to east
        JsonArray turned = bake("minecraft:furnace[facing=east]").getAsJsonArray("quads");
        assertEquals(6, turned.get(2 * 23 + 22).getAsInt(), "the north-face (3rd) culls east = 6");
    }

    @Test
    public void testAnimatedTexturesKeepAllFramesWithTheMcmeta() throws Exception {
        JsonObject fire = bake("minecraft:fire");
        JsonArray animations = fire.getAsJsonArray("animations");
        assertEquals(1, animations.size());
        JsonObject animation = animations.get(0).getAsJsonObject();
        assertEquals(4, animation.get("frames").getAsInt());
        assertEquals(2, animation.get("frametime").getAsInt());
        assertEquals("[3,1,0]", animation.getAsJsonArray("order").toString());
        assertTrue(bake("minecraft:stone").getAsJsonArray("animations").get(0).isJsonNull(), "not animated");
    }

    @Test
    public void testUnknownAndAirHaveNoQuads() throws Exception {
        assertEquals(0, bake("minecraft:air").getAsJsonArray("quads").size());
        assertEquals(0, bake("somemod:unknown[a=b]").getAsJsonArray("quads").size());
    }

    @Test
    public void testAssetNamesAndValidation() {
        assertEquals("blocks/minecraft/oak_stairs/facing_east__half_bottom.json",
                ItemAssetUpdater.blockAssetName("minecraft:oak_stairs[facing=east,half=bottom]"));
        assertEquals("blocks/minecraft/stone/default.json", ItemAssetUpdater.blockAssetName("minecraft:stone"));
        assertTrue(ItemAssetUpdater.isValidBlockState("minecraft:oak_stairs[facing=east,half=bottom]"));
        assertFalse(ItemAssetUpdater.isValidBlockState("minecraft:../evil"));
        assertFalse(ItemAssetUpdater.isValidBlockState("minecraft:stone[facing=EAST]"));
        assertFalse(ItemAssetUpdater.isValidBlockState("stone"));
    }

}
