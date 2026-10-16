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
 * BlueMap Live: a playback-buffer for the live-data (like the "interpolation delay" of online games).
 * Over the internet the responses do not arrive evenly (the latency varies), the markers would stop and jump.
 * Instead every sample is applied at its server-time plus the (smallest) transfer-time plus a fixed delay,
 * so the samples are applied as evenly as they were taken and the existing interpolation runs without gaps.
 */

/** the default delay in ms (0: no buffer, samples are applied when they arrive) */
export const DEFAULT_PLAYBACK_DELAY = 400;

/** the selectable delays in ms */
export const PLAYBACK_DELAYS = [0, 250, 400, 750, 1000];

/** the shared settings: the delay is the same for all live-data, so riders, leashes and holders stay together */
export const LIVE_PLAYBACK = {delay: DEFAULT_PLAYBACK_DELAY};

/** the transfer-time is the smallest one seen in the last WINDOW ms (in buckets of BUCKET ms) */
const BUCKET = 1000;
const WINDOW = 10000;

/**
 * Estimates the difference between the client-clock and the server-clock plus the fastest transfer-time:
 * offset = smallest (receive-time - sample-time) of the last 10 s. Clock-differences are included, the clocks do not
 * have to be synchronized. Taking the smallest value of a sliding window follows slow changes (clock-drift).
 */
export class LiveClock {

    constructor() {
        /** per bucket (by receive-time): the smallest offset */
        this.buckets = new Map();
        this.offset = null;
    }

    /**
     * @param sampleTime {number} - server-time of a sample (epoch-ms)
     * @param now {number} - client-time when it was received (epoch-ms)
     */
    observe(sampleTime, now) {
        if (!Number.isFinite(sampleTime) || !Number.isFinite(now)) return;
        const offset = now - sampleTime;
        const bucket = Math.floor(now / BUCKET);
        const current = this.buckets.get(bucket);
        if (current === undefined || offset < current) this.buckets.set(bucket, offset);
        let min = Infinity;
        for (const [key, value] of this.buckets) {
            if (key < bucket - WINDOW / BUCKET) this.buckets.delete(key);
            else if (value < min) min = value;
        }
        this.offset = min;
    }

    /**
     * @returns {number | null} the client-time when a sample of this server-time is applied, null if unknown
     */
    playbackTime(sampleTime, delay = LIVE_PLAYBACK.delay) {
        if (this.offset === null || !Number.isFinite(sampleTime)) return null;
        return sampleTime + this.offset + delay;
    }

}

/** the clock of the live-data of the server (players and entities come from the same server-clock) */
export const LIVE_CLOCK = new LiveClock();

/**
 * Plays back the samples of one marker on the playback-time (server-time - delay - sample-interval): while the
 * playback-time is between
 * two samples, the marker moves from the first to the second. So a sample is applied (as the target of the
 * interpolation) as soon as the playback-time reaches the previous sample, together with that client-time, the
 * interpolation then takes the time between the two samples (see interpolationDuration).
 * The sample-interval of the server is added to the delay: the next sample has to be there when the playback-time
 * reaches the previous one, so the whole delay is left for a late response.
 * Without a delay, without a sample-time or for the first sample (nothing shown yet) a sample is applied at once.
 */
export class PlaybackQueue {

    /**
     * @param apply {function(any, number): void} - with the sample and the client-time its interpolation starts at
     *   (the playback-time of the previous sample), so it does not depend on the frames
     * @param clock {LiveClock}
     * @param now {function(): number}
     */
    constructor(apply, clock = LIVE_CLOCK, now = () => Date.now()) {
        this.apply = apply;
        this.clock = clock;
        this.now = now;
        /** @type {Array<{time: number, sample: any}>} */
        this.queue = [];
        /** the sample-time of the last applied sample, null if none (or without time) */
        this.appliedTime = null;
        this.applied = false;
        /** the newest sample-time that was pushed */
        this.lastTime = null;
        /** the sample-interval of the server (ms) */
        this.interval = 0;
    }

    /**
     * @param sample {any}
     * @param sampleTime {number | null} - the server-time of the sample
     * @param interval {number} - the sample-interval of the server (ms, the update-interval of the response)
     */
    push(sample, sampleTime, interval = 0) {
        if (Number.isFinite(interval) && interval > 0) this.interval = Math.min(interval, 2000);
        const now = this.now();
        const timed = Number.isFinite(sampleTime);
        if (timed) this.clock.observe(sampleTime, now);
        // the same sample again (the data is requested more often than it is sampled) or an older one:
        // a waiting copy is replaced, otherwise it is dropped (it must not apply the waiting newer samples early)
        if (timed && this.lastTime !== null && sampleTime <= this.lastTime) {
            const last = this.queue[this.queue.length - 1];
            if (last && sampleTime === last.time) last.sample = sample;
            return;
        }
        if (timed) this.lastTime = sampleTime;
        if (LIVE_PLAYBACK.delay <= 0 || !this.applied || !timed || this.appliedTime === null) {
            this.flush();
            this.applyNow(sample, timed ? sampleTime : null, now);
            return;
        }
        this.queue.push({time: sampleTime, sample});
        this.release();
    }

    /** applies the next samples whose interpolation has started (called every frame) */
    release() {
        const now = this.now();
        while (this.queue.length > 0) {
            const start = this.clock.playbackTime(this.appliedTime, LIVE_PLAYBACK.delay + this.interval);
            if (start === null || start > now) return;
            const item = this.queue.shift();
            this.applyNow(item.sample, item.time, start);
        }
    }

    /** applies everything that is waiting */
    flush() {
        const now = this.now();
        while (this.queue.length > 0) {
            const item = this.queue.shift();
            this.applyNow(item.sample, item.time, now);
        }
    }

    /** @private */
    applyNow(sample, time, start) {
        this.applied = true;
        this.appliedTime = time;
        this.apply(sample, start);
    }

    get pending() {
        return this.queue.length;
    }

}
