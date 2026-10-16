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

import com.flowpowered.math.vector.Vector3f;
import com.flowpowered.math.vector.Vector4f;
import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.google.gson.stream.JsonWriter;
import de.bluecolored.bluemap.core.resources.ResourcePath;
import de.bluecolored.bluemap.core.resources.adapter.ResourcesGson;
import de.bluecolored.bluemap.core.resources.pack.resourcepack.model.Element;
import de.bluecolored.bluemap.core.resources.pack.resourcepack.model.Face;
import de.bluecolored.bluemap.core.resources.pack.resourcepack.model.Model;
import de.bluecolored.bluemap.core.resources.pack.resourcepack.model.TextureVariable;
import de.bluecolored.bluemap.core.resources.pack.resourcepack.texture.Texture;
import de.bluecolored.bluemap.core.util.Direction;
import de.bluecolored.bluemap.core.util.math.MatrixM4f;
import de.bluecolored.bluemap.core.util.math.VectorM3f;
import org.jetbrains.annotations.Nullable;

import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.StringWriter;
import java.util.*;

/**
 * Bakes the (third-person) item-model of an item into a self-contained json-asset for the webapp:
 * resolved faces (positions in block-units 0..1, uvs 0..1), the textures as png-data-urls (first frame of animated
 * textures), the <code>thirdperson_righthand/lefthand</code>, <code>ground</code> and <code>head</code> display-transformations and the overrides.
 * <p>Follows the vanilla rules: the parent-chain is merged (textures by key, elements and each display-mode from the
 * nearest model that defines them), <code>builtin/generated</code> models are extruded from their layer-textures
 * like the vanilla <code>ItemModelGenerator</code>, faces and uvs are created with BlueMaps own model-classes
 * (the same that are used to render the map).</p>
 * <p>See docs/bluemap-live/phase-4.md for the format.</p>
 */
public class ItemModelBaker {

    public interface Resources {
        /** the json of a model (key e.g. <code>minecraft:item/bow</code>), null if there is none */
        @Nullable String modelJson(String key);
        /** the texture-image (key e.g. <code>minecraft:item/bow</code>), only the first frame of animated textures, null if there is none */
        @Nullable BufferedImage texture(String key);
        /** the json of a blockstate-file (key e.g. <code>minecraft:oak_stairs</code>), null if there is none */
        default @Nullable String blockStateJson(String key) {
            return null;
        }
        /** the keys of all textures in a folder (e.g. <code>minecraft:entity/villager/</code>, including sub-folders), sorted */
        default List<String> textureKeys(String folder) {
            return List.of();
        }
    }

    public static final int FORMAT_VERSION = 1;

    static final String GENERATED = "minecraft:builtin/generated";
    static final String ENTITY = "minecraft:builtin/entity";
    static final String SHIELD_TEXTURE = "minecraft:entity/shield_base_nopattern";

    static final int MAX_PARENTS = 32;
    static final int MAX_OVERRIDES = 16;
    static final int MAX_QUADS = 8192;
    static final int MAX_TEXTURE_SIZE = 512;

    private static final String[] DISPLAY_MODES = {"thirdperson_righthand", "thirdperson_lefthand", "ground", "head"};
    private static final Map<String, String> DISPLAY_NAMES = Map.of(
            "thirdperson_righthand", "right",
            "thirdperson_lefthand", "left",
            "ground", "ground",
            "head", "head"
    );

    private final Resources resources;

    public ItemModelBaker(Resources resources) {
        this.resources = resources;
    }

    /**
     * @param itemId e.g. <code>minecraft:diamond_sword</code>
     * @return the json-asset (an asset with no models if the item has no displayable model)
     */
    public String bake(String itemId) throws IOException {
        Key id = Key.parse(itemId);
        // "minecraft:block/red_mushroom": the block-model itself (rendered by the webapp with entities, e.g. mooshroom)
        String itemModelKey = id.path.startsWith("block/") ? id.namespace + ":" + id.path : id.namespace + ":item/" + id.path;

        Textures textures = new Textures();
        List<BakedModel> models = new ArrayList<>();

        ResolvedModel base = resolve(itemModelKey);
        if (base != null) {
            BakedModel baked = bakeModel(base, id, textures, null);
            if (baked != null) {
                models.add(baked);

                // overrides (only those of the item-model itself, like vanilla)
                JsonArray overrides = base.overrides;
                if (overrides != null) {
                    for (int i = 0; i < overrides.size() && i < MAX_OVERRIDES; i++) {
                        if (!(overrides.get(i) instanceof JsonObject override)) continue;
                        if (!(override.get("predicate") instanceof JsonObject predicate)) continue;
                        if (!(override.get("model") instanceof JsonElement modelRef) || !modelRef.isJsonPrimitive()) continue;
                        ResolvedModel overrideModel = resolve(Key.normalize(modelRef.getAsString()));
                        if (overrideModel == null) continue;
                        BakedModel bakedOverride = bakeModel(overrideModel, id, textures, predicate);
                        if (bakedOverride != null) models.add(bakedOverride);
                    }
                }
            }
        }

        return write(itemId, textures, models);
    }

