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
import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import de.bluecolored.bluemap.common.config.PluginConfig;
import de.bluecolored.bluemap.common.plugin.text.Text;
import de.bluecolored.bluemap.common.serverinterface.Gamemode;
import de.bluecolored.bluemap.common.serverinterface.Player;
import de.bluecolored.bluemap.common.serverinterface.Server;
import de.bluecolored.bluemap.common.serverinterface.ServerEventListener;
import de.bluecolored.bluemap.common.serverinterface.ServerWorld;
import de.bluecolored.bluemap.core.util.Key;
import de.bluecolored.bluemap.core.world.World;
import org.junit.jupiter.api.Test;

import java.lang.reflect.Field;
import java.lang.reflect.Proxy;
import java.nio.file.Path;
import java.util.*;

import static org.junit.jupiter.api.Assertions.*;

public class LivePlayersDataSupplierTest {

    private static final UUID PLAYER = UUID.fromString("069a79f4-44e9-4726-a5be-fca90e38aaf5");

    private final ServerWorld overworld = new TestServerWorld(new Key("minecraft", "overworld"));
    private final ServerWorld nether = new TestServerWorld(new Key("minecraft", "the_nether"));

    /** the map-world, only used as a key to look up the server-world */
    private final World mapWorld = (World) Proxy.newProxyInstance(
            World.class.getClassLoader(), new Class[]{ World.class },
            (proxy, method, args) -> switch (method.getName()) {
                case "hashCode" -> System.identityHashCode(proxy);
                case "equals" -> proxy == args[0];
                case "toString" -> "TestMapWorld";
                default -> throw new UnsupportedOperationException(method.getName());
            });

    @Test
    public void testUsesOneConsistentSnapshot() {
        // getWorld() already returns the new world (nether), but the sampled snapshot still belongs to the overworld
        TestPlayer player = new TestPlayer(nether, new Vector3d(800, 70, 800));
        player.snapshot = new Player.LiveSnapshot(overworld, state(new Vector3d(100, 64, 100), 0));

        JsonObject p = onlyPlayer(supply(new PluginConfig(), player));

        assertFalse(p.get("foreign").getAsBoolean(), "foreign must be derived from the snapshot-world");
        assertEquals("minecraft:overworld", p.get("world").getAsString());
        assertEquals(100, p.getAsJsonObject("position").get("x").getAsDouble());
        assertEquals(0, p.get("generation").getAsInt());
    }

    @Test
    public void testPlayerInOtherWorldIsForeign() {
        TestPlayer player = new TestPlayer(nether, new Vector3d(10, 70, 10));

        JsonObject p = onlyPlayer(supply(new PluginConfig(), player));

        assertTrue(p.get("foreign").getAsBoolean());
        assertEquals("minecraft:the_nether", p.get("world").getAsString());
    }

    @Test
    public void testHideDifferentWorld() throws Exception {
        PluginConfig config = config("hideDifferentWorld", true);
        assertEquals(0, players(supply(config, new TestPlayer(nether, Vector3d.ZERO))).size());
        assertEquals(1, players(supply(config, new TestPlayer(overworld, Vector3d.ZERO))).size());
    }

    @Test
    public void testFilters() throws Exception {
        TestPlayer invisible = new TestPlayer(overworld, Vector3d.ZERO);
        invisible.invisible = true;
        assertEquals(0, players(supply(new PluginConfig(), invisible)).size(), "invisible players are hidden by default");

        TestPlayer visible = new TestPlayer(overworld, Vector3d.ZERO);
        String json = new LivePlayersDataSupplier(new TestServer(visible), new PluginConfig(), mapWorld, uuid -> false).get();
        assertEquals(0, players(json).size(), "player-filter (hidden players) is applied");

        assertEquals(0, players(supply(config("livePlayerMarkers", false), visible)).size());
    }

    @Test
    public void testExtendedDataCanBeDisabled() throws Exception {
        JsonObject p = onlyPlayer(supply(config("livePlayerExtendedData", false), new TestPlayer(overworld, Vector3d.ZERO)));
        assertEquals(Set.of("uuid", "name", "foreign", "position", "rotation"), p.keySet());
    }

    @Test
    public void testAnnouncedUpdateInterval() throws Exception {
        TestPlayer player = new TestPlayer(overworld, Vector3d.ZERO);
        assertEquals(250, root(supply(new PluginConfig(), player)).get("updateInterval").getAsInt());
        assertEquals(500, root(supply(config("livePlayerUpdateInterval", 500), player)).get("updateInterval").getAsInt());
        assertEquals(50, root(supply(config("livePlayerUpdateInterval", 1), player)).get("updateInterval").getAsInt(), "clamped");

        String json = new LivePlayersDataSupplier(new TestServer(player), new PluginConfig(), mapWorld, uuid -> true, 3000).get();
        assertEquals(3000, root(json).get("updateInterval").getAsInt());
    }

