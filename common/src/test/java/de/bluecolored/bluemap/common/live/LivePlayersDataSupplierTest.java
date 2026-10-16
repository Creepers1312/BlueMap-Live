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

    // --- entities (BlueMap Live) ---

    private static LiveEntityState entity(int id, String type, Vector3d position, HeldItem item) {
        return new LiveEntityState(id, type, position, 0, 0, Vector3d.ZERO, 1000, item, false);
    }

    private String supplyEntities(PluginConfig config, TestServer server, List<String> requested) {
        return new LiveEntitiesDataSupplier(server, config, mapWorld, uuid -> true, 250, requested::add).get();
    }

    private static JsonArray entities(String json) {
        return root(json).getAsJsonArray("entities");
    }

    @Test
    public void testEntitiesAroundShownPlayers() {
        TestPlayer player = new TestPlayer(overworld, new Vector3d(0, 64, 0));
        player.snapshot = new Player.LiveSnapshot(overworld, state(new Vector3d(0, 64, 0), 0));
        TestServer server = new TestServer(player);
        server.entities = List.of(
                entity(1, "minecraft:item", new Vector3d(20, 64, 0), new HeldItem("minecraft:diamond")),
                entity(2, "minecraft:arrow", new Vector3d(5, 64, 0), new HeldItem("minecraft:arrow")),
                entity(3, "minecraft:item", new Vector3d(100, 64, 0), new HeldItem("minecraft:stone")) // outside of 30 blocks
        );

        List<String> requested = new ArrayList<>();
        JsonObject root = root(supplyEntities(new PluginConfig(), server, requested));
        assertEquals(1, root.get("protocol").getAsInt());
        JsonArray list = root.getAsJsonArray("entities");
        assertEquals(2, list.size());
        assertEquals(2, list.get(0).getAsJsonObject().get("id").getAsInt(), "the nearest entity first");
        assertEquals("minecraft:item", list.get(1).getAsJsonObject().get("type").getAsString());
        assertEquals("minecraft:diamond", list.get(1).getAsJsonObject().getAsJsonObject("item").get("id").getAsString());
        assertEquals(List.of("minecraft:arrow", "minecraft:diamond"), requested, "item-assets of the listed entities");

        List<String> types = new ArrayList<>();
        new LiveEntitiesDataSupplier(server, new PluginConfig(), mapWorld, uuid -> true, 250, id -> {}, types::add).get();
        assertEquals(List.of("minecraft:arrow", "minecraft:item"), types, "entity-types of the listed entities (own entity-models)");
    }

    @Test
    public void testEntitiesLimitHiddenTypesAndDisabled() throws Exception {
        TestPlayer player = new TestPlayer(overworld, Vector3d.ZERO);
        player.snapshot = new Player.LiveSnapshot(overworld, state(Vector3d.ZERO, 0));
        TestServer server = new TestServer(player);
        List<LiveEntityState> many = new ArrayList<>();
        for (int i = 0; i < 300; i++) many.add(entity(i, "minecraft:item", new Vector3d(i * 0.1, 0, 0), null));
        many.add(entity(1000, "minecraft:arrow", new Vector3d(0, 0, 0), null));
        server.entities = many;

        assertEquals(200, entities(supplyEntities(new PluginConfig(), server, new ArrayList<>())).size(), "default limit");
        assertEquals(10, entities(supplyEntities(config("liveEntitiesLimit", 10), server, new ArrayList<>())).size());
        JsonArray noItems = entities(supplyEntities(config("liveEntitiesHiddenTypes", List.of("minecraft:item")), server, new ArrayList<>()));
        assertEquals(1, noItems.size());
        assertEquals("minecraft:arrow", noItems.get(0).getAsJsonObject().get("type").getAsString());
        assertEquals(0, entities(supplyEntities(config("liveEntities", false), server, new ArrayList<>())).size());
        assertEquals(0, entities(supplyEntities(config("livePlayerMarkers", false), server, new ArrayList<>())).size());
    }

    @Test
    public void testMobState() {
        TestPlayer player = new TestPlayer(overworld, Vector3d.ZERO);
        player.snapshot = new Player.LiveSnapshot(overworld, state(Vector3d.ZERO, 0));
        TestServer server = new TestServer(player);
        LiveMobState zombie = new LiveMobState(90, 120, 7, 0, true,
                new Equipment(new HeldItem("minecraft:iron_sword"), new HeldItem("minecraft:shield"), true, false),
                null, 0, 0.6, 1.95, List.of("attacking"));
        LiveMobState sheep = new LiveMobState(0, 0, 0, 3, false, null, "light_blue", 0, 0.9, 1.3, List.of("sheared"));
        server.entities = List.of(
                new LiveEntityState(1, "minecraft:zombie", new Vector3d(2, 0, 0), 0, 10, Vector3d.ZERO, 1000, null, true, zombie),
                new LiveEntityState(2, "minecraft:sheep", new Vector3d(3, 0, 0), 0, 0, Vector3d.ZERO, 1000, null, true, sheep)
        );

        List<String> requested = new ArrayList<>();
        JsonArray list = entities(supplyEntities(new PluginConfig(), server, requested));
        JsonObject mob = list.get(0).getAsJsonObject().getAsJsonObject("mob");
        assertEquals(90, mob.get("bodyYaw").getAsDouble());
        assertEquals(120, mob.get("headYaw").getAsDouble());
        assertEquals(7, mob.get("hurtTime").getAsInt());
        assertFalse(mob.has("deathTime"), "only values that differ from the default");
        assertFalse(mob.has("swingTicks"), "not swinging");
        assertFalse(mob.has("attackTicks"));
        assertTrue(mob.get("baby").getAsBoolean());
        assertEquals("attacking", mob.getAsJsonArray("flags").get(0).getAsString());
        JsonObject equipment = mob.getAsJsonObject("equipment");
        assertEquals("minecraft:iron_sword", equipment.getAsJsonObject("mainHand").get("id").getAsString());
        assertEquals("left", equipment.get("mainArm").getAsString(), "like the players");
        assertEquals(1.95, mob.get("height").getAsDouble(), 1e-9);
        assertEquals(List.of("minecraft:iron_sword", "minecraft:shield"), requested, "the item-assets of the held items");

        JsonObject sheepJson = list.get(1).getAsJsonObject().getAsJsonObject("mob");
        assertEquals("light_blue", sheepJson.get("variant").getAsString());
        assertEquals(3, sheepJson.get("deathTime").getAsInt());
        assertFalse(sheepJson.has("equipment"));
        assertFalse(list.get(1).getAsJsonObject().has("item"));

        // block-models (mooshroom-mushrooms, carried block) and armor-textures are requested like items
        LiveMobState mooshroom = new LiveMobState(0, 0, 0, 0, false,
                new Equipment(null, null, false, false, new Armor(List.of(new Armor.Layer("minecraft:models/armor/iron_layer_1", null)), null, null, null)),
                "red", 0, 0.9, 1.4, List.of("minecraft:block/red_mushroom"), List.of());
        server.entities = List.of(new LiveEntityState(3, "minecraft:mooshroom", new Vector3d(1, 0, 0), 0, 0, Vector3d.ZERO, 1000, null, true, mooshroom));
        List<String> requested2 = new ArrayList<>();
        JsonObject mooshroomJson = entities(supplyEntities(new PluginConfig(), server, requested2)).get(0).getAsJsonObject().getAsJsonObject("mob");
        assertEquals("minecraft:block/red_mushroom", mooshroomJson.getAsJsonArray("models").get(0).getAsString());
        assertEquals("minecraft:models/armor/iron_layer_1", mooshroomJson.getAsJsonObject("equipment").getAsJsonObject("armor")
                .getAsJsonArray("head").get(0).getAsJsonObject().get("texture").getAsString());
        assertEquals(List.of("minecraft:block/red_mushroom", "texture:minecraft:models/armor/iron_layer_1"), requested2);

        // the hand-swing and the attack-animation
        LiveMobState golem = new LiveMobState(0, 0, 0, 0, false, null, null, 0, 1.4, 2.7, List.of(), List.of(), 0, 10);
        LiveMobState swinging = new LiveMobState(0, 0, 0, 0, false, null, null, 0, 0.6, 1.95, List.of(), List.of("swing_off_hand"), 3, 0);
        server.entities = List.of(
                new LiveEntityState(4, "minecraft:iron_golem", new Vector3d(1, 0, 0), 0, 0, Vector3d.ZERO, 1000, null, true, golem),
                new LiveEntityState(5, "minecraft:zombie", new Vector3d(1, 0, 1), 0, 0, Vector3d.ZERO, 1000, null, true, swinging));
        JsonArray attacks = entities(supplyEntities(new PluginConfig(), server, new ArrayList<>()));
        JsonObject golemJson = attacks.get(0).getAsJsonObject().getAsJsonObject("mob");
        assertEquals(0, golemJson.get("swingTicks").getAsInt(), "the first tick of a swing");
        assertEquals(10, golemJson.get("attackTicks").getAsInt());
        JsonObject swingJson = attacks.get(1).getAsJsonObject().getAsJsonObject("mob");
        assertEquals(3, swingJson.get("swingTicks").getAsInt());
        assertFalse(swingJson.has("attackTicks"));

        // leashes: held by an entity (fence-knot) or a player, both ends relative to their entity
        java.util.UUID holder = java.util.UUID.fromString("069a79f4-44e9-4726-a5be-fca90e38aaf5");
        LiveMobState onKnot = swinging.withLeash(new Leash(9, null, new Vector3d(0, 1.2, 0.3), new Vector3d(0, 0.2, 0)));
        LiveMobState onPlayer = swinging.withLeash(new Leash(null, holder, new Vector3d(0, 1.2, 0.3), new Vector3d(-0.22, 0.8, 0.07)));
        server.entities = List.of(
                new LiveEntityState(6, "minecraft:cow", new Vector3d(1, 0, 0), 0, 0, Vector3d.ZERO, 1000, null, true, onKnot),
                new LiveEntityState(7, "minecraft:cow", new Vector3d(1, 0, 1), 0, 0, Vector3d.ZERO, 1000, null, true, onPlayer),
                new LiveEntityState(8, "minecraft:cow", new Vector3d(2, 0, 1), 0, 0, Vector3d.ZERO, 1000, null, true, golem));
        JsonArray leashed = entities(supplyEntities(new PluginConfig(), server, new ArrayList<>()));
        JsonObject knotLeash = leashed.get(0).getAsJsonObject().getAsJsonObject("mob").getAsJsonObject("leash");
        assertEquals(9, knotLeash.get("entity").getAsInt());
        assertFalse(knotLeash.has("player"));
        assertEquals(1.2, knotLeash.getAsJsonObject("start").get("y").getAsDouble(), 1e-9);
        JsonObject playerLeash = leashed.get(1).getAsJsonObject().getAsJsonObject("mob").getAsJsonObject("leash");
        assertEquals(holder.toString(), playerLeash.get("player").getAsString());
        assertEquals(-0.22, playerLeash.getAsJsonObject("end").get("x").getAsDouble(), 1e-9);
        assertFalse(leashed.get(2).getAsJsonObject().getAsJsonObject("mob").has("leash"), "not leashed");

        // flags are sorted and unique
        assertEquals(List.of("a", "b"), new LiveMobState(0, 0, 0, 0, false, null, null, 0, 1, 1, List.of("b", "a", "b")).flags());
    }

    @Test
    public void testProjectileImpact() {
        TestPlayer player = new TestPlayer(overworld, Vector3d.ZERO);
        player.snapshot = new Player.LiveSnapshot(overworld, state(Vector3d.ZERO, 0));
        TestServer server = new TestServer(player);
        server.entities = List.of(
                new LiveEntityState(1, "minecraft:arrow", new Vector3d(1, 0, 0), 0, 0, new Vector3d(40, 0, 0), 1000,
                        null, false, null, new LiveEntityState.Impact(new Vector3d(4, 0.5, 0), 1.5)),
                entity(2, "minecraft:arrow", new Vector3d(2, 0, 0), null)
        );
        JsonArray list = entities(supplyEntities(new PluginConfig(), server, new ArrayList<>()));
        JsonObject impact = list.get(0).getAsJsonObject().getAsJsonObject("impact");
        assertEquals(4, impact.get("x").getAsDouble());
        assertEquals(0.5, impact.get("y").getAsDouble());
        assertEquals(1.5, impact.get("ticks").getAsDouble());
        assertFalse(list.get(1).getAsJsonObject().has("impact"), "no impact predicted");
    }

    @Test
    public void testEntitiesDoNotRevealHiddenPlayers() {
        TestPlayer hidden = new TestPlayer(overworld, Vector3d.ZERO);
        hidden.invisible = true; // invisible players are hidden by default
        hidden.snapshot = new Player.LiveSnapshot(overworld, state(Vector3d.ZERO, 0));
        TestServer server = new TestServer(hidden);
        server.entities = List.of(entity(1, "minecraft:item", new Vector3d(1, 0, 0), null));
        assertEquals(0, entities(supplyEntities(new PluginConfig(), server, new ArrayList<>())).size(),
                "entities around a hidden player would reveal his position");

        // a player in another world shows nothing on this map
        TestPlayer inNether = new TestPlayer(nether, Vector3d.ZERO);
        inNether.snapshot = new Player.LiveSnapshot(nether, state(Vector3d.ZERO, 0));
        TestServer netherServer = new TestServer(inNether);
        netherServer.entities = server.entities;
        assertEquals(0, entities(supplyEntities(new PluginConfig(), netherServer, new ArrayList<>())).size());

        // filtered by the player-filter (e.g. /bluemap player hide)
        TestPlayer filtered = new TestPlayer(overworld, Vector3d.ZERO);
        filtered.snapshot = new Player.LiveSnapshot(overworld, state(Vector3d.ZERO, 0));
        TestServer filteredServer = new TestServer(filtered);
        filteredServer.entities = server.entities;
        String json = new LiveEntitiesDataSupplier(filteredServer, new PluginConfig(), mapWorld, uuid -> false, 250, id -> {}).get();
        assertEquals(0, entities(json).size());
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
        private List<LiveEntityState> entities = List.of();

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
        @Override public List<LiveEntityState> getLiveEntities(ServerWorld world) {
            return world == overworld ? entities : List.of();
        }
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
