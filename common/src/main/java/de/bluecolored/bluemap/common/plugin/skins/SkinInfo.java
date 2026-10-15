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
package de.bluecolored.bluemap.common.plugin.skins;

import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParseException;
import com.google.gson.JsonParser;
import org.jetbrains.annotations.Nullable;

import java.util.Objects;
import java.util.regex.Pattern;

/**
 * Information about the stored full skin of a player.
 *
 * @param model the model-variant of the skin
 * @param version a short hash of the normalized skin-image, changes whenever the skin changes
 */
public record SkinInfo(SkinModel model, String version) {

    private static final Pattern VERSION_PATTERN = Pattern.compile("[0-9a-f]{1,64}");

    public SkinInfo {
        Objects.requireNonNull(model);
        Objects.requireNonNull(version);
        if (!VERSION_PATTERN.matcher(version).matches())
            throw new IllegalArgumentException("Invalid skin-version: " + version);
    }

    /**
     * The content of the small json-file that is stored next to the skin-image (playerskins/&lt;uuid&gt;.json)
     */
    public String toJson() {
        JsonObject json = new JsonObject();
        json.addProperty("model", model.getId());
        json.addProperty("version", version);
        return json.toString();
    }

    /**
     * Parses the content of a skin-info json-file, returns null if it is missing or invalid.
     */
    public static @Nullable SkinInfo fromJson(@Nullable String jsonString) {
        if (jsonString == null) return null;
        try {
            JsonElement element = JsonParser.parseString(jsonString);
            if (!element.isJsonObject()) return null;
            JsonObject json = element.getAsJsonObject();

            SkinModel model = json.has("model") ? SkinModel.fromId(json.get("model").getAsString()) : null;
            String version = json.has("version") ? json.get("version").getAsString() : null;
            if (model == null || version == null || !VERSION_PATTERN.matcher(version).matches()) return null;

            return new SkinInfo(model, version);
        } catch (JsonParseException | IllegalStateException | UnsupportedOperationException ex) {
            return null;
        }
    }

}