    @Test
    public void testSkinLookup() {
        TestPlayer player = new TestPlayer(overworld, Vector3d.ZERO);
        LivePlayersJson.Skin skin = new LivePlayersJson.Skin("classic", "abc123");

        String json = new LivePlayersDataSupplier(new TestServer(player), new PluginConfig(), mapWorld, uuid -> true, 250,
                uuid -> uuid.equals(PLAYER) ? skin : null).get();
        JsonObject p = onlyPlayer(json);
        assertEquals("classic", p.getAsJsonObject("skin").get("model").getAsString());
        assertEquals("abc123", p.getAsJsonObject("skin").get("version").getAsString());

        assertFalse(onlyPlayer(supply(new PluginConfig(), player)).has("skin"), "no lookup -> no skin field");
    }

    @Test
    public void testHeldItemsAreRequested() throws Exception {
        TestPlayer player = new TestPlayer(overworld, Vector3d.ZERO);
        Equipment equipment = new Equipment(new HeldItem("minecraft:bow"), new HeldItem("minecraft:shield"), false, false);
        player.snapshot = new Player.LiveSnapshot(overworld, new LivePlayerState(Vector3d.ZERO, Vector3d.ZERO, 0, Vector3d.ZERO,
                0, 0, null, null, equipment, null));

        List<String> requested = new ArrayList<>();
        String json = new LivePlayersDataSupplier(new TestServer(player), new PluginConfig(), mapWorld, uuid -> true, 250,
                uuid -> null, requested::add).get();
        assertEquals(List.of("minecraft:bow", "minecraft:shield"), requested, "the item-assets of listed players are requested");
        assertEquals("minecraft:bow", onlyPlayer(json).getAsJsonObject("equipment").getAsJsonObject("mainHand").get("id").getAsString());

        // hidden players and disabled extended data: nothing is requested
        requested.clear();
        new LivePlayersDataSupplier(new TestServer(player), new PluginConfig(), mapWorld, uuid -> false, 250,
                uuid -> null, requested::add).get();
        new LivePlayersDataSupplier(new TestServer(player), config("livePlayerExtendedData", false), mapWorld, uuid -> true, 250,
                uuid -> null, requested::add).get();
        assertEquals(List.of(), requested);
    }

    @Test
    public void testDefaultSnapshotUsesWorldAndLiveState() {
        Player player = new TestPlayer(nether, new Vector3d(1, 2, 3));
        Player.LiveSnapshot snapshot = player.getLiveSnapshot();
        assertSame(nether, snapshot.world());
        assertEquals(new Vector3d(1, 2, 3), snapshot.state().position());
    }

    // --- helpers ---

    private String supply(PluginConfig config, Player... players) {
        return new LivePlayersDataSupplier(new TestServer(players), config, mapWorld, uuid -> true).get();
    }

    private static JsonObject root(String json) {
        return JsonParser.parseString(json).getAsJsonObject();
    }

    private static JsonArray players(String json) {
        return root(json).getAsJsonArray("players");
    }

    private static JsonObject onlyPlayer(String json) {
        JsonArray players = players(json);
        assertEquals(1, players.size());
        return players.get(0).getAsJsonObject();
    }

    private static PluginConfig config(String field, Object value) throws Exception {
        PluginConfig config = new PluginConfig();
        Field f = PluginConfig.class.getDeclaredField(field);
        f.setAccessible(true);
        f.set(config, value);
        return config;
    }

    private static LivePlayerState state(Vector3d position, int generation) {
        return new LivePlayerState(position, Vector3d.ZERO, 0, Vector3d.ZERO, generation, 1000, null);
    }

    private record TestServerWorld(Key dimension) implements ServerWorld {
        @Override public Path getWorldFolder() { return Path.of("world"); }
        @Override public Key getDimension() { return dimension; }
    }

    private class TestServer implements Server {
        private final List<Player> players;

        TestServer(Player... players) {
            this.players = List.of(players);
        }

        @Override public Optional<ServerWorld> getServerWorld(World world) {
            return world == mapWorld ? Optional.of(overworld) : Optional.empty();
        }
        @Override public String getMinecraftVersion() { return "1.21.1"; }
        @Override public Path getConfigFolder() { return Path.of("config"); }
        @Override public Optional<Path> getModsFolder() { return Optional.empty(); }
        @Override public Collection<ServerWorld> getLoadedServerWorlds() { return List.of(overworld, nether); }
        @Override public Collection<Player> getOnlinePlayers() { return players; }
        @Override public void registerListener(ServerEventListener listener) {}
        @Override public void unregisterAllListeners() {}
    }

    private static class TestPlayer extends Player {
        private final ServerWorld world;
        private final Vector3d position;
        private boolean invisible = false;
        private Player.LiveSnapshot snapshot = null;

        TestPlayer(ServerWorld world, Vector3d position) {
            this.world = world;
            this.position = position;
        }

        @Override public LiveSnapshot getLiveSnapshot() { return snapshot != null ? snapshot : super.getLiveSnapshot(); }
        @Override public UUID getUuid() { return PLAYER; }
        @Override public Text getName() { return Text.of("Notch"); }
        @Override public ServerWorld getWorld() { return world; }
        @Override public Vector3d getPosition() { return position; }
        @Override public Vector3d getRotation() { return Vector3d.ZERO; }
        @Override public int getSkyLight() { return 15; }
        @Override public int getBlockLight() { return 0; }
        @Override public boolean isSneaking() { return false; }
        @Override public boolean isInvisible() { return invisible; }
        @Override public Gamemode getGamemode() { return Gamemode.SURVIVAL; }
    }

}
