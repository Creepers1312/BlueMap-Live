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
import de.bluecolored.bluemap.common.BlueMapService;
import de.bluecolored.bluemap.common.config.PluginConfig;
import de.bluecolored.bluemap.common.live.HeldItem;
import de.bluecolored.bluemap.common.live.LiveBlockLog;
import de.bluecolored.bluemap.common.live.LiveEffect;
import de.bluecolored.bluemap.common.live.LiveEffectLog;
import de.bluecolored.bluemap.common.live.LiveEntityState;
import de.bluecolored.bluemap.common.live.LiveMobState;
import de.bluecolored.bluemap.common.live.LiveStats;
import de.bluecolored.bluemap.common.live.LiveWorldTime;
import de.bluecolored.bluemap.common.live.OpenContainer;
import de.bluecolored.bluemap.common.live.SwingState;
import de.bluecolored.bluemap.common.serverinterface.ServerWorld;
import de.bluecolored.bluemap.core.util.Key;
import net.minecraft.core.BlockPos;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.LivingEntity;
import net.minecraft.world.entity.item.ItemEntity;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.entity.projectile.AbstractArrow;
import net.minecraft.world.entity.projectile.ItemSupplier;
import net.minecraft.world.level.GameRules;
import net.minecraft.world.level.Level;
import net.minecraft.world.phys.AABB;
import net.minecraft.world.phys.Vec3;
import org.jetbrains.annotations.Nullable;

import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.Function;

/**
 * BlueMap Live: the live-data of the server (entities, effects, block-changes, opened chests, time and weather),
 * sampled on the server-thread and read by the webserver. Shared by forge and neoforge, the same as the live-part of
 * the FabricMod (in mojang-names); the mods forward their events to it.
 */
public final class LiveSampler {

    /** a protection against huge entity-amounts (e.g. farms), the data-supplier applies the configured limit */
    private static final int MAX_SAMPLED_ENTITIES_PER_WORLD = 2000;

    private final LiveHost host;

    private volatile Map<Key, List<LiveEntityState>> liveEntities = Map.of();
    private volatile Map<Key, LiveWorldTime> liveWorldTimes = Map.of();
    private final Map<Key, LiveEffectLog> liveEffects = new ConcurrentHashMap<>();
    private final Map<Key, LiveBlockLog> liveBlockChanges = new ConcurrentHashMap<>();
    private final LiveContainers containers = new LiveContainers();
    private volatile Map<Key, List<OpenContainer>> openContainers = Map.of();
    private int liveEntitySampleTicks = 0;

    public LiveSampler(LiveHost host) {
        this.host = host;
    }

    /**
     * Once per tick at the end of the server-tick, only call on the server-thread.
     * @param players the online players by their uuid
     * @param updatePlayers updates the players of this tick (see {@link #getPlayerUpdateIntervalTicks()})
     */
    public void tick(MinecraftServer server, Function<UUID, ?> players, Runnable updatePlayers) {
        flushBlockChanges(server);
        trackSwings(server, players);
        updatePlayers.run();
        long sampleStart = System.nanoTime();
        if (sampleLiveEntities(server)) LiveStats.add(LiveStats.ENTITY_SAMPLE_NANOS, System.nanoTime() - sampleStart);
    }

    /** a player left the server */
    public void onPlayerLeave(UUID player) {
        containers.onLeave(player);
    }

    /** a player used a block (opening a chest), only call on the server-thread */
    public void onUseBlock(Player player, Level world, BlockPos pos) {
        if (!world.isClientSide()) containers.onUseBlock(player, world, pos);
    }

    /**
     * Notes an action (attack, start breaking a block, use) of the player, the next arm-swing is of this kind.
     * Only call on the server-thread.
     */
    public void onPlayerAction(Player player, @Nullable Object onlinePlayer, SwingState.Kind action) {
        if (player.level().isClientSide()) return;
        if (onlinePlayer instanceof MojangPlayer mojangPlayer) mojangPlayer.noteAction(action);
    }

    /** checks all online players for new arm-swings (a swing only lasts a few ticks, so every tick) */
    private void trackSwings(MinecraftServer server, Function<UUID, ?> players) {
        for (ServerPlayer playerInstance : server.getPlayerList().getPlayers()) {
            if (players.apply(playerInstance.getUUID()) instanceof MojangPlayer player) {
                player.trackSwing(playerInstance);
            }
        }
    }

