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
package de.bluecolored.bluemap.forge;

import com.github.benmanes.caffeine.cache.LoadingCache;
import de.bluecolored.bluecommands.brigadier.BrigadierBridge;
import de.bluecolored.bluemap.common.commands.BrigadierExecutionHandler;
import de.bluecolored.bluemap.common.commands.Commands;
import de.bluecolored.bluemap.common.plugin.Plugin;
import de.bluecolored.bluemap.common.serverinterface.Player;
import de.bluecolored.bluemap.common.serverinterface.Server;
import de.bluecolored.bluemap.common.serverinterface.ServerEventListener;
import de.bluecolored.bluemap.common.serverinterface.ServerWorld;
import de.bluecolored.bluemap.core.logger.Logger;
import de.bluecolored.bluemap.core.util.Caches;
import de.bluecolored.bluemap.common.live.LiveBlockLog;
import de.bluecolored.bluemap.common.live.LiveEffect;
import de.bluecolored.bluemap.common.live.LiveEntityState;
import de.bluecolored.bluemap.common.live.LiveWorldTime;
import de.bluecolored.bluemap.common.live.OpenContainer;
import de.bluecolored.bluemap.common.live.SwingState;
import de.bluecolored.bluemap.live.mojang.LiveHost;
import de.bluecolored.bluemap.live.mojang.LiveSampler;
import de.bluecolored.bluemap.live.mojang.MojangPlayer;
import net.minecraft.SharedConstants;
import net.minecraft.commands.CommandSourceStack;
import net.minecraft.core.registries.Registries;
import net.minecraft.resources.ResourceKey;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.level.Level;
import net.minecraftforge.common.MinecraftForge;
import net.minecraftforge.event.RegisterCommandsEvent;
import net.minecraftforge.event.TickEvent;
import net.minecraftforge.event.TickEvent.ServerTickEvent;
import net.minecraftforge.event.entity.EntityLeaveLevelEvent;
import net.minecraftforge.event.entity.player.AttackEntityEvent;
import net.minecraftforge.event.entity.player.PlayerEvent;
import net.minecraftforge.event.entity.player.PlayerInteractEvent;
import net.minecraftforge.event.entity.player.PlayerEvent.PlayerLoggedInEvent;
import net.minecraftforge.event.entity.player.PlayerEvent.PlayerLoggedOutEvent;
import net.minecraftforge.event.server.ServerStartedEvent;
import net.minecraftforge.event.server.ServerStartingEvent;
import net.minecraftforge.event.server.ServerStoppingEvent;
import net.minecraftforge.eventbus.api.SubscribeEvent;
import net.minecraftforge.fml.IExtensionPoint;
import net.minecraftforge.fml.ModLoadingContext;
import net.minecraftforge.fml.common.Mod;
import net.minecraftforge.fml.javafmlmod.FMLJavaModLoadingContext;
import org.apache.logging.log4j.LogManager;
import org.jetbrains.annotations.Nullable;

import java.io.IOException;
import java.nio.file.Path;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;

@Mod(Plugin.PLUGIN_ID)
public class ForgeMod implements Server, LiveHost {

    private final Plugin pluginInstance;
    private MinecraftServer serverInstance = null;

    private final ForgeEventForwarder eventForwarder;
    private final LoadingCache<ServerLevel, ServerWorld> worlds;

    private int playerUpdateIndex = 0;
    private final Map<UUID, Player> onlinePlayerMap;
    private final List<MojangPlayer> onlinePlayerList;

    // BlueMap Live: entities, effects, block-changes, chests, time and weather (shared with forge/neoforge)
    private final LiveSampler live;

