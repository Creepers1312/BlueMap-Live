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
import com.github.benmanes.caffeine.cache.LoadingCache;
import de.bluecolored.bluecommands.brigadier.BrigadierBridge;
import de.bluecolored.bluemap.common.BlueMapService;
import de.bluecolored.bluemap.common.commands.BrigadierExecutionHandler;
import de.bluecolored.bluemap.common.commands.Commands;
import de.bluecolored.bluemap.common.config.PluginConfig;
import de.bluecolored.bluemap.common.live.HeldItem;
import de.bluecolored.bluemap.common.live.LiveEntityState;
import de.bluecolored.bluemap.common.live.SwingState;
import de.bluecolored.bluemap.common.plugin.Plugin;
import de.bluecolored.bluemap.common.serverinterface.Player;
import de.bluecolored.bluemap.common.serverinterface.Server;
import de.bluecolored.bluemap.common.serverinterface.ServerEventListener;
import de.bluecolored.bluemap.common.serverinterface.ServerWorld;
import de.bluecolored.bluemap.core.logger.Logger;
import de.bluecolored.bluemap.core.util.Caches;
import de.bluecolored.bluemap.core.util.Key;
import net.fabricmc.api.ModInitializer;
import net.fabricmc.fabric.api.command.v2.CommandRegistrationCallback;
import net.fabricmc.fabric.api.entity.event.v1.ServerEntityWorldChangeEvents;
import net.fabricmc.fabric.api.entity.event.v1.ServerPlayerEvents;
import net.fabricmc.fabric.api.event.lifecycle.v1.ServerLifecycleEvents;
import net.fabricmc.fabric.api.event.lifecycle.v1.ServerTickEvents;
import net.fabricmc.fabric.api.event.player.AttackBlockCallback;
import net.fabricmc.fabric.api.event.player.AttackEntityCallback;
import net.fabricmc.fabric.api.event.player.UseBlockCallback;
import net.fabricmc.fabric.api.event.player.UseItemCallback;
import net.fabricmc.fabric.api.networking.v1.ServerPlayConnectionEvents;
import net.minecraft.SharedConstants;
import net.minecraft.entity.Entity;
import net.minecraft.entity.FlyingItemEntity;
import net.minecraft.entity.ItemEntity;
import net.minecraft.entity.projectile.PersistentProjectileEntity;
import net.minecraft.entity.player.PlayerEntity;
import net.minecraft.item.ItemStack;
import net.minecraft.registry.RegistryKey;
import net.minecraft.registry.RegistryKeys;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.command.ServerCommandSource;
import net.minecraft.server.network.ServerPlayerEntity;
import net.minecraft.util.ActionResult;
import net.minecraft.util.Identifier;
import net.minecraft.util.TypedActionResult;
import net.minecraft.util.math.Box;
import net.minecraft.util.math.Vec3d;
import net.minecraft.world.World;
import org.apache.logging.log4j.LogManager;
import org.jetbrains.annotations.Nullable;

import java.io.IOException;
import java.nio.file.Path;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;

public class FabricMod implements ModInitializer, Server {

    private final Plugin pluginInstance;
    private MinecraftServer serverInstance = null;

    private final FabricEventForwarder eventForwarder;

    private final LoadingCache<net.minecraft.server.world.ServerWorld, ServerWorld> worlds;

    private int playerUpdateIndex = 0;
    private final Map<UUID, Player> onlinePlayerMap;

    // BlueMap Live: the entities around the players per world, sampled on the server-thread, read by the webserver
    private volatile Map<Key, List<LiveEntityState>> liveEntities = Map.of();
    private int liveEntitySampleTicks = 0;
    private final List<FabricPlayer> onlinePlayerList;

    public FabricMod() {
        Logger.global.clear();
        Logger.global.put(new Log4jLogger(LogManager.getLogger(Plugin.PLUGIN_NAME)));

        this.onlinePlayerMap = new ConcurrentHashMap<>();
        this.onlinePlayerList = Collections.synchronizedList(new ArrayList<>());

        pluginInstance = new Plugin("fabric", this);

        this.eventForwarder = new FabricEventForwarder(this);
        this.worlds = Caches.with()
                .weakKeys()
                .maximumSize(1000)
                .build(FabricWorld::new);
    }

