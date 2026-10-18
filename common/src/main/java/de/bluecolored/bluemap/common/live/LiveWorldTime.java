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
 * The time and weather of a world for the day-night-cycle of the webapp (BlueMap Live, see docs/bluemap-live/phase-8.md).
 * Only for worlds with sky-light and a running time (not the nether or the end).
 *
 * @param dayTime the time of day in ticks (vanilla <code>getTimeOfDay() % 24000</code>)
 * @param rain the rain-gradient (0..1)
 * @param thunder the thunder-gradient (0..1)
 * @param cycle if the time runs on (gamerule doDaylightCycle)
 * @param moonPhase the moon-phase 0..7 (vanilla <code>DimensionType.getMoonPhase</code>: the day modulo 8)
 */
public record LiveWorldTime(long dayTime, double rain, double thunder, boolean cycle, int moonPhase) {

    public LiveWorldTime(long dayTime, double rain, double thunder, boolean cycle) {
        this(dayTime, rain, thunder, cycle, 0);
    }

    /**
     * the textures of the sky and the weather the webapp draws in the live world-time mode (sun, moon-phases, clouds,
     * rain and snow), provided like the particle-textures (only these, only from minecraft)
     */
    public static final java.util.List<String> TEXTURES = java.util.List.of(
            "minecraft:environment/sun",
            "minecraft:environment/moon_phases",
            "minecraft:environment/clouds",
            "minecraft:environment/rain",
            "minecraft:environment/snow"
    );

}