    /** entity-models that are built by the webapp (like the vanilla entity-renderers), with their texture */
    static final Map<String, String[]> ENTITY_MODELS = Map.of(
            "minecraft:arrow", new String[] {"arrow", "minecraft:entity/projectiles/arrow"},
            "minecraft:spectral_arrow", new String[] {"arrow", "minecraft:entity/projectiles/spectral_arrow"}
    );

    static boolean isSupportedEntity(String entityType) {
        return ENTITY_MODELS.containsKey(entityType) || MobTextures.TEXTURES.containsKey(entityType);
    }

    /** textures that are provided on their own (requested by the live-data): armor-textures, armor-trims, skulls, particles, chests */
    static boolean isProvidedTexture(String textureKey) {
        int colon = textureKey.indexOf(':');
        return textureKey.startsWith("models/armor/", colon + 1) || textureKey.startsWith(TRIM_SPRITES, colon + 1) ||
                SKULL_TEXTURES.containsValue(textureKey) || textureKey.equals(de.bluecolored.bluemap.common.live.Armor.GLINT_TEXTURE) ||
                de.bluecolored.bluemap.common.live.ParticleState.TEXTURES.contains(textureKey) ||
                de.bluecolored.bluemap.common.live.OpenContainer.TEXTURES.contains(textureKey);
    }

    /** vanilla SkullBlockEntityRenderer.TEXTURES by the skull-items (player-heads: the default skin) */
    public static final Map<String, String> SKULL_TEXTURES = Map.of(
            "minecraft:skeleton_skull", "minecraft:entity/skeleton/skeleton",
            "minecraft:wither_skeleton_skull", "minecraft:entity/skeleton/wither_skeleton",
            "minecraft:player_head", "minecraft:entity/player/wide/steve",
            "minecraft:zombie_head", "minecraft:entity/zombie/zombie",
            "minecraft:creeper_head", "minecraft:entity/creeper/creeper",
            "minecraft:dragon_head", "minecraft:entity/enderdragon/dragon",
            "minecraft:piglin_head", "minecraft:entity/piglin/piglin"
    );

    /** the sprites of vanilla ArmorTrim.getGenericModelId / getLeggingsModelId: &lt;pattern&gt;[_leggings]_&lt;material&gt; */
    static final String TRIM_SPRITES = "trims/models/armor/";
    static final String TRIM_PALETTES = "trims/color_palettes/";
    /** vanilla atlases/armor_trims.json: the palette-key of the paletted permutations */
    static final String TRIM_PALETTE_KEY = "minecraft:trims/color_palettes/trim_palette";

    /**
     * A texture of the resource-pack, or a generated armor-trim sprite like vanilla PalettedPermutationsAtlasSource
     * (the permutations named like their palettes, as in the vanilla atlas armor_trims.json).
     */
    static @Nullable BufferedImage providedTexture(Resources resources, String textureKey) {
        BufferedImage texture = resources.texture(textureKey);
        if (texture != null) return texture;
        int colon = textureKey.indexOf(':');
        if (!textureKey.startsWith(TRIM_SPRITES, colon + 1)) return null;
        String namespace = textureKey.substring(0, colon);
        String rest = textureKey.substring(colon + 1 + TRIM_SPRITES.length());
        // "coast_leggings_iron_darker": the first split with an existing pattern-texture and palette
        for (int i = rest.indexOf('_'); i > 0; i = rest.indexOf('_', i + 1)) {
            BufferedImage pattern = resources.texture(namespace + ":" + TRIM_SPRITES + rest.substring(0, i));
            if (pattern == null) continue;
            BufferedImage palette = resources.texture(namespace + ":" + TRIM_PALETTES + rest.substring(i + 1));
            if (palette == null) palette = resources.texture("minecraft:" + TRIM_PALETTES + rest.substring(i + 1));
            BufferedImage key = resources.texture(TRIM_PALETTE_KEY);
            if (palette == null || key == null) continue;
            return applyPalette(pattern, key, palette);
        }
        return null;
    }

