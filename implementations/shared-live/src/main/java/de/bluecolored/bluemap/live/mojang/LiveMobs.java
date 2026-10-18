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

import de.bluecolored.bluemap.common.live.Armor;
import de.bluecolored.bluemap.common.live.Equipment;
import de.bluecolored.bluemap.common.live.HeldItem;
import de.bluecolored.bluemap.common.live.LiveMobState;
import de.bluecolored.bluemap.core.logger.Logger;
import org.jetbrains.annotations.Nullable;

import java.util.ArrayList;
import java.util.List;
import java.util.regex.Pattern;
import net.minecraft.core.Direction;
import net.minecraft.core.Holder;
import net.minecraft.tags.ItemTags;
import net.minecraft.util.StringRepresentable;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.HumanoidArm;
import net.minecraft.world.entity.LivingEntity;
import net.minecraft.world.entity.Mob;
import net.minecraft.world.entity.NeutralMob;
import net.minecraft.world.entity.Pose;
import net.minecraft.world.entity.TamableAnimal;
import net.minecraft.world.entity.VariantHolder;
import net.minecraft.world.entity.animal.Bee;
import net.minecraft.world.entity.animal.Cat;
import net.minecraft.world.entity.animal.Fox;
import net.minecraft.world.entity.animal.IronGolem;
import net.minecraft.world.entity.animal.MushroomCow;
import net.minecraft.world.entity.animal.Panda;
import net.minecraft.world.entity.animal.Pig;
import net.minecraft.world.entity.animal.PolarBear;
import net.minecraft.world.entity.animal.Pufferfish;
import net.minecraft.world.entity.animal.Sheep;
import net.minecraft.world.entity.animal.TropicalFish;
import net.minecraft.world.entity.animal.Wolf;
import net.minecraft.world.entity.animal.armadillo.Armadillo;
import net.minecraft.world.entity.animal.camel.Camel;
import net.minecraft.world.entity.animal.horse.AbstractChestedHorse;
import net.minecraft.world.entity.animal.horse.AbstractHorse;
import net.minecraft.world.entity.animal.horse.Horse;
import net.minecraft.world.entity.animal.horse.Llama;
import net.minecraft.world.entity.decoration.ArmorStand;
import net.minecraft.world.entity.monster.AbstractIllager;
import net.minecraft.world.entity.monster.Bogged;
import net.minecraft.world.entity.monster.Creeper;
import net.minecraft.world.entity.monster.EnderMan;
import net.minecraft.world.entity.monster.Ghast;
import net.minecraft.world.entity.monster.Monster;
import net.minecraft.world.entity.monster.Ravager;
import net.minecraft.world.entity.monster.Slime;
import net.minecraft.world.entity.monster.Strider;
import net.minecraft.world.entity.monster.Vex;
import net.minecraft.world.entity.monster.ZombieVillager;
import net.minecraft.world.entity.monster.hoglin.HoglinBase;
import net.minecraft.world.entity.monster.piglin.AbstractPiglin;
import net.minecraft.world.entity.npc.Villager;
import net.minecraft.world.entity.npc.VillagerData;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.item.AnimalArmorItem;
import net.minecraft.world.item.DyeColor;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.component.DyedItemColor;
import net.minecraft.world.level.block.state.BlockState;

/**
 * Samples the state of living entities (mobs) for the live-data (BlueMap Live, see docs/bluemap-live/phase-6.md).
 * Only reads synchronized entity-state (the same that the client gets), on the server-thread.
 */
final class LiveMobs {

    private static final Pattern NAME = Pattern.compile("[a-z0-9_.-]+");
    private static final Pattern NAME_OR_PATH = Pattern.compile("[a-z0-9_-]+(/[a-z0-9_-]+)*");

    private LiveMobs() {}

    /** living entities that are shown: no players (own markers), no armor-stands, nothing invisible */
    static boolean isLiveMob(Entity entity) {
        return entity instanceof LivingEntity && !(entity instanceof Player) &&
                !(entity instanceof ArmorStand) && !entity.isInvisible();
    }

