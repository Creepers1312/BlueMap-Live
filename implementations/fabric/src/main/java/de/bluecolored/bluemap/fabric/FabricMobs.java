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
import net.minecraft.entity.LivingEntity;
import net.minecraft.entity.decoration.ArmorStandEntity;
import net.minecraft.entity.mob.AbstractPiglinEntity;
import net.minecraft.entity.mob.CreeperEntity;
import net.minecraft.entity.mob.EndermanEntity;
import net.minecraft.entity.mob.MobEntity;
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

    static LiveMobState sample(LivingEntity entity) {
        List<String> flags = new ArrayList<>();
        List<String> models = new ArrayList<>();
        String[] variant = {null};
        int[] size = {0};

        if (entity instanceof MobEntity mob && mob.isAttacking()) flags.add("attacking");
        if (!detailsUnavailable) {
            try {
                sampleDetails(entity, flags, variant, size, models);
            } catch (LinkageError error) {
                detailsUnavailable = true;
                Logger.global.logWarning("BlueMap Live: mob-details are not available: " + error);
            }
        }

        HeldItem mainHand = FabricPlayer.toHeldItem(entity.getMainHandStack());
        HeldItem offHand = FabricPlayer.toHeldItem(entity.getOffHandStack());
        Armor armor = FabricArmor.sample(entity);
        Equipment equipment = mainHand != null || offHand != null || !armor.isEmpty() ?
                new Equipment(mainHand, offHand, entity.getMainArm() == Arm.LEFT, false, armor) : null;

        return new LiveMobState(
                entity.bodyYaw,
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
                flags
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
        } else if (entity instanceof AbstractPiglinEntity piglin) {
            switch (piglin.getActivity()) {
                case ADMIRING_ITEM -> flags.add("admiring");
                case DANCING -> flags.add("dancing");
                case ATTACKING_WITH_MELEE_WEAPON -> flags.add("melee");
                case CROSSBOW_HOLD -> flags.add("crossbow_hold");
                case CROSSBOW_CHARGE -> flags.add("crossbow_charge");
                default -> {}
            }
        }
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
