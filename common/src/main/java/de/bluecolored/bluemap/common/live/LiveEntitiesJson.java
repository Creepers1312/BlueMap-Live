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

import java.io.IOException;
import java.util.Collection;

/**
 * Writes the <code>live/entities.json</code> data (BlueMap Live, see docs/bluemap-live/phase-5.md).
 */
public final class LiveEntitiesJson {

    public static final int PROTOCOL_VERSION = 1;

    private LiveEntitiesJson() {}

    public static void write(JsonWriter json, long serverTime, int updateInterval, Collection<LiveEntityState> entities) throws IOException {
        json.beginObject();
        json.name("protocol").value(PROTOCOL_VERSION);
        json.name("serverTime").value(serverTime);
        json.name("updateInterval").value(updateInterval);

        json.name("entities").beginArray();
        for (LiveEntityState entity : entities) {
            json.beginObject();
            json.name("id").value(entity.id());
            json.name("type").value(entity.type());
            json.name("position");
            writeVector(json, entity.position());
            json.name("rotation").beginObject();
            json.name("yaw").value(finite(entity.yaw()));
            json.name("pitch").value(finite(entity.pitch()));
            json.endObject();
            json.name("velocity");
            writeVector(json, entity.velocity());
            json.name("time").value(entity.time());
            if (entity.onGround()) json.name("onGround").value(true);
            if (entity.item() != null) {
                json.name("item").beginObject();
                json.name("id").value(entity.item().id());
                if (entity.item().glint()) json.name("glint").value(true);
                if (entity.item().customModelData() != null) json.name("customModelData").value(entity.item().customModelData());
                json.endObject();
            }
            if (entity.mob() != null) writeMob(json, entity.mob());
            json.endObject();
        }
        json.endArray();

        json.endObject();
    }

    /** only the values that differ from the default, so a mob costs only a few bytes more per update */
    private static void writeMob(JsonWriter json, LiveMobState mob) throws IOException {
        json.name("mob").beginObject();
        json.name("bodyYaw").value(finite(mob.bodyYaw()));
        json.name("headYaw").value(finite(mob.headYaw()));
        if (mob.hurtTime() > 0) json.name("hurtTime").value(mob.hurtTime());
        if (mob.deathTime() > 0) json.name("deathTime").value(mob.deathTime());
        if (mob.baby()) json.name("baby").value(true);
        if (mob.variant() != null) json.name("variant").value(mob.variant());
        if (mob.size() > 0) json.name("size").value(mob.size());
        json.name("width").value(finite(mob.width()));
        json.name("height").value(finite(mob.height()));
        if (!mob.flags().isEmpty()) {
            json.name("flags").beginArray();
            for (String flag : mob.flags()) json.value(flag);
            json.endArray();
        }
        Equipment equipment = mob.equipment();
        if (equipment != null && (equipment.mainHand() != null || equipment.offHand() != null)) {
            json.name("equipment").beginObject();
            if (equipment.mainHand() != null) {
                json.name("mainHand");
                LivePlayersJson.writeItem(json, equipment.mainHand());
            }
            if (equipment.offHand() != null) {
                json.name("offHand");
                LivePlayersJson.writeItem(json, equipment.offHand());
            }
            if (equipment.leftHanded()) json.name("mainArm").value("left"); // like the players
            json.endObject();
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

    private static double finite(double value) {
        return Double.isFinite(value) ? value : 0;
    }

}
