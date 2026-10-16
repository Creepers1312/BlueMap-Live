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
import de.bluecolored.bluemap.common.live.LiveEffect;
import de.bluecolored.bluemap.common.live.LiveEffectLog;
import de.bluecolored.bluemap.common.live.ParticleState;
import net.minecraft.component.DataComponentTypes;
import net.minecraft.component.type.PotionContentsComponent;
import net.minecraft.entity.AreaEffectCloudEntity;
import net.minecraft.entity.Entity;
import net.minecraft.entity.LivingEntity;
import net.minecraft.entity.TntEntity;
import net.minecraft.entity.decoration.EndCrystalEntity;
import net.minecraft.entity.effect.StatusEffectInstance;
import net.minecraft.entity.mob.CreeperEntity;
import net.minecraft.entity.projectile.ExplosiveProjectileEntity;
import net.minecraft.entity.projectile.FireballEntity;
import net.minecraft.entity.projectile.WitherSkullEntity;
import net.minecraft.entity.projectile.thrown.PotionEntity;
import net.minecraft.nbt.NbtCompound;
import net.minecraft.particle.EntityEffectParticleEffect;
import net.minecraft.particle.ParticleEffect;
import net.minecraft.particle.ParticleTypes;
import net.minecraft.util.math.Vec3d;
import net.minecraft.world.GameRules;
import org.jetbrains.annotations.Nullable;

import java.util.ArrayList;
import java.util.List;

/**
 * The particles of BlueMap Live (see docs/bluemap-live/phase-10.md): what entities emit on their own (fire,
 * potion-swirls, area-effect-clouds) and the effects that happen once (explosions, splash-potions).
 * <p>Without mixins the effects are recognized when the entity that causes them is removed, with the same conditions
 * as in vanilla (CreeperEntity.explode, TntEntity.tick, FireballEntity / WitherSkullEntity.onCollision,
 * EndCrystalEntity.damage, PotionEntity.onCollision).</p>
 */
final class FabricParticles {

    private FabricParticles() {}

    /** set if a method is not available in this version: the particles are not sampled anymore */
    private static volatile boolean particlesUnavailable = false;
    private static volatile boolean effectsUnavailable = false;

    /** the particles an entity emits, null if none */
    static @Nullable ParticleState sample(Entity entity) {
        if (particlesUnavailable) return null;
        try {
            boolean onFire = entity.doesRenderOnFire();
            List<Integer> swirls = List.of();
            boolean ambient = false;
            if (entity instanceof LivingEntity living && !living.getStatusEffects().isEmpty()) {
                // vanilla LivingEntity.updatePotionSwirls / containsOnlyAmbientEffects
                swirls = new ArrayList<>();
                ambient = true;
                for (StatusEffectInstance effect : living.getStatusEffects()) {
                    if (!effect.shouldShowParticles()) continue;
                    if (!effect.isAmbient()) ambient = false;
                    if (swirls.size() < ParticleState.MAX_SWIRLS && effect.createParticle() instanceof EntityEffectParticleEffect particle)
                        swirls.add(color(particle));
                }
            }
            ParticleState.Cloud cloud = null;
            if (entity instanceof AreaEffectCloudEntity area && area.getParticleType() instanceof EntityEffectParticleEffect particle &&
                    particle.getType() == ParticleTypes.ENTITY_EFFECT) {
                cloud = new ParticleState.Cloud(area.getRadius(), color(particle), area.isWaiting());
            }
            return ParticleState.of(onFire, swirls, ambient, entity.isInvisible(), cloud);
        } catch (LinkageError ex) {
            particlesUnavailable = true;
            return null;
        }
    }

    /** the ARGB-color of the particle (vanilla EntityEffectParticleEffect.getRed/Green/Blue/Alpha) */
    private static int color(EntityEffectParticleEffect particle) {
        return Math.round(particle.getAlpha() * 255) << 24 | Math.round(particle.getRed() * 255) << 16 |
                Math.round(particle.getGreen() * 255) << 8 | Math.round(particle.getBlue() * 255);
    }

    /** area-effect-clouds are sampled for their particles (they have no model) */
    static boolean isParticleEntity(Entity entity) {
        return entity instanceof AreaEffectCloudEntity;
    }

