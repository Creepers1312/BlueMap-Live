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

import com.flowpowered.math.vector.Vector3d;
import de.bluecolored.bluemap.common.live.LiveEntityState;
import net.minecraft.entity.Entity;
import net.minecraft.util.hit.BlockHitResult;
import net.minecraft.util.hit.HitResult;
import net.minecraft.util.math.Vec3d;
import net.minecraft.world.RaycastContext;
import org.jetbrains.annotations.Nullable;

/**
 * Predicts where a flying projectile hits a block (BlueMap Live, see docs/bluemap-live/phase-5.md): the flight is
 * simulated with the same physics the webapp uses for its prediction (move, then drag and gravity per tick) and every
 * tick-segment is ray-cast against the block-collision-shapes like vanilla projectiles do. The webapp stops its
 * prediction there instead of flying through the block until the next sample.
 */
final class FabricProjectiles {

    /** a little more than the webapp predicts at most (0.75 s = 15 ticks) */
    static final int MAX_TICKS = 16;

    private FabricProjectiles() {}

    /** the per-tick gravity of the webapp-prediction (LiveEntityData.projectilePhysics), -1: not predicted */
    static double gravity(String type) {
        return switch (type) {
            case "minecraft:arrow", "minecraft:spectral_arrow", "minecraft:trident", "minecraft:potion" -> 0.05;
            case "minecraft:experience_bottle" -> 0.07;
            case "minecraft:fireball", "minecraft:small_fireball", "minecraft:dragon_fireball", "minecraft:wither_skull",
                 "minecraft:wind_charge", "minecraft:breeze_wind_charge" -> 0;
            default -> 0.03;
        };
    }

    static double drag(String type) {
        return gravity(type) == 0 ? 1 : 0.99;
    }

    /**
     * Only call this method on the server-thread.
     * @param velocity in blocks per tick
     * @return the impact, or null if the projectile does not hit a block within {@link #MAX_TICKS}
     */
    static @Nullable LiveEntityState.Impact predictImpact(Entity entity, String type, Vec3d position, Vec3d velocity) {
        double gravity = gravity(type), drag = drag(type);
        Vec3d current = position, motion = velocity;
        for (int tick = 0; tick < MAX_TICKS; tick++) {
            Vec3d next = current.add(motion);
            BlockHitResult hit = entity.getWorld().raycast(new RaycastContext(
                    current, next, RaycastContext.ShapeType.COLLIDER, RaycastContext.FluidHandling.NONE, entity));
            if (hit.getType() != HitResult.Type.MISS) {
                Vec3d at = hit.getPos();
                double length = next.distanceTo(current);
                double fraction = length > 1e-9 ? Math.min(1, at.distanceTo(current) / length) : 0;
                return new LiveEntityState.Impact(new Vector3d(at.x, at.y, at.z), tick + fraction);
            }
            current = next;
            motion = new Vec3d(motion.x * drag, motion.y * drag - gravity, motion.z * drag);
        }
        return null;
    }

}
