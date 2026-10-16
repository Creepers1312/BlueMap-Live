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

import java.util.ArrayList;
import java.util.List;

/**
 * The particles an entity (or a player) emits on its own, for the live-data (BlueMap Live, see docs/bluemap-live/phase-10.md).
 * The webapp spawns them like the vanilla client does.
 *
 * @param onFire if the entity is drawn burning (vanilla <code>Entity.doesRenderOnFire</code>)
 * @param swirls the colors (ARGB) of the potion-swirls (vanilla <code>LivingEntity.POTION_SWIRLS</code>, only the
 *               <code>entity_effect</code> particles), empty if none
 * @param ambient if all shown effects are ambient (vanilla <code>POTION_SWIRLS_AMBIENT</code>, fewer swirls)
 * @param invisible if the entity is invisible (vanilla: fewer swirls)
 * @param cloud the area-effect-cloud, null for other entities
 */
public record ParticleState(
        boolean onFire,
        List<Integer> swirls,
        boolean ambient,
        boolean invisible,
        @Nullable Cloud cloud
) {

    /**
     * The textures of the particles the webapp draws (vanilla particles/*.json: explosion, entity_effect and effect,
     * instant_effect, poof) and of the burning entities (vanilla ModelLoader.FIRE_0 / FIRE_1), provided like the
     * armor-textures (assets/textures/).
     */
    public static final List<String> TEXTURES = textures();

    private static List<String> textures() {
        List<String> textures = new ArrayList<>();
        for (int i = 0; i < 16; i++) textures.add("minecraft:particle/explosion_" + i);
        for (int i = 0; i < 8; i++) {
            textures.add("minecraft:particle/effect_" + i);
            textures.add("minecraft:particle/spell_" + i);
            textures.add("minecraft:particle/generic_" + i);
        }
        textures.add("minecraft:block/fire_0");
        textures.add("minecraft:block/fire_1");
        return List.copyOf(textures);
    }

    /** at most this many swirl-colors are sent (vanilla picks a random one per particle) */
    public static final int MAX_SWIRLS = 16;

    /**
     * An area-effect-cloud (lingering potion) that emits <code>entity_effect</code> particles.
     *
     * @param radius the radius in blocks
     * @param color the color (ARGB) of the particles
     * @param waiting if the cloud is still waiting (vanilla: only a few particles, partly white)
     */
    public record Cloud(double radius, int color, boolean waiting) {}

    public ParticleState {
        swirls = swirls.size() > MAX_SWIRLS ? List.copyOf(swirls.subList(0, MAX_SWIRLS)) : List.copyOf(swirls);
    }

    /** if nothing is emitted (then nothing needs to be sent) */
    public boolean isEmpty() {
        return !onFire && swirls.isEmpty() && cloud == null;
    }

    /** null if the state is empty */
    public static @Nullable ParticleState of(boolean onFire, List<Integer> swirls, boolean ambient, boolean invisible,
                                             @Nullable Cloud cloud) {
        ParticleState state = new ParticleState(onFire, swirls, ambient, invisible, cloud);
        return state.isEmpty() ? null : state;
    }

}
