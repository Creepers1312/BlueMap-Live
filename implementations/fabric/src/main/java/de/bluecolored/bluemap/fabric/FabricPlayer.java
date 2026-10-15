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
import de.bluecolored.bluemap.common.live.LivePlayerState;
import de.bluecolored.bluemap.common.live.MovementState;
import de.bluecolored.bluemap.common.live.PlayerMotionTracker;
import de.bluecolored.bluemap.common.plugin.text.Text;
import de.bluecolored.bluemap.common.serverinterface.Gamemode;
import de.bluecolored.bluemap.common.serverinterface.Player;
import de.bluecolored.bluemap.common.serverinterface.ServerWorld;
import net.minecraft.entity.effect.StatusEffectInstance;
import net.minecraft.entity.effect.StatusEffects;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.network.ServerPlayerEntity;
import net.minecraft.util.math.Vec3d;
import net.minecraft.world.GameMode;
import net.minecraft.world.LightType;

import java.util.EnumMap;
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
                player.isFallFlying()
        );

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
                        player.getBodyYaw(),
                        motion.velocity(),
                        motion.generation(),
                        now,
                        movement
                )
        );
    }

}