    @Override
    public void onInitialize() {

        //register commands
        CommandRegistrationCallback.EVENT.register((dispatcher, registryAccess, environment) ->
                BrigadierBridge.createCommandNodes(
                        Commands.create(pluginInstance),
                        new BrigadierExecutionHandler(pluginInstance),
                        (ServerCommandSource fabricSource) -> new FabricCommandSource(this, fabricSource)
                ).forEach(dispatcher.getRoot()::addChild)
        );

        ServerLifecycleEvents.SERVER_STARTED.register((MinecraftServer server) -> {
            this.serverInstance = server;

            new Thread(() -> {
                Logger.global.logInfo("Loading BlueMap...");

                try {
                    pluginInstance.load();
                    if (pluginInstance.isLoaded()) Logger.global.logInfo("BlueMap loaded!");
                } catch (IOException e) {
                    Logger.global.logError("Failed to load bluemap!", e);
                    pluginInstance.unload();
                }
            }, "BlueMap-Plugin-Loading").start();
        });

        ServerLifecycleEvents.SERVER_STOPPING.register((MinecraftServer server) -> {
            pluginInstance.unload();
            Logger.global.logInfo("BlueMap unloaded!");
        });

        ServerPlayConnectionEvents.JOIN.register((handler, sender, server) -> {
            this.onPlayerJoin(server, handler.getPlayer());
        });

        ServerPlayConnectionEvents.DISCONNECT.register((handler, server) -> {
            this.onPlayerLeave(server, handler.getPlayer());
        });

        // respawns and world-changes are discontinuous position-changes, update those players immediately
        ServerPlayerEvents.AFTER_RESPAWN.register((oldPlayer, newPlayer, alive) -> {
            this.onPlayerDiscontinuity(newPlayer);
        });

        ServerEntityWorldChangeEvents.AFTER_PLAYER_CHANGE_WORLD.register((player, origin, destination) -> {
            this.onPlayerDiscontinuity(player);
        });

        // actions that cause an arm-swing, only observed (always PASS), so the swing can be classified
        AttackEntityCallback.EVENT.register((player, world, hand, entity, hitResult) -> {
            if (!world.isClient()) this.onPlayerAction(player, SwingState.Kind.ATTACK);
            return ActionResult.PASS;
        });

        AttackBlockCallback.EVENT.register((player, world, hand, pos, direction) -> {
            if (!world.isClient()) this.onPlayerAction(player, SwingState.Kind.MINE);
            return ActionResult.PASS;
        });

        UseBlockCallback.EVENT.register((player, world, hand, hitResult) -> {
            if (!world.isClient()) this.onPlayerAction(player, SwingState.Kind.USE);
            return ActionResult.PASS;
        });

        UseItemCallback.EVENT.register((player, world, hand) -> {
            if (!world.isClient()) this.onPlayerAction(player, SwingState.Kind.USE);
            return TypedActionResult.pass(ItemStack.EMPTY);
        });

        ServerTickEvents.END_SERVER_TICK.register((MinecraftServer server) -> {
            if (server == this.serverInstance) {
                this.trackSwings(server);
                this.updateSomePlayers();
                this.sampleLiveEntities(server);
            }
        });

        this.eventForwarder.init();

    }

    @Override
    public String getMinecraftVersion() {
        return SharedConstants.getGameVersion().getId();
    }

    @Override
    public boolean isIntegratedServer() {
        MinecraftServer server = this.serverInstance;
        return server != null && !server.isDedicated();
    }

    @Override
    public void registerListener(ServerEventListener listener) {
        eventForwarder.addEventListener(listener);
    }

    @Override
    public void unregisterAllListeners() {
        eventForwarder.removeAllListeners();
    }

    @Override
    public Collection<ServerWorld> getLoadedServerWorlds() {
        Collection<ServerWorld> loadedWorlds = new ArrayList<>(3);
        for (net.minecraft.server.world.ServerWorld serverWorld : serverInstance.getWorlds()) {
            loadedWorlds.add(worlds.get(serverWorld));
        }
        return loadedWorlds;
    }

