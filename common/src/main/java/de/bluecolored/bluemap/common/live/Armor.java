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

import org.jetbrains.annotations.Nullable;

import java.util.List;

/**
 * The worn armor of a player or mob, per slot the layers that vanilla ArmorFeatureRenderer renders
 * (BlueMap Live, see docs/bluemap-live/phase-7.md).
 *
 * @param head the layers of the helmet, null if the slot has no armor-item
 * @param chest the layers of the chestplate
 * @param legs the layers of the leggings (rendered with the inner armor-model)
 * @param feet the layers of the boots
 */
public record Armor(
        @Nullable List<Layer> head,
        @Nullable List<Layer> chest,
        @Nullable List<Layer> legs,
        @Nullable List<Layer> feet
) {

    /** a layer with this texture is the enchantment-glint (vanilla RenderLayer.ARMOR_ENTITY_GLINT, ItemRenderer.ENTITY_ENCHANTMENT_GLINT) */
    public static final String GLINT_TEXTURE = "minecraft:misc/enchanted_glint_entity";


    public static final Armor EMPTY = new Armor(null, null, null, null);

    /**
     * One texture-layer of an armor-piece (vanilla ArmorMaterial.Layer).
     *
     * @param texture the texture-key, e.g. <code>minecraft:models/armor/iron_layer_1</code>
     * @param color the dye-color (rgb) of dyeable layers (leather), null if not tinted
     */
    public record Layer(String texture, @Nullable Integer color) {}

    public boolean isEmpty() {
        return head == null && chest == null && legs == null && feet == null;
    }

    /** all texture-keys of the worn armor */
    public List<String> textures() {
        return java.util.stream.Stream.of(head, chest, legs, feet)
                .filter(java.util.Objects::nonNull)
                .flatMap(List::stream)
                .map(Layer::texture)
                .distinct()
                .toList();
    }

}
