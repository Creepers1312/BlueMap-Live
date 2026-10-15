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

import org.jetbrains.annotations.Nullable;

/**
 * Detects every new arm-swing of a player from the swing-fields minecraft keeps on the server
 * (<code>handSwinging</code> and <code>handSwingTicks</code>), checked once per tick.
 * <p>A swing starts when the player starts swinging, or when the swing-progress restarts while still swinging
 * (a new swing before the previous one finished). Not thread-safe, only call from the server-thread.</p>
 * <p>The kind of a swing comes from server-events ({@link #noteAction(SwingState.Kind)}) of the same or the
 * previous tick (the action- and the swing-packet of the client are usually handled in the same tick).
 * Continued swings while breaking a block stay {@link SwingState.Kind#MINE}.</p>
 */
public class SwingTracker {

    /** an action is assigned to a swing that starts at most this many ticks after it */
    static final int ACTION_TICKS = 1;

    /** swings that follow a mining-swing within this many ticks are still mining (the client swings while breaking) */
    static final int MINE_CONTINUE_TICKS = 8;

    private boolean lastSwinging = false;
    private int lastTicks = 0;

    private int count = 0;
    private boolean leftArm = false;
    private SwingState.Kind kind = SwingState.Kind.SWING;

    private int tick = 0;
    private int lastSwingTick = Integer.MIN_VALUE / 2;
    private @Nullable SwingState.Kind pendingAction = null;
    private int pendingActionTick = 0;

    /**
     * Notes an action of the player (attack, start breaking a block, use an item/block), the next swing is of this kind.
     */
    public void noteAction(SwingState.Kind action) {
        pendingAction = action;
        pendingActionTick = tick;
    }

    /**
     * @param swinging if the player is currently swinging an arm
     * @param ticks the ticks since the current swing started
     * @param leftArm if the swinging arm is the left arm
     */
    public void update(boolean swinging, int ticks, boolean leftArm) {
        if (swinging && (!lastSwinging || ticks < lastTicks)) {
            count++;
            this.leftArm = leftArm;

            if (pendingAction != null && tick - pendingActionTick <= ACTION_TICKS) {
                kind = pendingAction;
            } else if (kind == SwingState.Kind.MINE && tick - lastSwingTick <= MINE_CONTINUE_TICKS) {
                kind = SwingState.Kind.MINE;
            } else {
                kind = SwingState.Kind.SWING;
            }
            pendingAction = null;
            lastSwingTick = tick;
        }
        lastSwinging = swinging;
        lastTicks = ticks;

        if (pendingAction != null && tick - pendingActionTick > ACTION_TICKS) pendingAction = null;
        tick++;
    }

    public SwingState getState() {
        return new SwingState(count, leftArm, kind);
    }

}
