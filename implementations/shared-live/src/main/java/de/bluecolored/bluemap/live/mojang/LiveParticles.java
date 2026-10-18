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

import com.flowpowered.math.vector.Vector3d;
import de.bluecolored.bluemap.common.live.LiveEffect;
import de.bluecolored.bluemap.common.live.LiveEffectLog;
import de.bluecolored.bluemap.common.live.ParticleState;
import org.jetbrains.annotations.Nullable;

import java.util.ArrayList;
import java.util.List;
import net.minecraft.core.component.DataComponents;
import net.minecraft.core.particles.ColorParticleOption;
import net.minecraft.core.particles.ParticleTypes;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.world.effect.MobEffectInstance;
import net.minecraft.world.entity.AreaEffectCloud;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.LivingEntity;
import net.minecraft.world.entity.boss.enderdragon.EndCrystal;
import net.minecraft.world.entity.item.PrimedTnt;
import net.minecraft.world.entity.monster.Creeper;
import net.minecraft.world.entity.projectile.AbstractHurtingProjectile;
import net.minecraft.world.entity.projectile.LargeFireball;
import net.minecraft.world.entity.projectile.ThrownPotion;
import net.minecraft.world.entity.projectile.WitherSkull;
import net.minecraft.world.item.alchemy.PotionContents;
import net.minecraft.world.level.GameRules;
import net.minecraft.world.phys.Vec3;

/**
 * The particles of BlueMap Live (see docs/bluemap-live/phase-10.md): what entities emit on their own (fire,
 * potion-swirls, area-effect-clouds) and the effects that happen once (explosions, splash-potions).
 * <p>Without mixins the effects are recognized when the entity that causes them is removed, with the same conditions
 * as in vanilla (CreeperEntity.explode, TntEntity.tick, FireballEntity / WitherSkullEntity.onCollision,
 * EndCrystalEntity.damage, PotionEntity.onCollision).</p>
 */
final class LiveParticles {

    private LiveParticles() {}

    /** set if a method is not available in this version: the particles are not sampled anymore */
    private static volatile boolean particlesUnavailable = false;
    private static volatile boolean effectsUnavailable = false;

    /** the particles an entity emits, null if none */
    static @Nullable ParticleState sample(Entity entity) {
        if (particlesUnavailable) return null;
        try {
            boolean onFire = entity.displayFireAnimation();
            List<Integer> swirls = List.of();
            boolean ambient = false;
            if (entity instanceof LivingEntity living && !living.getActiveEffects().isEmpty()) {
                // vanilla LivingEntity.updatePotionSwirls / containsOnlyAmbientEffects
                swirls = new ArrayList<>();
                ambient = true;
                for (MobEffectInstance effect : living.getActiveEffects()) {
                    if (!effect.isVisible()) continue;
                    if (!effect.isAmbient()) ambient = false;
                    if (swirls.size() < ParticleState.MAX_SWIRLS && effect.getParticleOptions() instanceof ColorParticleOption particle)
                        swirls.add(color(particle));
                }
            }
            ParticleState.Cloud cloud = null;
            if (entity instanceof AreaEffectCloud area && area.getParticle() instanceof ColorParticleOption particle &&
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
    private static int color(ColorParticleOption particle) {
        return Math.round(particle.getAlpha() * 255) << 24 | Math.round(particle.getRed() * 255) << 16 |
                Math.round(particle.getGreen() * 255) << 8 | Math.round(particle.getBlue() * 255);
    }

    /** area-effect-clouds are sampled for their particles (they have no model) */
    static boolean isParticleEntity(Entity entity) {
        return entity instanceof AreaEffectCloud;
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
                if (entity instanceof Creeper creeper && creeper.getSwelling(1f) > 1f) {
                    CompoundTag nbt = new CompoundTag();
                    creeper.saveWithoutId(nbt);
                    int fuseTime = nbt.getShort("Fuse");
                    if (fuseTime > 2 && creeper.getSwelling(1f) * (fuseTime - 2) >= fuseTime - 0.01f) {
                        double power = nbt.getByte("ExplosionRadius") * (creeper.isPowered() ? 2.0 : 1.0);
                        return explosion(log, entity.position(), power, mobGriefing(entity), now);
                    }
                    return null;
                }
                // TntEntity.tick: discarded when the fuse reaches 0, explodes at getBodyY(0.0625) with power 4
                // (ExplosionSourceType.TNT destroys blocks)
                if (entity instanceof PrimedTnt tnt && tnt.getFuse() <= 0) {
                    return explosion(log, new Vec3(tnt.getX(), tnt.getY(0.0625), tnt.getZ()), 4, true, now);
                }
                // FireballEntity / WitherSkullEntity.onCollision; ExplosiveProjectileEntity.tick also discards them
                // without an explosion when the owner was removed or the chunk is not loaded
                if (entity instanceof LargeFireball || entity instanceof WitherSkull) {
                    AbstractHurtingProjectile projectile = (AbstractHurtingProjectile) entity;
                    Entity owner = projectile.getOwner();
                    if ((owner != null && owner.isRemoved()) || !entity.level().hasChunkAt(entity.blockPosition())) return null;
                    if (entity instanceof LargeFireball fireball) {
                        CompoundTag nbt = new CompoundTag();
                        fireball.saveWithoutId(nbt);
                        return explosion(log, entity.position(), nbt.getByte("ExplosionPower"), mobGriefing(entity), now);
                    }
                    return explosion(log, entity.position(), 1, false, now);
                }
                // PotionEntity.onCollision: world-event 2007 (instant effect) or 2002 at the block-position with the color
                if (entity instanceof ThrownPotion potion && entity.getY() > entity.level().getMinBuildHeight() - 64) {
                    PotionContents contents = potion.getItem().getOrDefault(DataComponents.POTION_CONTENTS,
                            PotionContents.EMPTY);
                    // the potion-component, like ThrownPotion.onHit
                    boolean instant = contents.potion().isPresent() && contents.potion().get().value().hasInstantEffects();
                    Vec3 center = Vec3.atBottomCenterOf(entity.blockPosition());
                    return log.add(instant ? LiveEffect.INSTANT_SPLASH : LiveEffect.SPLASH, toVector(center), 0, false,
                            contents.getColor(), now);
                }
            }
            // EndCrystalEntity.damage: removed as KILLED, explodes with power 6 (ExplosionSourceType.BLOCK destroys
            // blocks); not when the damage was an explosion itself (that is not known here, chain-reactions show an
            // explosion for every crystal)
            if (reason == Entity.RemovalReason.KILLED && entity instanceof EndCrystal) {
                return explosion(log, entity.position(), 6, true, now);
            }
        } catch (LinkageError ex) {
            effectsUnavailable = true;
        }
        return null;
    }

    private static boolean mobGriefing(Entity entity) {
        return entity.level().getGameRules().getBoolean(GameRules.RULE_MOBGRIEFING);
    }

    private static LiveEffect explosion(LiveEffectLog log, Vec3 position, double power, boolean destroy, long now) {
        return log.add(LiveEffect.EXPLOSION, toVector(position), power, destroy, 0, now);
    }

    private static Vector3d toVector(Vec3 vec) {
        return new Vector3d(vec.x, vec.y, vec.z);
    }

}
