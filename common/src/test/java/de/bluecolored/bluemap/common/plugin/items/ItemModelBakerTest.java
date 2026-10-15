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

import java.awt.image.BufferedImage;
import java.io.IOException;
import java.util.HashMap;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

public class ItemModelBakerTest {

    /** a tiny resource-pack in memory, the model-jsons are copies of the vanilla 1.21.1 ones that matter here */
    static class TestResources implements ItemModelBaker.Resources {
        final Map<String, String> models = new HashMap<>();
        final Map<String, BufferedImage> textures = new HashMap<>();

        TestResources() {
            models.put("minecraft:item/generated", """
                    {"parent": "builtin/generated", "gui_light": "front", "display": {
                      "ground": {"rotation": [0, 0, 0], "translation": [0, 2, 0], "scale": [0.5, 0.5, 0.5]},
                      "thirdperson_righthand": {"rotation": [0, 0, 0], "translation": [0, 3, 1], "scale": [0.55, 0.55, 0.55]}}}""");
            models.put("minecraft:item/handheld", """
                    {"parent": "item/generated", "display": {
                      "thirdperson_righthand": {"rotation": [0, -90, 55], "translation": [0, 4.0, 0.5], "scale": [0.85, 0.85, 0.85]},
                      "thirdperson_lefthand": {"rotation": [0, 90, -55], "translation": [0, 4.0, 0.5], "scale": [0.85, 0.85, 0.85]}}}""");
            models.put("minecraft:item/diamond_sword", """
                    {"parent": "minecraft:item/handheld", "textures": {"layer0": "minecraft:item/diamond_sword"}}""");
            models.put("minecraft:item/apple", """
                    {"parent": "minecraft:item/generated", "textures": {"layer0": "minecraft:item/apple"}}""");
            models.put("minecraft:block/block", """
                    {"display": {"thirdperson_righthand": {"rotation": [75, 45, 0], "translation": [0, 2.5, 0], "scale": [0.375, 0.375, 0.375]}}}""");
            models.put("minecraft:block/cube_all", """
                    {"parent": "block/block", "elements": [{"from": [0, 0, 0], "to": [16, 16, 16], "faces": {
                      "down": {"texture": "#all"}, "up": {"texture": "#all"}, "north": {"texture": "#all"},
                      "south": {"texture": "#all"}, "west": {"texture": "#all"}, "east": {"texture": "#all"}}}]}""");
            models.put("minecraft:block/stone", """
                    {"parent": "minecraft:block/cube_all", "textures": {"all": "minecraft:block/stone"}}""");
            models.put("minecraft:item/stone", """
                    {"parent": "minecraft:block/stone"}""");
            models.put("minecraft:item/bow", """
                    {"parent": "item/generated", "textures": {"layer0": "item/bow"}, "overrides": [
                      {"predicate": {"pulling": 1}, "model": "item/bow_pulling_0"},
                      {"predicate": {"pulling": 1, "pull": 0.65}, "model": "item/bow_pulling_1"},
                      {"predicate": {"pulling": 1}, "model": "item/missing_model"}]}""");
            models.put("minecraft:item/bow_pulling_0", """
                    {"parent": "item/bow", "textures": {"layer0": "item/bow_pulling_0"}}""");
            models.put("minecraft:item/bow_pulling_1", """
                    {"parent": "item/bow", "textures": {"layer0": "item/bow_pulling_1"}}""");
            models.put("minecraft:item/shield", """
                    {"parent": "builtin/entity", "display": {
                      "thirdperson_righthand": {"rotation": [0, 90, 0], "translation": [10, 6, -4], "scale": [1, 1, 1]}}}""");
            models.put("minecraft:item/chest", """
                    {"parent": "builtin/entity"}""");

            textures.put("minecraft:item/diamond_sword", diagonal());
            textures.put("minecraft:item/apple", square(16, 4, 4, 8, 8));
            textures.put("minecraft:item/bow", square(16, 0, 0, 16, 16));
            textures.put("minecraft:item/bow_pulling_0", square(16, 0, 0, 16, 16));
            textures.put("minecraft:item/bow_pulling_1", square(16, 0, 0, 16, 16));
            textures.put("minecraft:block/stone", square(16, 0, 0, 16, 16));
            textures.put("minecraft:entity/shield_base_nopattern", square(64, 0, 0, 64, 64));
            textures.put("minecraft:entity/projectiles/arrow", square(32, 0, 0, 16, 10));
            textures.put("minecraft:entity/zombie/zombie", square(64, 0, 0, 64, 64));
            textures.put("minecraft:entity/villager/villager", square(64, 0, 0, 64, 64));
            textures.put("minecraft:entity/villager/type/plains", square(64, 0, 0, 8, 8));
            textures.put("minecraft:entity/villager/profession/farmer", square(64, 0, 0, 8, 8));
        }

