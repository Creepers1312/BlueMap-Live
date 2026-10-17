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
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.io.StringWriter;

import static org.junit.jupiter.api.Assertions.*;

public class LiveTileLogTest {

    @AfterEach
    public void enable() {
        LiveTileLog.setEnabled(true);
    }

    private static JsonObject json(LiveTileLog log, long now) throws IOException {
        StringWriter out = new StringWriter();
        try (JsonWriter json = new JsonWriter(out)) {
            log.write(json, now);
        }
        return JsonParser.parseString(out.toString()).getAsJsonObject();
    }

    @Test
    public void testEntriesAreWrittenWithIncreasingIds() throws IOException {
        LiveTileLog log = new LiveTileLog();
        assertEquals(1, json(log, 0).get("next").getAsLong(), "the webapp starts after the current entries");
        log.hires(3, -4, 1000);
        log.lowres(3, -4, 1100);
        JsonObject json = json(log, 2000);
        assertEquals(1, json.get("protocol").getAsInt());
        assertEquals(3, json.get("next").getAsLong());
        JsonArray tiles = json.getAsJsonArray("tiles");
        assertEquals(2, tiles.size());
        assertEquals(1, tiles.get(0).getAsJsonObject().get("id").getAsLong());
        assertEquals(3, tiles.get(0).getAsJsonObject().get("x").getAsInt());
        assertEquals(-4, tiles.get(0).getAsJsonObject().get("z").getAsInt());
        assertFalse(tiles.get(0).getAsJsonObject().has("lowres"));
        assertTrue(tiles.get(1).getAsJsonObject().get("lowres").getAsBoolean());
    }

    @Test
    public void testOldAndTooManyEntriesAreDropped() {
        LiveTileLog log = new LiveTileLog();
        log.hires(0, 0, 1000);
        log.hires(1, 0, 5000);
        assertEquals(2, log.recent(1000 + LiveTileLog.MAX_AGE_MILLIS).size());
        assertEquals(1, log.recent(1001 + LiveTileLog.MAX_AGE_MILLIS).size());
        for (int i = 0; i < LiveTileLog.MAX_ENTRIES + 5; i++) log.hires(i, i, 6000);
        assertEquals(LiveTileLog.MAX_ENTRIES, log.recent(6000).size());
        assertEquals(LiveTileLog.MAX_ENTRIES + 8, log.nextId());
    }

    @Test
    public void testDisabledLogsNothingAndLogsArePerMap() {
        LiveTileLog.setEnabled(false);
        LiveTileLog log = new LiveTileLog();
        log.hires(0, 0, 1000);
        assertEquals(0, log.recent(1000).size());
        assertSame(LiveTileLog.of("world"), LiveTileLog.of("world"));
        assertNotSame(LiveTileLog.of("world"), LiveTileLog.of("world_nether"));
    }

}