    /**
     * vanilla PalettedPermutationsAtlasSource.toMapper and its pixel-function: the colors of the palette-key (with alpha)
     * map to the colors of the palette; pixels with alpha 0 stay, others get the mapped color (unknown: opaque own
     * color) with alpha * mapped alpha / 255.
     */
    static BufferedImage applyPalette(BufferedImage texture, BufferedImage key, BufferedImage palette) {
        int[] keys = key.getRGB(0, 0, key.getWidth(), key.getHeight(), null, 0, key.getWidth());
        int[] values = palette.getRGB(0, 0, palette.getWidth(), palette.getHeight(), null, 0, palette.getWidth());
        if (keys.length != values.length) throw new IllegalArgumentException("palette mapping has different sizes");
        Map<Integer, Integer> mapping = new HashMap<>();
        for (int i = 0; i < keys.length; i++) {
            if ((keys[i] >>> 24) != 0) mapping.put(keys[i] & 0xFFFFFF, values[i]);
        }
        BufferedImage result = new BufferedImage(texture.getWidth(), texture.getHeight(), BufferedImage.TYPE_INT_ARGB);
        for (int y = 0; y < texture.getHeight(); y++) {
            for (int x = 0; x < texture.getWidth(); x++) {
                int color = texture.getRGB(x, y);
                int alpha = color >>> 24;
                if (alpha == 0) {
                    result.setRGB(x, y, color);
                    continue;
                }
                int rgb = color & 0xFFFFFF;
                int mapped = mapping.getOrDefault(rgb, 0xFF000000 | rgb);
                result.setRGB(x, y, ((alpha * (mapped >>> 24) / 255) << 24) | (mapped & 0xFFFFFF));
            }
        }
        return result;
    }

    /** protection against huge folders (a resource-pack with very many villager-textures) */
    static final int MAX_MOB_TEXTURES = 128;

    /**
     * Bakes the asset of a mob whose (vanilla) model the webapp has: only its textures from the resource-pack,
     * by their key (the webapp chooses the variant). Textures that do not exist are left out.
     */
    String bakeMob(String entityType) throws IOException {
        Map<String, String> dataUrls = new java.util.TreeMap<>();
        Textures textures = new Textures();
        for (String entry : MobTextures.TEXTURES.getOrDefault(entityType, List.of())) {
            List<String> keys = entry.endsWith("/") || entry.endsWith("_") ? resources.textureKeys(entry) : List.of(entry);
            for (String key : keys) {
                if (dataUrls.size() >= MAX_MOB_TEXTURES) break;
                int index = textures.add(key, resources);
                if (index >= 0) dataUrls.put(key, textures.dataUrls.get(index));
            }
        }

        StringWriter out = new StringWriter();
        try (JsonWriter json = new JsonWriter(out)) {
            json.beginObject();
            json.name("format").value(FORMAT_VERSION);
            json.name("entity").value(entityType);
            json.name("textures").beginObject();
            for (Map.Entry<String, String> texture : dataUrls.entrySet()) json.name(texture.getKey()).value(texture.getValue());
            json.endObject();
            json.endObject();
        }
        return out.toString();
    }

    /**
     * Bakes the asset of an entity whose model the webapp builds itself (e.g. the arrow, vanilla ArrowEntityRenderer):
     * only the texture from the resource-pack and the model-type. Same format as the item-assets.
     * @return the json-asset (no models if the entity or its texture is unknown)
     */
    public String bakeEntity(String entityType) throws IOException {
        Key.parse(entityType);
        if (MobTextures.TEXTURES.containsKey(entityType)) return bakeMob(entityType);
        Textures textures = new Textures();
        List<BakedModel> models = new ArrayList<>();
        String[] model = ENTITY_MODELS.get(entityType);
        if (model != null) {
            int texture = textures.add(model[1], resources);
            if (texture >= 0) {
                BakedModel baked = new BakedModel();
                baked.type = model[0];
                baked.texture = texture;
                models.add(baked);
            }
        }
        return write(entityType, textures, models);
    }

    // ---- model resolution ----

    /** a model with its parent-chain merged */
    static final class ResolvedModel {
        String key;
        String terminal; // GENERATED, ENTITY or null for element-models
        final JsonObject textures = new JsonObject();
        @Nullable JsonArray elements;
        final Map<String, JsonObject> display = new HashMap<>();
        @Nullable JsonArray overrides;
    }

