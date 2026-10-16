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

import de.bluecolored.bluemap.common.live.Armor;
import net.minecraft.component.type.DyedColorComponent;
import net.minecraft.entity.EquipmentSlot;
import net.minecraft.entity.LivingEntity;
import net.minecraft.item.ArmorItem;
import net.minecraft.item.ArmorMaterial;
import net.minecraft.item.ItemStack;
import net.minecraft.registry.tag.ItemTags;
import net.minecraft.util.Identifier;
import org.jetbrains.annotations.Nullable;

import java.util.ArrayList;
import java.util.List;

/**
 * Samples the worn armor like vanilla ArmorFeatureRenderer (1.21) decides what to render: for each slot with an
 * armor-item of that slot the layers of its armor-material, the second-layer textures for the leggings (inner model),
 * dyeable layers with the dye-color (leather, default color 0xA06540). Trims and the glint are not sampled.
 */
final class FabricArmor {

    /** vanilla ArmorFeatureRenderer: the default color of dyeable armor (-6265536) */
    private static final int DEFAULT_DYE_COLOR = -6265536;

    private FabricArmor() {}

    static Armor sample(LivingEntity entity) {
        return new Armor(
                layers(entity, EquipmentSlot.HEAD),
                layers(entity, EquipmentSlot.CHEST),
                layers(entity, EquipmentSlot.LEGS),
                layers(entity, EquipmentSlot.FEET)
        );
    }

    private static @Nullable List<Armor.Layer> layers(LivingEntity entity, EquipmentSlot slot) {
        ItemStack stack = entity.getEquippedStack(slot);
        if (!(stack.getItem() instanceof ArmorItem armorItem) || armorItem.getSlotType() != slot) return null;
        ArmorMaterial material = armorItem.getMaterial().value();
        boolean innerModel = slot == EquipmentSlot.LEGS;
        Integer color = stack.isIn(ItemTags.DYEABLE) ? DyedColorComponent.getColor(stack, DEFAULT_DYE_COLOR) & 0xFFFFFF : null;

        List<Armor.Layer> layers = new ArrayList<>();
        for (ArmorMaterial.Layer layer : material.layers()) {
            String key = textureKey(layer.getTexture(innerModel));
            if (key != null) layers.add(new Armor.Layer(key, layer.isDyeable() ? color : null));
        }
        return layers.isEmpty() ? null : List.copyOf(layers);
    }

    /** "minecraft:textures/models/armor/iron_layer_1.png" -> "minecraft:models/armor/iron_layer_1" */
    static @Nullable String textureKey(Identifier texture) {
        String path = texture.getPath();
        if (!path.startsWith("textures/") || !path.endsWith(".png")) return null;
        return texture.getNamespace() + ":" + path.substring("textures/".length(), path.length() - ".png".length());
    }

}
