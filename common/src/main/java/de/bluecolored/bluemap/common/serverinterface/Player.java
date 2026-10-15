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
package de.bluecolored.bluemap.common.serverinterface;

import com.flowpowered.math.vector.Vector3d;
import de.bluecolored.bluemap.common.live.LivePlayerState;
import de.bluecolored.bluemap.common.plugin.text.Text;

import java.util.UUID;

public abstract class Player {

    public abstract UUID getUuid();

    public abstract Text getName();

    public abstract ServerWorld getWorld();

    public abstract Vector3d getPosition();

    /**
     * x -> pitch, y -> yaw, z -> roll
     */
    public abstract Vector3d getRotation();

    /**
     * Returns a consistent snapshot of all live-data of this player (position, rotation, velocity, ...).
     * <p>Implementations should override this to provide a snapshot where all values are sampled at the same time,
     * and to provide velocity, generation and movement-state.
     * The default implementation only uses {@link #getPosition()} and {@link #getRotation()}.</p>
     */
    public LivePlayerState getLiveState() {
        Vector3d rotation = getRotation();
        return new LivePlayerState(
                getPosition(),
                rotation,
                rotation.getY(),
                Vector3d.ZERO,
                0,
                System.currentTimeMillis(),
                null
        );
    }

    /**
     * Returns the world and the live-state of this player as one consistent snapshot,
     * so that e.g. a world-change can never be combined with a position from the previous world.
     * <p>Implementations that sample asynchronously should override this together with {@link #getLiveState()}.</p>
     */
    public LiveSnapshot getLiveSnapshot() {
        return new LiveSnapshot(getWorld(), getLiveState());
    }

    /**
     * @param world the world the player was in when the state was sampled
     * @param state the live-state of the player
     */
    public record LiveSnapshot(ServerWorld world, LivePlayerState state) {}

    public abstract int getSkyLight();

    public abstract int getBlockLight();

    /**
     * Return <code>true</code> if the player is sneaking.
     * <p><i>If the player is offline the value of this method is undetermined.</i></p>
     */
    public abstract boolean isSneaking();

    /**
     * Returns <code>true</code> if the player has an invisibillity effect
     * <p><i>If the player is offline the value of this method is undetermined.</i></p>
     */
    public abstract boolean isInvisible();

    /**
     * Returns <code>true</code> if the player is vanished
     * <p><i>If the player is offline the value of this method is undetermined.</i></p>
     */
    public boolean isVanished() {
        return false;
    }

    /**
     * Returns the {@link Gamemode} this player is in
     * <p><i>If the player is offline the value of this method is undetermined.</i></p>
     */
    public abstract Gamemode getGamemode();

    @Override
    public boolean equals(Object o) {
        if (o == null || getClass() != o.getClass()) return false;
        Player other = (Player) o;
        return getUuid().equals(other.getUuid());
    }

    @Override
    public int hashCode() {
        return getUuid().hashCode();
    }
}
