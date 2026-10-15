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
import com.google.gson.stream.JsonWriter;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.io.StringWriter;
import java.util.List;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.*;

public class LivePlayersJsonTest {

    private static final String UUID = "069a79f4-44e9-4726-a5be-fca90e38aaf5";

    private static LivePlayerState state(MovementState movement) {
        return new LivePlayerState(
                new Vector3d(10.5, 64, -20.25),
                new Vector3d(15, 90, 0),
                80,
                new Vector3d(4.3, 0, 0),
                3,
                123456789L,
                movement
        );
    }

    private static JsonObject writeAndParse(boolean extended, List<LivePlayersJson.Entry> entries) throws IOException {
        StringWriter out = new StringWriter();
        try (JsonWriter json = new JsonWriter(out)) {
            LivePlayersJson.write(json, 1000L, 250, extended, entries);
        }
        return JsonParser.parseString(out.toString()).getAsJsonObject();
    }

    @Test
    public void testRoundTripExtended() throws IOException {
        MovementState movement = new MovementState(true, false, true, false, false, true);
        JsonObject root = writeAndParse(true, List.of(
                new LivePlayersJson.Entry(UUID, "Notch", false, "minecraft:overworld", state(movement))
        ));

        assertEquals(LivePlayersJson.PROTOCOL_VERSION, root.get("protocol").getAsInt());
        assertEquals(1000L, root.get("serverTime").getAsLong());
        assertEquals(250, root.get("updateInterval").getAsInt());

        JsonArray players = root.getAsJsonArray("players");
        assertEquals(1, players.size());
        JsonObject p = players.get(0).getAsJsonObject();

        // original fields, unchanged meaning
        assertEquals(UUID, p.get("uuid").getAsString());
        assertEquals("Notch", p.get("name").getAsString());
        assertFalse(p.get("foreign").getAsBoolean());
        assertEquals(10.5, p.getAsJsonObject("position").get("x").getAsDouble());
        assertEquals(64, p.getAsJsonObject("position").get("y").getAsDouble());
        assertEquals(-20.25, p.getAsJsonObject("position").get("z").getAsDouble());
        assertEquals(15, p.getAsJsonObject("rotation").get("pitch").getAsDouble());
        assertEquals(90, p.getAsJsonObject("rotation").get("yaw").getAsDouble());
        assertEquals(0, p.getAsJsonObject("rotation").get("roll").getAsDouble());

        // extended fields
        assertEquals("minecraft:overworld", p.get("world").getAsString());
        assertEquals(3, p.get("generation").getAsInt());
        assertEquals(123456789L, p.get("time").getAsLong());
        assertEquals(80, p.get("bodyYaw").getAsDouble());
        assertEquals(4.3, p.getAsJsonObject("velocity").get("x").getAsDouble());

        JsonObject s = p.getAsJsonObject("state");
        assertTrue(s.get("sneaking").getAsBoolean());
        assertFalse(s.get("sprinting").getAsBoolean());
        assertTrue(s.get("onGround").getAsBoolean());
        assertFalse(s.get("swimming").getAsBoolean());
        assertFalse(s.get("flying").getAsBoolean());
        assertTrue(s.get("fallFlying").getAsBoolean());
    }

    @Test
    public void testLegacyOnlyWhenExtendedDisabled() throws IOException {
        JsonObject root = writeAndParse(false, List.of(
                new LivePlayersJson.Entry(UUID, "Notch", true, "minecraft:the_nether", state(new MovementState(false, false, false, false, false, false)))
        ));
        JsonObject p = root.getAsJsonArray("players").get(0).getAsJsonObject();

        assertEquals(Set.of("uuid", "name", "foreign", "position", "rotation"), p.keySet());
        assertTrue(p.get("foreign").getAsBoolean());
    }

