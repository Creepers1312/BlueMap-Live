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
import de.bluecolored.bluemap.common.live.Armor;
import de.bluecolored.bluemap.common.live.Equipment;
import de.bluecolored.bluemap.common.live.HeldItem;
import de.bluecolored.bluemap.common.live.ItemUse;
import de.bluecolored.bluemap.common.live.LivePlayerState;
import de.bluecolored.bluemap.common.live.MovementState;
import de.bluecolored.bluemap.common.live.PlayerMotionTracker;
import de.bluecolored.bluemap.common.live.SwingState;
import de.bluecolored.bluemap.common.live.SwingTracker;
import de.bluecolored.bluemap.common.live.Vehicle;
import de.bluecolored.bluemap.common.plugin.text.Text;
import de.bluecolored.bluemap.common.serverinterface.Gamemode;
import de.bluecolored.bluemap.common.serverinterface.Player;
import de.bluecolored.bluemap.common.serverinterface.ServerWorld;
import net.minecraft.block.Blocks;
import net.minecraft.component.DataComponentTypes;
import net.minecraft.component.type.ChargedProjectilesComponent;
import net.minecraft.component.type.CustomModelDataComponent;
import net.minecraft.entity.Entity;
import net.minecraft.entity.EntityPose;
import net.minecraft.entity.EquipmentSlot;
import net.minecraft.entity.LivingEntity;
import net.minecraft.entity.effect.StatusEffectInstance;
import net.minecraft.entity.effect.StatusEffects;
import net.minecraft.item.BlockItem;
import net.minecraft.item.CrossbowItem;
import net.minecraft.item.ItemStack;
import net.minecraft.item.Items;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.network.ServerPlayerEntity;
import net.minecraft.util.Arm;
import net.minecraft.util.Hand;
import net.minecraft.util.math.Vec3d;
import net.minecraft.world.GameMode;
import net.minecraft.world.LightType;
import org.jetbrains.annotations.Nullable;

import java.util.EnumMap;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;

public class FabricPlayer extends Player {

    private static final Map<GameMode, Gamemode> GAMEMODE_MAP = new EnumMap<>(GameMode.class);
    static {
        GAMEMODE_MAP.put(GameMode.ADVENTURE, Gamemode.ADVENTURE);
        GAMEMODE_MAP.put(GameMode.SURVIVAL, Gamemode.SURVIVAL);
        GAMEMODE_MAP.put(GameMode.CREATIVE, Gamemode.CREATIVE);
        GAMEMODE_MAP.put(GameMode.SPECTATOR, Gamemode.SPECTATOR);
    }

    private final UUID uuid;
    private final FabricMod mod;

    // only accessed on the server-thread
    private final PlayerMotionTracker motionTracker;
    private final SwingTracker swingTracker;
    private ItemStack lastMainHand = ItemStack.EMPTY, lastOffHand = ItemStack.EMPTY;
    private @Nullable HeldItem mainHandItem, offHandItem;
    private Equipment equipment = Equipment.EMPTY;
    private int hurtCount = 0, lastHurtTime = 0;

    // written on the server-thread, read from other threads (e.g. webserver)
    private volatile State state;

    /**
     * All sampled values in one immutable object, so that readers always see a consistent state.
     */
    private record State(
            Text name,
            ServerWorld world,
            int skyLight,
            int blockLight,
            boolean invisible,
            Gamemode gamemode,
            LivePlayerState live
    ) {}

    public FabricPlayer(ServerPlayerEntity player, FabricMod mod) {
        this.uuid = player.getUuid();
        this.mod = mod;
        this.motionTracker = new PlayerMotionTracker();
        this.swingTracker = new SwingTracker();

        update(player);
    }

    @Override
    public UUID getUuid() {
        return this.uuid;
    }

    @Override
    public Text getName() {
        return state.name();
    }

    @Override
    public ServerWorld getWorld() {
        return state.world();
    }

    @Override
    public Vector3d getPosition() {
        return state.live().position();
    }

    @Override
    public Vector3d getRotation() {
        return state.live().rotation();
    }

    @Override
    public LivePlayerState getLiveState() {
        return state.live();
    }

    @Override
    public LiveSnapshot getLiveSnapshot() {
        State state = this.state; // read once, so world and live-state belong together
        return new LiveSnapshot(state.world(), state.live());
    }

    @Override
    public int getSkyLight() {
        return state.skyLight();
    }

    @Override
    public int getBlockLight() {
        return state.blockLight();
    }

    @Override
    public boolean isSneaking() {
        MovementState movement = state.live().movement();
        return movement != null && movement.sneaking();
    }

    @Override
    public boolean isInvisible() {
        return state.invisible();
    }

    @Override
    public Gamemode getGamemode() {
        return state.gamemode();
    }

    /**
     * Marks the next update as discontinuous, e.g. after a respawn or a world-change.
     * Only call on server thread!
     */
    public void markDiscontinuity() {
        motionTracker.markDiscontinuity();
    }

