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

/*
 * The day-night-cycle of the Minecraft world for the map-lighting (BlueMap Live, see docs/bluemap-live/phase-8.md).
 * No three.js, so it can be unit-tested with node.
 */

const isFiniteNumber = value => typeof value === "number" && Number.isFinite(value);
const clamp01 = value => Math.min(1, Math.max(0, value));

/**
 * @param value {any} - the "world"-object of live/players.json
 * @returns {{dayTime: number, rain: number, thunder: number, cycle: boolean} | null}
 */
export function parseWorldTime(value) {
    if (!value || typeof value !== "object" || !isFiniteNumber(value.dayTime)) return null;
    return {
        dayTime: ((value.dayTime % 24000) + 24000) % 24000,
        rain: isFiniteNumber(value.rain) ? clamp01(value.rain) : 0,
        thunder: isFiniteNumber(value.thunder) ? clamp01(value.thunder) : 0,
        cycle: value.cycle !== false,
        moonPhase: Number.isInteger(value.moonPhase) ? ((value.moonPhase % 8) + 8) % 8 : 0,
    };
}

/**
 * vanilla DimensionType.getSkyAngle: the angle of the sun (0..1, 0 = noon) at a time of day.
 * @param dayTime {number} - ticks
 * @returns {number}
 */
export function skyAngle(dayTime) {
    let d = dayTime / 24000 - 0.25;
    d -= Math.floor(d);
    const e = 0.5 - Math.cos(d * Math.PI) / 2;
    return (d * 2 + e) / 3;
}

/**
 * The sunlight-strength of the map (0..1) like the sky-light in Minecraft: vanilla World.calculateAmbientDarkness
 * (darkness = (1 - f * rain * thunder) * 11, the sky-light is 15 - darkness).
 * Noon: 1, night: 4/15 (BlueMaps own night-switch uses 0.25).
 * @param dayTime {number}
 * @param rain {number} - 0..1
 * @param thunder {number} - 0..1
 * @returns {number}
 */
export function worldSunlight(dayTime, rain = 0, thunder = 0) {
    const f = 0.5 + 2 * Math.min(0.25, Math.max(-0.25, Math.cos(skyAngle(dayTime) * Math.PI * 2)));
    const d = 1 - rain * 5 / 16;
    const e = 1 - thunder * 5 / 16;
    const darkness = (1 - f * d * e) * 11;
    return (15 - darkness) / 15;
}

/**
 * The current time of day from the last sample: runs on with 20 ticks per second (if the cycle runs).
 * @param world {{dayTime: number, cycle: boolean}}
 * @param secondsSinceSample {number}
 * @returns {number}
 */
export function currentDayTime(world, secondsSinceSample) {
    const time = world.cycle ? world.dayTime + Math.max(0, secondsSinceSample) * 20 : world.dayTime;
    return time % 24000;
}

/**
 * The time of day as a clock like the game (0 ticks = 06:00, 1000 ticks per hour).
 * @param dayTime {number} - ticks
 * @returns {string} "HH:MM"
 */
export function worldClock(dayTime) {
    const t = ((Math.floor(dayTime) % 24000) + 24000) % 24000;
    const hours = (Math.floor(t / 1000) + 6) % 24;
    const minutes = Math.floor((t % 1000) * 60 / 1000);
    return String(hours).padStart(2, "0") + ":" + String(minutes).padStart(2, "0");
}

/**
 * The weather of the world: vanilla World.isRaining (rain-gradient > 0.2), isThundering (thunder-gradient > 0.9,
 * the server sends World.getThunderGradient, which already includes the rain).
 * @param world {{rain: number, thunder: number}}
 * @returns {"clear" | "rain" | "thunder"}
 */
export function worldWeather(world) {
    if (world.rain <= 0.2) return "clear";
    return world.thunder > 0.9 ? "thunder" : "rain";
}

/**
 * If the sun is up (vanilla: day between 23000 and 13000 ticks, the sun rises at 23000)
 * @param dayTime {number}
 * @returns {boolean}
 */
export function isDayTime(dayTime) {
    const t = ((dayTime % 24000) + 24000) % 24000;
    return t < 13000 || t >= 23000;
}