    @Test
    public void testOptionalFieldsAreOmitted() throws IOException {
        JsonObject root = writeAndParse(true, List.of(
                new LivePlayersJson.Entry(UUID, "Notch", false, null, state(null))
        ));
        JsonObject p = root.getAsJsonArray("players").get(0).getAsJsonObject();

        assertFalse(p.has("world"), "unknown world must be omitted, not written as null");
        assertFalse(p.has("state"), "unknown movement-state must be omitted");
        assertTrue(p.has("generation"));
    }

    @Test
    public void testNonFiniteValuesAreSanitized() throws IOException {
        LivePlayerState broken = new LivePlayerState(
                new Vector3d(Double.NaN, Double.POSITIVE_INFINITY, 1),
                new Vector3d(Double.NaN, 0, 0),
                Double.NaN,
                new Vector3d(Double.NEGATIVE_INFINITY, 0, 0),
                0, 0, null
        );

        // must not throw (a non-lenient JsonWriter throws on NaN)
        JsonObject root = writeAndParse(true, List.of(new LivePlayersJson.Entry(UUID, "Notch", false, null, broken)));
        JsonObject p = root.getAsJsonArray("players").get(0).getAsJsonObject();

        assertEquals(0, p.getAsJsonObject("position").get("x").getAsDouble());
        assertEquals(0, p.getAsJsonObject("position").get("y").getAsDouble());
        assertEquals(1, p.getAsJsonObject("position").get("z").getAsDouble());
        assertEquals(0, p.getAsJsonObject("rotation").get("pitch").getAsDouble());
        assertEquals(0, p.get("bodyYaw").getAsDouble());
        assertEquals(0, p.getAsJsonObject("velocity").get("x").getAsDouble());
    }

    @Test
    public void testSkin() throws IOException {
        LivePlayersJson.Skin skin = new LivePlayersJson.Skin("slim", "0123abcd");
        JsonObject p = writeAndParse(true, List.of(
                new LivePlayersJson.Entry(UUID, "Notch", false, "minecraft:overworld", state(null), skin)
        )).getAsJsonArray("players").get(0).getAsJsonObject();
        assertEquals("slim", p.getAsJsonObject("skin").get("model").getAsString());
        assertEquals("0123abcd", p.getAsJsonObject("skin").get("version").getAsString());

        // no skin known -> no field
        p = writeAndParse(true, List.of(
                new LivePlayersJson.Entry(UUID, "Notch", false, "minecraft:overworld", state(null), null)
        )).getAsJsonArray("players").get(0).getAsJsonObject();
        assertFalse(p.has("skin"));

        // extended data disabled -> only the original fields
        p = writeAndParse(false, List.of(
                new LivePlayersJson.Entry(UUID, "Notch", false, "minecraft:overworld", state(null), skin)
        )).getAsJsonArray("players").get(0).getAsJsonObject();
        assertFalse(p.has("skin"));
    }

    @Test
    public void testSwing() throws IOException {
        LivePlayerState withSwing = new LivePlayerState(Vector3d.ZERO, Vector3d.ZERO, 0, Vector3d.ZERO, 0, 0, null, new SwingState(7, true));
        JsonObject p = writeAndParse(true, List.of(new LivePlayersJson.Entry(UUID, "Notch", false, null, withSwing)))
                .getAsJsonArray("players").get(0).getAsJsonObject();
        assertEquals(7, p.getAsJsonObject("swing").get("count").getAsInt());
        assertEquals("left", p.getAsJsonObject("swing").get("arm").getAsString());

        p = writeAndParse(true, List.of(new LivePlayersJson.Entry(UUID, "Notch", false, null, state(null))))
                .getAsJsonArray("players").get(0).getAsJsonObject();
        assertFalse(p.has("swing"), "unknown swing-state is omitted");

        p = writeAndParse(false, List.of(new LivePlayersJson.Entry(UUID, "Notch", false, null, withSwing)))
                .getAsJsonArray("players").get(0).getAsJsonObject();
        assertFalse(p.has("swing"), "only with extended data");
    }