    /**
     * Called when an entity is removed from a world (on the server-thread): adds the effect it caused to the log.
     * @return the added effect, or null if the entity caused none
     */
    static @Nullable LiveEffect onRemoved(Entity entity, LiveEffectLog log, long now) {
        if (effectsUnavailable) return null;
        Entity.RemovalReason reason = entity.getRemovalReason();
        if (reason == null) return null;
        try {
            if (reason == Entity.RemovalReason.DISCARDED) {
                // CreeperEntity.tick / explode: discarded with currentFuseTime = fuseTime, so
                // getClientFuseTime(1) = currentFuseTime / (fuseTime - 2) is fuseTime / (fuseTime - 2)
                // (fuseTime and explosionRadius from writeCustomDataToNbt: "Fuse", "ExplosionRadius")
                if (entity instanceof CreeperEntity creeper && creeper.getClientFuseTime(1f) > 1f) {
                    NbtCompound nbt = new NbtCompound();
                    creeper.writeNbt(nbt);
                    int fuseTime = nbt.getShort("Fuse");
                    if (fuseTime > 2 && creeper.getClientFuseTime(1f) * (fuseTime - 2) >= fuseTime - 0.01f) {
                        double power = nbt.getByte("ExplosionRadius") * (creeper.shouldRenderOverlay() ? 2.0 : 1.0);
                        return explosion(log, entity.getPos(), power, mobGriefing(entity), now);
                    }
                    return null;
                }
                // TntEntity.tick: discarded when the fuse reaches 0, explodes at getBodyY(0.0625) with power 4
                // (ExplosionSourceType.TNT destroys blocks)
                if (entity instanceof TntEntity tnt && tnt.getFuse() <= 0) {
                    return explosion(log, new Vec3d(tnt.getX(), tnt.getBodyY(0.0625), tnt.getZ()), 4, true, now);
                }
                // FireballEntity / WitherSkullEntity.onCollision; ExplosiveProjectileEntity.tick also discards them
                // without an explosion when the owner was removed or the chunk is not loaded
                if (entity instanceof FireballEntity || entity instanceof WitherSkullEntity) {
                    ExplosiveProjectileEntity projectile = (ExplosiveProjectileEntity) entity;
                    Entity owner = projectile.getOwner();
                    if ((owner != null && owner.isRemoved()) || !entity.getWorld().isChunkLoaded(entity.getBlockPos())) return null;
                    if (entity instanceof FireballEntity fireball) {
                        NbtCompound nbt = new NbtCompound();
                        fireball.writeNbt(nbt);
                        return explosion(log, entity.getPos(), nbt.getByte("ExplosionPower"), mobGriefing(entity), now);
                    }
                    return explosion(log, entity.getPos(), 1, false, now);
                }
                // PotionEntity.onCollision: world-event 2007 (instant effect) or 2002 at the block-position with the color
                if (entity instanceof PotionEntity potion && entity.getY() > entity.getWorld().getBottomY() - 64) {
                    PotionContentsComponent contents = potion.getStack().getOrDefault(DataComponentTypes.POTION_CONTENTS,
                            PotionContentsComponent.DEFAULT);
                    boolean instant = contents.potion().isPresent() && contents.potion().get().value().hasInstantEffect();
                    Vec3d center = Vec3d.ofBottomCenter(entity.getBlockPos());
                    return log.add(instant ? LiveEffect.INSTANT_SPLASH : LiveEffect.SPLASH, toVector(center), 0, false,
                            contents.getColor(), now);
                }
            }
            // EndCrystalEntity.damage: removed as KILLED, explodes with power 6 (ExplosionSourceType.BLOCK destroys
            // blocks); not when the damage was an explosion itself (that is not known here, chain-reactions show an
            // explosion for every crystal)
            if (reason == Entity.RemovalReason.KILLED && entity instanceof EndCrystalEntity) {
                return explosion(log, entity.getPos(), 6, true, now);
            }
        } catch (LinkageError ex) {
            effectsUnavailable = true;
        }
        return null;
    }

    private static boolean mobGriefing(Entity entity) {
        return entity.getWorld().getGameRules().getBoolean(GameRules.DO_MOB_GRIEFING);
    }

    private static LiveEffect explosion(LiveEffectLog log, Vec3d position, double power, boolean destroy, long now) {
        return log.add(LiveEffect.EXPLOSION, toVector(position), power, destroy, 0, now);
    }

    private static Vector3d toVector(Vec3d vec) {
        return new Vector3d(vec.x, vec.y, vec.z);
    }

}
