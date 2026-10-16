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
package de.bluecolored.bluemap.fabric;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.lang.reflect.Field;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.*;

import static org.junit.jupiter.api.Assertions.fail;

/**
 * Verifies the mob-models of the webapp (common/webapp/src/js/markers/mob/vanilla-mob-models.json) against the
 * model-definitions of Minecraft itself: the static model-methods of the vanilla model-classes (client-classes of the
 * merged jar) that <code>EntityModels.getModels()</code> uses for these layers. <code>EntityModels.getModels()</code> itself
 * needs the registries (the bootstrap), which do not work in a plain test-jvm with the dev-mappings.
 * <p>Every difference is reported (also as GitHub-annotations in <code>build/vanilla-model-check.txt</code>, printed by
 * the CI), together with the definition of the game in the format of the json, so a wrong value is never guessed.</p>
 * <p>The model-classes are called and read with reflection (yarn-names), only the data of the layers is used, nothing
 * is rendered.</p>
 */
public class VanillaMobModelsTest {

    private static final float EPSILON = 1e-4f;

    @Test
    public void webappModelsMatchVanilla() throws Exception {
        Path jsonFile = Path.of(System.getProperty("bluemap.mobModels",
                "../../common/webapp/src/js/markers/mob/vanilla-mob-models.json"));
        JsonObject expectedModels = JsonParser.parseString(Files.readString(jsonFile, StandardCharsets.UTF_8))
                .getAsJsonObject().getAsJsonObject("models");

        Map<String, Object> layers = new HashMap<>();
        List<String> report = new ArrayList<>();
        for (Map.Entry<String, ModelSource> source : LAYERS.entrySet()) {
            try {
                layers.put(source.getKey(), source.getValue().create());
            } catch (Throwable t) {
                report.add("::" + source.getKey() + ": " + describe(t));
            }
        }

        List<String> differences = new ArrayList<>();
        for (Map.Entry<String, JsonElement> entry : expectedModels.entrySet()) {
            String layer = entry.getKey();
            Object texturedModelData = layers.get(layer);
            if (texturedModelData == null) {
                differences.add(layer + ": not created (see the report)");
                continue;
            }
            JsonObject actual;
            try {
                actual = toJson(texturedModelData);
            } catch (Throwable t) {
                differences.add(layer + ": not readable");
                report.add("::" + layer + ": not readable (" + texturedModelData.getClass().getSimpleName() + "): " + describe(t));
                continue;
            }
            List<String> layerDifferences = new ArrayList<>();
            compare(layer, entry.getValue(), actual, layerDifferences);
            if (!layerDifferences.isEmpty()) {
                differences.addAll(layerDifferences);
                report.add("::" + String.join("; ", layerDifferences) + " -- vanilla: " + actual);
            }
        }
        // layers the webapp does not use (yet): their vanilla definition is reported (no failure)
        for (Map.Entry<String, Object> layer : new TreeMap<>(layers).entrySet()) {
            if (!expectedModels.has(layer.getKey())) {
                try {
                    report.add("::" + layer.getKey() + ": not in the webapp -- vanilla: " + toJson(layer.getValue()));
                } catch (Throwable t) {
                    report.add("::" + layer.getKey() + ": not readable (" + layer.getValue().getClass().getSimpleName() + "): " + describe(t));
                }
            }
        }

        // the wool-colors of the sheep: vanilla SheepEntity.getRgbColor(DyeColor) (found by its signature);
        // if the entity-class can not be loaded without the registries, the dye-colors are checked with the formula
        JsonObject expectedColors = JsonParser.parseString(Files.readString(jsonFile, StandardCharsets.UTF_8))
                .getAsJsonObject().getAsJsonObject("sheepWoolColors");
        JsonObject actualColors = new JsonObject();
        String colorSource;
        try {
        Class<?> dyeColor = Class.forName("net.minecraft.util.DyeColor");
        try {
            java.lang.reflect.Method woolColor = null;
            for (java.lang.reflect.Method method : Class.forName("net.minecraft.entity.passive.SheepEntity").getDeclaredMethods()) {
                if (java.lang.reflect.Modifier.isStatic(method.getModifiers()) && method.getReturnType() == int.class &&
                        method.getParameterCount() == 1 && method.getParameterTypes()[0] == dyeColor &&
                        java.lang.reflect.Modifier.isPublic(method.getModifiers())) woolColor = method;
            }
            if (woolColor == null) throw new NoSuchMethodException("SheepEntity.getRgbColor(DyeColor)");
            for (Object dye : dyeColor.getEnumConstants()) {
                actualColors.addProperty(((Enum<?>) dye).name().toLowerCase(Locale.ROOT),
                        String.format("#%06x", ((int) woolColor.invoke(null, dye)) & 0xFFFFFF));
            }
            colorSource = "SheepEntity.getRgbColor";
        } catch (Throwable t) {
            // vanilla SheepEntity.getDyedColor: white is 0xE6E6E6, the other entity-colors * 0.75
            java.lang.reflect.Method entityColor = dyeColor.getMethod("getEntityColor");
            for (Object dye : dyeColor.getEnumConstants()) {
                int color = (int) entityColor.invoke(dye);
                int wool = ((Enum<?>) dye).name().equals("WHITE") ? 0xE6E6E6 :
                        ((int) Math.floor(((color >> 16) & 0xFF) * 0.75f) << 16) |
                        ((int) Math.floor(((color >> 8) & 0xFF) * 0.75f) << 8) |
                        (int) Math.floor((color & 0xFF) * 0.75f);
                actualColors.addProperty(((Enum<?>) dye).name().toLowerCase(Locale.ROOT), String.format("#%06x", wool));
            }
            colorSource = "DyeColor.getEntityColor (SheepEntity not loadable: " + describe(t) + ")";
        }
        } catch (Throwable t) {
            colorSource = "unavailable: " + describe(t);
        }
        if (!actualColors.equals(expectedColors)) {
            differences.add("sheepWoolColors differ (" + colorSource + ")");
            report.add("::sheepWoolColors differ (" + colorSource + ") -- vanilla: " + actualColors);
        }
        // the dye-colors (tropical fish, collars, llama-carpets): vanilla DyeColor.getEntityColor
        JsonObject expectedDyeColors = JsonParser.parseString(Files.readString(jsonFile, StandardCharsets.UTF_8))
                .getAsJsonObject().getAsJsonObject("dyeColors");
        JsonObject actualDyeColors = new JsonObject();
        try {
            Class<?> dyeColor = Class.forName("net.minecraft.util.DyeColor");
            java.lang.reflect.Method entityColor = dyeColor.getMethod("getEntityColor");
            for (Object dye : dyeColor.getEnumConstants()) {
                actualDyeColors.addProperty(((Enum<?>) dye).name().toLowerCase(Locale.ROOT),
                        String.format("#%06x", ((int) entityColor.invoke(dye)) & 0xFFFFFF));
            }
        } catch (Throwable t) {
            actualDyeColors.addProperty("unavailable", describe(t));
        }
        if (!actualDyeColors.equals(expectedDyeColors)) {
            differences.add("dyeColors differ");
            report.add("::dyeColors differ -- vanilla: " + actualDyeColors);
        }
        System.out.println("vanilla-model-check: " + layers.size() + " layers, colors from " + colorSource);

        writeReport(report);
        if (!differences.isEmpty()) fail("The webapp mob-models differ from vanilla:\n" + String.join("\n", differences));
    }