        @Override
        public java.util.List<String> textureKeys(String folder) {
            return textures.keySet().stream().filter(key -> key.startsWith(folder)).sorted().toList();
        }

        @Override
        public @Nullable String modelJson(String key) {
            return models.get(key);
        }

        @Override
        public @Nullable BufferedImage texture(String key) {
            return textures.get(key);
        }
    }

    /** a transparent image with an opaque rectangle */
    static BufferedImage square(int size, int x, int y, int w, int h) {
        BufferedImage image = new BufferedImage(size, size, BufferedImage.TYPE_INT_ARGB);
        for (int i = x; i < x + w; i++) for (int j = y; j < y + h; j++) image.setRGB(i, j, 0xFF808080);
        return image;
    }

    /** a one pixel wide diagonal line (like a sword) */
    static BufferedImage diagonal() {
        BufferedImage image = new BufferedImage(16, 16, BufferedImage.TYPE_INT_ARGB);
        for (int i = 0; i < 16; i++) image.setRGB(i, 15 - i, 0xFF00FFFF);
        return image;
    }

    static JsonObject bake(String item) throws IOException {
        return JsonParser.parseString(new ItemModelBaker(new TestResources()).bake(item)).getAsJsonObject();
    }

    static int quadCount(JsonObject model) {
        return model.getAsJsonArray("quads").size() / 22;
    }

    @Test
    public void testGeneratedItem() throws IOException {
        JsonObject asset = bake("minecraft:apple");
        assertEquals(1, asset.get("format").getAsInt());
        assertEquals("minecraft:apple", asset.get("item").getAsString());
        assertEquals(1, asset.getAsJsonArray("textures").size());
        assertTrue(asset.getAsJsonArray("textures").get(0).getAsString().startsWith("data:image/png;base64,"));

        JsonObject model = asset.getAsJsonArray("models").get(0).getAsJsonObject();
        assertEquals("quads", model.get("type").getAsString());
        // front + back + 4 edges of the opaque 8x8 square (one merged run per side)
        assertEquals(6, quadCount(model));

        // display from item/generated, the left hand defaults to the right hand
        JsonObject right = model.getAsJsonObject("display").getAsJsonObject("right");
        assertEquals(3, right.getAsJsonArray("translation").get(1).getAsDouble());
        assertEquals(right, model.getAsJsonObject("display").getAsJsonObject("left"));
        // the ground-transformation (dropped and thrown items)
        assertEquals(0.5, model.getAsJsonObject("display").getAsJsonObject("ground").getAsJsonArray("scale").get(1).getAsDouble(), 1e-6);
    }