    /** the entity-types that are shown on the map (dropped items, thrown items, arrows, tridents and mobs) */
    private static boolean isLiveEntity(Entity entity) {
        return entity instanceof ItemEntity || entity instanceof ItemSupplier || entity instanceof AbstractArrow ||
                LiveMobs.isLiveMob(entity) || LiveVehicles.isVehicle(entity) || LiveParticles.isParticleEntity(entity);
    }

    private @Nullable PluginConfig config() {
        BlueMapService blueMap = host.getPluginInstance().getBlueMap();
        return blueMap != null ? blueMap.getConfig().getPluginConfig() : null;
    }

    private ServerWorld world(ServerLevel world) {
        return host.getServerWorld(world);
    }

    /**
     * Samples the entities around all players, once per live-player-update-interval.
     * @return if it sampled in this tick
     */
    private boolean sampleLiveEntities(MinecraftServer server) {
        if (++liveEntitySampleTicks < getPlayerUpdateIntervalTicks()) return false;
        liveEntitySampleTicks = 0;

        // the time and weather of the worlds with a day-night-cycle (cheap: a few field-reads per world);
        // the nether and the end have a fixed time
        Map<Key, LiveWorldTime> times = new HashMap<>();
        for (ServerLevel world : server.getAllLevels()) {
            if (world.dimensionType().hasFixedTime()) continue;
            times.put(world(world).getDimension(), new LiveWorldTime(
                    Math.floorMod(world.getDayTime(), 24000L),
                    world.getRainLevel(1f),
                    world.getThunderLevel(1f),
                    world.getGameRules().getBoolean(GameRules.RULE_DAYLIGHT),
                    world.getMoonPhase()
            ));
        }
        liveWorldTimes = times;

        PluginConfig config = config();
        if (config == null || !config.isLiveEntities() || !config.isLivePlayerMarkers() || config.getLiveEntitiesRadius() <= 0) {
            liveEntities = Map.of();
            return true;
        }

        double radius = config.getLiveEntitiesRadius();
        long now = System.currentTimeMillis();
        Map<Key, List<LiveEntityState>> result = new HashMap<>();
        for (ServerLevel world : server.getAllLevels()) {
            List<ServerPlayer> players = world.players();
            if (players.isEmpty()) continue;

            Map<Integer, LiveEntityState> entities = new LinkedHashMap<>();
            for (ServerPlayer player : players) {
                AABB box = player.getBoundingBox().inflate(radius);
                for (Entity entity : world.getEntities(player, box, LiveSampler::isLiveEntity)) {
                    if (entities.size() >= MAX_SAMPLED_ENTITIES_PER_WORLD) break;
                    if (entities.containsKey(entity.getId())) continue;
                    LiveEntityState state = toLiveEntity(entity, now);
                    if (state != null) entities.put(entity.getId(), state);
                }
            }
            result.put(world(world).getDimension(), List.copyOf(entities.values()));
        }
        liveEntities = result;

        Map<Key, List<OpenContainer>> opened = new HashMap<>();
        for (ServerLevel world : server.getAllLevels()) {
            List<OpenContainer> list = containers.sample(world, now);
            if (!list.isEmpty()) opened.put(world(world).getDimension(), list);
        }
        openContainers = opened;
        return true;
    }

    private static @Nullable LiveEntityState toLiveEntity(Entity entity, long now) {
        String type = entity.getType().builtInRegistryHolder().unwrapKey().map(key -> key.location().toString()).orElse(null);
        if (type == null) return null;

        HeldItem item = null;
        if (entity instanceof ItemEntity itemEntity) item = MojangPlayer.toHeldItem(itemEntity.getItem());
        else if (entity instanceof ItemSupplier flyingItem) item = MojangPlayer.toHeldItem(flyingItem.getItem());
        else if (entity instanceof AbstractArrow projectile) item = MojangPlayer.toHeldItem(projectile.getPickupItemStackOrigin());

        Vec3 pos = entity.position();
        Vec3 velocity = entity.getDeltaMovement();
        boolean onGround = entity.onGround();

        // a projectile stuck in a block does not move anymore (its velocity is not reset in vanilla):
        // it is sent as resting (onGround) without velocity, so the webapp does not predict a flight
        if (entity instanceof AbstractArrow) {
            double dx = pos.x - entity.xo, dy = pos.y - entity.yo, dz = pos.z - entity.zo;
            if (dx * dx + dy * dy + dz * dz < 1e-8) {
                onGround = true;
                velocity = Vec3.ZERO;
            }
        }

        // flying projectiles: where they will hit a block, so the webapp-prediction does not fly through it
        LiveEntityState.Impact impact = null;
        if (!onGround && (entity instanceof AbstractArrow || entity instanceof ItemSupplier) &&
                velocity.lengthSqr() > 1e-6) {
            impact = LiveProjectiles.predictImpact(entity, type, pos, velocity);
        }

        // boats and minecarts: the yaw and pitch the vanilla renderer draws them with
        float yaw = entity.getYRot(), pitch = entity.getXRot();
        LiveMobState vehicle = null;
        if (LiveVehicles.isVehicle(entity)) {
            float[] rotation = LiveVehicles.drawnRotation(entity);
            yaw = rotation[0];
            pitch = rotation[1];
            vehicle = LiveVehicles.sample(entity, yaw);
        }

        return new LiveEntityState(
                entity.getId(),
                type,
                new Vector3d(pos.x, pos.y, pos.z),
                yaw,
                pitch,
                new Vector3d(velocity.x * 20, velocity.y * 20, velocity.z * 20), // blocks per tick -> per second
                now,
                item,
                onGround,
                withLeash(entity instanceof LivingEntity living ? LiveMobs.sample(living).withInfo(LiveMobs.info(living)) : vehicle, entity),
                impact,
                LiveParticles.sample(entity)
        );
    }