    /**
     * GitHub-annotations (error, warning, notice: at most 10 of each type are shown per step), several reports are
     * joined into one annotation (separated by " ##### ") so all differences fit
     */
    private static void writeReport(List<String> report) throws IOException {
        String[] types = {"error", "warning", "notice"};
        List<String> joined = new ArrayList<>();
        StringBuilder current = new StringBuilder();
        for (String line : report) {
            String text = line.startsWith("error::") ? line.substring(7) : line.substring(2);
            if (current.length() > 0 && current.length() + text.length() > 3500) {
                joined.add(current.toString());
                current.setLength(0);
            }
            if (current.length() > 0) current.append(" ##### ");
            current.append(text);
        }
        if (current.length() > 0) joined.add(current.toString());
        List<String> lines = new ArrayList<>();
        for (int i = 0; i < joined.size(); i++) {
            lines.add("::" + types[(i / 10) % 3] + " title=vanilla-model-check::" +
                    joined.get(i).replace("%", "%25").replace("\r", "").replace("\n", " "));
        }
        Path out = Path.of(System.getProperty("bluemap.modelCheckReport", "build/vanilla-model-check.txt"));
        Files.createDirectories(out.getParent());
        Files.write(out, lines, StandardCharsets.UTF_8);
    }

    // ---- the model-layers: the vanilla methods that EntityModels.getModels() (1.21) uses for them ----

