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
package de.bluecolored.bluemap.live.mojang;

import de.bluecolored.bluemap.common.live.Leash;
import de.bluecolored.bluemap.common.live.LiveMobState;
import de.bluecolored.bluemap.common.live.Vehicle;
import org.jetbrains.annotations.Nullable;

import java.util.ArrayList;
import java.util.List;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.Leashable;
import net.minecraft.world.entity.LivingEntity;
import net.minecraft.world.entity.decoration.LeashFenceKnotEntity;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.entity.vehicle.AbstractMinecart;
import net.minecraft.world.entity.vehicle.Boat;
import net.minecraft.world.phys.Vec3;

/**
 * Boats, rafts and minecarts (not living, drawn with their own renderers): sampled with a mob-state, so the webapp
 * shows them with the mob-models (see MobTypes). The yaw is the one the vanilla renderer draws them with.
 */
final class LiveVehicles {

    private LiveVehicles() {}

    /** set if a vehicle-method is not available in this version: the details are not sampled anymore */
    private static volatile boolean detailsUnavailable = false;

    /** boats, minecarts and the knots of leashes on fences (vanilla LeashKnotEntityRenderer) */
    static boolean isVehicle(Entity entity) {
        return (entity instanceof Boat || entity instanceof AbstractMinecart || entity instanceof LeashFenceKnotEntity) &&
                !entity.isInvisible();
    }

    /** set if a leash-method is not available in this version: leashes are not sampled anymore */
    private static volatile boolean leashUnavailable = false;

    /**
     * The leash of an entity, both ends as vanilla EntityRenderer.renderLeash computes them (tick-progress 1):
     * at the entity its getLeashOffset turned by lerpYaw + 90 degrees, at the holder its getLeashPos. Each end is given
     * relative to its entity in the frame of the drawn yaw (see drawnRotation), so the webapp can follow both.
     */
    static @Nullable Leash leash(Entity entity) {
        if (leashUnavailable || !(entity instanceof Leashable leashable)) return null;
        try {
            Entity holder = leashable.getLeashHolder();
            if (holder == null) return null;
            double yaw = entity.getPreciseBodyRotation(1f) * Math.PI / 180 + Math.PI / 2;
            Vec3 offset = entity.getLeashOffset(1f);
            double dx = Math.cos(yaw) * offset.z + Math.sin(yaw) * offset.x;
            double dz = Math.sin(yaw) * offset.z - Math.cos(yaw) * offset.x;
            Vec3 end = holder.getRopeHoldPosition(1f), holderPos = holder.position();
            return new Leash(
                    holder instanceof Player ? null : holder.getId(),
                    holder instanceof Player ? holder.getUUID() : null,
                    Vehicle.toLocal(dx, offset.y, dz, drawnRotation(entity)[0]),
                    Vehicle.toLocal(end.x - holderPos.x, end.y - holderPos.y, end.z - holderPos.z, drawnRotation(holder)[0])
            );
        } catch (LinkageError e) {
            leashUnavailable = true;
            return null;
        }
    }

    /**
     * The yaw (and pitch) the vanilla renderer draws an entity with: living entities their body-yaw
     * (LivingEntityRenderer), boats their yaw (BoatEntityRenderer), minecarts on rails the direction of the rail
     * (MinecartEntityRenderer.render: from the positions 0.3 blocks before and behind on the rail), otherwise their yaw.
     * @return {yaw, pitch} in degrees
     */
    static float[] drawnRotation(Entity entity) {
        if (entity instanceof LivingEntity living) return new float[] {living.yBodyRot, living.getXRot()};
        float yaw = entity.getYRot(), pitch = entity.getXRot();
        if (entity instanceof AbstractMinecart cart && !detailsUnavailable) {
            try {
                double x = cart.getX(), y = cart.getY(), z = cart.getZ();
                Vec3 snapped = cart.getPos(x, y, z);
                if (snapped != null) {
                    Vec3 front = cart.getPosOffs(x, y, z, 0.3f);
                    Vec3 back = cart.getPosOffs(x, y, z, -0.3f);
                    if (front == null) front = snapped;
                    if (back == null) back = snapped;
                    Vec3 direction = back.add(-front.x, -front.y, -front.z);
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
        if (entity instanceof Boat boat && !detailsUnavailable) {
            try {
                variant = boat.getVariant().getName();
                // vanilla BoatEntity.isPaddleMoving: the paddles turn while the driver rows (tracked data)
                if (boat.getPaddleState(0)) flags.add("paddle_left");
                if (boat.getPaddleState(1)) flags.add("paddle_right");
            } catch (LinkageError e) {
                detailsUnavailable = true;
            }
        }
        return new LiveMobState(yaw, yaw, 0, 0, false, null, variant, 0,
                entity.getBbWidth(), entity.getBbHeight(), List.of(), flags);
    }

}
