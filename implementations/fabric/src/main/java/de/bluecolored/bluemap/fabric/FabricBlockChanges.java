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
package de.bluecolored.bluemap.fabric;

import de.bluecolored.bluemap.common.live.LiveBlockLog;
import de.bluecolored.bluemap.common.live.LiveStats;
import net.minecraft.block.BlockState;
import net.minecraft.server.network.ServerPlayerEntity;
import net.minecraft.server.world.ServerWorld;
import net.minecraft.state.property.Property;
import net.minecraft.util.math.BlockPos;
import net.minecraft.world.LightType;
import net.minecraft.world.World;

import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

/**
 * BlueMap Live (see docs/bluemap-live/phase-11.md): the changed blocks of the worlds (reported by the WorldChunkMixin),
 * turned into block-states once per tick and kept in a {@link LiveBlockLog} per world.
 */
public final class FabricBlockChanges {

    /** at most this many changed positions per world and tick (the rest is shown when BlueMap rendered the tile) */
    static final int MAX_PER_TICK = 2048;

    private static volatile boolean listening = false;
    private static final Map<World, Set<Long>> CHANGED = new ConcurrentHashMap<>();

    /** the block-state-strings (block-states are shared objects) */
    private static final Map<BlockState, String> STATE_STRINGS = new ConcurrentHashMap<>();

    private FabricBlockChanges() {}

    /** if changes are recorded (live-block-preview on, players online) */
    public static boolean isListening() {
        return listening;
    }

    static void setListening(boolean listening) {
        FabricBlockChanges.listening = listening;
        if (!listening) CHANGED.clear();
    }

    /** called by the mixin when a block of a loaded chunk changed */
    public static void changed(World world, BlockPos pos) {
        Set<Long> set = CHANGED.computeIfAbsent(world, w -> new LinkedHashSet<>());
        synchronized (set) {
            if (set.size() < MAX_PER_TICK) set.add(pos.asLong());
            else DROPPED.incrementAndGet();
        }
    }

    /** the changes that were not recorded since the last flush (more than the limit per tick) */
    private static final java.util.concurrent.atomic.AtomicLong DROPPED = new java.util.concurrent.atomic.AtomicLong();

    /**
     * Once per tick (server-thread): the changes around the players become entries of the log of their world.
     * @param logs the log of a world
     */
    static void flush(List<ServerWorld> worlds, java.util.function.Function<ServerWorld, LiveBlockLog> logs, double radius, long now) {
        long start = System.nanoTime();
        int recorded = 0;
        long dropped = DROPPED.getAndSet(0);
        if (dropped > 0) LiveStats.add(LiveStats.BLOCK_CHANGES_DROPPED, dropped);
        for (ServerWorld world : worlds) {
            Set<Long> set = CHANGED.get(world);
            if (set == null) continue;
            long[] positions;
            synchronized (set) {
                if (set.isEmpty()) continue;
                positions = set.stream().mapToLong(Long::longValue).toArray();
                set.clear();
            }
            List<ServerPlayerEntity> players = world.getPlayers();
            if (players.isEmpty()) continue;
            double radiusSquared = radius * radius;
            LiveBlockLog log = null;
            BlockPos.Mutable neighbor = new BlockPos.Mutable();
            for (long packed : positions) {
                BlockPos pos = BlockPos.fromLong(packed);
                boolean near = false;
                for (ServerPlayerEntity player : players) {
                    if (player.squaredDistanceTo(pos.getX() + 0.5, pos.getY() + 0.5, pos.getZ() + 0.5) <= radiusSquared) {
                        near = true;
                        break;
                    }
                }
                if (!near) continue;
                String[] neighbors = new String[6];
                int[][] offsets = {{0, -1, 0}, {0, 1, 0}, {0, 0, -1}, {0, 0, 1}, {-1, 0, 0}, {1, 0, 0}};
                // the light the faces get: the brightest of the block and its neighbors (like the light of the
                // air in front of a face, which BlueMap uses)
                int skyLight = world.getLightLevel(LightType.SKY, pos), blockLight = world.getLightLevel(LightType.BLOCK, pos);
                for (int i = 0; i < 6; i++) {
                    neighbor.set(pos.getX() + offsets[i][0], pos.getY() + offsets[i][1], pos.getZ() + offsets[i][2]);
                    BlockState state = world.getBlockState(neighbor);
                    neighbors[i] = state.isAir() ? null : toString(state);
                    skyLight = Math.max(skyLight, world.getLightLevel(LightType.SKY, neighbor));
                    blockLight = Math.max(blockLight, world.getLightLevel(LightType.BLOCK, neighbor));
                }
                BlockState newState = world.getBlockState(pos);
                // the light-engine updates later: a placed torch already lights its own block
                int luminance = newState.getLuminance();
                if (log == null) log = logs.apply(world);
                log.add(pos.getX(), pos.getY(), pos.getZ(), toString(newState), neighbors, now, skyLight,
                        Math.max(blockLight, luminance), luminance);
                recorded++;
            }
        }
        if (recorded > 0) LiveStats.add(LiveStats.BLOCK_CHANGES, recorded);
        LiveStats.add(LiveStats.BLOCK_FLUSH_NANOS, System.nanoTime() - start);
    }

    /** <code>minecraft:oak_stairs[facing=east,half=bottom,...]</code> with the properties sorted like BlueMap */
    static String toString(BlockState state) {
        String cached = STATE_STRINGS.get(state);
        if (cached != null) return cached;
        Map<String, String> properties = new HashMap<>();
        for (Property<?> property : state.getProperties()) properties.put(property.getName(), value(state, property));
        // like the entity-types (Registries.BLOCK.getId needs fabric-api interfaces that are not on the classpath)
        String id = state.getRegistryEntry().getKey().map(key -> key.getValue().toString()).orElse("minecraft:air");
        String result = LiveBlockLog.normalize(id, properties);
        if (STATE_STRINGS.size() < 65536) STATE_STRINGS.put(state, result);
        return result;
    }

    private static <T extends Comparable<T>> String value(BlockState state, Property<T> property) {
        return property.name(state.get(property));
    }

}