    @Nullable ResolvedModel resolve(String key) {
        List<JsonObject> chain = new ArrayList<>();
        String terminal = null;
        String current = key;
        for (int i = 0; current != null && i < MAX_PARENTS; i++) {
            if (current.equals(GENERATED) || current.equals(ENTITY)) {
                terminal = current;
                break;
            }
            String json = resources.modelJson(current);
            if (json == null) {
                if (i == 0) return null;
                break;
            }
            JsonObject model;
            try {
                model = JsonParser.parseString(json).getAsJsonObject();
            } catch (RuntimeException ex) {
                if (i == 0) return null;
                break;
            }
            chain.add(model);
            current = model.get("parent") instanceof JsonElement parent && parent.isJsonPrimitive() ?
                    Key.normalize(parent.getAsString()) : null;
        }

        ResolvedModel resolved = new ResolvedModel();
        resolved.key = key;
        resolved.terminal = terminal;
        if (!chain.isEmpty() && chain.get(0).get("overrides") instanceof JsonArray overrides) resolved.overrides = overrides;

        // from the root-parent to the model itself, so children override their parents
        for (int i = chain.size() - 1; i >= 0; i--) {
            JsonObject model = chain.get(i);
            if (model.get("textures") instanceof JsonObject textures) {
                textures.entrySet().forEach(e -> resolved.textures.add(e.getKey(), e.getValue()));
            }
            if (model.get("elements") instanceof JsonArray elements) resolved.elements = elements;
            if (model.get("display") instanceof JsonObject display) {
                for (String mode : DISPLAY_MODES) {
                    if (display.get(mode) instanceof JsonObject transform) resolved.display.put(mode, transform);
                }
            }
        }

        // a model with own elements is no generated / entity model anymore
        for (JsonObject model : chain) {
            if (model.has("elements")) {
                resolved.terminal = null;
                break;
            }
        }
        return resolved;
    }

    // ---- baking ----

    static final class BakedModel {
        String type; // "quads" or "shield"
        final List<float[]> quads = new ArrayList<>();
        int texture = -1; // shield-texture
        final Map<String, JsonObject> display = new HashMap<>();
        @Nullable JsonObject predicate;
    }

    private @Nullable BakedModel bakeModel(ResolvedModel model, Key itemId, Textures textures, @Nullable JsonObject predicate) {
        BakedModel baked = new BakedModel();
        baked.predicate = predicate;

        JsonArray elements = model.elements;
        if (ENTITY.equals(model.terminal)) {
            if (itemId.namespace.equals("minecraft") && (itemId.path.equals("shield"))) {
                // the shield is an entity-model in vanilla (ShieldEntityModel), the webapp builds its geometry
                int texture = textures.add(SHIELD_TEXTURE, resources);
                if (texture < 0) return null;
                baked.type = "shield";
                baked.texture = texture;
                copyDisplay(model, baked);
                return baked;
            }

            // other entity-rendered items (trident, chest, banner, heads, ...): approximated with the flat item-texture
            String flat = itemId.namespace + ":item/" + itemId.path;
            if (resources.texture(flat) == null) return null;
            ResolvedModel generated = resolve(Key.normalize("minecraft:item/generated"));
            JsonObject layers = new JsonObject();
            layers.addProperty("layer0", flat);
            elements = generateElements(layers, textures);
            if (generated != null) generated.display.forEach(baked.display::put);
            fillDisplay(baked);
            model = new ResolvedModel();
            model.textures.addProperty("layer0", flat);
        } else if (GENERATED.equals(model.terminal)) {
            elements = generateElements(model.textures, textures);
            copyDisplay(model, baked);
        } else {
            copyDisplay(model, baked);
        }

        if (elements == null || elements.isEmpty()) return null;

        // let BlueMaps model-classes parse the elements (default-uvs, element-rotation, texture-references)
        JsonObject modelJson = new JsonObject();
        modelJson.add("textures", model.textures);
        modelJson.add("elements", elements);
        Model parsed;
        try {
            parsed = ResourcesGson.INSTANCE.fromJson(modelJson, Model.class);
        } catch (RuntimeException ex) {
            return null;
        }
        if (parsed == null || parsed.getElements() == null) return null;

        baked.type = "quads";
        for (Element element : parsed.getElements()) {
            if (element == null) continue;
            bakeElement(element, parsed, textures, baked.quads);
            if (baked.quads.size() > MAX_QUADS) break;
        }
        if (baked.quads.isEmpty()) return null;
        return baked;
    }

    private static void copyDisplay(ResolvedModel model, BakedModel baked) {
        baked.display.putAll(model.display);
        fillDisplay(baked);
    }

    /** vanilla: the left-hand transformation defaults to the right-hand one */
    private static void fillDisplay(BakedModel baked) {
        if (!baked.display.containsKey("thirdperson_lefthand") && baked.display.containsKey("thirdperson_righthand")) {
            baked.display.put("thirdperson_lefthand", baked.display.get("thirdperson_righthand"));
        }
    }

    private static final Direction[] FACE_ORDER = {
            Direction.DOWN, Direction.UP, Direction.NORTH, Direction.SOUTH, Direction.WEST, Direction.EAST
    };

    private final VectorM3f[] corners = new VectorM3f[] {
            new VectorM3f(0, 0, 0), new VectorM3f(0, 0, 0), new VectorM3f(0, 0, 0), new VectorM3f(0, 0, 0),
            new VectorM3f(0, 0, 0), new VectorM3f(0, 0, 0), new VectorM3f(0, 0, 0), new VectorM3f(0, 0, 0)
    };
    private final VectorM3f vertex = new VectorM3f(0, 0, 0);

