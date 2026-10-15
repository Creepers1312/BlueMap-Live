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

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

public class SwingTrackerTest {

    /** simulates minecraft: swingHand() sets ticks to -1, every tick increments it until the swing-duration (6) */
    private static void swing(SwingTracker tracker, boolean leftArm, int ticks) {
        for (int t = 0; t < ticks; t++) tracker.update(true, t, leftArm);
    }

    @Test
    public void testNoSwing() {
        SwingTracker tracker = new SwingTracker();
        for (int i = 0; i < 10; i++) tracker.update(false, 0, false);
        assertEquals(new SwingState(0, false), tracker.getState());
    }

    @Test
    public void testSingleSwingIsCountedOnce() {
        SwingTracker tracker = new SwingTracker();
        swing(tracker, false, 6);
        tracker.update(false, 0, false);
        tracker.update(false, 0, false);
        assertEquals(new SwingState(1, false), tracker.getState());
    }

    @Test
    public void testConsecutiveSwings() {
        SwingTracker tracker = new SwingTracker();
        swing(tracker, false, 6);
        tracker.update(false, 0, false);
        swing(tracker, true, 6);
        assertEquals(new SwingState(2, true), tracker.getState(), "second swing with the left arm");
    }

    @Test
    public void testRestartWhileSwingingIsANewSwing() {
        SwingTracker tracker = new SwingTracker();
        swing(tracker, false, 3); // ticks 0,1,2
        swing(tracker, false, 6); // restarted at 0 before the first one finished
        assertEquals(2, tracker.getState().count());
    }

    @Test
    public void testAlreadySwingingWhenTrackingStarts() {
        SwingTracker tracker = new SwingTracker();
        tracker.update(true, 3, false);
        tracker.update(true, 4, false);
        assertEquals(1, tracker.getState().count());
    }

    @Test
    public void testManySwingsBetweenTwoSamples() {
        // the server samples every 5 ticks: every swing is still counted (the client sees the count increase)
        SwingTracker tracker = new SwingTracker();
        for (int i = 0; i < 5; i++) {
            swing(tracker, false, 2);
        }
        assertEquals(5, tracker.getState().count());
    }

    @Test
    public void testSwingKinds() {
        SwingTracker tracker = new SwingTracker();

        // swing into the air
        swing(tracker, false, 6);
        assertEquals(SwingState.Kind.SWING, tracker.getState().kind());

        // attack: the event comes in the same tick as the swing
        tracker.noteAction(SwingState.Kind.ATTACK);
        swing(tracker, false, 6);
        assertEquals(SwingState.Kind.ATTACK, tracker.getState().kind());

        // the next swing without an event is a normal swing again
        tracker.update(false, 0, false);
        swing(tracker, false, 6);
        assertEquals(SwingState.Kind.SWING, tracker.getState().kind());

        // use (e.g. throwing a snowball): the swing comes one tick after the event
        tracker.noteAction(SwingState.Kind.USE);
        tracker.update(false, 0, false);
        swing(tracker, true, 6);
        assertEquals(new SwingState(4, true, SwingState.Kind.USE), tracker.getState());
    }

    @Test
    public void testOldActionsAreNotAssigned() {
        SwingTracker tracker = new SwingTracker();
        tracker.noteAction(SwingState.Kind.ATTACK);
        for (int i = 0; i < 5; i++) tracker.update(false, 0, false);
        swing(tracker, false, 6);
        assertEquals(SwingState.Kind.SWING, tracker.getState().kind(), "an attack without a swing is not assigned to a later swing");
    }

    @Test
    public void testContinuedMining() {
        SwingTracker tracker = new SwingTracker();
        tracker.noteAction(SwingState.Kind.MINE);
        // the client keeps swinging while breaking a block (a restart every few ticks)
        for (int i = 0; i < 5; i++) swing(tracker, false, 3);
        assertEquals(5, tracker.getState().count());
        assertEquals(SwingState.Kind.MINE, tracker.getState().kind());

        // a pause ends the mining
        for (int i = 0; i < SwingTracker.MINE_CONTINUE_TICKS + 2; i++) tracker.update(false, 0, false);
        swing(tracker, false, 6);
        assertEquals(SwingState.Kind.SWING, tracker.getState().kind());
    }

}
