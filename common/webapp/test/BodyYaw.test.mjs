import {test} from "node:test";
import assert from "node:assert/strict";

import {BodyYawTracker, bodyYawTick} from "../src/js/markers/player/BodyYaw.js";

const close = (a, b, eps = 1e-6, message = "") => {
    if (typeof eps === "string") [eps, message] = [1e-6, eps];
    assert.ok(Math.abs(a - b) < eps, `${a} != ${b} ${message}`);
};

test("body-yaw: walking straight ahead turns the body to the look-direction (vanilla turnHead, 30 % per tick)", () => {
    // looking south (yaw 0), walking south (+z, 0.2 blocks per tick), the body starts 40 degrees off
    let body = 40;
    for (let i = 0; i < 30; i++) body = bodyYawTick(body, 0, 0, 0.2);
    close(body, 0, 1e-3);
    close(bodyYawTick(40, 0, 0, 0.2), 28, 1e-4, "40 - 0.3 * 40");
});

test("body-yaw: standing still the body follows only when the head turns more than 50 degrees (15 while blocking)", () => {
    close(bodyYawTick(0, 30, 0, 0), 0, "within 50 degrees: stays");
    close(bodyYawTick(0, 80, 0, 0), 30, "80 - 50");
    close(bodyYawTick(0, 30, 0, 0, false, true), 15, "blocking: 30 - 15");
    // a movement below 0.05 blocks per tick counts as standing (0.0025000002)
    close(bodyYawTick(0, 30, 0.04, 0), 0);
});

test("body-yaw: walking backwards keeps the body facing forward, strafing turns it, a swing faces the look-direction", () => {
    // looking south, walking north: the body stays south
    close(bodyYawTick(0, 0, 0, -0.2), 0);
    // looking south, walking east (-90 in minecraft yaw): turned 30 % towards east, within 50 degrees
    close(bodyYawTick(0, 0, 0.2, 0), -27);
    close(bodyYawTick(40, 0, 0, 0, true), 28, "swinging: towards the yaw");
});

test("body-yaw tracker: 20 ticks per second, interpolated between the ticks", () => {
    const tracker = new BodyYawTracker();
    tracker.reset(40, 0, 0);
    close(tracker.step(0.025, 0, 0.1, 0), 40, "half a tick: no tick yet");
    const after = tracker.step(0.025, 0, 0.2, 0);
    close(after, 40, "the tick is done, interpolation starts at the previous value");
    close(tracker.step(0.025, 0, 0.3, 0), 34, "half-way to 28");
    // a slow frame of 10 ticks: walking straight on turns the body almost to the look-direction
    let yaw = 0;
    for (let i = 0; i < 4; i++) yaw = tracker.step(0.5, 0, 0.3 + (i + 1) * 2, 0);
    close(yaw, 0, 0.5);
});
