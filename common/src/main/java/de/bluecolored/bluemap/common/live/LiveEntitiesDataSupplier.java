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

import com.flowpowered.math.vector.Vector3d;
import com.google.gson.stream.JsonWriter;
import de.bluecolored.bluemap.common.config.PluginConfig;
import de.bluecolored.bluemap.common.serverinterface.Player;
import de.bluecolored.bluemap.common.serverinterface.Server;
import de.bluecolored.bluemap.common.serverinterface.ServerWorld;
import de.bluecolored.bluemap.core.logger.Logger;
import de.bluecolored.bluemap.core.world.World;
import org.jetbrains.annotations.Nullable;

import java.io.IOException;
import java.io.StringWriter;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.UUID;
import java.util.function.Consumer;
import java.util.function.Predicate;
import java.util.function.Supplier;

/**
 * Supplies the <code>live/entities.json</code> of a map: the entities (no players) around the players that are
 * listed on this map.
 * <p>Only entities within the configured radius of a <b>shown</b> player are written, so hidden players
 * (hidden game-modes, vanished, invisible, hidden by command) are not revealed by the entities around them.
 * The nearest entities come first, at most the configured limit.</p>
 */
public class LiveEntitiesDataSupplier implements Supplier<String> {

    private final Server server;
    private final PluginConfig config;
    private final World world;
    private final Predicate<UUID> playerFilter;
    private final int updateIntervalMillis;
    private final Consumer<String> itemRequester;
    private final Consumer<String> entityRequester;

    private transient @Nullable ServerWorld serverWorld;

    /**
     * @param itemRequester called with the id of every item of a listed entity (so the item-asset can be provided)
     */
    public LiveEntitiesDataSupplier(Server server, PluginConfig config, World world, Predicate<UUID> playerFilter,
                                    int updateIntervalMillis, Consumer<String> itemRequester) {
        this(server, config, world, playerFilter, updateIntervalMillis, itemRequester, type -> {});
    }

    /**
     * @param entityRequester called with the type of every listed entity (so the asset of an own entity-model can be provided)
     */
    public LiveEntitiesDataSupplier(Server server, PluginConfig config, World world, Predicate<UUID> playerFilter,
                                    int updateIntervalMillis, Consumer<String> itemRequester, Consumer<String> entityRequester) {
        this.entityRequester = entityRequester;
        this.server = server;
        this.config = config;
        this.world = world;
        this.playerFilter = playerFilter;
        this.updateIntervalMillis = updateIntervalMillis;
        this.itemRequester = itemRequester;
    }

    private record Listed(LiveEntityState entity, double distanceSquared) {}

    @Override
    public String get() {
        if (serverWorld == null)
            serverWorld = server.getServerWorld(world).orElse(null);

        List<LiveEntityState> result = new ArrayList<>();
        if (config.isLiveEntities() && config.isLivePlayerMarkers() && serverWorld != null) {

            // the positions of the players that are shown on this map
            List<Vector3d> players = new ArrayList<>();
            for (Player player : server.getOnlinePlayers()) {
                Player.LiveSnapshot snapshot = player.getLiveSnapshot();
                if (snapshot.state() == null || !serverWorld.equals(snapshot.world())) continue;
                if (!LivePlayersDataSupplier.isShown(player, config, playerFilter, true)) continue;
                players.add(snapshot.state().position());
            }

            if (!players.isEmpty()) {
                double radius = config.getLiveEntitiesRadius();
                double radiusSquared = radius * radius;
                List<Listed> listed = new ArrayList<>();
                for (LiveEntityState entity : server.getLiveEntities(serverWorld)) {
                    if (config.getLiveEntitiesHiddenTypes().contains(entity.type())) continue;
                    double nearest = Double.MAX_VALUE;
                    for (Vector3d player : players) {
                        nearest = Math.min(nearest, player.distanceSquared(entity.position()));
                    }
                    if (nearest <= radiusSquared) listed.add(new Listed(entity, nearest));
                }

                listed.sort(Comparator.comparingDouble(Listed::distanceSquared));
                int limit = config.getLiveEntitiesLimit();
                for (int i = 0; i < listed.size() && i < limit; i++) {
                    LiveEntityState entity = listed.get(i).entity();
                    if (entity.item() != null) itemRequester.accept(entity.item().id());
                    if (entity.mob() != null) entity.mob().models().forEach(itemRequester);
                    Equipment equipment = entity.mob() != null ? entity.mob().equipment() : null;
                    if (equipment != null) {
                        if (equipment.mainHand() != null) itemRequester.accept(equipment.mainHand().id());
                        if (equipment.offHand() != null) itemRequester.accept(equipment.offHand().id());
                        if (equipment.armor() != null) equipment.armor().textures().forEach(t -> itemRequester.accept(LivePlayersDataSupplier.TEXTURE_PREFIX + t));
                    }
                    entityRequester.accept(entity.type());
                    result.add(entity);
                }
            }
        }

        try (StringWriter jsonString = new StringWriter();
             JsonWriter json = new JsonWriter(jsonString)) {
            LiveEntitiesJson.write(json, System.currentTimeMillis(), updateIntervalMillis, result);
            json.flush();
            return jsonString.toString();
        } catch (IOException ex) {
            Logger.global.logError("Failed to write live/entities json!", ex);
            return "BlueMap - Exception handling this request";
        }
    }

}