    /** creates the faces like BlueMaps ResourceModelRenderer (same corner-order, uv-mapping and face-rotation) */
    private void bakeElement(Element element, Model model, Textures textures, List<float[]> quads) {
        bakeElement(element, model, textures, quads, null);
    }

    /**
     * @param variant BlueMap Live (block-previews): the transformation of the blockstate-variant (in blocks), null for
     *                items; with a variant the quads get a 23rd value: the (turned) cullface, see {@link #CULLFACE_CODES}
     */
    private void bakeElement(Element element, Model model, Textures textures, List<float[]> quads, @Nullable MatrixM4f variant) {
        Vector3f from = element.getFrom(), to = element.getTo();
        float minX = from.getX(), minY = from.getY(), minZ = from.getZ();
        float maxX = to.getX(), maxY = to.getY(), maxZ = to.getZ();

        VectorM3f[] c = corners;
        c[0].set(minX, minY, minZ);
        c[1].set(minX, minY, maxZ);
        c[2].set(maxX, minY, minZ);
        c[3].set(maxX, minY, maxZ);
        c[4].set(minX, maxY, minZ);
        c[5].set(minX, maxY, maxZ);
        c[6].set(maxX, maxY, minZ);
        c[7].set(maxX, maxY, maxZ);

        MatrixM4f rotation = element.getRotation().getMatrix();

        for (Direction direction : FACE_ORDER) {
            Face face = element.getFaces().get(direction);
            if (face == null) continue;

            VectorM3f[] q = switch (direction) {
                case DOWN -> new VectorM3f[] {c[0], c[2], c[3], c[1]};
                case UP -> new VectorM3f[] {c[5], c[7], c[6], c[4]};
                case NORTH -> new VectorM3f[] {c[2], c[0], c[4], c[6]};
                case SOUTH -> new VectorM3f[] {c[1], c[3], c[7], c[5]};
                case WEST -> new VectorM3f[] {c[0], c[1], c[5], c[4]};
                case EAST -> new VectorM3f[] {c[3], c[2], c[6], c[7]};
            };

            ResourcePath<Texture> texturePath = face.getTexture().getTexturePath(model.getTextures()::get);
            if (texturePath == null) continue;
            int texture = textures.add(texturePath.getFormatted(), resources);
            if (texture < 0) continue;

            Vector4f uv = face.getUv();
            float u1 = uv.getX() / 16f, v1 = uv.getY() / 16f, u2 = uv.getZ() / 16f, v2 = uv.getW() / 16f;
            float[][] rawUvs = {{u1, v2}, {u2, v2}, {u2, v1}, {u1, v1}};
            int steps = Math.floorMod(Math.floorDiv(face.getRotation(), 90), 4);

            float[] quad = new float[variant != null ? 23 : 22];
            for (int i = 0; i < 4; i++) {
                vertex.set(q[i].x, q[i].y, q[i].z);
                vertex.transform(rotation);
                vertex.set(vertex.x / 16f, vertex.y / 16f, vertex.z / 16f);
                if (variant != null) vertex.transform(variant);
                quad[i * 3] = round(vertex.x);
                quad[i * 3 + 1] = round(vertex.y);
                quad[i * 3 + 2] = round(vertex.z);

                float[] faceUv = rawUvs[(steps + i) % 4];
                quad[12 + i * 2] = round(faceUv[0]);
                quad[12 + i * 2 + 1] = round(faceUv[1]);
            }
            quad[20] = texture;
            quad[21] = face.getTintindex();
            if (variant != null) quad[22] = cullfaceCode(face.getCullface(), variant);
            quads.add(quad);
        }
    }

    /**
     * Like vanilla's ItemModelGenerator: every layer becomes a 1px thick plate (front and back face with the whole
     * texture) and side-faces along the borders of the opaque pixels (merged into runs).
     */
    @Nullable JsonArray generateElements(JsonObject modelTextures, Textures textures) {
        JsonArray elements = new JsonArray();
        for (int layer = 0; layer < 5; layer++) {
            String name = "layer" + layer;
            if (!(modelTextures.get(name) instanceof JsonElement ref) || !ref.isJsonPrimitive()) break;
            String textureKey = resolveTextureReference(modelTextures, ref.getAsString());
            if (textureKey == null) break;
            BufferedImage image = resources.texture(textureKey);
            if (image == null) continue;
            String texture = "#" + name;

            // front and back
            JsonObject plate = element(0, 0, 7.5f, 16, 16, 8.5f);
            JsonObject faces = new JsonObject();
            faces.add("south", face(texture, 0, 0, 16, 16, layer));
            faces.add("north", face(texture, 16, 0, 0, 16, layer));
            plate.add("faces", faces);
            elements.add(plate);

            addEdges(image, texture, layer, elements);
        }
        return elements.isEmpty() ? null : elements;
    }