    @Test
    public void testGeneratedItemGeometry() throws IOException {
        JsonObject model = bake("minecraft:apple").getAsJsonArray("models").get(0).getAsJsonObject();
        JsonArray q = model.getAsJsonArray("quads");

        // the plate: back (north, z = 7.5 px) and front (south, z = 8.5 px) with the full texture, mirrored on the back
        for (int i = 0; i < 4; i++) assertEquals(7.5 / 16, q.get(i * 3 + 2).getAsDouble(), 1e-4);
        for (int i = 0; i < 4; i++) assertEquals(8.5 / 16, q.get(22 + i * 3 + 2).getAsDouble(), 1e-4);
        assertEquals(1, q.get(12).getAsDouble(), 1e-6, "back: u = 1 at the first (max-x) corner");
        assertEquals(0, q.get(22 + 12).getAsDouble(), 1e-6, "front: u = 0 at the first (min-x) corner");
        assertEquals(0, q.get(20).getAsInt(), "texture-index");
        assertEquals(0, q.get(21).getAsInt(), "layer 0 -> tintindex 0 (like vanilla)");

        // all positions in block-units, the edges lie on the borders of the square (4..12 px)
        for (int quad = 2; quad < quadCount(model); quad++) {
            for (int i = 0; i < 4; i++) {
                double x = q.get(quad * 22 + i * 3).getAsDouble() * 16;
                double y = q.get(quad * 22 + i * 3 + 1).getAsDouble() * 16;
                assertTrue(x >= 4 - 1e-3 && x <= 12 + 1e-3, "x " + x);
                assertTrue(y >= 4 - 1e-3 && y <= 12 + 1e-3, "y " + y);
            }
        }
    }

    @Test
    public void testHandheldItemFollowsParentChain() throws IOException {
        JsonObject model = bake("minecraft:diamond_sword").getAsJsonArray("models").get(0).getAsJsonObject();
        JsonObject display = model.getAsJsonObject("display");
        assertEquals(-90, display.getAsJsonObject("right").getAsJsonArray("rotation").get(1).getAsDouble());
        assertEquals(90, display.getAsJsonObject("left").getAsJsonArray("rotation").get(1).getAsDouble());
        assertEquals(0.85, display.getAsJsonObject("right").getAsJsonArray("scale").get(0).getAsDouble(), 1e-6);
        // 16 single pixels on a diagonal: 2 plate-faces + every pixel has 4 open sides
        assertEquals(2 + 16 * 4, quadCount(model));
    }

    @Test
    public void testBlockItem() throws IOException {
        JsonObject asset = bake("minecraft:stone");
        JsonObject model = asset.getAsJsonArray("models").get(0).getAsJsonObject();
        assertEquals(6, quadCount(model), "six cube faces");
        assertEquals(75, model.getAsJsonObject("display").getAsJsonObject("right").getAsJsonArray("rotation").get(0).getAsDouble());
        JsonArray q = model.getAsJsonArray("quads");
        // the cube spans the whole block 0..1
        double min = 1, max = 0;
        for (int quad = 0; quad < 6; quad++) for (int i = 0; i < 12; i++) {
            min = Math.min(min, q.get(quad * 22 + i).getAsDouble());
            max = Math.max(max, q.get(quad * 22 + i).getAsDouble());
        }
        assertEquals(0, min, 1e-6);
        assertEquals(1, max, 1e-6);
        assertEquals(-1, q.get(21).getAsInt(), "no tint");
    }

    @Test
    public void testOverrides() throws IOException {
        JsonObject asset = bake("minecraft:bow");
        JsonArray models = asset.getAsJsonArray("models");
        assertEquals(3, models.size(), "base + two overrides, the override with a missing model is skipped");
        assertFalse(models.get(0).getAsJsonObject().has("predicate"));
        JsonObject predicate = models.get(2).getAsJsonObject().getAsJsonObject("predicate");
        assertEquals(1, predicate.get("pulling").getAsDouble());
        assertEquals(0.65, predicate.get("pull").getAsDouble(), 1e-6);
        assertEquals(3, asset.getAsJsonArray("textures").size(), "every texture only once");
    }

    @Test
    public void testShieldAndOtherEntityItems() throws IOException {
        JsonObject shield = bake("minecraft:shield").getAsJsonArray("models").get(0).getAsJsonObject();
        assertEquals("shield", shield.get("type").getAsString());
        assertEquals(0, shield.get("texture").getAsInt());
        assertEquals(10, shield.getAsJsonObject("display").getAsJsonObject("right").getAsJsonArray("translation").get(0).getAsDouble());

        // a chest has neither an item-texture nor a supported entity-model -> no model
        assertEquals(0, bake("minecraft:chest").getAsJsonArray("models").size());
    }

