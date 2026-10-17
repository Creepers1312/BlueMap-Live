import {test} from "node:test";
import assert from "node:assert/strict";

import {LIVE_PLAYBACK, LiveClock, PlaybackQueue} from "../src/js/markers/LivePlayback.js";

test("live-clock: the smallest receive-delay of the last 10 s, clock-differences included", () => {
    const clock = new LiveClock();
    assert.equal(clock.playbackTime(1000), null, "unknown before the first sample");
    // the client-clock is 5000 ms ahead, the transfer takes 80..300 ms
    clock.observe(1000, 6300);
    clock.observe(1250, 6330);
    clock.observe(1500, 6600);
    assert.equal(clock.offset, 5080);
    assert.equal(clock.playbackTime(1750, 400), 1750 + 5080 + 400);
    // after 10 s without such a fast sample the window forgets it (follows clock-drift)
    clock.observe(13000, 18200);
    assert.equal(clock.offset, 5200);
});

test("playback-queue: a sample is applied when the playback-time reaches the previous one, the first one at once", () => {
    LIVE_PLAYBACK.delay = 400;
    let now = 10000;
    const applied = [];
    const queue = new PlaybackQueue((sample, start) => applied.push([sample, start, now]), new LiveClock(), () => now);

    queue.push("a", 10000); // first: shown at once (offset 0: received when it was taken)
    assert.deepEqual(applied, [["a", 10000, 10000]]);
    now = 10250;
    queue.push("b", 10250); // its interpolation starts when the playback-time reaches "a": 10000 + 0 + 400 (no interval)
    queue.push("b2", 10250); // the same sample again (cached response): replaces, not twice
    assert.equal(applied.length, 1);
    assert.equal(queue.pending, 1);
    now = 10399;
    queue.release();
    assert.equal(applied.length, 1);
    now = 10410; // the next frame: applied with the exact start-time, not the time of the frame
    queue.release();
    assert.deepEqual(applied[1], ["b2", 10400, 10410]);

    // a copy of an applied sample (requested more often than sampled) changes nothing,
    // above all it does not apply the waiting newer sample early
    now = 10500;
    queue.push("c", 10500); // starts at 10250 + 400
    queue.push("b-again", 10250);
    assert.equal(applied.length, 2);
    assert.equal(queue.pending, 1);
    queue.push("old", 9000); // an older sample is dropped
    assert.equal(applied.length, 2);
    now = 10700;
    queue.release();
    assert.deepEqual(applied[2], ["c", 10650, 10700]);
});

test("playback-queue: the sample-interval of the server is added, the whole delay is left for late responses", () => {
    LIVE_PLAYBACK.delay = 400;
    let now = 10000;
    const starts = [];
    const queue = new PlaybackQueue((sample, start) => starts.push([sample, start]), new LiveClock(), () => now);
    queue.push("a", 10000, 250);
    now = 10600; // "b" arrives 350 ms late (taken at 10250): still in time, its interpolation starts at 10000 + 400 + 250
    queue.push("b", 10250, 250);
    assert.equal(queue.pending, 1);
    now = 10650;
    queue.release();
    assert.deepEqual(starts[1], ["b", 10650]);
});

test("playback-queue: without delay or sample-time every sample is applied when it arrives (previous behavior)", () => {
    LIVE_PLAYBACK.delay = 0;
    let now = 1000;
    const applied = [];
    const queue = new PlaybackQueue(sample => applied.push(sample), new LiveClock(), () => now);
    queue.push("a", 900);
    queue.push("b", 1150);
    LIVE_PLAYBACK.delay = 400;
    queue.push("c", null);
    assert.deepEqual(applied, ["a", "b", "c"]);
});

test("playback-queue: samples taken every 250 ms, arriving with 50..350 ms delay, start every 250 ms", () => {
    LIVE_PLAYBACK.delay = 400;
    let now = 0;
    const appliedAt = [];
    const queue = new PlaybackQueue((time, start) => appliedAt.push([time, start]), new LiveClock(), () => now);
    // a reproducible jitter
    const jitter = i => 50 + ((i * 7919) % 31) * 10;
    const arrivals = [];
    for (let i = 0; i < 40; i++) arrivals.push({time: 1000 + i * 250, at: 1000 + i * 250 + jitter(i)});
    arrivals.sort((a, b) => a.at - b.at);
    let next = 0;
    for (now = 1000; now < 13000; now += 10) { // frames every 10 ms
        while (next < arrivals.length && arrivals[next].at <= now) queue.push(arrivals[next].time, arrivals[next++].time);
        queue.release();
    }
    // without the buffer the gaps would vary between about -50 and 550 ms (stops and jumps)
    const gaps = appliedAt.slice(6).map((a, i) => a[1] - appliedAt[i + 5][1]);
    assert.ok(gaps.every(gap => gap >= 240 && gap <= 260), `even gaps: ${gaps.join(",")}`);
    assert.deepEqual(appliedAt.map(a => a[0]), arrivals.map(a => a.time).sort((a, b) => a - b), "all, in order");
});
