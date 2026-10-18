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

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * BlueMap Live: what the live-features cost on the server, over the last minute (shown by <code>/bluemap live-stats</code>).
 * Thread-safe and cheap (a few array-writes per measurement).
 */
public final class LiveStats {

    /** the length of the window in seconds */
    public static final int WINDOW = 60;

    private LiveStats() {}

    /**
     * A measured thing: per second of the window the number of events, the summed amount (e.g. nanoseconds or
     * blocks) and the largest single amount.
     */
    public static final class Metric {
        private final long[] seconds = new long[WINDOW];
        private final long[] counts = new long[WINDOW];
        private final long[] sums = new long[WINDOW];
        private final long[] maxima = new long[WINDOW];

        public synchronized void add(long amount, long nowMillis) {
            long second = nowMillis / 1000;
            int i = (int) Math.floorMod(second, (long) WINDOW);
            if (seconds[i] != second) {
                seconds[i] = second;
                counts[i] = 0;
                sums[i] = 0;
                maxima[i] = 0;
            }
            counts[i]++;
            sums[i] += amount;
            maxima[i] = Math.max(maxima[i], amount);
        }

        /** @return count, sum, max of the last {@link #WINDOW} seconds (without the current second) */
        public synchronized long[] window(long nowMillis) {
            long now = nowMillis / 1000;
            long count = 0, sum = 0, max = 0;
            for (int i = 0; i < WINDOW; i++) {
                if (seconds[i] < now - WINDOW || seconds[i] >= now) continue;
                count += counts[i];
                sum += sums[i];
                max = Math.max(max, maxima[i]);
            }
            return new long[] {count, sum, max};
        }
    }

    private static final Map<String, Metric> METRICS = new ConcurrentHashMap<>();

    /** the metric of a name (created on first use) */
    public static Metric get(String name) {
        return METRICS.computeIfAbsent(name, n -> new Metric());
    }

    public static void add(String name, long amount) {
        get(name).add(amount, System.currentTimeMillis());
    }

    // the names of the metrics (time-metrics in nanoseconds)
    /** server-thread: turning the changed blocks of a tick into block-states (FabricBlockChanges.flush) */
    public static final String BLOCK_FLUSH_NANOS = "block-flush";
    /** the changed blocks that were recorded (amount: blocks per tick) */
    public static final String BLOCK_CHANGES = "block-changes";
    /** the changed blocks that were not recorded (more than the limit per tick) */
    public static final String BLOCK_CHANGES_DROPPED = "block-changes-dropped";
    /** server-thread: sampling the entities, chests and world-times */
    public static final String ENTITY_SAMPLE_NANOS = "entity-sample";
    /** render-threads: hires-tiles that were rendered again */
    public static final String TILES_RENDERED = "tiles-rendered";
    /** render-threads: the immediate saves of the lowres-tiles of small updates */
    public static final String LOWRES_SAVE_NANOS = "lowres-save";
    /** webserver: building live/entities.json */
    public static final String ENTITIES_JSON_NANOS = "entities-json";
    /** webserver: building live/players.json */
    public static final String PLAYERS_JSON_NANOS = "players-json";
    /** webserver: building live/tiles.json */
    public static final String TILES_JSON_NANOS = "tiles-json";
    /** background: baking a block-asset */
    public static final String BLOCK_ASSET_NANOS = "block-asset";

    /** a snapshot of all metrics: name -> {count, sum, max} */
    public static Map<String, long[]> snapshot() {
        long now = System.currentTimeMillis();
        Map<String, long[]> result = new LinkedHashMap<>();
        METRICS.forEach((name, metric) -> result.put(name, metric.window(now)));
        return result;
    }

    /** for tests */
    static void reset() {
        METRICS.clear();
    }

}
