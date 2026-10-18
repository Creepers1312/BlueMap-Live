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
package de.bluecolored.bluemap.live.mojang;

import com.flowpowered.math.vector.Vector3i;
import de.bluecolored.bluemap.common.live.OpenContainer;
import org.jetbrains.annotations.Nullable;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.block.ChestBlock;
import net.minecraft.world.level.block.EnderChestBlock;
import net.minecraft.world.level.block.TrappedChestBlock;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.level.block.state.properties.ChestType;

/**
 * The opened chests (BlueMap Live, see docs/bluemap-live/phase-11.md): a chest is open while the player who used it
 * still has a screen open (vanilla ChestBlock / EnderChestBlock.onUse opens the screen in the same call).
 */
final class LiveContainers {

    /** a use is only counted if the screen opened within this time */
    private static final long OPEN_TIMEOUT_MILLIS = 2000;

    private record Used(Level world, BlockPos pos, long time) {}

    private final Map<UUID, Used> used = new ConcurrentHashMap<>();

    /** set if a method is not available in this version: chests are not sampled anymore */
    private volatile boolean unavailable = false;

    /** called on the server-thread when a player uses a block */
    void onUseBlock(Player player, Level world, BlockPos pos) {
        if (unavailable || world.isClientSide()) return;
        try {
            if (isChest(world.getBlockState(pos))) used.put(player.getUUID(), new Used(world, pos.immutable(), System.currentTimeMillis()));
        } catch (LinkageError ex) {
            unavailable = true;
        }
    }

    void onLeave(UUID player) {
        used.remove(player);
    }

    private static boolean isChest(BlockState state) {
        return state.getBlock() instanceof ChestBlock || state.getBlock() instanceof EnderChestBlock;
    }

    /** the opened chests of a world (both halves of a double chest), only call on the server-thread */
    List<OpenContainer> sample(ServerLevel world, long now) {
        if (unavailable || used.isEmpty()) return List.of();
        try {
            Map<BlockPos, OpenContainer> result = new LinkedHashMap<>();
            for (ServerPlayer player : world.players()) {
                Used use = used.get(player.getUUID());
                if (use == null) continue;
                if (player.containerMenu == player.inventoryMenu) {
                    // closed (or not opened, e.g. a blocked chest)
                    if (now - use.time() > OPEN_TIMEOUT_MILLIS) used.remove(player.getUUID());
                    continue;
                }
                if (use.world() != world) continue;
                BlockState state = world.getBlockState(use.pos());
                OpenContainer container = toContainer(use.pos(), state);
                if (container == null) {
                    used.remove(player.getUUID());
                    continue;
                }
                result.put(use.pos(), container);
                // the other half of a double chest (vanilla ChestBlock.getFacing)
                if (!container.part().equals("single")) {
                    Direction facing = state.getValue(ChestBlock.FACING);
                    BlockPos other = use.pos().relative(container.part().equals("left") ?
                            facing.getClockWise() : facing.getCounterClockWise());
                    OpenContainer otherHalf = toContainer(other, world.getBlockState(other));
                    if (otherHalf != null && !otherHalf.part().equals(container.part()) && !otherHalf.part().equals("single"))
                        result.put(other, otherHalf);
                }
            }
            return List.copyOf(result.values());
        } catch (LinkageError ex) {
            unavailable = true;
            return List.of();
        }
    }

    /** vanilla TexturedRenderLayers.getChestTextureId (christmas is decided by the webapp, like by the client) */
    private static @Nullable OpenContainer toContainer(BlockPos pos, BlockState state) {
        Vector3i position = new Vector3i(pos.getX(), pos.getY(), pos.getZ());
        if (state.getBlock() instanceof EnderChestBlock) {
            return new OpenContainer(position, "minecraft:entity/chest/ender", state.getValue(EnderChestBlock.FACING).getSerializedName(), "single");
        }
        if (state.getBlock() instanceof ChestBlock) {
            ChestType type = state.getValue(ChestBlock.TYPE);
            String part = type == ChestType.LEFT ? "left" : type == ChestType.RIGHT ? "right" : "single";
            String base = state.getBlock() instanceof TrappedChestBlock ? "minecraft:entity/chest/trapped" : "minecraft:entity/chest/normal";
            return new OpenContainer(position, part.equals("single") ? base : base + "_" + part,
                    state.getValue(ChestBlock.FACING).getSerializedName(), part);
        }
        return null;
    }

}