    @Test
    public void testNoPlayers() throws IOException {
        JsonObject root = writeAndParse(true, List.of());
        assertEquals(0, root.getAsJsonArray("players").size());
        assertEquals(LivePlayersJson.PROTOCOL_VERSION, root.get("protocol").getAsInt());
    }

    @Test
    public void testMultiplePlayers() throws IOException {
        JsonObject root = writeAndParse(true, List.of(
                new LivePlayersJson.Entry(UUID, "A", false, "minecraft:overworld", state(null)),
                new LivePlayersJson.Entry("853c80ef-3c37-49fd-aa49-938b674adae6", "B", true, "minecraft:the_end", state(null))
        ));
        JsonArray players = root.getAsJsonArray("players");
        assertEquals(2, players.size());
        assertEquals("A", players.get(0).getAsJsonObject().get("name").getAsString());
        assertEquals("B", players.get(1).getAsJsonObject().get("name").getAsString());
        assertEquals("minecraft:the_end", players.get(1).getAsJsonObject().get("world").getAsString());
    }

    @Test
    public void testEquipmentAndUse() throws IOException {
        HeldItem bow = new HeldItem("minecraft:bow", true, null, false, false);
        HeldItem crossbow = new HeldItem("minecraft:crossbow", false, 7, true, true);
        LivePlayerState withItems = new LivePlayerState(Vector3d.ZERO, Vector3d.ZERO, 0, Vector3d.ZERO, 0, 0, null,
                new SwingState(2, false, SwingState.Kind.ATTACK),
                new Equipment(bow, crossbow, true, true),
                new ItemUse(true, "bow", 12));

        JsonObject p = writeAndParse(true, List.of(new LivePlayersJson.Entry(UUID, "Notch", false, null, withItems)))
                .getAsJsonArray("players").get(0).getAsJsonObject();

        assertEquals("attack", p.getAsJsonObject("swing").get("kind").getAsString());

        JsonObject equipment = p.getAsJsonObject("equipment");
        assertEquals("left", equipment.get("mainArm").getAsString());
        assertTrue(equipment.get("fishing").getAsBoolean());
        JsonObject main = equipment.getAsJsonObject("mainHand");
        assertEquals("minecraft:bow", main.get("id").getAsString());
        assertTrue(main.get("glint").getAsBoolean());
        assertFalse(main.has("customModelData"), "only set flags are written");
        assertFalse(main.has("charged"));
        JsonObject off = equipment.getAsJsonObject("offHand");
        assertEquals(7, off.get("customModelData").getAsInt());
        assertTrue(off.get("charged").getAsBoolean());
        assertTrue(off.get("firework").getAsBoolean());

        JsonObject use = p.getAsJsonObject("use");
        assertEquals("main", use.get("hand").getAsString());
        assertEquals("bow", use.get("action").getAsString());
        assertEquals(12, use.get("ticks").getAsInt());

        // empty hands, no use
        LivePlayerState empty = new LivePlayerState(Vector3d.ZERO, Vector3d.ZERO, 0, Vector3d.ZERO, 0, 0, null, null,
                Equipment.EMPTY, null);
        p = writeAndParse(true, List.of(new LivePlayersJson.Entry(UUID, "Notch", false, null, empty)))
                .getAsJsonArray("players").get(0).getAsJsonObject();
        assertEquals("right", p.getAsJsonObject("equipment").get("mainArm").getAsString());
        assertFalse(p.getAsJsonObject("equipment").has("mainHand"));
        assertFalse(p.getAsJsonObject("equipment").has("fishing"));
        assertFalse(p.has("use"));

        // without extended data nothing of it
        p = writeAndParse(false, List.of(new LivePlayersJson.Entry(UUID, "Notch", false, null, withItems)))
                .getAsJsonArray("players").get(0).getAsJsonObject();
        assertFalse(p.has("equipment"));
        assertFalse(p.has("use"));
    }

}