    /** resolves #references within the texture-map (max. a few steps) to a texture-key */
    private static @Nullable String resolveTextureReference(JsonObject textures, String value) {
        for (int i = 0; i < 8 && value.startsWith("#"); i++) {
            if (!(textures.get(value.substring(1)) instanceof JsonElement next) || !next.isJsonPrimitive()) return null;
            value = next.getAsString();
        }
        if (value.startsWith("#")) return null;
        return Key.normalize(value);
    }

    private static void addEdges(BufferedImage image, String texture, int tint, JsonArray elements) {
        int w = image.getWidth(), h = image.getHeight();
        float sx = 16f / w, sy = 16f / h;

        // horizontal runs (up / down faces) per row
        for (int y = 0; y < h; y++) {
            for (int dir = 0; dir < 2; dir++) {
                int ny = dir == 0 ? y - 1 : y + 1;
                int start = -1;
                for (int x = 0; x <= w; x++) {
                    boolean edge = x < w && opaque(image, x, y) && !opaque(image, x, ny);
                    if (edge && start < 0) start = x;
                    if (!edge && start >= 0) {
                        float x0 = start * sx, x1 = x * sx;
                        float yPos = dir == 0 ? 16 - y * sy : 16 - (y + 1) * sy;
                        JsonObject element = element(x0, yPos, 7.5f, x1, yPos, 8.5f);
                        JsonObject faces = new JsonObject();
                        faces.add(dir == 0 ? "up" : "down", face(texture, x0, y * sy, x1, (y + 1) * sy, tint));
                        element.add("faces", faces);
                        elements.add(element);
                        start = -1;
                    }
                }
            }
        }

        // vertical runs (west / east faces) per column
        for (int x = 0; x < w; x++) {
            for (int dir = 0; dir < 2; dir++) {
                int nx = dir == 0 ? x - 1 : x + 1;
                int start = -1;
                for (int y = 0; y <= h; y++) {
                    boolean edge = y < h && opaque(image, x, y) && !opaque(image, nx, y);
                    if (edge && start < 0) start = y;
                    if (!edge && start >= 0) {
                        float xPos = dir == 0 ? x * sx : (x + 1) * sx;
                        float y0 = 16 - y * sy, y1 = 16 - start * sy;
                        JsonObject element = element(xPos, y0, 7.5f, xPos, y1, 8.5f);
                        JsonObject faces = new JsonObject();
                        faces.add(dir == 0 ? "west" : "east", face(texture, x * sx, start * sy, (x + 1) * sx, y * sy, tint));
                        element.add("faces", faces);
                        elements.add(element);
                        start = -1;
                    }
                }
            }
        }
    }

    private static boolean opaque(BufferedImage image, int x, int y) {
        if (x < 0 || y < 0 || x >= image.getWidth() || y >= image.getHeight()) return false;
        return (image.getRGB(x, y) >>> 24) != 0;
    }

    private static JsonObject element(float x0, float y0, float z0, float x1, float y1, float z1) {
        JsonObject element = new JsonObject();
        element.add("from", array(x0, y0, z0));
        element.add("to", array(x1, y1, z1));
        return element;
    }

    private static JsonObject face(String texture, float u0, float v0, float u1, float v1, int tint) {
        JsonObject face = new JsonObject();
        face.add("uv", array(u0, v0, u1, v1));
        face.addProperty("texture", texture);
        face.addProperty("tintindex", tint);
        return face;
    }

    private static JsonArray array(float... values) {
        JsonArray array = new JsonArray();
        for (float value : values) array.add(value);
        return array;
    }

    private static float round(float value) {
        return Math.round(value * 10000f) / 10000f;
    }

    // ---- blocks (BlueMap Live: previews of changed blocks, see docs/bluemap-live/phase-11.md) ----

    /** 0: no cullface, 1..6: down, up, north, south, west, east */
    static final Direction[] CULLFACE_CODES = {null, Direction.DOWN, Direction.UP, Direction.NORTH, Direction.SOUTH,
            Direction.WEST, Direction.EAST};

    private final VectorM3f cullfaceVector = new VectorM3f(0, 0, 0);

    /** the cullface turned like the variant (vanilla turns the cullface with the model) */
    private int cullfaceCode(@Nullable Direction cullface, MatrixM4f variant) {
        if (cullface == null) return 0;
        var v = cullface.toVector();
        cullfaceVector.set(v.getX(), v.getY(), v.getZ());
        cullfaceVector.rotateAndScale(variant);
        int best = 0;
        float bestDot = 0.5f;
        for (int i = 1; i < CULLFACE_CODES.length; i++) {
            var d = CULLFACE_CODES[i].toVector();
            float dot = cullfaceVector.x * d.getX() + cullfaceVector.y * d.getY() + cullfaceVector.z * d.getZ();
            if (dot > bestDot) {
                bestDot = dot;
                best = i;
            }
        }
        return best;
    }

