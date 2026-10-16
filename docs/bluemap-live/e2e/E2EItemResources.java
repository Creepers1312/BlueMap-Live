/*
 * BlueMap Live – Phase 2 end-to-end test-server (NOT part of the BlueMap build).
 *
 * Serves the original, built BlueMap webapp (common/webapp/dist) together with
 *  - a small test-map whose single hires-tile is generated with BlueMap's own ArrayTileModel + PRBMWriter
 *  - maps/world/live/players.json generated with BlueMap's own PlayerMotionTracker + LivePlayersJson
 *    (the same classes FabricPlayer / LivePlayersDataSupplier use on the real server)
 *
 * The player-state is driven by the test-script through /control requests, each /control request is one
 * "server sample" (like FabricPlayer.update() on the server-thread).
 *
 * Usage: see docs/bluemap-live/e2e/README.md
 */

import com.flowpowered.math.vector.Vector3d;
import com.google.gson.stream.JsonWriter;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import de.bluecolored.bluemap.common.live.LivePlayerState;
import de.bluecolored.bluemap.common.live.LivePlayersJson;
import de.bluecolored.bluemap.common.live.Equipment;
import de.bluecolored.bluemap.common.live.HeldItem;
import de.bluecolored.bluemap.common.live.ItemUse;
import de.bluecolored.bluemap.common.live.MovementState;

import de.bluecolored.bluemap.common.plugin.items.ItemModelBaker;
import org.jetbrains.annotations.Nullable;

import java.awt.image.BufferedImage;
import java.util.HashMap;
import java.util.Map;

/**
 * A small resource-pack for the browser-tests (NOT part of the BlueMap build): the model-jsons have the structure of
 * the vanilla 1.21.1 models (parents, display, overrides), the textures are synthetic and color-coded, so the test can
 * find each item in a screenshot. Used with the real ItemModelBaker.
 */
public class E2EItemResources implements ItemModelBaker.Resources {

    public static final int SWORD = 0xFF00FFFF, APPLE = 0xFFFF0000, STONE = 0xFFFF8000, SHIELD = 0xFF00C800,
            BOW = 0xFFFFFF00, BOW_PULLING = 0xFFFF00FF, CROSSBOW = 0xFF0000FF, CROSSBOW_ARROW = 0xFFFFFFFF,
            DIAMOND = 0xFF8080FF, SNOWBALL = 0xFF80FFFF, ARROW = 0xFFFF80C0,
            ZOMBIE = 0xFF309060, COW = 0xFF804020, SHEEP = 0xFF606060, WOOL = 0xFFFFFFFF,
            VILLAGER = 0xFFC08040, FARMER = 0xFFFF00C0, IRON_ARMOR = 0xFFA0FF00, LEATHER = 0xFFFFFFFF,
            MOOSHROOM = 0xFF602020, MUSHROOM = 0xFFFF2080, ENDERMAN = 0xFF202020, GRASS = 0xFF40FF40, CREEPER = 0xFF00C0C0,
            GOLEM = 0xFFE0A000, SKULL = 0xFFFF40FF, BOAT = 0xFFB07030, MINECART = 0xFF8080A0;

    private final Map<String, String> models = new HashMap<>();
    private final Map<String, BufferedImage> textures = new HashMap<>();