    @SuppressWarnings("unchecked")
    @Override
    public Optional<ServerWorld> getServerWorld(Object world) {

        if (world instanceof String) {
            Identifier identifier = Identifier.tryParse((String) world);
            if (identifier != null) world = serverInstance.getWorld(RegistryKey.of(RegistryKeys.WORLD, identifier));
        }

        if (world instanceof RegistryKey) {
            try {
                world = serverInstance.getWorld((RegistryKey<World>) world);
            } catch (ClassCastException ignored) {}
        }

        if (world instanceof net.minecraft.server.world.ServerWorld)
            return Optional.of(getServerWorld((net.minecraft.server.world.ServerWorld) world));

        return Optional.empty();
    }

    public ServerWorld getServerWorld(net.minecraft.server.world.ServerWorld serverWorld) {
        return worlds.get(Objects.requireNonNull(serverWorld));
    }

    @Override
    public Path getConfigFolder() {
        return Path.of("config", "bluemap");
    }

    @Override
    public Optional<Path> getModsFolder() {
        return Optional.of(Path.of("mods"));
    }

    public void onPlayerJoin(MinecraftServer server, ServerPlayerEntity playerInstance) {
        if (this.serverInstance != server) return;

        FabricPlayer player = new FabricPlayer(playerInstance, this);
        onlinePlayerMap.put(player.getUuid(), player);
        onlinePlayerList.add(player);
    }

    public void onPlayerLeave(MinecraftServer server, ServerPlayerEntity player) {
        if (this.serverInstance != server) return;

        UUID playerUUID = player.getUuid();
        onlinePlayerMap.remove(playerUUID);
        synchronized (onlinePlayerList) {
            onlinePlayerList.removeIf(p -> p.getUuid().equals(playerUUID));
        }
    }

    /**
     * Called (on the server-thread) when a players position changed discontinuously, e.g. on respawn or world-change.
     */
    public void onPlayerDiscontinuity(ServerPlayerEntity playerInstance) {
        if (this.serverInstance != playerInstance.getServer()) return;

        if (onlinePlayerMap.get(playerInstance.getUuid()) instanceof FabricPlayer player) {
            player.markDiscontinuity();
            player.update(playerInstance);
        }
    }

    public MinecraftServer getServer() {
        return this.serverInstance;
    }

    public Plugin getPluginInstance() {
        return pluginInstance;
    }

    @Override
    public Collection<Player> getOnlinePlayers() {
        return onlinePlayerMap.values();
    }

    /**
     * Only update some of the online players each tick to minimize performance impact on the server-thread.
     * The players are spread over the configured live-player-update-interval, so each player is updated once per interval.
     * Only call this method on the server-thread.
     */
    private void updateSomePlayers() {
        int onlinePlayerCount = onlinePlayerList.size();
        if (onlinePlayerCount == 0) return;

        int intervalTicks = getPlayerUpdateIntervalTicks();
        int playersToBeUpdated = Math.ceilDiv(onlinePlayerCount, intervalTicks);
        int cycleLength = Math.max(intervalTicks, onlinePlayerCount);

        for (int i = 0; i < playersToBeUpdated; i++) {
            playerUpdateIndex++;
            if (playerUpdateIndex >= cycleLength) playerUpdateIndex = 0;

            if (playerUpdateIndex < onlinePlayerCount) {
                onlinePlayerList.get(playerUpdateIndex).update();
            }
        }
    }

    /**
     * Only call this method on the server-thread.
     */
    private void onPlayerAction(PlayerEntity playerInstance, SwingState.Kind action) {
        if (onlinePlayerMap.get(playerInstance.getUuid()) instanceof FabricPlayer player) {
            player.noteAction(action);
        }
    }

    /**
     * Checks all online players for new arm-swings (a few field-reads per player).
     * This is done every tick, because a swing only lasts a few ticks and could be missed between two samples.
     * Only call this method on the server-thread.
     */
    private void trackSwings(MinecraftServer server) {
        for (ServerPlayerEntity playerInstance : server.getPlayerManager().getPlayerList()) {
            if (onlinePlayerMap.get(playerInstance.getUuid()) instanceof FabricPlayer player) {
                player.trackSwing(playerInstance);
            }
        }
    }

