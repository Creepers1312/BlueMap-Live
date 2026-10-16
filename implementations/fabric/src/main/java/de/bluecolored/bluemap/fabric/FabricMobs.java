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

import de.bluecolored.bluemap.common.live.Armor;
import de.bluecolored.bluemap.common.live.Equipment;
import de.bluecolored.bluemap.common.live.HeldItem;
import de.bluecolored.bluemap.common.live.LiveMobState;
import de.bluecolored.bluemap.core.logger.Logger;
import net.minecraft.block.BlockState;
import net.minecraft.entity.Entity;
import net.minecraft.entity.VariantHolder;
import net.minecraft.entity.mob.Angerable;
import net.minecraft.entity.passive.HorseEntity;
import net.minecraft.entity.passive.AbstractHorseEntity;
import net.minecraft.entity.passive.AbstractDonkeyEntity;
import net.minecraft.entity.passive.StriderEntity;
import net.minecraft.entity.passive.BeeEntity;
import net.minecraft.entity.passive.PandaEntity;
import net.minecraft.entity.passive.ArmadilloEntity;
import net.minecraft.entity.passive.CamelEntity;
import net.minecraft.entity.passive.CatEntity;
import net.minecraft.entity.passive.FoxEntity;
import net.minecraft.entity.passive.PolarBearEntity;
import net.minecraft.entity.passive.PufferfishEntity;
import net.minecraft.entity.passive.TropicalFishEntity;
import net.minecraft.entity.passive.WolfEntity;
import net.minecraft.entity.passive.LlamaEntity;
import net.minecraft.item.AnimalArmorItem;
import net.minecraft.item.ItemStack;
import net.minecraft.registry.tag.ItemTags;
import net.minecraft.component.type.DyedColorComponent;
import net.minecraft.util.DyeColor;
import net.minecraft.util.math.Direction;
import net.minecraft.entity.EntityPose;
import net.minecraft.entity.mob.IllagerEntity;
import net.minecraft.entity.mob.GhastEntity;
import net.minecraft.entity.mob.VexEntity;
import net.minecraft.entity.mob.BoggedEntity;
import net.minecraft.entity.passive.TameableEntity;
import net.minecraft.registry.entry.RegistryEntry;
import net.minecraft.util.StringIdentifiable;
import net.minecraft.entity.LivingEntity;
import net.minecraft.entity.decoration.ArmorStandEntity;
import net.minecraft.entity.mob.AbstractPiglinEntity;
import net.minecraft.entity.mob.CreeperEntity;
import net.minecraft.entity.mob.EndermanEntity;
import net.minecraft.entity.mob.Hoglin;
import net.minecraft.entity.mob.HostileEntity;
import net.minecraft.entity.mob.MobEntity;
import net.minecraft.entity.mob.RavagerEntity;
import net.minecraft.entity.passive.IronGolemEntity;
import net.minecraft.util.Hand;
import net.minecraft.entity.mob.SlimeEntity;
import net.minecraft.entity.mob.ZombieVillagerEntity;
import net.minecraft.entity.passive.MooshroomEntity;
import net.minecraft.entity.passive.PigEntity;
import net.minecraft.entity.passive.SheepEntity;
import net.minecraft.entity.passive.VillagerEntity;
import net.minecraft.entity.player.PlayerEntity;
import net.minecraft.util.Arm;
import net.minecraft.village.VillagerData;
import org.jetbrains.annotations.Nullable;

import java.util.ArrayList;
import java.util.List;
import java.util.regex.Pattern;

/**
 * Samples the state of living entities (mobs) for the live-data (BlueMap Live, see docs/bluemap-live/phase-6.md).
 * Only reads synchronized entity-state (the same that the client gets), on the server-thread.
 */
final class FabricMobs {

    private static final Pattern NAME = Pattern.compile("[a-z0-9_.-]+");
    private static final Pattern NAME_OR_PATH = Pattern.compile("[a-z0-9_-]+(/[a-z0-9_-]+)*");

    private FabricMobs() {}

