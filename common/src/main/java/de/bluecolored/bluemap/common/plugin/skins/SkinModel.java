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

import org.jetbrains.annotations.Nullable;

/**
 * The model-variant of a player-skin.
 */
public enum SkinModel {

    /** the default model with 4 pixel wide arms ("Steve") */
    CLASSIC ("classic"),

    /** the slim model with 3 pixel wide arms ("Alex") */
    SLIM ("slim");

    private final String id;

    SkinModel(String id) {
        this.id = id;
    }

    public String getId() {
        return id;
    }

    /**
     * Returns the model with the given id, or null if the id is unknown.
     */
    public static @Nullable SkinModel fromId(@Nullable String id) {
        if (id == null) return null;
        for (SkinModel model : values()) {
            if (model.id.equals(id)) return model;
        }
        return null;
    }

}
