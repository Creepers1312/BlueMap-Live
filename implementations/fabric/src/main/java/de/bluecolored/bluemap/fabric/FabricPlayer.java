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
import net.minecraft.core.component.DataComponents;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.effect.MobEffectInstance;
import net.minecraft.world.effect.MobEffects;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.EquipmentSlot;
import net.minecraft.world.entity.HumanoidArm;
import net.minecraft.world.entity.LivingEntity;
import net.minecraft.world.entity.Pose;
import net.minecraft.world.item.BlockItem;
import net.minecraft.world.item.CrossbowItem;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.Items;
import net.minecraft.world.item.component.ChargedProjectiles;
import net.minecraft.world.item.component.CustomModelData;
import net.minecraft.world.level.GameType;
import net.minecraft.world.level.LightLayer;
import net.minecraft.world.level.block.Blocks;
import net.minecraft.world.phys.Vec3;
import org.jetbrains.annotations.Nullable;

import java.util.EnumMap;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;

public class FabricPlayer extends Player {

    private static final Map<GameType, Gamemode> GAMEMODE_MAP = new EnumMap<>(GameType.class);
    static {
        GAMEMODE_MAP.put(GameType.ADVENTURE, Gamemode.ADVENTURE);
        GAMEMODE_MAP.put(GameType.SURVIVAL, Gamemode.SURVIVAL);
        GAMEMODE_MAP.put(GameType.CREATIVE, Gamemode.CREATIVE);
        GAMEMODE_MAP.put(GameType.SPECTATOR, Gamemode.SPECTATOR);
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

    public FabricPlayer(ServerPlayer player, FabricMod mod) {
        this.uuid = player.getUUID();
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
    public void trackSwing(ServerPlayer player) {
        InteractionHand hand = player.swingingArm != null ? player.swingingArm : InteractionHand.MAIN_HAND;
        boolean mainArmLeft = player.getMainArm() == HumanoidArm.LEFT;
        boolean leftArm = hand == InteractionHand.MAIN_HAND ? mainArmLeft : !mainArmLeft;
        swingTracker.update(player.swinging, player.swingTime, leftArm);

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
    private Equipment sampleEquipment(ServerPlayer player) {
        ItemStack mainHand = player.getMainHandItem();
        ItemStack offHand = player.getOffhandItem();
        boolean changed = false;

        // the count is ignored, it does not change how the item looks
        if (!ItemStack.isSameItemSameComponents(mainHand, lastMainHand)) {
            lastMainHand = mainHand.copy();
            mainHandItem = toHeldItem(mainHand);
            changed = true;
        }
        if (!ItemStack.isSameItemSameComponents(offHand, lastOffHand)) {
            lastOffHand = offHand.copy();
            offHandItem = toHeldItem(offHand);
            changed = true;
        }

        boolean leftHanded = player.getMainArm() == HumanoidArm.LEFT;
        boolean fishing = player.fishing != null;
        Armor armor = FabricArmor.sample(player);
        if (armor.isEmpty()) armor = null;
        HeldItem head = FabricArmor.headItem(player);
        // dynamic lights: the brightest of the held items and the item on the head
        int light = Math.max(Math.max(luminance(mainHand), luminance(offHand)), luminance(player.getItemBySlot(EquipmentSlot.HEAD)));
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
        if (stack.getItem() instanceof BlockItem blockItem) return blockItem.getBlock().defaultBlockState().getLightEmission();
        if (stack.is(Items.LAVA_BUCKET)) return Blocks.LAVA.defaultBlockState().getLightEmission();
        return 0;
    }

    static @Nullable HeldItem toHeldItem(ItemStack stack) {
        if (stack.isEmpty()) return null;

        // the id from the registry-entry of the item (avoids the fabric-injected registry-interface)
        String id = stack.getItemHolder().unwrapKey().map(key -> key.location().toString()).orElse(null);
        if (id == null) return null;

        CustomModelData customModelData = stack.get(DataComponents.CUSTOM_MODEL_DATA);
        boolean charged = stack.is(Items.CROSSBOW) && CrossbowItem.isCharged(stack);
        ChargedProjectiles projectiles = charged ? stack.get(DataComponents.CHARGED_PROJECTILES) : null;

        return new HeldItem(
                id,
                stack.hasFoil(),
                // the record-component "value" has no yarn-name in 1.21.1, so its intermediary name is used
                customModelData != null ? customModelData.value() : null,
                charged,
                projectiles != null && projectiles.contains(Items.FIREWORK_ROCKET)
        );
    }

    private static @Nullable ItemUse sampleItemUse(ServerPlayer player) {
        if (!player.isUsingItem()) return null;
        return new ItemUse(
                player.getUsedItemHand() == InteractionHand.MAIN_HAND,
                player.getUseItem().getUseAnimation().name().toLowerCase(Locale.ROOT),
                player.getTicksUsingItem()
        );
    }

    /**
     * Only call on server thread!
     */
    public void update() {
        MinecraftServer server = mod.getServer();
        if (server == null) return;

        ServerPlayer player = server.getPlayerList().getPlayer(uuid);
        if (player == null) return;

        update(player);
    }

    /**
     * Only call on server thread!
     */
    public void update(ServerPlayer player) {
        Gamemode gamemode = GAMEMODE_MAP.get(player.gameMode.getGameModeForPlayer());
        if (gamemode == null) gamemode = Gamemode.SURVIVAL;

        MobEffectInstance invis = player.getEffect(MobEffects.INVISIBILITY);
        boolean invisible = invis != null && invis.getDuration() > 0;

        Text name = Text.of(player.getName().getString());

        Vec3 pos = player.position();
        Vector3d position = new Vector3d(pos.x(), pos.y(), pos.z());
        Vector3d rotation = new Vector3d(player.getXRot(), player.getYHeadRot(), 0);

        net.minecraft.server.level.ServerLevel world = player.serverLevel();
        ServerWorld serverWorld = mod.getServerWorld(world);

        int skyLight = world.getLightEngine().getLayerListener(LightLayer.SKY).getLightValue(player.blockPosition());
        int blockLight = world.getLightEngine().getLayerListener(LightLayer.BLOCK).getLightValue(player.blockPosition());

        MovementState movement = new MovementState(
                player.isShiftKeyDown(),
                player.isSprinting(),
                player.onGround(),
                player.isSwimming(),
                player.getAbilities().flying,
                player.isFallFlying(),
                player.isPassenger(),
                // vanilla LivingEntityRenderer: lying in the bed (direction of the bed, moved towards the head-end)
                player.hasPose(Pose.SLEEPING) ?
                        (player.getBedOrientation() != null ? player.getBedOrientation().getSerializedName() : "") : null,
                player.hasPose(Pose.SLEEPING) ? player.getEyeHeight(Pose.STANDING) - 0.1 : 0
        );
        // vanilla LivingEntityRenderer: on a living vehicle the body follows the vehicle
        float bodyYaw = player.getVehicle() instanceof LivingEntity vehicle ?
                MovementState.passengerBodyYaw(player.getYHeadRot(), vehicle.yBodyRot) : player.getVisualRotationYInDegrees();
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
    static @Nullable de.bluecolored.bluemap.common.live.PlayerStatus sampleStatus(ServerPlayer player) {
        if (statusUnavailable) return null;
        try {
            net.minecraft.core.BlockPos pos = player.blockPosition();
            String precipitation = player.level().getBiome(pos).value().getPrecipitationAt(pos).name()
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
        Vec3 pos = passenger.position(), vehiclePos = vehicle.position();
        return new Vehicle(
                vehicle.getId(),
                Vehicle.toLocal(pos.x - vehiclePos.x, pos.y - vehiclePos.y, pos.z - vehiclePos.z, vehicleYaw),
                Vehicle.relativeYaw(bodyYaw, vehicleYaw),
                Vehicle.relativeYaw(passenger.getYHeadRot(), vehicleYaw)
        );
    }

}
