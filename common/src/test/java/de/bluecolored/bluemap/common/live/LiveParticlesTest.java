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
import java.util.ArrayList;
import java.util.Collection;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

public class LiveParticlesTest {

    private static JsonObject entities(Collection<LiveEntityState> entities, Collection<LiveEffect> effects) throws IOException {
        StringWriter out = new StringWriter();
        try (JsonWriter json = new JsonWriter(out)) {
            LiveEntitiesJson.write(json, 1000L, 250, entities, effects);
        }
        return JsonParser.parseString(out.toString()).getAsJsonObject();
    }

    private static LiveEntityState entity(int id, String type, ParticleState particles) {
        return new LiveEntityState(id, type, new Vector3d(1, 64, 2), 0, 0, Vector3d.ZERO, 900L, null, true, null, null, particles);
    }

    @Test
    public void testParticleStateIsEmptyWithoutParticles() {
        assertNull(ParticleState.of(false, List.of(), false, false, null));
        assertNotNull(ParticleState.of(true, List.of(), false, false, null));
        List<Integer> many = new ArrayList<>();
        for (int i = 0; i < 40; i++) many.add(i);
        assertEquals(ParticleState.MAX_SWIRLS, new ParticleState(false, many, false, false, null).swirls().size());
        // the webapp-atlas: explosion 0..15, effect / spell / generic 0..7, fire 0 and 1
        assertEquals(16 + 3 * 8 + 2, ParticleState.TEXTURES.size());
    }

    @Test
    public void testParticlesAreWritten() throws IOException {
        ParticleState swirls = new ParticleState(true, List.of(0x26F82423, 0xFF7DBEE8), true, false, null);
        ParticleState cloud = new ParticleState(false, List.of(), false, false, new ParticleState.Cloud(3, 0xFF7DBEE8, true));
        JsonObject json = entities(List.of(entity(1, "minecraft:zombie", swirls),
                entity(2, "minecraft:area_effect_cloud", cloud), entity(3, "minecraft:item", null)), List.of());
        JsonArray list = json.getAsJsonArray("entities");

        JsonObject first = list.get(0).getAsJsonObject().getAsJsonObject("particles");
        assertTrue(first.get("fire").getAsBoolean());
        assertEquals(0x26F82423L, first.getAsJsonArray("swirls").get(0).getAsLong(), "unsigned ARGB");
        assertEquals(0xFF7DBEE8L, first.getAsJsonArray("swirls").get(1).getAsLong());
        assertTrue(first.get("ambient").getAsBoolean());
        assertFalse(first.has("invisible"));
        assertFalse(first.has("cloud"));

        JsonObject second = list.get(1).getAsJsonObject().getAsJsonObject("particles");
        assertFalse(second.has("fire"));
        assertEquals(3, second.getAsJsonObject("cloud").get("radius").getAsDouble());
        assertEquals(0xFF7DBEE8L, second.getAsJsonObject("cloud").get("color").getAsLong());
        assertTrue(second.getAsJsonObject("cloud").get("waiting").getAsBoolean());

        assertFalse(list.get(2).getAsJsonObject().has("particles"));
        assertFalse(json.has("effects"), "only written if there are effects");
    }

    @Test
    public void testEffectsAreWritten() throws IOException {
        LiveEffectLog log = new LiveEffectLog();
        log.add(LiveEffect.EXPLOSION, new Vector3d(1.23456, 64, -5), 3, true, 0, 900L);
        log.add(LiveEffect.SPLASH, new Vector3d(0.5, 70, 0.5), 0, false, 0xFF385DC6, 950L);
        JsonArray effects = entities(List.of(), log.recent(1000L)).getAsJsonArray("effects");
        assertEquals(2, effects.size());

        JsonObject explosion = effects.get(0).getAsJsonObject();
        assertEquals(1, explosion.get("id").getAsLong());
        assertEquals("explosion", explosion.get("type").getAsString());
        assertEquals(1.235, explosion.get("x").getAsDouble());
        assertEquals(3, explosion.get("power").getAsDouble());
        assertTrue(explosion.get("destroy").getAsBoolean());
        assertFalse(explosion.has("color"));
        assertEquals(900L, explosion.get("time").getAsLong());

        JsonObject splash = effects.get(1).getAsJsonObject();
        assertEquals(2, splash.get("id").getAsLong());
        assertEquals(0x385DC6, splash.get("color").getAsInt(), "RGB without alpha");
        assertFalse(splash.has("power"));
        assertFalse(splash.has("destroy"));
    }

    @Test
    public void testEffectLogKeepsRecentEffects() {
        LiveEffectLog log = new LiveEffectLog();
        log.add(LiveEffect.EXPLOSION, Vector3d.ZERO, 4, true, 0, 1000L);
        log.add(LiveEffect.EXPLOSION, Vector3d.ZERO, 4, true, 0, 5000L);
        assertEquals(2, log.recent(1000L + LiveEffectLog.MAX_AGE_MILLIS).size());
        List<LiveEffect> later = log.recent(1001L + LiveEffectLog.MAX_AGE_MILLIS);
        assertEquals(1, later.size());
        assertEquals(2, later.get(0).id(), "ids stay unique");

        for (int i = 0; i < LiveEffectLog.MAX_EFFECTS + 10; i++) log.add(LiveEffect.EXPLOSION, Vector3d.ZERO, 4, true, 0, 6000L);
        List<LiveEffect> recent = log.recent(6000L);
        assertEquals(LiveEffectLog.MAX_EFFECTS, recent.size());
        assertEquals(LiveEffectLog.MAX_EFFECTS + 12, recent.get(recent.size() - 1).id());
    }

    @Test
    public void testPlayerParticlesAreExtendedData() throws IOException {
        LivePlayerState state = new LivePlayerState(Vector3d.ZERO, Vector3d.ZERO, 0, Vector3d.ZERO, 0, 0, null, null,
                null, null, null, null, new ParticleState(true, List.of(0xFFF82423), false, false, null));
        List<LivePlayersJson.Entry> entries = List.of(new LivePlayersJson.Entry("069a79f4-44e9-4726-a5be-fca90e38aaf5",
                "Notch", false, "minecraft:overworld", state));
        for (boolean extended : new boolean[] {true, false}) {
            StringWriter out = new StringWriter();
            try (JsonWriter json = new JsonWriter(out)) {
                LivePlayersJson.write(json, 1000L, 250, extended, entries);
            }
            JsonObject player = JsonParser.parseString(out.toString()).getAsJsonObject().getAsJsonArray("players")
                    .get(0).getAsJsonObject();
            assertEquals(extended, player.has("particles"));
            if (extended) assertTrue(player.getAsJsonObject("particles").get("fire").getAsBoolean());
        }
    }

}