    /**
     * set if a type-specific method is not available (e.g. only on the client in this version): the details of
     * that type are not sampled anymore instead of failing every tick
     */
    private static volatile boolean detailsUnavailable = false;
    private static volatile boolean attackUnavailable = false;

    /** BlueMap Live: the category, health and custom name of a mob (name-tags, health-bars and filters of the webapp) */
    static LiveMobState.Info info(LivingEntity entity) {
        return new LiveMobState.Info(
                entity.getType().getCategory().getName(),
                entity.getHealth(),
                entity.getMaxHealth(),
                entity.hasCustomName() && entity.getCustomName() != null ? entity.getCustomName().getString() : null
        );
    }

    static LiveMobState sample(LivingEntity entity) {
        List<String> flags = new ArrayList<>();
        List<String> models = new ArrayList<>();
        String[] variant = {null};
        int[] size = {0};

        if (entity instanceof Mob mob && mob.isAggressive()) flags.add("attacking");
        // riding (jockeys, mobs in boats and minecarts): the body follows a living vehicle like in LivingEntityRenderer
        if (entity.isPassenger()) flags.add("riding");
        float bodyYaw = entity.getVehicle() instanceof LivingEntity vehicle ?
                de.bluecolored.bluemap.common.live.MovementState.passengerBodyYaw(entity.getYHeadRot(), vehicle.yBodyRot) : entity.yBodyRot;
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
        double bedOffset = entity.hasPose(Pose.SLEEPING) ? entity.getEyeHeight(Pose.STANDING) - 0.1 : 0;
        if (!attackUnavailable) {
            try {
                if (entity instanceof Monster && entity.swinging) {
                    swingTicks = Math.max(entity.swingTime, 0);
                    if (entity.swingingArm == InteractionHand.OFF_HAND) flags.add("swing_off_hand");
                }
                if (entity instanceof IronGolem golem) attackTicks = golem.getAttackAnimationTick();
                else if (entity instanceof Ravager ravager) attackTicks = ravager.getAttackTick();
                else if (entity instanceof HoglinBase hoglin) attackTicks = hoglin.getAttackAnimationRemainingTicks();
            } catch (LinkageError error) {
                attackUnavailable = true;
                Logger.global.logWarning("BlueMap Live: mob-attacks are not available: " + error);
            }
        }

        HeldItem mainHand = MojangPlayer.toHeldItem(entity.getMainHandItem());
        HeldItem offHand = MojangPlayer.toHeldItem(entity.getOffhandItem());
        Armor armor = LiveArmor.sample(entity);
        HeldItem head = LiveArmor.headItem(entity);
        Equipment equipment = mainHand != null || offHand != null || !armor.isEmpty() || head != null ?
                new Equipment(mainHand, offHand, entity.getMainArm() == HumanoidArm.LEFT, false, armor, head) : null;

        return new LiveMobState(
                bodyYaw,
                entity.getYHeadRot(),
                Math.max(entity.hurtTime, 0),
                Math.max(entity.deathTime, 0),
                entity.isBaby(),
                equipment,
                variant[0] != null && NAME_OR_PATH.matcher(variant[0]).matches() ? variant[0] : null,
                size[0],
                entity.getBbWidth(),
                entity.getBbHeight(),
                models,
                flags,
                swingTicks,
                Math.max(attackTicks, 0),
                bedOffset
        );
    }