    /** living entities that are shown: no players (own markers), no armor-stands, nothing invisible */
    static boolean isLiveMob(Entity entity) {
        return entity instanceof LivingEntity && !(entity instanceof PlayerEntity) &&
                !(entity instanceof ArmorStandEntity) && !entity.isInvisible();
    }

    /**
     * set if a type-specific method is not available (e.g. only on the client in this version): the details of
     * that type are not sampled anymore instead of failing every tick
     */
    private static volatile boolean detailsUnavailable = false;
    private static volatile boolean attackUnavailable = false;

    static LiveMobState sample(LivingEntity entity) {
        List<String> flags = new ArrayList<>();
        List<String> models = new ArrayList<>();
        String[] variant = {null};
        int[] size = {0};

        if (entity instanceof MobEntity mob && mob.isAttacking()) flags.add("attacking");
        // riding (jockeys, mobs in boats and minecarts): the body follows a living vehicle like in LivingEntityRenderer
        if (entity.hasVehicle()) flags.add("riding");
        float bodyYaw = entity.getVehicle() instanceof LivingEntity vehicle ?
                de.bluecolored.bluemap.common.live.MovementState.passengerBodyYaw(entity.getHeadYaw(), vehicle.bodyYaw) : entity.bodyYaw;
        if (!detailsUnavailable) {
            try {
                sampleDetails(entity, flags, variant, size, models);
            } catch (LinkageError error) {
                detailsUnavailable = true;
                Logger.global.logWarning("BlueMap Live: mob-details are not available: " + error);
            }
        }

        // the visible attack: the hand-swing (only hostile mobs advance it on the server: HostileEntity.tickMovement)
        // and the attack-timers the vanilla models animate
        int swingTicks = -1, attackTicks = 0;
        double bedOffset = entity.isInPose(EntityPose.SLEEPING) ? entity.getEyeHeight(EntityPose.STANDING) - 0.1 : 0;
        if (!attackUnavailable) {
            try {
                if (entity instanceof HostileEntity && entity.handSwinging) {
                    swingTicks = Math.max(entity.handSwingTicks, 0);
                    if (entity.preferredHand == Hand.OFF_HAND) flags.add("swing_off_hand");
                }
                if (entity instanceof IronGolemEntity golem) attackTicks = golem.getAttackTicksLeft();
                else if (entity instanceof RavagerEntity ravager) attackTicks = ravager.getAttackTick();
                else if (entity instanceof Hoglin hoglin) attackTicks = hoglin.getMovementCooldownTicks();
            } catch (LinkageError error) {
                attackUnavailable = true;
                Logger.global.logWarning("BlueMap Live: mob-attacks are not available: " + error);
            }
        }

        HeldItem mainHand = FabricPlayer.toHeldItem(entity.getMainHandStack());
        HeldItem offHand = FabricPlayer.toHeldItem(entity.getOffHandStack());
        Armor armor = FabricArmor.sample(entity);
        HeldItem head = FabricArmor.headItem(entity);
        Equipment equipment = mainHand != null || offHand != null || !armor.isEmpty() || head != null ?
                new Equipment(mainHand, offHand, entity.getMainArm() == Arm.LEFT, false, armor, head) : null;

        return new LiveMobState(
                bodyYaw,
                entity.getHeadYaw(),
                Math.max(entity.hurtTime, 0),
                Math.max(entity.deathTime, 0),
                entity.isBaby(),
                equipment,
                variant[0] != null && NAME_OR_PATH.matcher(variant[0]).matches() ? variant[0] : null,
                size[0],
                entity.getWidth(),
                entity.getHeight(),
                models,
                flags,
                swingTicks,
                Math.max(attackTicks, 0),
                bedOffset
        );
    }

