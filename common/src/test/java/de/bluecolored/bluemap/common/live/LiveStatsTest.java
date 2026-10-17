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

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

public class LiveStatsTest {

    @Test
    public void testWindowOfTheLastMinute() {
        LiveStats.Metric metric = new LiveStats.Metric();
        long t = 1_000_000_000L * 1000; // epoch-ms at a full second
        metric.add(5, t);
        metric.add(7, t + 500);
        metric.add(2, t + 1000);
        // the current second is not counted (it is not over yet)
        assertArrayEquals(new long[] {2, 12, 7}, metric.window(t + 1500));
        assertArrayEquals(new long[] {3, 14, 7}, metric.window(t + 2000));
        // after a minute the old seconds are gone
        assertArrayEquals(new long[] {1, 2, 2}, metric.window(t + 1000 + LiveStats.WINDOW * 1000L));
        assertArrayEquals(new long[] {0, 0, 0}, metric.window(t + 2000 + LiveStats.WINDOW * 1000L));
        // a slot of an old second is reused
        metric.add(9, t + LiveStats.WINDOW * 1000L);
        assertArrayEquals(new long[] {2, 11, 9}, metric.window(t + 1000 + LiveStats.WINDOW * 1000L));
    }

    @Test
    public void testNamedMetrics() {
        LiveStats.reset();
        LiveStats.add(LiveStats.TILES_RENDERED, 1);
        assertTrue(LiveStats.snapshot().containsKey(LiveStats.TILES_RENDERED));
        assertSame(LiveStats.get("x"), LiveStats.get("x"));
    }

}
