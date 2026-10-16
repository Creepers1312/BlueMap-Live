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

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.google.gson.stream.JsonWriter;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.io.StringWriter;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

public class LiveBlockLogTest {

    @Test
    public void testNormalizeSortsProperties() {
        assertEquals("minecraft:stone", LiveBlockLog.normalize("minecraft:stone", Map.of()));
        assertEquals("minecraft:oak_stairs[facing=east,half=bottom,shape=straight]",
                LiveBlockLog.normalize("minecraft:oak_stairs", Map.of("shape", "straight", "facing", "east", "half", "bottom")));
    }

    @Test
    public void testRecentChangesAndLimit() {
        LiveBlockLog log = new LiveBlockLog();
        log.add(1, 2, 3, "minecraft:air", null, 1000);
        log.add(1, 2, 3, "minecraft:stone", null, 5000);
        assertEquals(2, log.recent(1000 + LiveBlockLog.MAX_AGE_MILLIS).size());
        assertEquals(1, log.recent(1001 + LiveBlockLog.MAX_AGE_MILLIS).size());
        for (int i = 0; i < LiveBlockLog.MAX_CHANGES + 3; i++) log.add(i, 0, 0, "minecraft:air", null, 6000);
        assertEquals(LiveBlockLog.MAX_CHANGES, log.recent(6000).size());
    }

    @Test
    public void testBlocksAreWrittenWithAPalette() throws IOException {
        LiveBlockLog log = new LiveBlockLog();
        log.add(10, 64, -3, "minecraft:air", new String[] {"minecraft:stone", null, null, null, "minecraft:dirt", "minecraft:stone"}, 1234);
        log.add(11, 64, -3, "minecraft:stone", null, 1235);
        StringWriter out = new StringWriter();
        try (JsonWriter json = new JsonWriter(out)) {
            LiveEntitiesJson.write(json, 2000, 250, List.of(), List.of(), List.of(), log.recent(2000));
        }
        JsonObject blocks = JsonParser.parseString(out.toString()).getAsJsonObject().getAsJsonObject("blocks");
        JsonArray palette = blocks.getAsJsonArray("palette");
        assertEquals(3, palette.size());
        assertEquals("minecraft:air", palette.get(0).getAsString());
        assertEquals("minecraft:stone", palette.get(1).getAsString());
        assertEquals("minecraft:dirt", palette.get(2).getAsString());
        JsonArray first = blocks.getAsJsonArray("changes").get(0).getAsJsonArray();
        long[] expected = {1, 10, 64, -3, 0, 1, -1, -1, -1, 2, 1, 1234};
        assertEquals(expected.length, first.size());
        for (int i = 0; i < expected.length; i++) assertEquals(expected[i], first.get(i).getAsLong(), "value " + i);
        JsonArray second = blocks.getAsJsonArray("changes").get(1).getAsJsonArray();
        assertEquals(-1, second.get(5).getAsInt(), "no neighbors known");

        StringWriter none = new StringWriter();
        try (JsonWriter json = new JsonWriter(none)) {
            LiveEntitiesJson.write(json, 2000, 250, List.of(), List.of(), List.of(), List.of());
        }
        assertFalse(JsonParser.parseString(none.toString()).getAsJsonObject().has("blocks"));
    }

    @Test
    public void testTileEntriesWithChunkTimes() throws IOException {
        LiveTileLog tiles = new LiveTileLog();
        tiles.hires(0, 0, 1000, new int[] {0, 0, 1700000000, 1, 0, 1600000000});
        StringWriter out = new StringWriter();
        try (JsonWriter json = new JsonWriter(out)) {
            tiles.write(json, 1500);
        }
        JsonArray chunks = JsonParser.parseString(out.toString()).getAsJsonObject().getAsJsonArray("tiles").get(0)
                .getAsJsonObject().getAsJsonArray("chunks");
        assertEquals(6, chunks.size());
        assertEquals(1700000000, chunks.get(2).getAsInt());
    }

}
