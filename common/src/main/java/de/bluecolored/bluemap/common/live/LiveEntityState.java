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
 * An immutable snapshot of an entity (that is not a player) for the live-data.
 *
 * @param id the (network-)id of the entity, unique within the world while the entity exists
 * @param type the entity-type-id, e.g. <code>minecraft:item</code>
 * @param position the position of the entity
 * @param yaw the yaw in degrees (minecraft convention)
 * @param pitch the pitch in degrees (minecraft convention)
 * @param velocity the velocity in blocks per second
 * @param time the time (epoch-millis) when this state was sampled
 * @param item the item of the entity (dropped items, thrown items, arrows), or null
 * @param onGround if the entity is on the ground
 * @param mob the state of a living entity (mob), null for other entities
 * @param impact where a flying projectile will hit a block (computed by the server), null if unknown or none
 */
public record LiveEntityState(
        int id,
        String type,
        Vector3d position,
        double yaw,
        double pitch,
        Vector3d velocity,
        long time,
        @Nullable HeldItem item,
        boolean onGround,
        @Nullable LiveMobState mob,
        @Nullable Impact impact
) {

    /**
     * The predicted impact of a flying projectile on a block.
     *
     * @param position the position where the projectile hits the block
     * @param ticks the ticks (with fraction) from the sample until the impact
     */
    public record Impact(Vector3d position, double ticks) {}

    public LiveEntityState(int id, String type, Vector3d position, double yaw, double pitch, Vector3d velocity,
                           long time, @Nullable HeldItem item, boolean onGround) {
        this(id, type, position, yaw, pitch, velocity, time, item, onGround, null, null);
    }

    public LiveEntityState(int id, String type, Vector3d position, double yaw, double pitch, Vector3d velocity,
                           long time, @Nullable HeldItem item, boolean onGround, @Nullable LiveMobState mob) {
        this(id, type, position, yaw, pitch, velocity, time, item, onGround, mob, null);
    }

}
