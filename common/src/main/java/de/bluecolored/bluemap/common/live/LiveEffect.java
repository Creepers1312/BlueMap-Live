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

import com.flowpowered.math.vector.Vector3d;

/**
 * A short effect in a world that the webapp shows once (BlueMap Live, see docs/bluemap-live/phase-10.md):
 * an explosion or a splash-potion that breaks.
 *
 * @param id unique (increasing) while the server runs, so the webapp shows each effect only once
 * @param type the kind of the effect, see the constants
 * @param position the center of the effect
 * @param power explosions: the power (vanilla <code>Explosion.power</code>), 0 for other effects
 * @param destroy explosions: if blocks are destroyed (vanilla <code>Explosion.shouldDestroy</code>; with a power
 *                of at least 2 the large explosion-emitter is shown)
 * @param color splash-potions: the color (RGB) of the potion, 0 for other effects
 * @param time the time (epoch-millis) when the effect happened
 */
public record LiveEffect(
        long id,
        String type,
        Vector3d position,
        double power,
        boolean destroy,
        int color,
        long time
) {

    /** vanilla Explosion.affectWorld (the particles of the client) */
    public static final String EXPLOSION = "explosion";
    /** vanilla world-event 2002 (a splash- or lingering-potion breaks) */
    public static final String SPLASH = "splash";
    /** vanilla world-event 2007 (a splash-potion with an instant effect breaks) */
    public static final String INSTANT_SPLASH = "instant_splash";

}