    /**
     * Checks for a new arm-swing (attack/use) and a new hurt of the player. Called every tick, so nothing is missed.
     * Only call on server thread!
     */
    public void trackSwing(ServerPlayerEntity player) {
        Hand hand = player.preferredHand != null ? player.preferredHand : Hand.MAIN_HAND;
        boolean mainArmLeft = player.getMainArm() == Arm.LEFT;
        boolean leftArm = hand == Hand.MAIN_HAND ? mainArmLeft : !mainArmLeft;
        swingTracker.update(player.handSwinging, player.handSwingTicks, leftArm);

        // a new hurt sets hurtTime to maxHurtTime (10 ticks), it counts down every tick
        if (player.hurtTime > lastHurtTime) hurtCount++;
        lastHurtTime = player.hurtTime;
    }

    /**
     * Notes an action (attack, start breaking a block, use) of the player, the next arm-swing is of this kind.
     * Only call on server thread!
     */
    public void noteAction(SwingState.Kind action) {
        swingTracker.noteAction(action);
    }

    /**
     * The held items, a new object is only created when an item (or its components) changed.
     */
    private Equipment sampleEquipment(ServerPlayerEntity player) {
        ItemStack mainHand = player.getMainHandStack();
        ItemStack offHand = player.getOffHandStack();
        boolean changed = false;

        // the count is ignored, it does not change how the item looks
        if (!ItemStack.areItemsAndComponentsEqual(mainHand, lastMainHand)) {
            lastMainHand = mainHand.copy();
            mainHandItem = toHeldItem(mainHand);
            changed = true;
        }
        if (!ItemStack.areItemsAndComponentsEqual(offHand, lastOffHand)) {
            lastOffHand = offHand.copy();
            offHandItem = toHeldItem(offHand);
            changed = true;
        }

        boolean leftHanded = player.getMainArm() == Arm.LEFT;
        boolean fishing = player.fishHook != null;
        Armor armor = FabricArmor.sample(player);
        if (armor.isEmpty()) armor = null;
        HeldItem head = FabricArmor.headItem(player);
        // dynamic lights: the brightest of the held items and the item on the head
        int light = Math.max(Math.max(luminance(mainHand), luminance(offHand)), luminance(player.getEquippedStack(EquipmentSlot.HEAD)));
        if (changed || leftHanded != equipment.leftHanded() || fishing != equipment.fishing() ||
                !java.util.Objects.equals(armor, equipment.armor()) || !java.util.Objects.equals(head, equipment.head()) ||
                light != equipment.light()) {
            equipment = new Equipment(mainHandItem, offHandItem, leftHanded, fishing, armor, head, light);
        }
        return equipment;
    }

    /**
     * The light an item emits for the dynamic lights (vanilla has none; like the mod LambDynamicLights): a block-item
     * the luminance of its block (torch 14, lantern 15, soul torch 10, ...), a lava-bucket the luminance of lava.
     */
    static int luminance(ItemStack stack) {
        if (stack.isEmpty()) return 0;
        if (stack.getItem() instanceof BlockItem blockItem) return blockItem.getBlock().getDefaultState().getLuminance();
        if (stack.isOf(Items.LAVA_BUCKET)) return Blocks.LAVA.getDefaultState().getLuminance();
        return 0;
    }

    static @Nullable HeldItem toHeldItem(ItemStack stack) {
        if (stack.isEmpty()) return null;

        // the id from the registry-entry of the item (avoids the fabric-injected registry-interface)
        String id = stack.getRegistryEntry().getKey().map(key -> key.getValue().toString()).orElse(null);
        if (id == null) return null;

        CustomModelDataComponent customModelData = stack.get(DataComponentTypes.CUSTOM_MODEL_DATA);
        boolean charged = stack.isOf(Items.CROSSBOW) && CrossbowItem.isCharged(stack);
        ChargedProjectilesComponent projectiles = charged ? stack.get(DataComponentTypes.CHARGED_PROJECTILES) : null;

        return new HeldItem(
                id,
                stack.hasGlint(),
                // the record-component "value" has no yarn-name in 1.21.1, so its intermediary name is used
                customModelData != null ? customModelData.comp_2382() : null,
                charged,
                projectiles != null && projectiles.contains(Items.FIREWORK_ROCKET)
        );
    }

    private static @Nullable ItemUse sampleItemUse(ServerPlayerEntity player) {
        if (!player.isUsingItem()) return null;
        return new ItemUse(
                player.getActiveHand() == Hand.MAIN_HAND,
                player.getActiveItem().getUseAction().name().toLowerCase(Locale.ROOT),
                player.getItemUseTime()
        );
    }

    /**
     * Only call on server thread!
     */
    public void update() {
        MinecraftServer server = mod.getServer();
        if (server == null) return;

        ServerPlayerEntity player = server.getPlayerManager().getPlayer(uuid);
        if (player == null) return;

        update(player);
    }