    /** creates the TexturedModelData of a layer with the vanilla model-classes (no registries needed) */
    private interface ModelSource {
        Object create() throws Exception;
    }

    private static final String MODEL = "net.minecraft.client.render.entity.model.";

    private static final Map<String, ModelSource> LAYERS = new LinkedHashMap<>();
    static {
        ModelSource zombie = () -> of(call(MODEL + "BipedEntityModel", "getModelData", dilation(0), 0f), 64, 64);
        ModelSource skeleton = () -> call(MODEL + "SkeletonEntityModel", "getTexturedModelData");
        ModelSource cow = () -> call(MODEL + "CowEntityModel", "getTexturedModelData");
        ModelSource spider = () -> call(MODEL + "SpiderEntityModel", "getTexturedModelData");
        ModelSource piglin = () -> of(call(MODEL + "PiglinEntityModel", "getModelData", dilation(0)), 64, 64);
        LAYERS.put("minecraft:zombie#main", zombie);
        LAYERS.put("minecraft:husk#main", zombie);
        LAYERS.put("minecraft:drowned#main", () -> call(MODEL + "DrownedEntityModel", "getTexturedModelData", dilation(0)));
        LAYERS.put("minecraft:drowned#outer", () -> call(MODEL + "DrownedEntityModel", "getTexturedModelData", dilation(0.25f)));
        LAYERS.put("minecraft:skeleton#main", skeleton);
        LAYERS.put("minecraft:stray#main", skeleton);
        LAYERS.put("minecraft:stray#outer", () -> of(call(MODEL + "BipedEntityModel", "getModelData", dilation(0.25f), 0f), 64, 32));
        LAYERS.put("minecraft:wither_skeleton#main", skeleton);
        LAYERS.put("minecraft:creeper#main", () -> call(MODEL + "CreeperEntityModel", "getTexturedModelData", dilation(0)));
        LAYERS.put("minecraft:creeper#armor", () -> call(MODEL + "CreeperEntityModel", "getTexturedModelData", dilation(2f)));
        LAYERS.put("minecraft:pig#main", () -> call(MODEL + "PigEntityModel", "getTexturedModelData", dilation(0)));
        LAYERS.put("minecraft:pig#saddle", () -> call(MODEL + "PigEntityModel", "getTexturedModelData", dilation(0.5f)));
        LAYERS.put("minecraft:cow#main", cow);
        LAYERS.put("minecraft:mooshroom#main", cow);
        LAYERS.put("minecraft:sheep#main", () -> call(MODEL + "SheepEntityModel", "getTexturedModelData"));
        LAYERS.put("minecraft:sheep#fur", () -> call(MODEL + "SheepWoolEntityModel", "getTexturedModelData"));
        LAYERS.put("minecraft:chicken#main", () -> call(MODEL + "ChickenEntityModel", "getTexturedModelData"));
        LAYERS.put("minecraft:spider#main", spider);
        LAYERS.put("minecraft:cave_spider#main", spider);
        LAYERS.put("minecraft:enderman#main", () -> call(MODEL + "EndermanEntityModel", "getTexturedModelData"));
        LAYERS.put("minecraft:slime#main", () -> call(MODEL + "SlimeEntityModel", "getInnerTexturedModelData"));
        LAYERS.put("minecraft:slime#outer", () -> call(MODEL + "SlimeEntityModel", "getOuterTexturedModelData"));
        LAYERS.put("minecraft:villager#main", () -> of(call(MODEL + "VillagerResemblingModel", "getModelData"), 64, 64));
        LAYERS.put("minecraft:zombie_villager#main", () -> call(MODEL + "ZombieVillagerEntityModel", "getTexturedModelData"));
        LAYERS.put("minecraft:piglin#main", piglin);
        LAYERS.put("minecraft:zombified_piglin#main", piglin);
        LAYERS.put("minecraft:piglin_brute#main", piglin);
        // armor (ArmorEntityModel, ZombieVillagerEntityModel.getArmorTexturedModelData)
        LAYERS.put("minecraft:player#inner_armor", () -> of(call(MODEL + "ArmorEntityModel", "getModelData", dilation(0.5f)), 64, 32));
        LAYERS.put("minecraft:player#outer_armor", () -> of(call(MODEL + "ArmorEntityModel", "getModelData", dilation(1f)), 64, 32));
        LAYERS.put("minecraft:zombie_villager#inner_armor", () -> call(MODEL + "ZombieVillagerEntityModel", "getArmorTexturedModelData", dilation(0.5f)));
        LAYERS.put("minecraft:zombie_villager#outer_armor", () -> call(MODEL + "ZombieVillagerEntityModel", "getArmorTexturedModelData", dilation(1f)));
        LAYERS.put("minecraft:piglin#inner_armor", () -> of(call(MODEL + "ArmorEntityModel", "getModelData", dilation(0.5f)), 64, 32));
        LAYERS.put("minecraft:piglin#outer_armor", () -> of(call(MODEL + "ArmorEntityModel", "getModelData", dilation(1.02f)), 64, 32));
        // further mobs of 1.21 (EntityModels.getModels)
        simple("allay", "AllayEntityModel");
        simple("armadillo", "ArmadilloEntityModel");
        simple("axolotl", "AxolotlEntityModel");
        simple("bat", "BatEntityModel");
        simple("bee", "BeeEntityModel");
        simple("blaze", "BlazeEntityModel");
        simple("bogged", "BoggedEntityModel");
        LAYERS.put("minecraft:bogged#outer", () -> of(call(MODEL + "BipedEntityModel", "getModelData", dilation(0.2f), 0f), 64, 32));
        LAYERS.put("minecraft:breeze#main", () -> call(MODEL + "BreezeEntityModel", "getTexturedModelData", 32, 32));
        simple("camel", "CamelEntityModel");
        LAYERS.put("minecraft:cat#main", () -> of(call(MODEL + "OcelotEntityModel", "getModelData", dilation(0)), 64, 32));
        LAYERS.put("minecraft:ocelot#main", () -> of(call(MODEL + "OcelotEntityModel", "getModelData", dilation(0)), 64, 32));
        simple("cod", "CodEntityModel");
        simple("dolphin", "DolphinEntityModel");
        simple("donkey", "DonkeyEntityModel");
        simple("mule", "DonkeyEntityModel");
        simple("elder_guardian", "GuardianEntityModel");
        simple("guardian", "GuardianEntityModel");
        simple("endermite", "EndermiteEntityModel");
        simple("evoker", "IllagerEntityModel");
        simple("illusioner", "IllagerEntityModel");
        simple("pillager", "IllagerEntityModel");
        simple("vindicator", "IllagerEntityModel");
        simple("fox", "FoxEntityModel");
        simple("frog", "FrogEntityModel");
        simple("ghast", "GhastEntityModel");
        LAYERS.put("minecraft:giant#main", () -> of(call(MODEL + "BipedEntityModel", "getModelData", dilation(0), 0f), 64, 64));
        simple("glow_squid", "SquidEntityModel");
        simple("squid", "SquidEntityModel");
        simple("goat", "GoatEntityModel");
        simple("hoglin", "HoglinEntityModel");
        simple("zoglin", "HoglinEntityModel");
        LAYERS.put("minecraft:horse#main", () -> of(call(MODEL + "HorseEntityModel", "getModelData", dilation(0)), 64, 64));
        LAYERS.put("minecraft:skeleton_horse#main", () -> of(call(MODEL + "HorseEntityModel", "getModelData", dilation(0)), 64, 64));
        LAYERS.put("minecraft:zombie_horse#main", () -> of(call(MODEL + "HorseEntityModel", "getModelData", dilation(0)), 64, 64));
        simple("iron_golem", "IronGolemEntityModel");
        LAYERS.put("minecraft:llama#main", () -> call(MODEL + "LlamaEntityModel", "getTexturedModelData", dilation(0)));
        // the feature-layers of EntityModels.getModels (collar, carpet, horse-armor; the dilations are in the CI-dump)
        LAYERS.put("minecraft:cat#collar", () -> of(call(MODEL + "OcelotEntityModel", "getModelData", dilation(0.01f)), 64, 32));
        LAYERS.put("minecraft:llama#decor", () -> call(MODEL + "LlamaEntityModel", "getTexturedModelData", dilation(0.5f)));
        // the skulls of SkullBlockEntityRenderer.getModels (heads on the head, vanilla HeadFeatureRenderer)
        LAYERS.put("minecraft:skull#skull", () -> call(MODEL + "SkullEntityModel", "getSkullTexturedModelData"));
        LAYERS.put("minecraft:skull#head", () -> call(MODEL + "SkullEntityModel", "getHeadTexturedModelData"));
        LAYERS.put("minecraft:dragon_head#main", () -> call(MODEL + "DragonHeadEntityModel", "getTexturedModelData"));
        LAYERS.put("minecraft:piglin_head#main", () -> of(call(MODEL + "PiglinHeadEntityModel", "getModelData"), 64, 64));
        LAYERS.put("minecraft:horse#armor", () -> of(call(MODEL + "HorseEntityModel", "getModelData", dilation(0.1f)), 64, 64));
        LAYERS.put("minecraft:trader_llama#main", () -> call(MODEL + "LlamaEntityModel", "getTexturedModelData", dilation(0)));
        simple("magma_cube", "MagmaCubeEntityModel");
        simple("panda", "PandaEntityModel");
        simple("parrot", "ParrotEntityModel");
        simple("phantom", "PhantomEntityModel");
        simple("polar_bear", "PolarBearEntityModel");
        simple("pufferfish_big", "LargePufferfishEntityModel");
        simple("pufferfish_medium", "MediumPufferfishEntityModel");
        simple("pufferfish_small", "SmallPufferfishEntityModel");
        simple("rabbit", "RabbitEntityModel");
        simple("ravager", "RavagerEntityModel");
        simple("salmon", "SalmonEntityModel");
        simple("shulker", "ShulkerEntityModel");
        simple("silverfish", "SilverfishEntityModel");
        simple("sniffer", "SnifferEntityModel");
        simple("snow_golem", "SnowGolemEntityModel");
        simple("strider", "StriderEntityModel");
        simple("tadpole", "TadpoleEntityModel");
        LAYERS.put("minecraft:tropical_fish_large#main", () -> call(MODEL + "LargeTropicalFishEntityModel", "getTexturedModelData", dilation(0)));
        LAYERS.put("minecraft:tropical_fish_small#main", () -> call(MODEL + "SmallTropicalFishEntityModel", "getTexturedModelData", dilation(0)));
        simple("turtle", "TurtleEntityModel");
        simple("vex", "VexEntityModel");
        LAYERS.put("minecraft:wandering_trader#main", () -> of(call(MODEL + "VillagerResemblingModel", "getModelData"), 64, 64));
        simple("warden", "WardenEntityModel");
        simple("witch", "WitchEntityModel");
        LAYERS.put("minecraft:wither#main", () -> call(MODEL + "WitherEntityModel", "getTexturedModelData", dilation(0)));
        LAYERS.put("minecraft:wolf#main", () -> of(call(MODEL + "WolfEntityModel", "getTexturedModelData", dilation(0)), 64, 32));
    }

