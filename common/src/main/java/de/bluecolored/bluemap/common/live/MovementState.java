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

/**
 * Movement-flags of a player, as known by the server.
 *
 * @param riding the player sits on a vehicle (vanilla hasVehicle: horse, boat, minecart, ...)
 */
public record MovementState(
        boolean sneaking,
        boolean sprinting,
        boolean onGround,
        boolean swimming,
        boolean flying,
        boolean fallFlying,
        boolean riding
) {

    public MovementState(boolean sneaking, boolean sprinting, boolean onGround, boolean swimming, boolean flying, boolean fallFlying) {
        this(sneaking, sprinting, onGround, swimming, flying, fallFlying, false);
    }

    /**
     * vanilla LivingEntityRenderer.render: the body of a passenger of a living vehicle follows the body of the vehicle,
     * the head may differ by at most 85 degrees (beyond 50 degrees the body is turned by 0.2 of the difference)
     * @return the rendered body-yaw in degrees
     */
    public static float passengerBodyYaw(float headYaw, float vehicleBodyYaw) {
        float difference = wrapDegrees(headYaw - vehicleBodyYaw);
        if (difference < -85) difference = -85;
        if (difference >= 85) difference = 85;
        float bodyYaw = headYaw - difference;
        if (difference * difference > 2500) bodyYaw += difference * 0.2f;
        return bodyYaw;
    }

    private static float wrapDegrees(float degrees) {
        float wrapped = degrees % 360;
        if (wrapped >= 180) wrapped -= 360;
        if (wrapped < -180) wrapped += 360;
        return wrapped;
    }

}
