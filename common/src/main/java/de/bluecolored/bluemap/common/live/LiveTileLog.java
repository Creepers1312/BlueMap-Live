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

import java.io.IOException;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * BlueMap Live (see docs/bluemap-live/phase-11.md): the tiles of a map that were rendered again recently, so the webapp
 * reloads them without reloading the page (<code>live/tiles.json</code>). Thread-safe: written by the render-threads,
 * read by the webserver.
 */
public class LiveTileLog {

    public static final int PROTOCOL_VERSION = 1;
    /** entries are kept this long (every webapp polls more often) */
    public static final long MAX_AGE_MILLIS = 60_000;
    /** a protection against huge amounts (e.g. a full render): older entries are dropped */
    public static final int MAX_ENTRIES = 2048;

    /**
     * A hires-tile that was rendered (hires), or whose lowres-tiles were saved (lowres).
     * @param chunks hires: the chunks of the tile with the time (epoch-seconds) the rendered chunk-data was saved
     *               (the region-file timestamp): <code>[x, z, time, x, z, time, ...]</code>, so the webapp knows which
     *               block-changes the tile shows (see BlockPreview.js); empty if unknown
     */
    public record Entry(long id, int x, int z, boolean lowres, long time, int[] chunks) {}

    private static final Map<String, LiveTileLog> LOGS = new ConcurrentHashMap<>();
    private static volatile boolean enabled = true;

    /** the config live-block-updates: if disabled, nothing is logged (and small updates do not save at once) */
    public static void setEnabled(boolean enabled) {
        LiveTileLog.enabled = enabled;
    }

    public static boolean isEnabled() {
        return enabled;
    }

    /** the log of a map (created on first use) */
    public static LiveTileLog of(String mapId) {
        return LOGS.computeIfAbsent(mapId, id -> new LiveTileLog());
    }

    private final Deque<Entry> entries = new ArrayDeque<>();
    private long nextId = 1;

    public synchronized void hires(int x, int z, long time) {
        hires(x, z, time, new int[0]);
    }

    public synchronized void hires(int x, int z, long time, int[] chunks) {
        add(x, z, false, time, chunks);
    }

    public synchronized void lowres(int x, int z, long time) {
        add(x, z, true, time, new int[0]);
    }

    private void add(int x, int z, boolean lowres, long time, int[] chunks) {
        if (!enabled) return;
        entries.addLast(new Entry(nextId++, x, z, lowres, time, chunks));
        while (entries.size() > MAX_ENTRIES) entries.removeFirst();
    }

    /** the entries that are not older than {@link #MAX_AGE_MILLIS}, oldest first */
    public synchronized List<Entry> recent(long now) {
        while (!entries.isEmpty() && now - entries.peekFirst().time() > MAX_AGE_MILLIS) entries.removeFirst();
        return new ArrayList<>(entries);
    }

    /** the id the next entry gets (the webapp starts after it, so it does not reload tiles it just loaded) */
    public synchronized long nextId() {
        return nextId;
    }

    /**
     * <code>{"protocol":1,"serverTime":..,"next":..,"tiles":[{"id":..,"x":..,"z":..,"lowres":true?},..]}</code>,
     * x and z are hires-tile-coordinates
     */
    public void write(JsonWriter json, long now) throws IOException {
        List<Entry> recent;
        long next;
        synchronized (this) {
            recent = recent(now);
            next = nextId;
        }
        json.beginObject();
        json.name("protocol").value(PROTOCOL_VERSION);
        json.name("serverTime").value(now);
        json.name("next").value(next);
        json.name("tiles").beginArray();
        for (Entry entry : recent) {
            json.beginObject();
            json.name("id").value(entry.id());
            json.name("x").value(entry.x());
            json.name("z").value(entry.z());
            if (entry.lowres()) json.name("lowres").value(true);
            if (entry.chunks().length > 0) {
                json.name("chunks").beginArray();
                for (int value : entry.chunks()) json.value(value);
                json.endArray();
            }
            json.endObject();
        }
        json.endArray();
        json.endObject();
    }

}