    private static void simple(String mob, String modelClass) {
        LAYERS.put("minecraft:" + mob + "#main", () -> call(MODEL + modelClass, "getTexturedModelData"));
    }

    /** calls a static method by its name and the number of arguments (primitive floats are matched) */
    private static Object call(String className, String method, Object... args) throws Exception {
        Class<?> type = Class.forName(className);
        List<String> candidates = new ArrayList<>();
        for (java.lang.reflect.Method m : type.getDeclaredMethods()) {
            if (!m.getName().equals(method) || !java.lang.reflect.Modifier.isStatic(m.getModifiers())) continue;
            candidates.add(m.toString());
            if (m.getParameterCount() != args.length) continue;
            m.setAccessible(true);
            return m.invoke(null, args);
        }
        List<String> methods = new ArrayList<>();
        for (java.lang.reflect.Method m : type.getDeclaredMethods())
            if (java.lang.reflect.Modifier.isStatic(m.getModifiers())) methods.add(m.getName() + m.getParameterCount());
        throw new NoSuchMethodException(className + "." + method + "/" + args.length + " (candidates: " + candidates + ", static: " + methods + ")");
    }

    private static Object dilation(float radius) throws Exception {
        return Class.forName("net.minecraft.client.model.Dilation").getConstructor(float.class).newInstance(radius);
    }