    @Test
    public void testUnknownAndInvalidItems() throws IOException {
        assertEquals(0, bake("minecraft:does_not_exist").getAsJsonArray("models").size());
        assertThrows(IllegalArgumentException.class, () -> bake("minecraft:../../evil"));
        assertThrows(IllegalArgumentException.class, () -> bake("Minecraft:Stone"));
        assertEquals("items/minecraft/stone.json", ItemAssetUpdater.assetName("minecraft:stone"));
        assertEquals("items/mymod/tools/hammer.json", ItemAssetUpdater.assetName("mymod:tools/hammer"));
    }

    @Test
    public void testTextureFilter() {
        assertTrue(ItemResourceIndex.isItemRelevantTexture("minecraft", "item/bow"));
        assertTrue(ItemResourceIndex.isItemRelevantTexture("minecraft", "block/stone"));
        assertTrue(ItemResourceIndex.isItemRelevantTexture("minecraft", "entity/shield_base_nopattern"));
        assertTrue(ItemResourceIndex.isItemRelevantTexture("minecraft", "entity/zombie/zombie")); // mob-textures
        assertFalse(ItemResourceIndex.isItemRelevantTexture("minecraft", "gui/widgets"));
        assertTrue(ItemResourceIndex.isItemRelevantTexture("mymod", "anything/else"));
    }

    @Test
    public void testEntityAssets() throws IOException {
        ItemModelBaker baker = new ItemModelBaker(new TestResources());
        JsonObject arrow = JsonParser.parseString(baker.bakeEntity("minecraft:arrow")).getAsJsonObject();
        assertEquals(1, arrow.getAsJsonArray("textures").size());
        JsonObject model = arrow.getAsJsonArray("models").get(0).getAsJsonObject();
        assertEquals("arrow", model.get("type").getAsString());
        assertEquals(0, model.get("texture").getAsInt());

        // spectral-arrow texture missing in this pack, unknown entities: no model
        assertEquals(0, JsonParser.parseString(baker.bakeEntity("minecraft:spectral_arrow")).getAsJsonObject().getAsJsonArray("models").size());
        assertEquals(0, JsonParser.parseString(baker.bakeEntity("minecraft:allay")).getAsJsonObject().getAsJsonArray("models").size());
        assertEquals("entities/minecraft/arrow.json", ItemAssetUpdater.entityAssetName("minecraft:arrow"));
        assertTrue(ItemResourceIndex.isItemRelevantTexture("minecraft", "entity/projectiles/arrow"));
    }

    @Test
    public void testMobAssets() throws IOException {
        ItemModelBaker baker = new ItemModelBaker(new TestResources());

        // the textures by their key, missing textures (drowned) are left out
        JsonObject zombie = JsonParser.parseString(baker.bakeEntity("minecraft:zombie")).getAsJsonObject();
        assertEquals("minecraft:zombie", zombie.get("entity").getAsString());
        JsonObject textures = zombie.getAsJsonObject("textures");
        assertEquals(1, textures.size());
        assertTrue(textures.get("minecraft:entity/zombie/zombie").getAsString().startsWith("data:image/png;base64,"));
        assertEquals(0, JsonParser.parseString(baker.bakeEntity("minecraft:drowned")).getAsJsonObject()
                .getAsJsonObject("textures").size());

        // folders: all villager-textures
        JsonObject villager = JsonParser.parseString(baker.bakeEntity("minecraft:villager")).getAsJsonObject();
        assertEquals(java.util.Set.of("minecraft:entity/villager/villager", "minecraft:entity/villager/type/plains",
                "minecraft:entity/villager/profession/farmer"), villager.getAsJsonObject("textures").keySet());

        assertTrue(ItemModelBaker.isSupportedEntity("minecraft:sheep"));
        assertFalse(ItemModelBaker.isSupportedEntity("minecraft:allay"));
    }

}
