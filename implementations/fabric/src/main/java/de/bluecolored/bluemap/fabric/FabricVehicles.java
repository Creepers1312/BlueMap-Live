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
package de.bluecolored.bluemap.fabric;

import de.bluecolored.bluemap.common.live.LiveMobState;
import net.minecraft.entity.Entity;
import net.minecraft.entity.LivingEntity;
import net.minecraft.entity.vehicle.AbstractMinecartEntity;
import net.minecraft.entity.vehicle.BoatEntity;
import net.minecraft.util.math.Vec3d;

import java.util.ArrayList;
import java.util.List;

/**
 * Boats, rafts and minecarts (not living, drawn with their own renderers): sampled with a mob-state, so the webapp
 * shows them with the mob-models (see MobTypes). The yaw is the one the vanilla renderer draws them with.
 */
final class FabricVehicles {

    private FabricVehicles() {}

    /** set if a vehicle-method is not available in this version: the details are not sampled anymore */
    private static volatile boolean detailsUnavailable = false;

    static boolean isVehicle(Entity entity) {
        return (entity instanceof BoatEntity || entity instanceof AbstractMinecartEntity) && !entity.isInvisible();
    }

    /**
     * The yaw (and pitch) the vanilla renderer draws an entity with: living entities their body-yaw
     * (LivingEntityRenderer), boats their yaw (BoatEntityRenderer), minecarts on rails the direction of the rail
     * (MinecartEntityRenderer.render: from the positions 0.3 blocks before and behind on the rail), otherwise their yaw.
     * @return {yaw, pitch} in degrees
     */
    static float[] drawnRotation(Entity entity) {
        if (entity instanceof LivingEntity living) return new float[] {living.bodyYaw, living.getPitch()};
        float yaw = entity.getYaw(), pitch = entity.getPitch();
        if (entity instanceof AbstractMinecartEntity cart && !detailsUnavailable) {
            try {
                double x = cart.getX(), y = cart.getY(), z = cart.getZ();
                Vec3d snapped = cart.snapPositionToRail(x, y, z);
                if (snapped != null) {
                    Vec3d front = cart.snapPositionToRailWithOffset(x, y, z, 0.3f);
                    Vec3d back = cart.snapPositionToRailWithOffset(x, y, z, -0.3f);
                    if (front == null) front = snapped;
                    if (back == null) back = snapped;
                    Vec3d direction = back.add(-front.x, -front.y, -front.z);
                    if (direction.length() != 0) {
                        direction = direction.normalize();
                        yaw = (float) (Math.atan2(direction.z, direction.x) * 180 / Math.PI);
                        pitch = (float) (Math.atan(direction.y) * 73);
                    }
                }
            } catch (LinkageError e) {
                detailsUnavailable = true;
            }
        }
        return new float[] {yaw, pitch};
    }

    /** the state of a boat or minecart: the drawn yaw, the boat-type and the moving paddles */
    static LiveMobState sample(Entity entity, float yaw) {
        List<String> flags = new ArrayList<>();
        String variant = null;
        if (entity instanceof BoatEntity boat && !detailsUnavailable) {
            try {
                variant = boat.getVariant().getName();
                // vanilla BoatEntity.isPaddleMoving: the paddles turn while the driver rows (tracked data)
                if (boat.isPaddleMoving(0)) flags.add("paddle_left");
                if (boat.isPaddleMoving(1)) flags.add("paddle_right");
            } catch (LinkageError e) {
                detailsUnavailable = true;
            }
        }
        return new LiveMobState(yaw, yaw, 0, 0, false, null, variant, 0,
                entity.getWidth(), entity.getHeight(), List.of(), flags);
    }

}