    /** TexturedModelData.of(modelData, width, height) */
    private static Object of(Object modelData, int width, int height) throws Exception {
        Class<?> type = Class.forName("net.minecraft.client.model.TexturedModelData");
        return type.getMethod("of", modelData.getClass(), int.class, int.class).invoke(null, modelData, width, height);
    }

    private static String describe(Throwable t) {
        Throwable cause = t;
        while (cause.getCause() != null) cause = cause.getCause();
        StringBuilder trace = new StringBuilder(cause.toString());
        for (StackTraceElement element : cause.getStackTrace()) {
            if (trace.length() > 1500) break;
            trace.append(" | ").append(element);
        }
        return trace.toString();
    }

    // ---- vanilla -> json (the format of vanilla-mob-models.json) ----

    private static JsonObject toJson(Object texturedModelData) throws ReflectiveOperationException {
        Object data = get(texturedModelData, "data");
        Object dimensions = get(texturedModelData, "dimensions");
        JsonObject result = new JsonObject();
        JsonArray texture = new JsonArray();
        texture.add((int) get(dimensions, "width"));
        texture.add((int) get(dimensions, "height"));
        result.add("texture", texture);
        Object root = data.getClass().getMethod("getRoot").invoke(data);
        result.add("parts", childrenToJson(root));
        return result;
    }