    public ForgeMod(FMLJavaModLoadingContext context) {
        Logger.global.clear();
        Logger.global.put(new Log4jLogger(LogManager.getLogger(Plugin.PLUGIN_NAME)));

        this.onlinePlayerMap = new ConcurrentHashMap<>();
        this.onlinePlayerList = Collections.synchronizedList(new ArrayList<>());

        this.pluginInstance = new Plugin("forge", this);
        this.live = new LiveSampler(this);

        this.eventForwarder = new ForgeEventForwarder();
        this.worlds = Caches.with()
                .weakKeys()
                .maximumSize(1000)
                .build(ForgeWorld::new);

        MinecraftForge.EVENT_BUS.register(this);
        MinecraftForge.EVENT_BUS.register(this.eventForwarder);

        //Make sure the mod being absent on the other network side does not cause the client to display the server as incompatible
        ModLoadingContext.get().registerExtensionPoint(
                IExtensionPoint.DisplayTest.class,
                () -> new IExtensionPoint.DisplayTest(
                        () -> IExtensionPoint.DisplayTest.IGNORESERVERONLY,
                        (a, b) -> true
                )
        );
    }

    @SubscribeEvent
    public void onServerStarting(ServerStartingEvent event) {
        this.serverInstance = event.getServer();
    }

    @SubscribeEvent
    public void onRegisterCommands(RegisterCommandsEvent event) {
        //register commands
        BrigadierBridge.createCommandNodes(
                Commands.create(pluginInstance),
                new BrigadierExecutionHandler(pluginInstance),
                (CommandSourceStack forgeSource) -> new ForgeCommandSource(this, forgeSource)
        ).forEach(event.getDispatcher().getRoot()::addChild);
    }

    @SubscribeEvent
    public void onServerStarted(ServerStartedEvent event) {
        //save worlds to generate level.dat files
        serverInstance.saveAllChunks(false, true, true);

        new Thread(() -> {
            Logger.global.logInfo("Loading...");

            try {
                pluginInstance.load();
                if (pluginInstance.isLoaded()) Logger.global.logInfo("Loaded!");
            } catch (IOException e) {
                Logger.global.logError("Failed to load bluemap!", e);
                pluginInstance.unload();
            }
        }, "BlueMap-Plugin-Loading").start();
    }

    @SubscribeEvent
    public void onServerStopping(ServerStoppingEvent event) {
        pluginInstance.unload();
        Logger.global.logInfo("BlueMap unloaded!");
    }

    @SubscribeEvent
    public void onTick(ServerTickEvent evt) {
        if (evt.phase != TickEvent.Phase.END) return;
        MinecraftServer server = this.serverInstance;
        if (server == null) return;
        live.tick(server, onlinePlayerMap::get, this::updateSomePlayers);
    }

    // BlueMap Live: respawns and world-changes are discontinuous position-changes, update those players immediately
    @SubscribeEvent
    public void onPlayerRespawn(PlayerEvent.PlayerRespawnEvent evt) {
        if (evt.getEntity() instanceof ServerPlayer player) onPlayerDiscontinuity(player);
    }

    @SubscribeEvent
    public void onPlayerChangedWorld(PlayerEvent.PlayerChangedDimensionEvent evt) {
        if (evt.getEntity() instanceof ServerPlayer player) onPlayerDiscontinuity(player);
    }

    // BlueMap Live: actions that cause an arm-swing, only observed (never cancelled), so the swing can be classified
    @SubscribeEvent
    public void onAttackEntity(AttackEntityEvent evt) {
        live.onPlayerAction(evt.getEntity(), onlinePlayerMap.get(evt.getEntity().getUUID()), SwingState.Kind.ATTACK);
    }

    @SubscribeEvent
    public void onLeftClickBlock(PlayerInteractEvent.LeftClickBlock evt) {
        live.onPlayerAction(evt.getEntity(), onlinePlayerMap.get(evt.getEntity().getUUID()), SwingState.Kind.MINE);
    }

    @SubscribeEvent
    public void onRightClickBlock(PlayerInteractEvent.RightClickBlock evt) {
        live.onPlayerAction(evt.getEntity(), onlinePlayerMap.get(evt.getEntity().getUUID()), SwingState.Kind.USE);
        live.onUseBlock(evt.getEntity(), evt.getLevel(), evt.getPos());
    }

    @SubscribeEvent
    public void onRightClickItem(PlayerInteractEvent.RightClickItem evt) {
        live.onPlayerAction(evt.getEntity(), onlinePlayerMap.get(evt.getEntity().getUUID()), SwingState.Kind.USE);
    }

