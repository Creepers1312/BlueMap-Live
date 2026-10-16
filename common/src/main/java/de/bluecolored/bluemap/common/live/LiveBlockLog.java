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

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.List;

/**
 * BlueMap Live (see docs/bluemap-live/phase-11.md): the recent block-changes of one world, shown by the webapp as a
 * preview until BlueMap rendered the tile again (thread-safe: added on the server-thread, read by the webserver).
 */
public class LiveBlockLog {

    /**
     * @param id unique (increasing) while the server runs
     * @param state the new block-state, normalized (properties sorted), e.g. <code>minecraft:air</code>
     * @param neighbors the states of the 6 neighbors (down, up, north, south, west, east), null for air
     * @param time the time (epoch-millis) of the change
     */
    public record Change(long id, int x, int y, int z, String state, @Nullable String[] neighbors, long time) {}

    /** longer than the slowest update-interval plus the playback-delay of the webapp */
    public static final long MAX_AGE_MILLIS = 10_000;
    /** a protection against huge amounts (e.g. a large explosion or a world-edit): the rest waits for the render */
    public static final int MAX_CHANGES = 4096;

    private final Deque<Change> changes = new ArrayDeque<>();
    private long nextId = 1;

    public synchronized void add(int x, int y, int z, String state, @Nullable String[] neighbors, long time) {
        changes.addLast(new Change(nextId++, x, y, z, state, neighbors, time));
        while (changes.size() > MAX_CHANGES) changes.removeFirst();
    }

    /** the changes that are not older than {@link #MAX_AGE_MILLIS}, oldest first */
    public synchronized List<Change> recent(long now) {
        while (!changes.isEmpty() && now - changes.peekFirst().time() > MAX_AGE_MILLIS) changes.removeFirst();
        return new ArrayList<>(changes);
    }

    /**
     * Normalizes a block-state-string like BlueMap: <code>id[key=value,...]</code> with the properties sorted by key.
     */
    public static String normalize(String id, java.util.Map<String, String> properties) {
        if (properties.isEmpty()) return id;
        StringBuilder result = new StringBuilder(id).append('[');
        properties.entrySet().stream().sorted(java.util.Map.Entry.comparingByKey()).forEach(e ->
                result.append(e.getKey()).append('=').append(e.getValue()).append(','));
        result.setLength(result.length() - 1);
        return result.append(']').toString();
    }

}
