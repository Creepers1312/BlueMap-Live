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
import org.jetbrains.annotations.Nullable;

import java.io.IOException;
import java.util.Collection;

/**
 * Writes the <code>live/players.json</code> data.
 * <p>The format is a backwards-compatible extension of the original format: all fields that existed before
 * (<code>players[].uuid, name, foreign, position, rotation</code>) are always present with the same meaning.
 * All other fields are optional for clients.</p>
 * <p>See <code>docs/bluemap-live/phase-2.md</code> for the full format description.</p>
 */
public final class LivePlayersJson {

    /**
     * The protocol-version of the live-players data.
     * Only incremented on breaking changes, adding optional fields does not change it.
     */
    public static final int PROTOCOL_VERSION = 1;

    private LivePlayersJson() {}

    /**
     * One entry in the players-list.
     *
     * @param world the formatted dimension-key of the world the player is in, or null if unknown
     * @param skin the stored full skin of the player, or null if none is known
     */
    public record Entry(
            String uuid,
            String name,
            boolean foreign,
            @Nullable String world,
            LivePlayerState state,
            @Nullable Skin skin
    ) {
        public Entry(String uuid, String name, boolean foreign, @Nullable String world, LivePlayerState state) {
            this(uuid, name, foreign, world, state, null);
        }
    }

    /**
     * Information about the full skin of a player, stored as <code>assets/playerskins/&lt;uuid&gt;.png</code>.
     *
     * @param model "classic" or "slim"
     * @param version changes whenever the skin changes (used to invalidate the browser-cache)
     */
    public record Skin(String model, String version) {}

    /**
     * @param serverTime the current server time in epoch-millis
     * @param updateInterval the interval in ms in which clients should poll for new data
     * @param includeExtendedData if false, only the original fields are written for each player
     */
    public static void write(JsonWriter json, long serverTime, int updateInterval, boolean includeExtendedData, Collection<Entry> players) throws IOException {
        json.beginObject();
        json.name("protocol").value(PROTOCOL_VERSION);
        json.name("serverTime").value(serverTime);
        json.name("updateInterval").value(updateInterval);

        json.name("players").beginArray();
        for (Entry player : players) {
            writePlayer(json, player, includeExtendedData);
        }
        json.endArray();

        json.endObject();
    }

    private static void writePlayer(JsonWriter json, Entry player, boolean includeExtendedData) throws IOException {
        LivePlayerState state = player.state();

        json.beginObject();
        json.name("uuid").value(player.uuid());
        json.name("name").value(player.name());
        json.name("foreign").value(player.foreign());

        json.name("position");
        writeVector(json, state.position());

        json.name("rotation").beginObject();
        json.name("pitch").value(finite(state.rotation().getX()));
        json.name("yaw").value(finite(state.rotation().getY()));
        json.name("roll").value(finite(state.rotation().getZ()));
        json.endObject();

        if (includeExtendedData) {
            if (player.world() != null) json.name("world").value(player.world());
            json.name("generation").value(state.generation());
            json.name("time").value(state.time());
            json.name("bodyYaw").value(finite(state.bodyYaw()));

            json.name("velocity");
            writeVector(json, state.velocity());

            Skin skin = player.skin();
            if (skin != null) {
                json.name("skin").beginObject();
                json.name("model").value(skin.model());
                json.name("version").value(skin.version());
                json.endObject();
            }

            MovementState movement = state.movement();
            if (movement != null) {
                json.name("state").beginObject();
                json.name("sneaking").value(movement.sneaking());
                json.name("sprinting").value(movement.sprinting());
                json.name("onGround").value(movement.onGround());
                json.name("swimming").value(movement.swimming());
                json.name("flying").value(movement.flying());
                json.name("fallFlying").value(movement.fallFlying());
                json.endObject();
            }
        }

        json.endObject();
    }

    private static void writeVector(JsonWriter json, Vector3d vector) throws IOException {
        json.beginObject();
        json.name("x").value(finite(vector.getX()));
        json.name("y").value(finite(vector.getY()));
        json.name("z").value(finite(vector.getZ()));
        json.endObject();
    }

    /** JsonWriter refuses NaN/Infinity (lenient=false), so we make sure to never write them */
    private static double finite(double value) {
        return Double.isFinite(value) ? value : 0;
    }

}