    // BlueMap Live: explosions and splash-potions (the effect of a removed entity)
    @SubscribeEvent
    public void onEntityLeaveLevel(EntityLeaveLevelEvent evt) {
        live.onEntityRemoved(evt.getEntity(), evt.getLevel());
    }

    /**
     * Called (on the server-thread) when a players position changed discontinuously, e.g. on respawn or world-change.
     */
    private void onPlayerDiscontinuity(ServerPlayer playerInstance) {
        if (this.serverInstance != playerInstance.getServer()) return;

        if (onlinePlayerMap.get(playerInstance.getUUID()) instanceof MojangPlayer player) {
            player.markDiscontinuity();
            player.update(playerInstance);
        }
    }

    @Override
    public String getMinecraftVersion() {
        return SharedConstants.getCurrentVersion().getId();
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
        for (ServerLevel serverWorld : serverInstance.getAllLevels()) {
            loadedWorlds.add(worlds.get(serverWorld));
        }
        return loadedWorlds;
    }

    @SuppressWarnings("unchecked")
    @Override
    public Optional<ServerWorld> getServerWorld(Object world) {

        if (world instanceof String) {
            ResourceLocation resourceLocation = ResourceLocation.tryParse((String) world);
            if (resourceLocation != null) world = serverInstance.getLevel(ResourceKey.create(Registries.DIMENSION, resourceLocation));
        }

        if (world instanceof ResourceKey) {
            try {
                world = serverInstance.getLevel((ResourceKey<Level>) world);
            } catch (ClassCastException ignored) {}
        }

        if (world instanceof ServerLevel)
            return Optional.of(getServerWorld((ServerLevel) world));

        return Optional.empty();
    }

    @Override
    public ServerWorld getServerWorld(ServerLevel world) {
        return worlds.get(Objects.requireNonNull(world));
    }

    @Override
    public Path getConfigFolder() {
        return Path.of("config", "bluemap");
    }

    @Override
    public Optional<Path> getModsFolder() {
        return Optional.of(Path.of("mods"));
    }

    @SubscribeEvent
    public void onPlayerJoin(PlayerLoggedInEvent evt) {
        if (!(evt.getEntity() instanceof ServerPlayer serverPlayer)) return;

        MojangPlayer player = new MojangPlayer(serverPlayer, this);
        onlinePlayerMap.put(player.getUuid(), player);
        onlinePlayerList.add(player);
    }

    @SubscribeEvent
    public void onPlayerLeave(PlayerLoggedOutEvent evt) {
        var player = evt.getEntity();
        if (!(player instanceof ServerPlayer)) return;

        UUID playerUUID = player.getUUID();
        onlinePlayerMap.remove(playerUUID);
        live.onPlayerLeave(playerUUID);
        synchronized (onlinePlayerList) {
            onlinePlayerList.removeIf(p -> p.getUuid().equals(playerUUID));
        }
    }

    @Override
    public @Nullable MinecraftServer getServer() {
        return this.serverInstance;
    }

    @Override
    public Plugin getPluginInstance() {
        return this.pluginInstance;
    }

    public Plugin getPlugin() {
        return this.pluginInstance;
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

        int intervalTicks = live.getPlayerUpdateIntervalTicks();
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

    @Override
    public List<LiveEntityState> getLiveEntities(ServerWorld world) {
        return live.getLiveEntities(world);
    }

    @Override
    public List<LiveEffect> getLiveEffects(ServerWorld world) {
        return live.getLiveEffects(world);
    }

    @Override
    public List<LiveBlockLog.Change> getLiveBlockChanges(ServerWorld world) {
        return live.getLiveBlockChanges(world);
    }

    @Override
    public List<OpenContainer> getOpenContainers(ServerWorld world) {
        return live.getOpenContainers(world);
    }

    @Override
    public @Nullable LiveWorldTime getLiveWorldTime(ServerWorld world) {
        return live.getLiveWorldTime(world);
    }

}
