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
 * model-definitions of Minecraft itself (<code>EntityModels.getModels()</code>, client-classes of the merged jar).
 * <p>Every difference is reported (also as GitHub-annotations in <code>build/vanilla-model-check.txt</code>, printed by
 * the CI), together with the definition of the game in the format of the json, so a wrong value is never guessed.</p>
 * <p>The model-classes are read with reflection (yarn-names), only the data of the layers is used, nothing is rendered.</p>
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
        try {
            // the registries (used by some model-classes) need the bootstrap, like the vanilla data-generator
            Class.forName("net.minecraft.SharedConstants").getMethod("createGameVersion").invoke(null);
            Class.forName("net.minecraft.Bootstrap").getMethod("initialize").invoke(null);
            Map<?, ?> models = (Map<?, ?>) Class.forName("net.minecraft.client.render.entity.model.EntityModels")
                    .getMethod("getModels").invoke(null);
            for (Map.Entry<?, ?> entry : models.entrySet()) layers.put(entry.getKey().toString(), entry.getValue());
        } catch (Throwable t) {
            Throwable cause = t;
            while (cause.getCause() != null) cause = cause.getCause();
            StringBuilder trace = new StringBuilder(cause.toString());
            for (StackTraceElement element : cause.getStackTrace()) {
                if (trace.length() > 3000) break;
                trace.append(" | ").append(element);
            }
            report.add("error::loading the vanilla models failed: " + trace);
            writeReport(report);
            fail("loading the vanilla models failed: " + cause);
        }

        List<String> differences = new ArrayList<>();
        for (Map.Entry<String, JsonElement> entry : expectedModels.entrySet()) {
            String layer = entry.getKey();
            Object texturedModelData = layers.get(layer);
            if (texturedModelData == null) {
                differences.add(layer + ": no such model-layer");
                report.add("::" + layer + ": no such model-layer");
                continue;
            }
            JsonObject actual = toJson(texturedModelData);
            List<String> layerDifferences = new ArrayList<>();
            compare(layer, entry.getValue(), actual, layerDifferences);
            if (!layerDifferences.isEmpty()) {
                differences.addAll(layerDifferences);
                report.add("::" + String.join("; ", layerDifferences) + " -- vanilla: " + actual);
            }
        }
        writeReport(report);
        if (!differences.isEmpty()) fail("The webapp mob-models differ from vanilla:\n" + String.join("\n", differences));
    }

    /** one GitHub-annotation per line (error, warning, notice: at most 10 of each type are shown per step) */
    private static void writeReport(List<String> report) throws IOException {
        String[] types = {"error", "warning", "notice"};
        List<String> lines = new ArrayList<>();
        for (int i = 0; i < report.size(); i++) {
            String line = report.get(i);
            if (line.startsWith("error::")) line = line.substring(5);
            lines.add("::" + types[Math.min(i / 10, 2)] + " title=vanilla-model-check" + line.replace("%", "%25").replace("\r", "").replace("\n", " "));
        }
        Path out = Path.of("build", "vanilla-model-check.txt");
        Files.createDirectories(out.getParent());
        Files.write(out, lines, StandardCharsets.UTF_8);
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
        if (!children.isEmpty()) part.add("children", children);
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