    private static void sampleDetails(LivingEntity entity, List<String> flags, String[] variant, int[] size, List<String> models) {
        if (entity instanceof SheepEntity sheep) {
            variant[0] = sheep.getColor().getName();
            if (sheep.isSheared()) flags.add("sheared");
        } else if (entity instanceof MooshroomEntity mooshroom) {
            variant[0] = mooshroom.getVariant().asString();
            // vanilla MooshroomMushroomFeatureRenderer: the block-model of the mushroom-state of the variant
            String mushroom = blockModel(mooshroom.getVariant().getMushroomState());
            if (mushroom != null) models.add(mushroom);
        } else if (entity instanceof PigEntity pig) {
            if (pig.isSaddled()) flags.add("saddled");
        } else if (entity instanceof CreeperEntity creeper) {
            if (creeper.shouldRenderOverlay()) flags.add("charged");
            if (creeper.getFuseSpeed() > 0) flags.add("fusing");
        } else if (entity instanceof SlimeEntity slime) { // also magma cubes
            size[0] = slime.getSize();
        } else if (entity instanceof EndermanEntity enderman) {
            if (enderman.isAngry()) flags.add("angry");
            BlockState carried = enderman.getCarriedBlock();
            if (carried != null) {
                flags.add("carrying");
                // vanilla EndermanBlockFeatureRenderer: the carried block
                String block = blockModel(carried);
                if (block != null) models.add(block);
            }
        } else if (entity instanceof VillagerEntity villager) {
            variant[0] = villagerVariant(villager.getVillagerData());
        } else if (entity instanceof ZombieVillagerEntity zombieVillager) {
            variant[0] = villagerVariant(zombieVillager.getVillagerData());
        } else if (entity instanceof HorseEntity horse) {
            variant[0] = name(horse.getVariant()) + "/" + name(horse.getMarking());
        } else if (entity instanceof AbstractPiglinEntity piglin) {
            switch (piglin.getActivity()) {
                case ADMIRING_ITEM -> flags.add("admiring");
                case DANCING -> flags.add("dancing");
                case ATTACKING_WITH_MELEE_WEAPON -> flags.add("melee");
                case CROSSBOW_HOLD -> flags.add("crossbow_hold");
                case CROSSBOW_CHARGE -> flags.add("crossbow_charge");
                default -> {}
            }
        } else if (entity instanceof PandaEntity panda) {
            variant[0] = name(panda.getProductGene());
        } else if (entity instanceof VariantHolder<?> holder) {
            // cat, wolf, frog, axolotl, fox, llama, parrot, rabbit, tropical fish, ...: the name of the variant
            variant[0] = name(holder.getVariant());
        }

        // states of further mobs that change the model, the texture or the animation
        if (entity instanceof AbstractHorseEntity horse && horse.isSaddled()) flags.add("saddled");
        if (entity instanceof AbstractDonkeyEntity donkey && donkey.hasChest()) flags.add("chest");
        if (entity instanceof StriderEntity strider) {
            if (strider.isSaddled()) flags.add("saddled");
            if (strider.isCold()) flags.add("cold");
        }
        if (entity instanceof IllagerEntity illager) flags.add("illager_" + illager.getState().name().toLowerCase(java.util.Locale.ROOT));
        if (entity instanceof BeeEntity bee) {
            if (bee.hasNectar()) flags.add("nectar");
            if (bee.hasStung()) flags.add("stung");
        }
        if (entity instanceof GhastEntity ghast && ghast.isShooting()) flags.add("shooting");
        if (entity instanceof VexEntity vex && vex.isCharging()) flags.add("charging");
        if (entity instanceof BoggedEntity bogged && bogged.isSheared()) flags.add("sheared");

        // common states that change the model or the texture
        if (entity instanceof TameableEntity tameable) {
            if (tameable.isTamed()) flags.add("tame");
            if (tameable.isInSittingPose()) flags.add("sitting");
        }
        if (entity instanceof Angerable angerable && angerable.hasAngerTime()) flags.add("angry");

        // poses: lying in a bed (vanilla LivingEntityRenderer: EntityPose.SLEEPING with the direction of the bed),
        // the fox sleeping on the ground, sitting, lying
        if (entity.isInPose(EntityPose.SLEEPING)) {
            flags.add("in_bed");
            Direction direction = entity.getSleepingDirection();
            if (direction != null) flags.add("bed_" + direction.asString());
        }
        if (entity instanceof FoxEntity fox && fox.isSleeping()) flags.add("sleeping");
        if (entity instanceof FoxEntity fox && fox.isSitting()) flags.add("sitting");
        if (entity instanceof CatEntity cat) {
            if (cat.isInSleepingPose()) flags.add("lying");
            if (cat.getHeadDownAnimation(1f) > 0) flags.add("head_down");
        }
        if (entity instanceof PandaEntity panda) {
            if (panda.isSitting()) flags.add("sitting");
            if (panda.isLyingOnBack()) flags.add("lying_on_back");
            if (panda.isEating()) flags.add("eating");
        }
        if (entity instanceof PolarBearEntity bear && bear.isWarning()) flags.add("warning");
        if (entity instanceof ArmadilloEntity armadillo && armadillo.isRolledUp()) flags.add("rolled_up");
        if (entity instanceof CamelEntity camel && camel.isSitting()) flags.add("sitting");
        // vanilla TropicalFishEntityRenderer and TropicalFishColorFeatureRenderer: the body and the pattern are tinted
        if (entity instanceof TropicalFishEntity fish) {
            flags.add("base_" + fish.getBaseColorComponents().getName());
            flags.add("pattern_" + fish.getPatternColorComponents().getName());
        }
        // vanilla Wolf/CatCollarFeatureRenderer: the collar of tamed wolves and cats in its dye-color
        if (entity instanceof WolfEntity wolf && wolf.isTamed()) flags.add("collar_" + wolf.getCollarColor().getName());
        if (entity instanceof CatEntity cat && cat.isTamed()) flags.add("collar_" + cat.getCollarColor().getName());
        // vanilla LlamaDecorFeatureRenderer: the carpet (the trader-llama has its own decor without one)
        if (entity instanceof LlamaEntity llama) {
            DyeColor carpet = llama.getCarpetColor();
            if (carpet != null) flags.add("carpet_" + carpet.getName());
            else if (llama.isTrader()) flags.add("carpet_trader");
        }
        // vanilla HorseArmorFeatureRenderer: equestrian armor, dyeable (leather) with its color
        if (entity instanceof HorseEntity horse) {
            ItemStack armor = horse.getBodyArmor();
            if (armor.getItem() instanceof AnimalArmorItem armorItem && armorItem.getType() == AnimalArmorItem.Type.EQUESTRIAN) {
                String texture = armorItem.getEntityTexture().getPath();
                String prefix = "textures/entity/horse/armor/horse_armor_";
                if (texture.startsWith(prefix) && texture.endsWith(".png")) {
                    flags.add("armor_" + texture.substring(prefix.length(), texture.length() - 4));
                    if (armor.isIn(ItemTags.DYEABLE)) {
                        flags.add(String.format("armor_color_%06x", DyedColorComponent.getColor(armor, -6265536) & 0xFFFFFF));
                    }
                }
            }
        }
        // vanilla PufferfishEntityRenderer: the model of the puff-state
        if (entity instanceof PufferfishEntity pufferfish && pufferfish.getPuffState() > 0) {
            flags.add("puff_" + Math.min(2, pufferfish.getPuffState()));
        }
    }

    /** the name of a variant: registry-key-path, StringIdentifiable or enum-name (lower case) */
    private static @Nullable String name(@Nullable Object variant) {
        if (variant == null) return null;
        if (variant instanceof RegistryEntry<?> entry) return entry.getKey().map(key -> key.getValue().getPath()).orElse(null);
        if (variant instanceof StringIdentifiable identifiable) return identifiable.asString();
        if (variant instanceof Enum<?> e) return e.name().toLowerCase(java.util.Locale.ROOT);
        return null;
    }

    /** the default block-model of a block-state: "minecraft:block/red_mushroom" (the webapp falls back to the item-model) */
    private static @Nullable String blockModel(BlockState state) {
        return state.getRegistryEntry().getKey()
                .map(key -> key.getValue().getNamespace() + ":block/" + key.getValue().getPath())
                .orElse(null);
    }

    /** "type/profession/level", e.g. "plains/farmer/2" (type and profession print their name) */
    private static @Nullable String villagerVariant(VillagerData data) {
        String type = data.getType().toString();
        String profession = data.getProfession().toString();
        if (!NAME.matcher(type).matches() || !NAME.matcher(profession).matches()) return null;
        return type + "/" + profession + "/" + data.getLevel();
    }

}
