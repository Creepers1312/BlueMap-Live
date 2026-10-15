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

/**
 * An immutable, consistent snapshot of the live-state of a player.
 * <p>All values are taken at the same moment, so position and generation always belong together.</p>
 *
 * @param position the position of the player (feet)
 * @param rotation x -> pitch, y -> head-yaw, z -> roll (degrees, minecraft convention)
 * @param bodyYaw the yaw of the players body in degrees
 * @param velocity the velocity in blocks per second, derived from the last samples
 * @param generation a counter that changes whenever the position changed discontinuously (teleport, respawn, world-change)
 * @param time the time (epoch-millis) when this state was sampled
 * @param movement the movement-flags of the player, or null if unknown on this platform
 * @param swing the arm-swing state of the player, or null if unknown on this platform
 */
public record LivePlayerState(
        Vector3d position,
        Vector3d rotation,
        double bodyYaw,
        Vector3d velocity,
        int generation,
        long time,
        @Nullable MovementState movement,
        @Nullable SwingState swing
) {

    public LivePlayerState(Vector3d position, Vector3d rotation, double bodyYaw, Vector3d velocity, int generation,
                           long time, @Nullable MovementState movement) {
        this(position, rotation, bodyYaw, velocity, generation, time, movement, null);
    }

}
