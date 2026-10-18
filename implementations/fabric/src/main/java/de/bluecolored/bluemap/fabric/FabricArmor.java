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
import de.bluecolored.bluemap.common.live.HeldItem;
import org.jetbrains.annotations.Nullable;

import java.lang.reflect.Method;
import java.lang.reflect.RecordComponent;
import java.util.ArrayList;
import java.util.List;
import net.minecraft.core.Holder;
import net.minecraft.core.component.DataComponents;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.tags.ItemTags;
import net.minecraft.world.entity.EquipmentSlot;
import net.minecraft.world.entity.LivingEntity;
import net.minecraft.world.item.ArmorItem;
import net.minecraft.world.item.ArmorMaterial;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.armortrim.ArmorTrim;
import net.minecraft.world.item.component.DyedItemColor;

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

    /**
     * vanilla HeadFeatureRenderer: an item on the head that is no helmet, rendered as item (display-mode "head", e.g. a
     * carved pumpkin or a block) or as skull-model (mob- and player-heads, the webapp knows the skull-items).
     */
    static @Nullable HeldItem headItem(LivingEntity entity) {
        ItemStack stack = entity.getItemBySlot(EquipmentSlot.HEAD);
        if (stack.isEmpty()) return null;
        if (stack.getItem() instanceof ArmorItem armorItem && armorItem.getEquipmentSlot() == EquipmentSlot.HEAD) return null;
        return FabricPlayer.toHeldItem(stack);
    }

    private static @Nullable List<Armor.Layer> layers(LivingEntity entity, EquipmentSlot slot) {
        ItemStack stack = entity.getItemBySlot(slot);
        if (!(stack.getItem() instanceof ArmorItem armorItem) || armorItem.getEquipmentSlot() != slot) return null;
        boolean innerModel = slot == EquipmentSlot.LEGS;
        Integer color = stack.is(ItemTags.DYEABLE) ? DyedItemColor.getOrDefault(stack, DEFAULT_DYE_COLOR) & 0xFFFFFF : null;

        List<Armor.Layer> layers = new ArrayList<>();
        Holder<?> material;
        try {
            material = materialEntry(armorItem);
        } catch (ReflectiveOperationException | RuntimeException | LinkageError ex) {
            return null;
        }
        try {
            for (Object layer : materialLayers(entryValue(material))) {
                String key = textureKey((ResourceLocation) layerTexture(layer).invoke(layer, innerModel));
                boolean dyeable = (boolean) layerDyeable(layer).invoke(layer);
                if (key != null) layers.add(new Armor.Layer(key, dyeable ? color : null));
            }
        } catch (ReflectiveOperationException | RuntimeException | LinkageError ex) {
            // the vanilla layers of the material: <id>_layer_1/2, leather with a dyeable layer and an overlay
            layers.clear();
            String id = material.unwrapKey()
                    .filter(key -> key.registry().getPath().equals("armor_material"))
                    .map(key -> key.location().toString()).orElse(null);
            if (id == null) return null;
            int colon = id.indexOf(':');
            String base = id.substring(0, colon) + ":models/armor/" + id.substring(colon + 1) + "_layer_" + (innerModel ? 2 : 1);
            if (id.equals("minecraft:leather")) {
                layers.add(new Armor.Layer(base, color));
                layers.add(new Armor.Layer(base + "_overlay", null));
            } else {
                layers.add(new Armor.Layer(base, null));
            }
        }
        // vanilla ArmorFeatureRenderer.renderTrim: the sprite of the trim-atlas over the layers (generated by the baker)
        ArmorTrim trim = stack.get(DataComponents.TRIM);
        if (trim != null && !layers.isEmpty()) {
            try {
                @SuppressWarnings("unchecked") Holder<ArmorMaterial> armorMaterial = (Holder<ArmorMaterial>) material;
                ResourceLocation sprite = innerModel ? trim.innerTexture(armorMaterial) : trim.outerTexture(armorMaterial);
                layers.add(new Armor.Layer(sprite.getNamespace() + ":" + sprite.getPath(), null));
            } catch (RuntimeException | LinkageError ignored) {
                // no trim
            }
        }
        // vanilla ArmorFeatureRenderer.renderGlint: the enchantment-glint over the armor (the webapp knows the texture)
        if (stack.hasFoil() && !layers.isEmpty()) layers.add(new Armor.Layer(Armor.GLINT_TEXTURE, null));
        return layers.isEmpty() ? null : List.copyOf(layers);
    }

    // ArmorMaterial is a record whose components have no yarn-names in 1.21: they are found by their types

    private static @Nullable Method materialMethod, layersAccessor, textureMethod, dyeableMethod;

    /** ArmorItem.getMaterial(): the registry-entry of the armor-material */
    private static Holder<?> materialEntry(ArmorItem item) throws ReflectiveOperationException {
        if (materialMethod != null) return (Holder<?>) materialMethod.invoke(item);
        // ArmorItem has a second public no-arg method that returns a RegistryEntry (getEquipSound), and in a
        // production-environment the names are intermediary-names: by the generic return-type
        // RegistryEntry<ArmorMaterial>, or else by the value of the returned entry
        List<Method> candidates = new ArrayList<>();
        for (Method method : ArmorItem.class.getDeclaredMethods()) {
            if (method.getReturnType() != Holder.class || method.getParameterCount() != 0 ||
                    !java.lang.reflect.Modifier.isPublic(method.getModifiers())) continue;
            if (method.getGenericReturnType() instanceof java.lang.reflect.ParameterizedType type &&
                    type.getActualTypeArguments().length == 1 && type.getActualTypeArguments()[0] == ArmorMaterial.class) {
                materialMethod = method;
                return (Holder<?>) method.invoke(item);
            }
            candidates.add(method);
        }
        for (Method method : candidates) {
            Holder<?> entry = (Holder<?>) method.invoke(item);
            try {
                entryValue(entry);
            } catch (NoSuchMethodException notArmor) {
                continue;
            }
            materialMethod = method;
            return entry;
        }
        throw new NoSuchMethodException("ArmorItem.getMaterial");
    }

    /** RegistryEntry.value(): found as the no-arg method that returns the ArmorMaterial */
    private static Object entryValue(Holder<?> entry) throws ReflectiveOperationException {
        for (Method method : Holder.class.getMethods()) {
            if (method.getParameterCount() != 0 || method.getReturnType() != Object.class) continue;
            Object value = method.invoke(entry);
            if (value instanceof ArmorMaterial) return value;
        }
        throw new NoSuchMethodException("RegistryEntry.value");
    }

    private static List<?> materialLayers(Object material) throws ReflectiveOperationException {
        if (layersAccessor == null) {
            for (RecordComponent component : ArmorMaterial.class.getRecordComponents()) {
                if (component.getType() == List.class) layersAccessor = component.getAccessor();
            }
            if (layersAccessor == null) throw new NoSuchMethodException("ArmorMaterial.layers");
        }
        return (List<?>) layersAccessor.invoke(material);
    }

    /**
     * ArmorMaterial.Layer.getTexture(boolean secondLayer): the public method (boolean) -> Identifier whose result is a
     * texture-path (textures/....png); the layer has a second one with this signature (getTextureId)
     */
    private static Method layerTexture(Object layer) throws ReflectiveOperationException {
        if (textureMethod == null) {
            for (Method method : layer.getClass().getMethods()) {
                if (method.getReturnType() != ResourceLocation.class || method.getParameterCount() != 1 ||
                        method.getParameterTypes()[0] != boolean.class) continue;
                Object result = method.invoke(layer, false);
                if (result instanceof ResourceLocation id && textureKey(id) != null) {
                    textureMethod = method;
                    break;
                }
            }
            if (textureMethod == null) throw new NoSuchMethodException("ArmorMaterial.Layer.getTexture");
        }
        return textureMethod;
    }

    /** ArmorMaterial.Layer.isDyeable() */
    private static Method layerDyeable(Object layer) throws NoSuchMethodException {
        if (dyeableMethod == null) {
            // the only public no-arg boolean method of the record ArmorMaterial.Layer (besides equals(Object))
            for (Method method : layer.getClass().getDeclaredMethods()) {
                if (method.getReturnType() == boolean.class && method.getParameterCount() == 0 &&
                        java.lang.reflect.Modifier.isPublic(method.getModifiers())) dyeableMethod = method;
            }
            if (dyeableMethod == null) throw new NoSuchMethodException("ArmorMaterial.Layer.isDyeable");
        }
        return dyeableMethod;
    }

    /** "minecraft:textures/models/armor/iron_layer_1.png" -> "minecraft:models/armor/iron_layer_1" */
    static @Nullable String textureKey(ResourceLocation texture) {
        String path = texture.getPath();
        if (!path.startsWith("textures/") || !path.endsWith(".png")) return null;
        return texture.getNamespace() + ":" + path.substring("textures/".length(), path.length() - ".png".length());
    }

}