    public E2EItemResources() {
        models.put("minecraft:item/generated", """
                {"parent": "builtin/generated", "display": {
                  "ground": {"rotation": [0, 0, 0], "translation": [0, 2, 0], "scale": [0.5, 0.5, 0.5]},
                  "thirdperson_righthand": {"rotation": [0, 0, 0], "translation": [0, 3, 1], "scale": [0.55, 0.55, 0.55]}}}""");
        models.put("minecraft:item/handheld", """
                {"parent": "item/generated", "display": {
                  "thirdperson_righthand": {"rotation": [0, -90, 55], "translation": [0, 4.0, 0.5], "scale": [0.85, 0.85, 0.85]},
                  "thirdperson_lefthand": {"rotation": [0, 90, -55], "translation": [0, 4.0, 0.5], "scale": [0.85, 0.85, 0.85]}}}""");
        models.put("minecraft:block/block", """
                {"display": {"thirdperson_righthand": {"rotation": [75, 45, 0], "translation": [0, 2.5, 0], "scale": [0.375, 0.375, 0.375]},
                  "ground": {"rotation": [0, 0, 0], "translation": [0, 3, 0], "scale": [0.25, 0.25, 0.25]}}}""");
        models.put("minecraft:block/cube_all", """
                {"parent": "block/block", "elements": [{"from": [0, 0, 0], "to": [16, 16, 16], "faces": {
                  "down": {"texture": "#all"}, "up": {"texture": "#all"}, "north": {"texture": "#all"},
                  "south": {"texture": "#all"}, "west": {"texture": "#all"}, "east": {"texture": "#all"}}}]}""");
        models.put("minecraft:block/stone", """
                {"parent": "minecraft:block/cube_all", "textures": {"all": "minecraft:block/stone"}}""");
        models.put("minecraft:item/stone", """
                {"parent": "minecraft:block/stone"}""");
        models.put("minecraft:item/diamond_sword", """
                {"parent": "minecraft:item/handheld", "textures": {"layer0": "minecraft:item/diamond_sword"}}""");
        models.put("minecraft:item/apple", """
                {"parent": "minecraft:item/generated", "textures": {"layer0": "minecraft:item/apple"}}""");
        models.put("minecraft:item/bow", """
                {"parent": "item/generated", "textures": {"layer0": "item/bow"}, "display": {
                  "thirdperson_righthand": {"rotation": [-80, 260, -40], "translation": [-1, -2, 2.5], "scale": [0.9, 0.9, 0.9]},
                  "thirdperson_lefthand": {"rotation": [-80, -280, 40], "translation": [-1, -2, 2.5], "scale": [0.9, 0.9, 0.9]}},
                 "overrides": [
                  {"predicate": {"pulling": 1}, "model": "item/bow_pulling_0"},
                  {"predicate": {"pulling": 1, "pull": 0.65}, "model": "item/bow_pulling_1"},
                  {"predicate": {"pulling": 1, "pull": 0.9}, "model": "item/bow_pulling_2"}]}""");
        for (int i = 0; i < 3; i++) {
            models.put("minecraft:item/bow_pulling_" + i, """
                    {"parent": "item/bow", "textures": {"layer0": "item/bow_pulling_%d"}}""".formatted(i));
            textures.put("minecraft:item/bow_pulling_" + i, bar(BOW_PULLING));
        }
        models.put("minecraft:item/crossbow", """
                {"parent": "item/generated", "textures": {"layer0": "item/crossbow"}, "display": {
                  "thirdperson_righthand": {"rotation": [-90, 0, -60], "translation": [2, 0.1, -3], "scale": [0.9, 0.9, 0.9]},
                  "thirdperson_lefthand": {"rotation": [-90, 0, 30], "translation": [2, 0.1, -3], "scale": [0.9, 0.9, 0.9]}},
                 "overrides": [
                  {"predicate": {"pulling": 1}, "model": "item/crossbow_pulling_0"},
                  {"predicate": {"charged": 1}, "model": "item/crossbow_arrow"}]}""");
        models.put("minecraft:item/crossbow_pulling_0", """
                {"parent": "item/crossbow", "textures": {"layer0": "item/crossbow_pulling_0"}}""");
        models.put("minecraft:item/crossbow_arrow", """
                {"parent": "item/crossbow", "textures": {"layer0": "item/crossbow_arrow"}}""");
        models.put("minecraft:item/shield", """
                {"parent": "builtin/entity", "display": {
                  "thirdperson_righthand": {"rotation": [0, 90, 0], "translation": [10, 6, -4], "scale": [1, 1, 1]},
                  "thirdperson_lefthand": {"rotation": [0, 90, 0], "translation": [10, 6, 12], "scale": [1, 1, 1]}},
                 "overrides": [{"predicate": {"blocking": 1}, "model": "item/shield_blocking"}]}""");
        models.put("minecraft:item/shield_blocking", """
                {"parent": "builtin/entity", "display": {
                  "thirdperson_righthand": {"rotation": [45, 135, 0], "translation": [3.51, 11, -2], "scale": [1, 1, 1]},
                  "thirdperson_lefthand": {"rotation": [45, 135, 0], "translation": [13.51, 3, 5], "scale": [1, 1, 1]}}}""");

        for (String name : new String[] {"diamond", "snowball", "arrow"}) {
            models.put("minecraft:item/" + name, """
                    {"parent": "minecraft:item/generated", "textures": {"layer0": "minecraft:item/%s"}}""".formatted(name));
        }
        textures.put("minecraft:item/diamond", square(16, 3, 3, 10, 10, DIAMOND));
        textures.put("minecraft:item/snowball", square(16, 3, 3, 10, 10, SNOWBALL));
        textures.put("minecraft:item/arrow", diagonal(ARROW));

        // the 32x32 arrow-texture: shaft-strip (16x5 px at 0,0) pink, fletching (5x5 px at 0,5) white
        BufferedImage arrow = square(32, 0, 0, 16, 5, ARROW);
        for (int x = 0; x < 5; x++) for (int y = 5; y < 10; y++) arrow.setRGB(x, y, 0xFFFFFFFF);
        textures.put("minecraft:entity/projectiles/arrow", arrow);

        textures.put("minecraft:item/diamond_sword", diagonal(SWORD));
        textures.put("minecraft:item/apple", square(16, 4, 4, 8, 8, APPLE));
        textures.put("minecraft:block/stone", square(16, 0, 0, 16, 16, STONE));
        textures.put("minecraft:entity/shield_base_nopattern", square(64, 0, 0, 64, 64, SHIELD));
        textures.put("minecraft:item/bow", bar(BOW));
        textures.put("minecraft:item/crossbow", bar(CROSSBOW));
        textures.put("minecraft:item/crossbow_pulling_0", bar(CROSSBOW));
        textures.put("minecraft:item/crossbow_arrow", bar(CROSSBOW_ARROW));

        // mobs: one color per texture (the whole image), the villager-profession only on the upper half (head)
        textures.put("minecraft:entity/zombie/zombie", square(64, 0, 0, 64, 64, ZOMBIE));
        textures.put("minecraft:entity/cow/cow", rect(64, 32, 0, 0, 64, 32, COW));
        textures.put("minecraft:entity/boat/oak", rect(128, 64, 0, 0, 128, 64, BOAT));
        textures.put("minecraft:entity/minecart", rect(64, 32, 0, 0, 64, 32, MINECART));
        textures.put("minecraft:entity/lead_knot", rect(32, 32, 0, 0, 32, 32, BOAT));
        // particles: white (the particle-color is multiplied), the fire: an animated strip of 32 frames
        for (String texture : de.bluecolored.bluemap.common.live.ParticleState.TEXTURES) {
            textures.put(texture, texture.contains(":block/fire_") ? rect(16, 512, 0, 0, 16, 512, FIRE) :
                    square(texture.contains("explosion") ? 16 : 8, 0, 0, texture.contains("explosion") ? 16 : 8,
                            texture.contains("explosion") ? 16 : 8, 0xFFFFFFFF));
        }
        textures.put("minecraft:entity/sheep/sheep", rect(64, 32, 0, 0, 64, 32, SHEEP));
        textures.put("minecraft:entity/sheep/sheep_fur", rect(64, 32, 0, 0, 64, 32, WOOL));
        textures.put("minecraft:entity/villager/villager", square(64, 0, 0, 64, 64, VILLAGER));
        textures.put("minecraft:entity/villager/type/plains", square(64, 0, 0, 1, 1, VILLAGER));
        textures.put("minecraft:entity/villager/profession/farmer", square(64, 0, 0, 64, 20, FARMER));

        // block-models for the mooshroom-mushrooms (vanilla block/cross structure) and the enderman (a cube)
        models.put("minecraft:block/cross", """
                {"elements": [
                  {"from": [0.8, 0, 8], "to": [15.2, 16, 8], "rotation": {"origin": [8, 8, 8], "axis": "y", "angle": 45, "rescale": true},
                   "faces": {"north": {"uv": [0, 0, 16, 16], "texture": "#cross"}, "south": {"uv": [0, 0, 16, 16], "texture": "#cross"}}},
                  {"from": [8, 0, 0.8], "to": [8, 16, 15.2], "rotation": {"origin": [8, 8, 8], "axis": "y", "angle": 45, "rescale": true},
                   "faces": {"west": {"uv": [0, 0, 16, 16], "texture": "#cross"}, "east": {"uv": [0, 0, 16, 16], "texture": "#cross"}}}]}""");
        models.put("minecraft:block/red_mushroom", """
                {"parent": "minecraft:block/cross", "textures": {"cross": "minecraft:block/red_mushroom"}}""");
        textures.put("minecraft:block/red_mushroom", square(16, 2, 2, 12, 12, MUSHROOM));
        models.put("minecraft:block/grass_block", """
                {"parent": "minecraft:block/cube_all", "textures": {"all": "minecraft:block/grass_block_e2e"}}""");
        textures.put("minecraft:block/grass_block_e2e", square(16, 0, 0, 16, 16, GRASS));
        textures.put("minecraft:entity/cow/red_mooshroom", rect(64, 32, 0, 0, 64, 32, MOOSHROOM));
        textures.put("minecraft:entity/enderman/enderman", rect(64, 32, 0, 0, 64, 32, ENDERMAN));
        textures.put("minecraft:entity/creeper/creeper", rect(64, 32, 0, 0, 64, 32, CREEPER));
        textures.put("minecraft:entity/iron_golem/iron_golem", square(128, 0, 0, 128, 128, GOLEM));
        textures.put("minecraft:entity/skeleton/skeleton", rect(64, 32, 0, 0, 64, 32, SKULL));
        // poses: tame wolf and cat with a checker-pattern (the parts are distinguishable)
        textures.put("minecraft:entity/wolf/wolf_tame", checker(64, 32, 0xFF808080, 0xFFE0E0E0));
        textures.put("minecraft:entity/cat/tabby", checker(64, 32, 0xFFA06030, 0xFFE0C080));
        // the glint: diagonal stripes (the movement of the texture-matrix is visible)
        BufferedImage glint = new BufferedImage(64, 64, BufferedImage.TYPE_INT_ARGB);
        for (int i = 0; i < 64; i++) for (int j = 0; j < 64; j++) glint.setRGB(i, j, ((i + j) / 8) % 2 == 0 ? 0xFFFF00FF : 0xFF000000);
        textures.put("minecraft:misc/enchanted_glint_entity", glint);
        textures.put("minecraft:entity/panda/panda", checker(64, 64, 0xFF202020, 0xFFF0F0F0));
        // tropical fish: white like the vanilla textures (tinted by the webapp); only pattern 1 (kob), fully covering
        textures.put("minecraft:entity/fish/tropical_a", square(32, 0, 0, 32, 32, 0xFFFFFFFF));
        textures.put("minecraft:entity/fish/tropical_a_pattern_1", square(32, 0, 0, 32, 32, 0xFFFFFFFF));

        // armor-layers (64x32, one color; the leather-overlay is transparent)
        textures.put("minecraft:models/armor/iron_layer_1", rect(64, 32, 0, 0, 64, 32, IRON_ARMOR));
        textures.put("minecraft:models/armor/leather_layer_2", rect(64, 32, 0, 0, 64, 32, LEATHER));
        textures.put("minecraft:models/armor/leather_layer_2_overlay", rect(64, 32, 0, 0, 0, 0, LEATHER));
    }

