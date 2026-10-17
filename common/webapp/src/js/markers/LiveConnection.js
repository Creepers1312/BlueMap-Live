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
 * BlueMap Live: the state of the live-connection for the indicator in the control-bar (age of the last successful
 * live/players.json response).
 */

/** responses older than this are "delayed" (ms, at least 3 update-intervals) */
export const LIVE_DELAYED_AFTER = 3000;
/** responses older than this are "offline" (ms, the manager retries every 15 s after a failure) */
export const LIVE_OFFLINE_AFTER = 15000;

/**
 * @param lastSuccess {number | null} - client-time (ms) of the last successful response, null: none yet
 * @param now {number} - ms
 * @param interval {number} - the update-interval of the live-data (ms)
 * @returns {"live" | "delayed" | "offline" | "unknown"}
 */
export function liveConnectionState(lastSuccess, now, interval = 1000) {
    if (lastSuccess === null || lastSuccess === undefined) return "unknown";
    const age = now - lastSuccess;
    if (age <= Math.max(LIVE_DELAYED_AFTER, interval * 3)) return "live";
    if (age <= Math.max(LIVE_OFFLINE_AFTER, interval * 6)) return "delayed";
    return "offline";
}