    /**
     * The block-asset of a block-state: all quads of the models of its blockstate-variants (like BlueMaps renderer:
     * variants by the conditions, the weighted variant of the block at 0, 0, 0, uv-lock is not applied), in blocks,
     * with the cullface of each quad, and if the block is a full opaque cube (it hides the faces of its neighbors).
     * @param state e.g. <code>minecraft:oak_stairs[facing=east,half=bottom,shape=straight,waterlogged=false]</code>
     */
    public String bakeBlock(String state) throws IOException {
        de.bluecolored.bluemap.core.world.BlockState blockState = de.bluecolored.bluemap.core.world.BlockState.fromString(state);
        Textures textures = new Textures();
        List<float[]> quads = new ArrayList<>();

        String json = resources.blockStateJson(blockState.getId().getFormatted());
        if (json != null && !blockState.isAir()) {
            de.bluecolored.bluemap.core.resources.pack.resourcepack.blockstate.BlockState definition = null;
            try {
                definition = ResourcesGson.INSTANCE.fromJson(json,
                        de.bluecolored.bluemap.core.resources.pack.resourcepack.blockstate.BlockState.class);
            } catch (RuntimeException ignored) {}
            if (definition != null) {
                List<de.bluecolored.bluemap.core.resources.pack.resourcepack.blockstate.Variant> variants = new ArrayList<>();
                definition.forEach(blockState, 0, 0, 0, variants::add);
                for (var variant : variants) {
                    ResolvedModel resolved = resolve(variant.getModel().getFormatted());
                    if (resolved == null || resolved.elements == null || resolved.elements.isEmpty()) continue;
                    JsonObject modelJson = new JsonObject();
                    modelJson.add("textures", resolved.textures);
                    modelJson.add("elements", resolved.elements);
                    Model parsed;
                    try {
                        parsed = ResourcesGson.INSTANCE.fromJson(modelJson, Model.class);
                    } catch (RuntimeException ex) {
                        continue;
                    }
                    if (parsed == null || parsed.getElements() == null) continue;
                    for (Element element : parsed.getElements()) {
                        if (element == null) continue;
                        bakeElement(element, parsed, textures, quads, variant.getTransformMatrix());
                        if (quads.size() > MAX_QUADS) break;
                    }
                }
            }
        }

        StringWriter out = new StringWriter();
        try (JsonWriter writer = new JsonWriter(out)) {
            writer.beginObject();
            writer.name("format").value(FORMAT_VERSION);
            writer.name("state").value(state);
            writer.name("full").value(isFullCube(quads, textures));
            writer.name("textures").beginArray();
            for (String dataUrl : textures.dataUrls) writer.value(dataUrl);
            writer.endArray();
            writer.name("quads").beginArray();
            for (float[] quad : quads) {
                for (float value : quad) {
                    if (value == Math.rint(value)) writer.value((long) value);
                    else writer.value(value);
                }
            }
            writer.endArray();
            writer.endObject();
        }
        return out.toString();
    }

    /** a full cube: on all 6 sides a whole face with that cullface and an opaque texture */
    private boolean isFullCube(List<float[]> quads, Textures textures) {
        boolean[] sides = new boolean[7];
        for (float[] quad : quads) {
            int cullface = (int) quad[22];
            if (cullface == 0 || !textures.opaque.getOrDefault((int) quad[20], false)) continue;
            float minX = 1, minY = 1, minZ = 1, maxX = 0, maxY = 0, maxZ = 0;
            for (int i = 0; i < 4; i++) {
                minX = Math.min(minX, quad[i * 3]); maxX = Math.max(maxX, quad[i * 3]);
                minY = Math.min(minY, quad[i * 3 + 1]); maxY = Math.max(maxY, quad[i * 3 + 1]);
                minZ = Math.min(minZ, quad[i * 3 + 2]); maxZ = Math.max(maxZ, quad[i * 3 + 2]);
            }
            // two of the three axes span the whole block
            int spans = (minX <= 0 && maxX >= 1 ? 1 : 0) + (minY <= 0 && maxY >= 1 ? 1 : 0) + (minZ <= 0 && maxZ >= 1 ? 1 : 0);
            if (spans >= 2) sides[cullface] = true;
        }
        for (int i = 1; i < 7; i++) if (!sides[i]) return false;
        return true;
    }

    // ---- textures ----

    /** the textures of one asset, each one only once */
    static final class Textures {
        final Map<String, Integer> indices = new HashMap<>();
        final List<String> dataUrls = new ArrayList<>();
        /** per texture-index: if all pixels are opaque */
        final Map<Integer, Boolean> opaque = new HashMap<>();

