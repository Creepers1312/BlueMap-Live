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
import java.util.List;

/**
 * Writes the <code>live/entities.json</code> data (BlueMap Live, see docs/bluemap-live/phase-5.md).
 */
public final class LiveEntitiesJson {

    public static final int PROTOCOL_VERSION = 1;

    private LiveEntitiesJson() {}

    public static void write(JsonWriter json, long serverTime, int updateInterval, Collection<LiveEntityState> entities) throws IOException {
        write(json, serverTime, updateInterval, entities, List.of());
    }

    public static void write(JsonWriter json, long serverTime, int updateInterval, Collection<LiveEntityState> entities,
                             Collection<LiveEffect> effects) throws IOException {
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
            if (entity.impact() != null) {
                json.name("impact");
                json.beginObject();
                json.name("x").value(finite(entity.impact().position().getX()));
                json.name("y").value(finite(entity.impact().position().getY()));
                json.name("z").value(finite(entity.impact().position().getZ()));
                json.name("ticks").value(finite(entity.impact().ticks()));
                json.endObject();
            }
            if (entity.particles() != null) writeParticles(json, entity.particles());
            json.endObject();
        }
        json.endArray();

        if (!effects.isEmpty()) {
            json.name("effects").beginArray();
            for (LiveEffect effect : effects) {
                json.beginObject();
                json.name("id").value(effect.id());
                json.name("type").value(effect.type());
                json.name("x").value(finite(effect.position().getX()));
                json.name("y").value(finite(effect.position().getY()));
                json.name("z").value(finite(effect.position().getZ()));
                if (effect.power() != 0) json.name("power").value(finite(effect.power()));
                if (effect.destroy()) json.name("destroy").value(true);
                if (effect.color() != 0) json.name("color").value(effect.color() & 0xFFFFFF);
                json.name("time").value(effect.time());
                json.endObject();
            }
            json.endArray();
        }

        json.endObject();
    }

    /** the particles of an entity or player (only the values that differ from the default) */
    static void writeParticles(JsonWriter json, ParticleState particles) throws IOException {
        if (particles.isEmpty()) return;
        json.name("particles").beginObject();
        if (particles.onFire()) json.name("fire").value(true);
        if (!particles.swirls().isEmpty()) {
            json.name("swirls").beginArray();
            for (int color : particles.swirls()) json.value(Integer.toUnsignedLong(color));
            json.endArray();
            if (particles.ambient()) json.name("ambient").value(true);
            if (particles.invisible()) json.name("invisible").value(true);
        }
        ParticleState.Cloud cloud = particles.cloud();
        if (cloud != null) {
            json.name("cloud").beginObject();
            json.name("radius").value(finite(cloud.radius()));
            json.name("color").value(Integer.toUnsignedLong(cloud.color()));
            if (cloud.waiting()) json.name("waiting").value(true);
            json.endObject();
        }
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
        if (mob.swingTicks() >= 0) json.name("swingTicks").value(mob.swingTicks());
        if (mob.attackTicks() > 0) json.name("attackTicks").value(mob.attackTicks());
        if (mob.bedOffset() != 0 && Double.isFinite(mob.bedOffset())) json.name("bedOffset").value(mob.bedOffset());
        Leash leash = mob.leash();
        if (leash != null && (leash.holderEntity() != null || leash.holderPlayer() != null)) {
            json.name("leash").beginObject();
            if (leash.holderEntity() != null) json.name("entity").value(leash.holderEntity());
            else json.name("player").value(leash.holderPlayer().toString());
            json.name("start");
            writeVector(json, leash.start());
            json.name("end");
            writeVector(json, leash.end());
            json.endObject();
        }
        if (!mob.models().isEmpty()) {
            json.name("models").beginArray();
            for (String model : mob.models()) json.value(model);
            json.endArray();
        }
        if (!mob.flags().isEmpty()) {
            json.name("flags").beginArray();
            for (String flag : mob.flags()) json.value(flag);
            json.endArray();
        }
        Equipment equipment = mob.equipment();
        if (equipment != null && (equipment.mainHand() != null || equipment.offHand() != null || equipment.armor() != null ||
                equipment.head() != null)) {
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
            if (equipment.armor() != null) LivePlayersJson.writeArmor(json, equipment.armor());
            if (equipment.head() != null) {
                json.name("head");
                LivePlayersJson.writeItem(json, equipment.head());
            }
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

    /**
     * Finite and rounded to 1/1000 (positions to 1 mm, angles to 0.001 degrees): the entity-data is requested several
     * times per second, the full double-precision would only add digits.
     */
    static double finite(double value) {
        return Double.isFinite(value) ? Math.round(value * 1000) / 1000.0 : 0;
    }

}
