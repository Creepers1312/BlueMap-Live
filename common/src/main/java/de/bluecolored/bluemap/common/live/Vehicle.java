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
 * The vehicle a player rides (horse, boat, minecart, ...), so the webapp can draw the player on the drawn vehicle
 * instead of interpolating both separately (their samples are taken at different ticks).
 * <p>The offset and the angles are relative to the yaw the vehicle is drawn with (living vehicles: the body-yaw,
 * others: the yaw): offset = the position of the player minus the position of the vehicle (same tick), rotated
 * by that yaw into the frame of the vehicle (see {@link #toLocal}).</p>
 *
 * @param entityId the id of the vehicle-entity (as in the live entities)
 * @param offset the offset of the player (feet) in the frame of the vehicle, in blocks
 * @param bodyYaw the body-yaw of the player relative to the vehicle-yaw, degrees
 * @param headYaw the head-yaw of the player relative to the vehicle-yaw, degrees
 */
public record Vehicle(int entityId, Vector3d offset, float bodyYaw, float headYaw) {

    /**
     * @param dx the world-offset x (player - vehicle)
     * @param dz the world-offset z
     * @param vehicleYaw degrees (minecraft convention)
     * @return the offset in the frame of the vehicle; the webapp turns it back with
     * x = lx * cos(yaw) - lz * sin(yaw), z = lx * sin(yaw) + lz * cos(yaw)
     */
    public static Vector3d toLocal(double dx, double dy, double dz, double vehicleYaw) {
        double yaw = Math.toRadians(vehicleYaw);
        double cos = Math.cos(yaw), sin = Math.sin(yaw);
        return new Vector3d(dx * cos + dz * sin, dy, -dx * sin + dz * cos);
    }

    /** an angle relative to the vehicle-yaw, wrapped to -180..180 degrees */
    public static float relativeYaw(float yaw, float vehicleYaw) {
        float wrapped = (yaw - vehicleYaw) % 360;
        if (wrapped >= 180) wrapped -= 360;
        if (wrapped < -180) wrapped += 360;
        return wrapped;
    }

}