    private static JsonObject childrenToJson(Object partData) throws ReflectiveOperationException {
        Map<?, ?> children = (Map<?, ?>) get(partData, "children");
        JsonObject result = new JsonObject();
        for (Object name : new TreeSet<>(children.keySet().stream().map(String::valueOf).toList())) {
            result.add((String) name, partToJson(children.get(name)));
        }
        return result;
    }

    private static JsonObject partToJson(Object partData) throws ReflectiveOperationException {
        JsonObject part = new JsonObject();
        Object transform = get(partData, "rotationData");
        float[] pivot = {(float) get(transform, "pivotX"), (float) get(transform, "pivotY"), (float) get(transform, "pivotZ")};
        float[] rotation = {(float) get(transform, "pitch"), (float) get(transform, "yaw"), (float) get(transform, "roll")};
        if (!isZero(pivot)) part.add("pivot", array(pivot));
        if (!isZero(rotation)) part.add("rotation", array(rotation));

        List<?> cuboids = (List<?>) get(partData, "cuboidData");
        if (!cuboids.isEmpty()) {
            JsonArray array = new JsonArray();
            for (Object cuboid : cuboids) array.add(cuboidToJson(cuboid));
            part.add("cuboids", array);
        }
        JsonObject children = childrenToJson(partData);
        if (children.size() > 0) part.add("children", children);
        return part;
    }

