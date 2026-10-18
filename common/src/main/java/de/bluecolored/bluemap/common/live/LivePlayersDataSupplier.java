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
package de.bluecolored.bluemap.common.live;

import com.google.gson.stream.JsonWriter;
import de.bluecolored.bluemap.common.config.PluginConfig;
import de.bluecolored.bluemap.common.plugin.items.ItemModelBaker;
import de.bluecolored.bluemap.common.serverinterface.Player;
import de.bluecolored.bluemap.common.serverinterface.Server;
import de.bluecolored.bluemap.common.serverinterface.ServerWorld;
import de.bluecolored.bluemap.core.logger.Logger;
import de.bluecolored.bluemap.core.world.World;
import org.jetbrains.annotations.Nullable;

import java.io.IOException;
import java.io.StringWriter;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.function.Consumer;
import java.util.function.Function;
import java.util.function.Predicate;
import java.util.function.Supplier;

public class LivePlayersDataSupplier implements Supplier<String> {

    private final Server server;
    private final PluginConfig config;
    private final World world;
    private final Predicate<UUID> playerFilter;
    private final int updateIntervalMillis;
    private final Function<UUID, LivePlayersJson.Skin> skinLookup;
    private final Consumer<String> itemRequester;

    /** item-requests with this prefix request a texture (armor), e.g. <code>texture:minecraft:models/armor/iron_layer_1</code> */
    public static final String TEXTURE_PREFIX = "texture:";

    private transient @Nullable ServerWorld serverWorld;

    public LivePlayersDataSupplier(Server server, PluginConfig config, World world, Predicate<UUID> playerFilter) {
        this(server, config, world, playerFilter, config.getLivePlayerUpdateInterval());
    }

    /**
     * @param updateIntervalMillis the interval that is announced to clients, in which they should poll for new data
     */
    public LivePlayersDataSupplier(Server server, PluginConfig config, World world, Predicate<UUID> playerFilter, int updateIntervalMillis) {
        this(server, config, world, playerFilter, updateIntervalMillis, uuid -> null);
    }

    /**
     * @param skinLookup provides the info about the stored full skin of a player, returns null if there is none
     */
    public LivePlayersDataSupplier(Server server, PluginConfig config, World world, Predicate<UUID> playerFilter, int updateIntervalMillis,
                                   Function<UUID, LivePlayersJson.Skin> skinLookup) {
        this(server, config, world, playerFilter, updateIntervalMillis, skinLookup, itemId -> {});
    }

    /**
     * @param itemRequester called with the id of every item a listed player holds (so the item-asset can be provided)
     */
    public LivePlayersDataSupplier(Server server, PluginConfig config, World world, Predicate<UUID> playerFilter, int updateIntervalMillis,
                                   Function<UUID, LivePlayersJson.Skin> skinLookup, Consumer<String> itemRequester) {
        this.itemRequester = itemRequester;
        this.server = server;
        this.config = config;
        this.world = world;
        this.playerFilter = playerFilter;
        this.updateIntervalMillis = updateIntervalMillis;
        this.skinLookup = skinLookup;
    }

    /**
     * If a player is listed on the map according to the config (hidden game-modes, invisible, vanished, ...)
     * and the player-filter (e.g. players hidden by command).
     */
    static boolean isShown(Player player, PluginConfig config, Predicate<UUID> playerFilter, boolean isCorrectWorld) {
        if (config.isHideInvisible() && player.isInvisible()) return false;
        if (config.isHideVanished() && player.isVanished()) return false;
        if (config.isHideSneaking() && player.isSneaking()) return false;
        if (config.getHiddenGameModes().contains(player.getGamemode().getId())) return false;
        if (config.isHideDifferentWorld() && !isCorrectWorld) return false;
        if (
                player.getSkyLight() < config.getHideBelowSkyLight() &&
                player.getBlockLight() < config.getHideBelowBlockLight()
        ) return false;
        return playerFilter.test(player.getUuid());
    }

    @Override
    public String get() {
        long start = System.nanoTime();
        try {
            return build();
        } finally {
            LiveStats.add(LiveStats.PLAYERS_JSON_NANOS, System.nanoTime() - start);
        }
    }

    private String build() {
        if (serverWorld == null)
            serverWorld = server.getServerWorld(world).orElse(null);

        List<LivePlayersJson.Entry> entries = new ArrayList<>();
        if (config.isLivePlayerMarkers()) {
            for (Player player : this.server.getOnlinePlayers()) {
                Player.LiveSnapshot snapshot = player.getLiveSnapshot();
                ServerWorld playerWorld = snapshot.world();
                boolean isCorrectWorld = playerWorld != null && playerWorld.equals(serverWorld);

                if (!isShown(player, config, playerFilter, isCorrectWorld)) continue;

                Equipment equipment = snapshot.state() != null ? snapshot.state().equipment() : null;
                if (equipment != null && config.isLivePlayerExtendedData()) {
                    if (equipment.mainHand() != null) itemRequester.accept(equipment.mainHand().id());
                    if (equipment.offHand() != null) itemRequester.accept(equipment.offHand().id());
                    if (equipment.armor() != null) equipment.armor().textures().forEach(t -> itemRequester.accept(TEXTURE_PREFIX + t));
                    if (equipment.head() != null) itemRequester.accept(ItemModelBaker.SKULL_TEXTURES.containsKey(equipment.head().id()) ?
                        TEXTURE_PREFIX + ItemModelBaker.SKULL_TEXTURES.get(equipment.head().id()) : equipment.head().id());
                }

                if (snapshot.state() != null && snapshot.state().particles() != null && config.isLivePlayerExtendedData())
                    LiveEntitiesDataSupplier.requestParticleTextures(itemRequester);

                entries.add(new LivePlayersJson.Entry(
                        player.getUuid().toString(),
                        player.getName().toPlainString(),
                        !isCorrectWorld,
                        playerWorld != null ? playerWorld.getDimension().getFormatted() : null,
                        snapshot.state(),
                        skinLookup.apply(player.getUuid())
                ));
            }
        }

        LiveWorldTime worldTime = serverWorld != null ? server.getLiveWorldTime(serverWorld) : null;
        // the sky- and weather-textures of the world-time mode (cheap if they were requested before)
        if (worldTime != null) for (String texture : LiveWorldTime.TEXTURES) itemRequester.accept(TEXTURE_PREFIX + texture);

        try (StringWriter jsonString = new StringWriter();
            JsonWriter json = new JsonWriter(jsonString)) {

            LivePlayersJson.write(
                    json,
                    System.currentTimeMillis(),
                    updateIntervalMillis,
                    config.isLivePlayerExtendedData(),
                    entries,
                    worldTime
            );

            json.flush();
            return jsonString.toString();
        } catch (IOException ex) {
            Logger.global.logError("Failed to write live/players json!", ex);
            return "BlueMap - Exception handling this request";
        }
    }

}
