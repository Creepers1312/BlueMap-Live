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
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

public class PlayerMotionTrackerTest {

    private static final String OVERWORLD = "minecraft:overworld";
    private static final String NETHER = "minecraft:the_nether";

    @Test
    public void testFirstSample() {
        PlayerMotionTracker tracker = new PlayerMotionTracker();
        PlayerMotionTracker.Result result = tracker.sample(OVERWORLD, new Vector3d(10, 64, 10), 1000);

        assertEquals(0, result.generation());
        assertEquals(Vector3d.ZERO, result.velocity());
    }

    @Test
    public void testNormalMovement() {
        PlayerMotionTracker tracker = new PlayerMotionTracker();
        tracker.sample(OVERWORLD, new Vector3d(0, 64, 0), 1000);

        // walking ~4.3 blocks/s, sampled every 250ms
        PlayerMotionTracker.Result result = tracker.sample(OVERWORLD, new Vector3d(1.075, 64, 0), 1250);

        assertEquals(0, result.generation());
        assertEquals(4.3, result.velocity().getX(), 1e-9);
        assertEquals(0, result.velocity().getY(), 1e-9);
        assertEquals(0, result.velocity().getZ(), 1e-9);
    }

    @Test
    public void testRotationOnlyKeepsGenerationAndHasNoVelocity() {
        PlayerMotionTracker tracker = new PlayerMotionTracker();
        Vector3d position = new Vector3d(5, 70, -3);
        tracker.sample(OVERWORLD, position, 1000);

        PlayerMotionTracker.Result result = tracker.sample(OVERWORLD, position, 1250);

        assertEquals(0, result.generation());
        assertEquals(Vector3d.ZERO, result.velocity());
    }

    @Test
    public void testTeleportIncreasesGeneration() {
        PlayerMotionTracker tracker = new PlayerMotionTracker();
        tracker.sample(OVERWORLD, new Vector3d(0, 64, 0), 1000);

        PlayerMotionTracker.Result result = tracker.sample(OVERWORLD, new Vector3d(1000, 80, -500), 1250);

        assertEquals(1, result.generation());
        assertEquals(Vector3d.ZERO, result.velocity(), "no velocity across a teleport");

        // moving normally afterwards keeps the new generation
        result = tracker.sample(OVERWORLD, new Vector3d(1001, 80, -500), 1500);
        assertEquals(1, result.generation());
        assertEquals(4, result.velocity().getX(), 1e-9);
    }

    @Test
    public void testShortJumpIsNotATeleport() {
        PlayerMotionTracker tracker = new PlayerMotionTracker();
        tracker.sample(OVERWORLD, new Vector3d(0, 64, 0), 1000);

        // 5 blocks within one tick would be "fast", but is below the minimum jump distance
        PlayerMotionTracker.Result result = tracker.sample(OVERWORLD, new Vector3d(5, 64, 0), 1050);

        assertEquals(0, result.generation());
    }

    @Test
    public void testFastFlightIsNotATeleport() {
        PlayerMotionTracker tracker = new PlayerMotionTracker();
        tracker.sample(OVERWORLD, new Vector3d(0, 100, 0), 1000);

        // elytra with fireworks: ~33 blocks/s
        PlayerMotionTracker.Result result = tracker.sample(OVERWORLD, new Vector3d(33, 100, 0), 2000);

        assertEquals(0, result.generation());
        assertEquals(33, result.velocity().getX(), 1e-9);
    }

    @Test
    public void testSamplesWithinSameMillisecondDoNotExplode() {
        PlayerMotionTracker tracker = new PlayerMotionTracker();
        tracker.sample(OVERWORLD, new Vector3d(0, 64, 0), 1000);

        PlayerMotionTracker.Result result = tracker.sample(OVERWORLD, new Vector3d(0.2, 64, 0), 1000);

        assertTrue(Double.isFinite(result.velocity().getX()));
        assertEquals(0, result.generation());
    }

    @Test
    public void testWorldChangeIncreasesGeneration() {
        PlayerMotionTracker tracker = new PlayerMotionTracker();
        tracker.sample(OVERWORLD, new Vector3d(80, 64, 80), 1000);

        // nether-portal: position scaled by 1/8, close enough to not look like a teleport by distance
        PlayerMotionTracker.Result result = tracker.sample(NETHER, new Vector3d(10, 64, 10), 1250);
        assertEquals(1, result.generation());
        assertEquals(Vector3d.ZERO, result.velocity());

        // and back
        result = tracker.sample(OVERWORLD, new Vector3d(80, 64, 80), 1500);
        assertEquals(2, result.generation());
    }

    @Test
    public void testExplicitDiscontinuity() {
        PlayerMotionTracker tracker = new PlayerMotionTracker();
        tracker.sample(OVERWORLD, new Vector3d(0, 64, 0), 1000);

        // e.g. respawn next to the death-location
        tracker.markDiscontinuity();
        PlayerMotionTracker.Result result = tracker.sample(OVERWORLD, new Vector3d(1, 64, 0), 1250);
        assertEquals(1, result.generation());

        // the mark is consumed by one sample only
        result = tracker.sample(OVERWORLD, new Vector3d(2, 64, 0), 1500);
        assertEquals(1, result.generation());
    }

    @Test
    public void testDiscontinuityBeforeFirstSampleIsIgnored() {
        PlayerMotionTracker tracker = new PlayerMotionTracker();
        tracker.markDiscontinuity();

        assertEquals(0, tracker.sample(OVERWORLD, new Vector3d(0, 64, 0), 1000).generation());
        assertEquals(0, tracker.sample(OVERWORLD, new Vector3d(1, 64, 0), 1250).generation());
    }

    @Test
    public void testInvalidMaxSpeed() {
        assertThrows(IllegalArgumentException.class, () -> new PlayerMotionTracker(0));
        assertThrows(IllegalArgumentException.class, () -> new PlayerMotionTracker(Double.NaN));
    }

}