    private static JsonObject cuboidToJson(Object cuboid) throws ReflectiveOperationException {
        JsonObject result = new JsonObject();
        Object uv = get(cuboid, "textureUV");
        result.add("uv", array(new float[] {vector2(uv, "x"), vector2(uv, "y")}));
        Object offset = get(cuboid, "offset"), size = get(cuboid, "dimensions");
        result.add("box", array(new float[] {
                (float) get(offset, "x"), (float) get(offset, "y"), (float) get(offset, "z"),
                (float) get(size, "x"), (float) get(size, "y"), (float) get(size, "z")
        }));
        Object dilation = get(cuboid, "extraSize");
        float dx = (float) get(dilation, "radiusX"), dy = (float) get(dilation, "radiusY"), dz = (float) get(dilation, "radiusZ");
        if (dx == dy && dy == dz) {
            if (dx != 0) result.add("dilation", number(dx));
        } else result.add("dilation", array(new float[] {dx, dy, dz}));
        if ((boolean) get(cuboid, "mirror")) result.addProperty("mirror", true);
        Object name = get(cuboid, "name");
        if (name != null) result.addProperty("name", name.toString());
        Object scale = get(cuboid, "textureScale");
        float sx = vector2(scale, "x"), sy = vector2(scale, "y");
        if (sx != 1 || sy != 1) result.add("textureScale", array(new float[] {sx, sy}));
        return result;
    }

    // ---- comparison ----

    private static void compare(String path, JsonElement expected, JsonElement actual, List<String> differences) {
        if (expected.isJsonObject() && actual.isJsonObject()) {
            JsonObject e = expected.getAsJsonObject(), a = actual.getAsJsonObject();
            Set<String> keys = new TreeSet<>(e.keySet());
            keys.addAll(a.keySet());
            for (String key : keys) {
                if (!e.has(key)) differences.add(path + "." + key + ": missing (vanilla " + a.get(key) + ")");
                else if (!a.has(key)) differences.add(path + "." + key + ": not in vanilla (" + e.get(key) + ")");
                else compare(path + "." + key, e.get(key), a.get(key), differences);
            }
        } else if (expected.isJsonArray() && actual.isJsonArray()) {
            JsonArray e = expected.getAsJsonArray(), a = actual.getAsJsonArray();
            if (e.size() != a.size()) {
                differences.add(path + ": " + e + " != vanilla " + a);
                return;
            }
            for (int i = 0; i < e.size(); i++) {
                List<String> inner = new ArrayList<>();
                compare(path + "[" + i + "]", e.get(i), a.get(i), inner);
                if (!inner.isEmpty() && e.get(i).isJsonPrimitive()) {
                    differences.add(path + ": " + e + " != vanilla " + a);
                    return;
                }
                differences.addAll(inner);
            }
        } else if (expected.isJsonPrimitive() && actual.isJsonPrimitive()
                && expected.getAsJsonPrimitive().isNumber() && actual.getAsJsonPrimitive().isNumber()) {
            if (Math.abs(expected.getAsFloat() - actual.getAsFloat()) > EPSILON)
                differences.add(path + ": " + expected + " != vanilla " + actual);
        } else if (!expected.equals(actual)) {
            differences.add(path + ": " + expected + " != vanilla " + actual);
        }
    }

    // ---- reflection helpers ----

    private static Object get(Object object, String name) throws ReflectiveOperationException {
        for (Class<?> type = object.getClass(); type != null; type = type.getSuperclass()) {
            try {
                Field field = type.getDeclaredField(name);
                field.setAccessible(true);
                return field.get(object);
            } catch (NoSuchFieldException ignored) {}
        }
        List<String> fields = new ArrayList<>();
        for (Class<?> type = object.getClass(); type != null; type = type.getSuperclass())
            for (Field field : type.getDeclaredFields()) fields.add(field.getType().getSimpleName() + " " + field.getName());
        throw new NoSuchFieldException(object.getClass().getName() + "." + name + " (fields: " + fields + ")");
    }

    /** minecraft's Vector2f (private fields x/y) */
    private static float vector2(Object vector, String axis) throws ReflectiveOperationException {
        return (float) get(vector, axis);
    }

    private static boolean isZero(float[] values) {
        for (float value : values) if (value != 0) return false;
        return true;
    }

    private static JsonArray array(float[] values) {
        JsonArray array = new JsonArray();
        for (float value : values) array.add(number(value));
        return array;
    }

    private static JsonElement number(float value) {
        return value == Math.rint(value) ? new com.google.gson.JsonPrimitive((long) value) : new com.google.gson.JsonPrimitive(value);
    }

}