    /**
     * Only call on server thread!
     */
    public void update(ServerPlayerEntity player) {
        Gamemode gamemode = GAMEMODE_MAP.get(player.interactionManager.getGameMode());
        if (gamemode == null) gamemode = Gamemode.SURVIVAL;

        StatusEffectInstance invis = player.getStatusEffect(StatusEffects.INVISIBILITY);
        boolean invisible = invis != null && invis.getDuration() > 0;

        Text name = Text.of(player.getName().getString());

        Vec3d pos = player.getPos();
        Vector3d position = new Vector3d(pos.getX(), pos.getY(), pos.getZ());
        Vector3d rotation = new Vector3d(player.getPitch(), player.getHeadYaw(), 0);

        net.minecraft.server.world.ServerWorld world = player.getServerWorld();
        ServerWorld serverWorld = mod.getServerWorld(world);

        int skyLight = world.getLightingProvider().get(LightType.SKY).getLightLevel(player.getBlockPos());
        int blockLight = world.getLightingProvider().get(LightType.BLOCK).getLightLevel(player.getBlockPos());

        MovementState movement = new MovementState(
                player.isSneaking(),
                player.isSprinting(),
                player.isOnGround(),
                player.isSwimming(),
                player.getAbilities().flying,
                player.isFallFlying(),
                player.hasVehicle(),
                // vanilla LivingEntityRenderer: lying in the bed (direction of the bed, moved towards the head-end)
                player.isInPose(EntityPose.SLEEPING) ?
                        (player.getSleepingDirection() != null ? player.getSleepingDirection().asString() : "") : null,
                player.isInPose(EntityPose.SLEEPING) ? player.getEyeHeight(EntityPose.STANDING) - 0.1 : 0
        );
        // vanilla LivingEntityRenderer: on a living vehicle the body follows the vehicle
        float bodyYaw = player.getVehicle() instanceof LivingEntity vehicle ?
                MovementState.passengerBodyYaw(player.getHeadYaw(), vehicle.bodyYaw) : player.getBodyYaw();
        Vehicle vehicle = sampleVehicle(player, bodyYaw);

        long now = System.currentTimeMillis();
        PlayerMotionTracker.Result motion = motionTracker.sample(serverWorld.getDimension().getFormatted(), position, now);

        this.state = new State(
                name,
                serverWorld,
                skyLight,
                blockLight,
                invisible,
                gamemode,
                new LivePlayerState(
                        position,
                        rotation,
                        bodyYaw,
                        motion.velocity(),
                        motion.generation(),
                        now,
                        movement,
                        swingTracker.getState(),
                        sampleEquipment(player),
                        sampleItemUse(player),
                        hurtCount,
                        vehicle,
                        FabricParticles.sample(player),
                        sampleStatus(player)
                )
        );
    }


    /** set if a method is not available in this version (e.g. Biome.getPrecipitation): the status is not sampled anymore */
    private static volatile boolean statusUnavailable = false;

    /**
     * health and the precipitation at the player (vanilla Biome.getPrecipitation: rain, snow or none);
     * RegistryEntry.value() is unmapped in the yarn-mappings of 1.21 (comp_349, see FabricParticles)
     */
    static @Nullable de.bluecolored.bluemap.common.live.PlayerStatus sampleStatus(ServerPlayerEntity player) {
        if (statusUnavailable) return null;
        try {
            net.minecraft.util.math.BlockPos pos = player.getBlockPos();
            String precipitation = player.getWorld().getBiome(pos).comp_349().getPrecipitation(pos).name()
                    .toLowerCase(java.util.Locale.ROOT);
            return new de.bluecolored.bluemap.common.live.PlayerStatus(player.getHealth(), player.getMaxHealth(), precipitation);
        } catch (LinkageError ex) {
            statusUnavailable = true;
            return null;
        }
    }

    /**
     * The vehicle and the offset of the player on it (same tick), relative to the yaw the vehicle is drawn with
     * (see FabricVehicles.drawnRotation, the same yaw is sent with the vehicle).
     */
    static @Nullable Vehicle sampleVehicle(Entity passenger, float bodyYaw) {
        Entity vehicle = passenger.getVehicle();
        if (vehicle == null) return null;
        float vehicleYaw = FabricVehicles.drawnRotation(vehicle)[0];
        Vec3d pos = passenger.getPos(), vehiclePos = vehicle.getPos();
        return new Vehicle(
                vehicle.getId(),
                Vehicle.toLocal(pos.x - vehiclePos.x, pos.y - vehiclePos.y, pos.z - vehiclePos.z, vehicleYaw),
                Vehicle.relativeYaw(bodyYaw, vehicleYaw),
                Vehicle.relativeYaw(passenger.getHeadYaw(), vehicleYaw)
        );
    }

}