    private static void sampleDetails(LivingEntity entity, List<String> flags, String[] variant, int[] size, List<String> models) {
        if (entity instanceof Sheep sheep) {
            variant[0] = sheep.getColor().getName();
            if (sheep.isSheared()) flags.add("sheared");
        } else if (entity instanceof MushroomCow mooshroom) {
            variant[0] = mooshroom.getVariant().getSerializedName();
            // vanilla MooshroomMushroomFeatureRenderer: the block-model of the mushroom-state of the variant
            String mushroom = blockModel(mooshroom.getVariant().getBlockState());
            if (mushroom != null) models.add(mushroom);
        } else if (entity instanceof Pig pig) {
            if (pig.isSaddled()) flags.add("saddled");
        } else if (entity instanceof Creeper creeper) {
            if (creeper.isPowered()) flags.add("charged");
            if (creeper.getSwellDir() > 0) flags.add("fusing");
        } else if (entity instanceof Slime slime) { // also magma cubes
            size[0] = slime.getSize();
        } else if (entity instanceof EnderMan enderman) {
            if (enderman.isCreepy()) flags.add("angry");
            BlockState carried = enderman.getCarriedBlock();
            if (carried != null) {
                flags.add("carrying");
                // vanilla EndermanBlockFeatureRenderer: the carried block
                String block = blockModel(carried);
                if (block != null) models.add(block);
            }
        } else if (entity instanceof Villager villager) {
            variant[0] = villagerVariant(villager.getVillagerData());
        } else if (entity instanceof ZombieVillager zombieVillager) {
            variant[0] = villagerVariant(zombieVillager.getVillagerData());
        } else if (entity instanceof Horse horse) {
            variant[0] = name(horse.getVariant()) + "/" + name(horse.getMarkings());
        } else if (entity instanceof AbstractPiglin piglin) {
            switch (piglin.getArmPose()) {
                case ADMIRING_ITEM -> flags.add("admiring");
                case DANCING -> flags.add("dancing");
                case ATTACKING_WITH_MELEE_WEAPON -> flags.add("melee");
                case CROSSBOW_HOLD -> flags.add("crossbow_hold");
                case CROSSBOW_CHARGE -> flags.add("crossbow_charge");
                default -> {}
            }
        } else if (entity instanceof Panda panda) {
            variant[0] = name(panda.getVariant());
        } else if (entity instanceof VariantHolder<?> holder) {
            // cat, wolf, frog, axolotl, fox, llama, parrot, rabbit, tropical fish, ...: the name of the variant
            variant[0] = name(holder.getVariant());
        }

        // states of further mobs that change the model, the texture or the animation
        if (entity instanceof AbstractHorse horse) {
            if (horse.isSaddled()) flags.add("saddled");
            // vanilla HorseEntityModel.animateModel: grazing, rearing, slower legs in water, straps while ridden
            if (horse.isEating()) flags.add("eating_grass");
            if (horse.isStanding()) flags.add("angry");
            if (horse.isInWater()) flags.add("in_water");
            if (horse.isVehicle()) flags.add("ridden");
        }
        if (entity instanceof AbstractChestedHorse donkey && donkey.hasChest()) flags.add("chest");
        if (entity instanceof Strider strider) {
            if (strider.isSaddled()) flags.add("saddled");
            if (strider.isSuffocating()) flags.add("cold");
        }
        if (entity instanceof AbstractIllager illager) flags.add("illager_" + illager.getArmPose().name().toLowerCase(java.util.Locale.ROOT));
        if (entity instanceof Bee bee) {
            if (bee.hasNectar()) flags.add("nectar");
            if (bee.hasStung()) flags.add("stung");
        }
        if (entity instanceof Ghast ghast && ghast.isCharging()) flags.add("shooting");
        if (entity instanceof Vex vex && vex.isCharging()) flags.add("charging");
        if (entity instanceof Bogged bogged && bogged.isSheared()) flags.add("sheared");

        // common states that change the model or the texture
        if (entity instanceof TamableAnimal tameable) {
            if (tameable.isTame()) flags.add("tame");
            if (tameable.isInSittingPose()) flags.add("sitting");
        }
        if (entity instanceof NeutralMob angerable && angerable.isAngry()) flags.add("angry");

        // poses: lying in a bed (vanilla LivingEntityRenderer: EntityPose.SLEEPING with the direction of the bed),
        // the fox sleeping on the ground, sitting, lying
        if (entity.hasPose(Pose.SLEEPING)) {
            flags.add("in_bed");
            Direction direction = entity.getBedOrientation();
            if (direction != null) flags.add("bed_" + direction.getSerializedName());
        }
        if (entity instanceof Fox fox && fox.isSleeping()) flags.add("sleeping");
        if (entity instanceof Fox fox && fox.isSitting()) flags.add("sitting");
        if (entity instanceof Cat cat) {
            if (cat.isLying()) flags.add("lying");
            if (cat.getRelaxStateOneAmount(1f) > 0) flags.add("head_down");
        }
        if (entity instanceof Panda panda) {
            if (panda.isSitting()) flags.add("sitting");
            if (panda.isOnBack()) flags.add("lying_on_back");
            if (panda.isEating()) flags.add("eating");
        }
        if (entity instanceof PolarBear bear && bear.isStanding()) flags.add("warning");
        if (entity instanceof Armadillo armadillo && armadillo.shouldHideInShell()) flags.add("rolled_up");
        if (entity instanceof Camel camel && camel.isCamelSitting()) flags.add("sitting");
        // vanilla TropicalFishEntityRenderer and TropicalFishColorFeatureRenderer: the body and the pattern are tinted
        if (entity instanceof TropicalFish fish) {
            flags.add("base_" + fish.getBaseColor().getName());
            flags.add("pattern_" + fish.getPatternColor().getName());
        }
        // vanilla Wolf/CatCollarFeatureRenderer: the collar of tamed wolves and cats in its dye-color
        if (entity instanceof Wolf wolf && wolf.isTame()) flags.add("collar_" + wolf.getCollarColor().getName());
        if (entity instanceof Cat cat && cat.isTame()) flags.add("collar_" + cat.getCollarColor().getName());
        // vanilla LlamaDecorFeatureRenderer: the carpet (the trader-llama has its own decor without one)
        if (entity instanceof Llama llama) {
            DyeColor carpet = llama.getSwag();
            if (carpet != null) flags.add("carpet_" + carpet.getName());
            else if (llama.isTraderLlama()) flags.add("carpet_trader");
        }
        // vanilla HorseArmorFeatureRenderer: equestrian armor, dyeable (leather) with its color
        if (entity instanceof Horse horse) {
            ItemStack armor = horse.getBodyArmorItem();
            if (armor.getItem() instanceof AnimalArmorItem armorItem && armorItem.getBodyType() == AnimalArmorItem.BodyType.EQUESTRIAN) {
                String texture = armorItem.getTexture().getPath();
                String prefix = "textures/entity/horse/armor/horse_armor_";
                if (texture.startsWith(prefix) && texture.endsWith(".png")) {
                    flags.add("armor_" + texture.substring(prefix.length(), texture.length() - 4));
                    if (armor.is(ItemTags.DYEABLE)) {
                        flags.add(String.format("armor_color_%06x", DyedItemColor.getOrDefault(armor, -6265536) & 0xFFFFFF));
                    }
                }
            }
        }
        // vanilla PufferfishEntityRenderer: the model of the puff-state
        if (entity instanceof Pufferfish pufferfish && pufferfish.getPuffState() > 0) {
            flags.add("puff_" + Math.min(2, pufferfish.getPuffState()));
        }
    }

    /** the name of a variant: registry-key-path, StringIdentifiable or enum-name (lower case) */
    private static @Nullable String name(@Nullable Object variant) {
        if (variant == null) return null;
        if (variant instanceof Holder<?> entry) return entry.unwrapKey().map(key -> key.location().getPath()).orElse(null);
        if (variant instanceof StringRepresentable identifiable) return identifiable.getSerializedName();
        if (variant instanceof Enum<?> e) return e.name().toLowerCase(java.util.Locale.ROOT);
        return null;
    }

    /** the default block-model of a block-state: "minecraft:block/red_mushroom" (the webapp falls back to the item-model) */
    private static @Nullable String blockModel(BlockState state) {
        return state.getBlockHolder().unwrapKey()
                .map(key -> key.location().getNamespace() + ":block/" + key.location().getPath())
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