        /** @return the index of the texture, -1 if it does not exist */
        int add(String key, Resources resources) {
            Integer index = indices.get(key);
            if (index != null) return index;

            BufferedImage image = resources.texture(key);
            int result = -1;
            if (image != null && image.getWidth() <= MAX_TEXTURE_SIZE && image.getHeight() <= MAX_TEXTURE_SIZE) {
                try {
                    ByteArrayOutputStream out = new ByteArrayOutputStream();
                    ImageIO.write(image, "png", out);
                    dataUrls.add("data:image/png;base64," + Base64.getEncoder().encodeToString(out.toByteArray()));
                    result = dataUrls.size() - 1;
                    opaque.put(result, isOpaque(image));
                } catch (IOException ignored) {}
            }
            indices.put(key, result);
            return result;
        }
    }

    private static boolean isOpaque(BufferedImage image) {
        for (int x = 0; x < image.getWidth(); x++) {
            for (int y = 0; y < image.getHeight(); y++) {
                if ((image.getRGB(x, y) >>> 24) < 255) return false;
            }
        }
        return true;
    }

    // ---- output ----

    private static String write(String itemId, Textures textures, List<BakedModel> models) throws IOException {
        StringWriter out = new StringWriter();
        try (JsonWriter json = new JsonWriter(out)) {
            json.beginObject();
            json.name("format").value(FORMAT_VERSION);
            json.name("item").value(itemId);

            json.name("textures").beginArray();
            for (String dataUrl : textures.dataUrls) json.value(dataUrl);
            json.endArray();

            json.name("models").beginArray();
            for (BakedModel model : models) {
                json.beginObject();
                json.name("type").value(model.type);
                if (model.predicate != null) {
                    json.name("predicate").beginObject();
                    for (var entry : model.predicate.entrySet()) {
                        if (entry.getValue().isJsonPrimitive() && entry.getValue().getAsJsonPrimitive().isNumber()) {
                            json.name(entry.getKey()).value(entry.getValue().getAsDouble());
                        }
                    }
                    json.endObject();
                }
                if (model.texture >= 0) json.name("texture").value(model.texture);
                if (!model.quads.isEmpty()) {
                    json.name("quads").beginArray();
                    for (float[] quad : model.quads) {
                        for (float value : quad) {
                            if (value == Math.rint(value)) json.value((long) value);
                            else json.value(value);
                        }
                    }
                    json.endArray();
                }
                json.name("display").beginObject();
                for (String mode : DISPLAY_MODES) {
                    JsonObject transform = model.display.get(mode);
                    if (transform == null) continue;
                    json.name(DISPLAY_NAMES.get(mode)).beginObject();
                    writeVector(json, "rotation", transform, 0);
                    writeVector(json, "translation", transform, 0);
                    writeVector(json, "scale", transform, 1);
                    json.endObject();
                }
                json.endObject();
                json.endObject();
            }
            json.endArray();

            json.endObject();
        }
        return out.toString();
    }

    private static void writeVector(JsonWriter json, String name, JsonObject transform, double fallback) throws IOException {
        json.name(name).beginArray();
        JsonArray array = transform.get(name) instanceof JsonArray a ? a : null;
        for (int i = 0; i < 3; i++) {
            double value = fallback;
            if (array != null && i < array.size() && array.get(i).isJsonPrimitive() && array.get(i).getAsJsonPrimitive().isNumber()) {
                value = array.get(i).getAsDouble();
            }
            json.value(Double.isFinite(value) ? value : fallback);
        }
        json.endArray();
    }

    // ---- keys ----

    record Key(String namespace, String path) {

        private static final java.util.regex.Pattern NAMESPACE = java.util.regex.Pattern.compile("[a-z0-9_.-]+");
        private static final java.util.regex.Pattern PATH = java.util.regex.Pattern.compile("[a-z0-9_.-]+(/[a-z0-9_.-]+)*");

        /** parses and validates an item-id (also prevents path-traversal, the id is used in a storage-path) */
        static Key parse(String id) {
            int i = id.indexOf(':');
            String namespace = i < 0 ? "minecraft" : id.substring(0, i);
            String path = i < 0 ? id : id.substring(i + 1);
            if (!NAMESPACE.matcher(namespace).matches() || !PATH.matcher(path).matches() || path.contains(".."))
                throw new IllegalArgumentException("Invalid item-id: " + id);
            return new Key(namespace, path);
        }

        static boolean isValid(String id) {
            try {
                parse(id);
                return true;
            } catch (IllegalArgumentException ex) {
                return false;
            }
        }

        /** "item/bow" -> "minecraft:item/bow" */
        static String normalize(String key) {
            return key.indexOf(':') < 0 ? "minecraft:" + key : key;
        }

    }

}
