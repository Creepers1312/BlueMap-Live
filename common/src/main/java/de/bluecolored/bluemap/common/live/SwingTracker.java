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

/**
 * Detects every new arm-swing of a player from the swing-fields minecraft keeps on the server
 * (<code>handSwinging</code> and <code>handSwingTicks</code>), checked once per tick.
 * <p>A swing starts when the player starts swinging, or when the swing-progress restarts while still swinging
 * (a new swing before the previous one finished). Not thread-safe, only call from the server-thread.</p>
 */
public class SwingTracker {

    private boolean lastSwinging = false;
    private int lastTicks = 0;

    private int count = 0;
    private boolean leftArm = false;

    /**
     * @param swinging if the player is currently swinging an arm
     * @param ticks the ticks since the current swing started
     * @param leftArm if the swinging arm is the left arm
     */
    public void update(boolean swinging, int ticks, boolean leftArm) {
        if (swinging && (!lastSwinging || ticks < lastTicks)) {
            count++;
            this.leftArm = leftArm;
        }
        lastSwinging = swinging;
        lastTicks = ticks;
    }

    public SwingState getState() {
        return new SwingState(count, leftArm);
    }

}