    /** the leash of a mob or boat (the rope is drawn by the webapp) */
    private static @Nullable LiveMobState withLeash(@Nullable LiveMobState mob, Entity entity) {
        if (mob == null) return null;
        de.bluecolored.bluemap.common.live.Leash leash = LiveVehicles.leash(entity);
        return leash != null ? mob.withLeash(leash) : mob;
    }

    /**
     * The effect an entity caused when it was removed (explosions, splash-potions), only while live-entities are
     * shown. Only call on the server-thread.
     */
    public void onEntityRemoved(Entity entity, Level level) {
        if (!(level instanceof ServerLevel world) || world.getServer() != host.getServer()) return;
        if (entity.getRemovalReason() == null || entity.getRemovalReason() == Entity.RemovalReason.UNLOADED_TO_CHUNK ||
                entity.getRemovalReason() == Entity.RemovalReason.UNLOADED_WITH_PLAYER) return;
        PluginConfig config = config();
        if (config == null || !config.isLiveEntities() || !config.isLivePlayerMarkers()) return;
        LiveEffectLog log = liveEffects.computeIfAbsent(world(world).getDimension(), key -> new LiveEffectLog());
        LiveParticles.onRemoved(entity, log, System.currentTimeMillis());
    }

    /** the block-changes of the tick (see LiveBlockChanges) */
    private void flushBlockChanges(MinecraftServer server) {
        PluginConfig config = config();
        boolean enabled = config != null && config.isLiveBlockPreviewEnabled() && config.isLivePlayerMarkers() &&
                !server.getPlayerList().getPlayers().isEmpty();
        if (enabled != LiveBlockChanges.isListening()) LiveBlockChanges.setListening(enabled);
        if (!enabled) return;
        List<ServerLevel> worlds = new ArrayList<>();
        server.getAllLevels().forEach(worlds::add);
        LiveBlockChanges.flush(worlds, world -> liveBlockChanges.computeIfAbsent(world(world).getDimension(),
                key -> new LiveBlockLog()), config.getLiveBlockPreviewRadius(), System.currentTimeMillis());
    }

    public List<LiveEntityState> getLiveEntities(ServerWorld world) {
        return liveEntities.getOrDefault(world.getDimension(), List.of());
    }

    public List<LiveBlockLog.Change> getLiveBlockChanges(ServerWorld world) {
        LiveBlockLog log = liveBlockChanges.get(world.getDimension());
        return log != null ? log.recent(System.currentTimeMillis()) : List.of();
    }

    public List<OpenContainer> getOpenContainers(ServerWorld world) {
        return openContainers.getOrDefault(world.getDimension(), List.of());
    }

    public List<LiveEffect> getLiveEffects(ServerWorld world) {
        LiveEffectLog log = liveEffects.get(world.getDimension());
        return log != null ? log.recent(System.currentTimeMillis()) : List.of();
    }

    public @Nullable LiveWorldTime getLiveWorldTime(ServerWorld world) {
        return liveWorldTimes.get(world.getDimension());
    }

    /**
     * The configured live-player-update-interval in ticks (50ms), or 20 ticks (the previous fixed interval) if
     * the config is not (yet) available.
     */
    public int getPlayerUpdateIntervalTicks() {
        BlueMapService blueMap = host.getPluginInstance().getBlueMap();
        if (blueMap == null) return 20;

        int intervalMillis = blueMap.getConfig().getPluginConfig().getLivePlayerUpdateInterval();
        return Math.max(1, Math.round(intervalMillis / 50f));
    }

}
