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
 * The items a player holds.
 *
 * @param mainHand the item in the main hand, null if the hand is empty
 * @param offHand the item in the off hand, null if the hand is empty
 * @param leftHanded true if the main hand of the player is the left one
 * @param fishing true if the player has cast a fishing rod
 * @param armor the worn armor, null if none
 * @param head an item worn on the head that is no helmet (vanilla HeadFeatureRenderer, e.g. a carved pumpkin or a
 *             block), null if none
 * @param light the light the held and worn items emit (0..15, BlueMap Live dynamic lights: the luminance of the block
 *              of a block-item, e.g. 14 for a torch), 0 if none
 */
public record Equipment(@Nullable HeldItem mainHand, @Nullable HeldItem offHand, boolean leftHanded, boolean fishing,
                        @Nullable Armor armor, @Nullable HeldItem head, int light) {

    public static final Equipment EMPTY = new Equipment(null, null, false, false);

    public Equipment(@Nullable HeldItem mainHand, @Nullable HeldItem offHand, boolean leftHanded, boolean fishing) {
        this(mainHand, offHand, leftHanded, fishing, null);
    }

    public Equipment(@Nullable HeldItem mainHand, @Nullable HeldItem offHand, boolean leftHanded, boolean fishing,
                     @Nullable Armor armor) {
        this(mainHand, offHand, leftHanded, fishing, armor, null);
    }

    public Equipment(@Nullable HeldItem mainHand, @Nullable HeldItem offHand, boolean leftHanded, boolean fishing,
                     @Nullable Armor armor, @Nullable HeldItem head) {
        this(mainHand, offHand, leftHanded, fishing, armor, head, 0);
    }

    public Equipment {
        if (armor != null && armor.isEmpty()) armor = null;
        light = Math.max(0, Math.min(15, light));
    }

}
