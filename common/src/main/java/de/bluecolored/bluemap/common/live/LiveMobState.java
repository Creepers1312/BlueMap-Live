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
 * The additional state of a living entity (mob) for the live-data (BlueMap Live, see docs/bluemap-live/phase-6.md).
 *
 * @param bodyYaw the yaw of the body in degrees (minecraft convention)
 * @param headYaw the yaw of the head in degrees (minecraft convention, not relative to the body)
 * @param hurtTime the remaining ticks of the hurt-animation (vanilla <code>hurtTime</code>, 0 if not hurt)
 * @param deathTime the ticks since the entity died (vanilla <code>deathTime</code>, 0 if alive)
 * @param baby if the entity is a baby
 * @param equipment the held items, or null if it holds nothing
 * @param variant the texture-variant of the entity (e.g. the mooshroom-type), or null
 * @param size the size of slimes and magma cubes, 0 for other entities
 * @param width the width of the hitbox in blocks (for a placeholder if the webapp has no model)
 * @param height the height of the hitbox in blocks
 * @param models block-models the webapp renders with the mob, e.g. the mushrooms of a mooshroom or the block an
 *               enderman carries (<code>minecraft:block/red_mushroom</code>), provided like the item-assets
 * @param flags further states that change the model or its animation (e.g. <code>attacking</code>,
 *              <code>sheared</code>, <code>saddled</code>), sorted
 * @param swingTicks the ticks since the hand-swing started (vanilla <code>handSwingTicks</code>), -1 if not swinging
 * @param attackTicks the remaining ticks of a type-specific attack-animation (iron golem, ravager, hoglin, zoglin),
 *                    0 if none
 * @param bedOffset lying in a bed: how far the model is moved towards the head-end (vanilla
 *                  <code>getEyeHeight(STANDING) - 0.1</code>), 0 otherwise
 */
public record LiveMobState(
        double bodyYaw,
        double headYaw,
        int hurtTime,
        int deathTime,
        boolean baby,
        @Nullable Equipment equipment,
        @Nullable String variant,
        int size,
        double width,
        double height,
        List<String> models,
        List<String> flags,
        int swingTicks,
        int attackTicks,
        double bedOffset
) {

    public LiveMobState {
        models = List.copyOf(models);
        flags = flags.stream().sorted().distinct().toList();
    }

    public LiveMobState(double bodyYaw, double headYaw, int hurtTime, int deathTime, boolean baby,
                        @Nullable Equipment equipment, @Nullable String variant, int size, double width, double height,
                        List<String> models, List<String> flags) {
        this(bodyYaw, headYaw, hurtTime, deathTime, baby, equipment, variant, size, width, height, models, flags, -1, 0);
    }

    public LiveMobState(double bodyYaw, double headYaw, int hurtTime, int deathTime, boolean baby,
                        @Nullable Equipment equipment, @Nullable String variant, int size, double width, double height,
                        List<String> models, List<String> flags, int swingTicks, int attackTicks) {
        this(bodyYaw, headYaw, hurtTime, deathTime, baby, equipment, variant, size, width, height, models, flags,
                swingTicks, attackTicks, 0);
    }

    public LiveMobState(double bodyYaw, double headYaw, int hurtTime, int deathTime, boolean baby,
                        @Nullable Equipment equipment, @Nullable String variant, int size, double width, double height,
                        List<String> flags) {
        this(bodyYaw, headYaw, hurtTime, deathTime, baby, equipment, variant, size, width, height, List.of(), flags);
    }

}