    /** the entity-types that are shown on the map so far (dropped items, thrown items, arrows and tridents) */
    private static boolean isLiveEntity(Entity entity) {
        return entity instanceof ItemEntity || entity instanceof FlyingItemEntity || entity instanceof PersistentProjectileEntity;
    }

    /** a protection against huge entity-amounts (e.g. farms), the data-supplier applies the configured limit */
    private static final int MAX_SAMPLED_ENTITIES_PER_WORLD = 2000;

    /**
     * Samples the entities around all players, once per live-player-update-interval.
     * Only call this method on the server-thread.
     */
    private void sampleLiveEntities(MinecraftServer server) {
        if (++liveEntitySampleTicks < getPlayerUpdateIntervalTicks()) return;
        liveEntitySampleTicks = 0;

        BlueMapService blueMap = pluginInstance.getBlueMap();
        PluginConfig config = blueMap != null ? blueMap.getConfig().getPluginConfig() : null;
        if (config == null || !config.isLiveEntities() || !config.isLivePlayerMarkers() || config.getLiveEntitiesRadius() <= 0) {
            liveEntities = Map.of();
            return;
        }

        double radius = config.getLiveEntitiesRadius();
        long now = System.currentTimeMillis();
        Map<Key, List<LiveEntityState>> result = new HashMap<>();
        for (net.minecraft.server.world.ServerWorld world : server.getWorlds()) {
            List<ServerPlayerEntity> players = world.getPlayers();
            if (players.isEmpty()) continue;

            Map<Integer, LiveEntityState> entities = new LinkedHashMap<>();
            for (ServerPlayerEntity player : players) {
                Box box = player.getBoundingBox().expand(radius);
                for (Entity entity : world.getOtherEntities(player, box, FabricMod::isLiveEntity)) {
                    if (entities.size() >= MAX_SAMPLED_ENTITIES_PER_WORLD) break;
                    if (entities.containsKey(entity.getId())) continue;
                    LiveEntityState state = toLiveEntity(entity, now);
                    if (state != null) entities.put(entity.getId(), state);
                }
            }
            result.put(getServerWorld(world).getDimension(), List.copyOf(entities.values()));
        }
        liveEntities = result;
    }

    private static @Nullable LiveEntityState toLiveEntity(Entity entity, long now) {
        String type = entity.getType().getRegistryEntry().getKey().map(key -> key.getValue().toString()).orElse(null);
        if (type == null) return null;

        HeldItem item = null;
        if (entity instanceof ItemEntity itemEntity) item = FabricPlayer.toHeldItem(itemEntity.getStack());
        else if (entity instanceof FlyingItemEntity flyingItem) item = FabricPlayer.toHeldItem(flyingItem.getStack());
        else if (entity instanceof PersistentProjectileEntity projectile) item = FabricPlayer.toHeldItem(projectile.getItemStack());

        Vec3d pos = entity.getPos();
        Vec3d velocity = entity.getVelocity();
        return new LiveEntityState(
                entity.getId(),
                type,
                new Vector3d(pos.x, pos.y, pos.z),
                entity.getYaw(),
                entity.getPitch(),
                new Vector3d(velocity.x * 20, velocity.y * 20, velocity.z * 20), // blocks per tick -> per second
                now,
                item,
                entity.isOnGround()
        );
    }

    @Override
    public List<LiveEntityState> getLiveEntities(ServerWorld world) {
        return liveEntities.getOrDefault(world.getDimension(), List.of());
    }

    /**
     * The configured live-player-update-interval in ticks (50ms), or 20 ticks (the previous fixed interval) if
     * the config is not (yet) available.
     */
    private int getPlayerUpdateIntervalTicks() {
        BlueMapService blueMap = pluginInstance.getBlueMap();
        if (blueMap == null) return 20;

        int intervalMillis = blueMap.getConfig().getPluginConfig().getLivePlayerUpdateInterval();
        return Math.max(1, Math.round(intervalMillis / 50f));
    }

}