    /** the color of the fire-textures */
    static final int FIRE = 0xFFFF8000;

    private static BufferedImage rect(int width, int height, int x, int y, int w, int h, int argb) {
        BufferedImage image = new BufferedImage(width, height, BufferedImage.TYPE_INT_ARGB);
        for (int i = x; i < x + w; i++) for (int j = y; j < y + h; j++) image.setRGB(i, j, argb);
        return image;
    }


    private static BufferedImage checker(int width, int height, int a, int b) {
        BufferedImage image = new BufferedImage(width, height, BufferedImage.TYPE_INT_ARGB);
        for (int i = 0; i < width; i++) for (int j = 0; j < height; j++) image.setRGB(i, j, ((i / 2 + j / 2) % 2 == 0) ? a : b);
        return image;
    }

    private static BufferedImage square(int size, int x, int y, int w, int h, int argb) {
        BufferedImage image = new BufferedImage(size, size, BufferedImage.TYPE_INT_ARGB);
        for (int i = x; i < x + w; i++) for (int j = y; j < y + h; j++) image.setRGB(i, j, argb);
        return image;
    }

    /** a 3 px wide diagonal from the bottom-left (handle) to the top-right (tip), like a sword */
    private static BufferedImage diagonal(int argb) {
        BufferedImage image = new BufferedImage(16, 16, BufferedImage.TYPE_INT_ARGB);
        for (int i = 0; i < 16; i++) {
            for (int d = -1; d <= 1; d++) {
                int y = 15 - i + d;
                if (y >= 0 && y < 16) image.setRGB(i, y, argb);
            }
        }
        return image;
    }

    private static BufferedImage bar(int argb) {
        return square(16, 5, 0, 6, 16, argb);
    }

    @Override
    public @Nullable String modelJson(String key) {
        return models.get(key);
    }

    @Override
    public @Nullable BufferedImage texture(String key) {
        BufferedImage texture = textures.get(key);
        // for manual checks of the mob-models: -De2e.allMobTextures=true gives every missing entity-texture a checker
        if (texture == null && key.startsWith("minecraft:entity/") && Boolean.getBoolean("e2e.allMobTextures")) {
            texture = new BufferedImage(128, 128, BufferedImage.TYPE_INT_ARGB);
            int color = 0xFF000000 | (key.hashCode() & 0x7F7F7F) | 0x404040;
            for (int x = 0; x < 128; x++) for (int y = 0; y < 128; y++) texture.setRGB(x, y, ((x / 4 + y / 4) % 2 == 0) ? color : 0xFFE0E0E0);
        }
        return texture;
    }

    @Override
    public java.util.List<String> textureKeys(String folder) {
        java.util.List<String> keys = new java.util.ArrayList<>(textures.keySet().stream().filter(key -> key.startsWith(folder)).sorted().toList());
        return keys;
    }

}
