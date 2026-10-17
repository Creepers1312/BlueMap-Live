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

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.List;

/**
 * The recent effects of one world (thread-safe): added on the server-thread, read by the webserver.
 * Effects are kept for {@link #MAX_AGE_MILLIS}, so every client that polls the live-data sees them at least once.
 */
public class LiveEffectLog {

    /** longer than the slowest configured update-interval plus the playback-delay of the webapp */
    public static final long MAX_AGE_MILLIS = 6000;
    /** a protection against huge amounts (e.g. a tnt-cannon) */
    public static final int MAX_EFFECTS = 256;

    private final Deque<LiveEffect> effects = new ArrayDeque<>();
    private long nextId = 1;

    public synchronized LiveEffect add(String type, Vector3d position, double power, boolean destroy, int color, long time) {
        LiveEffect effect = new LiveEffect(nextId++, type, position, power, destroy, color, time);
        effects.addLast(effect);
        while (effects.size() > MAX_EFFECTS) effects.removeFirst();
        return effect;
    }

    /** the effects that are not older than {@link #MAX_AGE_MILLIS}, oldest first */
    public synchronized List<LiveEffect> recent(long now) {
        while (!effects.isEmpty() && now - effects.peekFirst().time() > MAX_AGE_MILLIS) effects.removeFirst();
        return new ArrayList<>(effects);
    }

}
