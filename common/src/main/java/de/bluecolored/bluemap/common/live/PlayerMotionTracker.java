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
import org.jetbrains.annotations.Nullable;

import java.util.Objects;

/**
 * Tracks the samples of one player and derives the velocity and the generation-counter from them.
 * <p>The generation is increased whenever the position changed discontinuously, so that clients know that they must
 * not interpolate between the previous and the new position. This happens if:</p>
 * <ul>
 *     <li>the world changed between two samples</li>
 *     <li>a discontinuity was reported explicitly (e.g. respawn or world-change events of the platform)</li>
 *     <li>the player moved faster than {@link #getMaxSpeed()} (e.g. a teleport)</li>
 * </ul>
 * <p>Not thread-safe, only call from one thread (usually the server-thread).</p>
 */
public class PlayerMotionTracker {

    /** Default for the speed (blocks/s) above which a movement is treated as a teleport. */
    public static final double DEFAULT_MAX_SPEED = 100;

    /** Movements shorter than this (blocks) are never treated as teleport. */
    public static final double MIN_JUMP_DISTANCE = 8;

    /** Lower bound for the time between two samples, to avoid huge velocities from samples within the same tick. */
    private static final long MIN_SAMPLE_DELTA_MILLIS = 50;

    private final double maxSpeed;

    private @Nullable String lastWorld;
    private @Nullable Vector3d lastPosition;
    private long lastTime;
    private int generation;
    private boolean discontinuityPending;

    public PlayerMotionTracker() {
        this(DEFAULT_MAX_SPEED);
    }

    public PlayerMotionTracker(double maxSpeed) {
        if (!(maxSpeed > 0)) throw new IllegalArgumentException("maxSpeed must be positive");
        this.maxSpeed = maxSpeed;
    }

    /**
     * Marks the next sample as discontinuous (e.g. after a respawn or world-change event).
     */
    public void markDiscontinuity() {
        this.discontinuityPending = true;
    }

    /**
     * Adds a new sample and returns the resulting velocity and generation.
     *
     * @param world an identifier of the world/dimension the player is in
     * @param position the new position of the player
     * @param time the time of this sample in epoch-millis
     */
    public Result sample(String world, Vector3d position, long time) {
        Objects.requireNonNull(world);
        Objects.requireNonNull(position);

        Vector3d velocity = Vector3d.ZERO;

        if (lastPosition == null) {
            // first sample, nothing to compare with
            discontinuityPending = false;
        } else {
            long deltaMillis = Math.max(time - lastTime, MIN_SAMPLE_DELTA_MILLIS);
            double deltaSeconds = deltaMillis / 1000.0;
            Vector3d delta = position.sub(lastPosition);
            double distance = delta.length();

            boolean worldChanged = !world.equals(lastWorld);
            boolean jumped = distance >= MIN_JUMP_DISTANCE && distance / deltaSeconds > maxSpeed;

            if (discontinuityPending || worldChanged || jumped) {
                generation++;
                discontinuityPending = false;
            } else {
                velocity = delta.div(deltaSeconds);
            }
        }

        lastWorld = world;
        lastPosition = position;
        lastTime = time;

        return new Result(velocity, generation);
    }

    public int getGeneration() {
        return generation;
    }

    public double getMaxSpeed() {
        return maxSpeed;
    }

    public record Result(Vector3d velocity, int generation) {}

}
