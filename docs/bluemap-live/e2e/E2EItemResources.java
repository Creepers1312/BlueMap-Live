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
            DIAMOND = 0xFF8080FF, SNOWBALL = 0xFF80FFFF, ARROW = 0xFFFF80C0;

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
        return textures.get(key);
    }

}
