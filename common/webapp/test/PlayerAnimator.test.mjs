// Unit-tests for src/js/markers/player/PlayerAnimator.js
// Run with: npm test

import {test} from "node:test";
import assert from "node:assert/strict";

import {PlayerAnimator, SWING_DURATION} from "../src/js/markers/player/PlayerAnimator.js";
import {parsePlayer} from "../src/js/markers/LivePlayerData.js";

const UUID = "069a79f4-44e9-4726-a5be-fca90e38aaf5";

const WALK = 4.317, SPRINT = 5.612, SNEAK = 1.31; // vanilla speeds in blocks per second

function player({speed = 0, vy = 0, swing = null, ...state} = {}) {
    return parsePlayer({
        uuid: UUID, position: {x: 0, y: 64, z: 0},
        velocity: {x: speed, y: vy, z: 0},
        state: {sneaking: false, sprinting: false, onGround: true, swimming: false, flying: false, fallFlying: false, ...state},
        swing,
    });
}

/** runs the animator for the given time with the given frame-rate, calls onFrame(pose, active) after every frame */
function run(animator, seconds, fps = 60, onFrame = null) {
    const frames = Math.round(seconds * fps);
    let active = false;
    for (let i = 0; i < frames; i++) {
        active = animator.step(1 / fps);
        if (onFrame) onFrame(animator.pose, active);
    }
    return active;
}

const maxAbs = (animator, seconds, get, fps = 60) => {
    let max = 0;
    run(animator, seconds, fps, pose => max = Math.max(max, Math.abs(get(pose))));
    return max;
};

test("idle: only the small vanilla arm-movement, legs and body stay still, no high-fps rendering needed", () => {
    const a = new PlayerAnimator();
    a.setTarget(player());
    let active = true;
    let maxArm = 0, maxLeg = 0;
    run(a, 5, 60, (pose, act) => {
        active = act;
        maxArm = Math.max(maxArm, Math.abs(pose.parts.rightArm.rx), Math.abs(pose.parts.rightArm.rz));
        maxLeg = Math.max(maxLeg, Math.abs(pose.parts.rightLeg.rx), Math.abs(pose.parts.body.rx));
    });
    assert.equal(active, false);
    assert.ok(maxArm > 0.01 && maxArm <= 0.1001, `idle arm movement ${maxArm}`);
    assert.equal(maxLeg, 0);
});

test("idle -> walk -> idle", () => {
    const a = new PlayerAnimator();
    a.setTarget(player());
    a.step(0.016);

    a.setTarget(player({speed: WALK}));
    // the limbs speed up smoothly (no jump in the first frame)
    a.step(1 / 60);
    assert.ok(a.limbSpeed > 0 && a.limbSpeed < 0.2, `first frame ${a.limbSpeed}`);
    assert.equal(run(a, 1), true, "walking is active");

    let maxLeg = 0;
    run(a, 2, 60, pose => {
        const {rightLeg, leftLeg, rightArm} = pose.parts;
        maxLeg = Math.max(maxLeg, Math.abs(rightLeg.rx));
        assert.ok(Math.abs(rightLeg.rx + leftLeg.rx) < 1e-9, "legs swing opposite");
        if (Math.abs(rightLeg.rx) > 0.3) assert.ok(Math.sign(rightArm.rx) !== Math.sign(rightLeg.rx), "arm opposite to the leg of the same side");
    });
    // vanilla: amplitude 1.4 * limbSpeed, limbSpeed = min(4.317 / 20 * 4, 1)
    assert.ok(Math.abs(maxLeg - 1.4 * 0.8634) < 0.05, `walk amplitude ${maxLeg}`);

    a.setTarget(player());
    run(a, 1);
    assert.equal(a.limbSpeed, 0, "limbs come to rest");
    assert.equal(Math.abs(a.pose.parts.rightLeg.rx), 0);
    assert.equal(a.step(1 / 60), false, "standing is not active");
});

const crossings = (a, seconds) => {
    let last = null, count = 0;
    run(a, seconds, 120, pose => {
        const s = Math.sign(pose.parts.rightLeg.rx);
        if (last !== null && s !== 0 && s !== last) count++;
        if (s !== 0) last = s;
    });
    return count;
};

test("walk -> sprint -> walk: the legs swing faster and wider while sprinting", () => {
    const a = new PlayerAnimator();
    a.setTarget(player({speed: WALK}));
    run(a, 1);
    const walk = crossings(a, 4);
    const walkAmp = maxAbs(a, 1, p => p.parts.rightLeg.rx);

    a.setTarget(player({speed: SPRINT, sprinting: true}));
    run(a, 1);
    const sprint = crossings(a, 4);
    const sprintAmp = maxAbs(a, 1, p => p.parts.rightLeg.rx);

    a.setTarget(player({speed: WALK}));
    run(a, 1);
    const walkAgain = crossings(a, 4);

    assert.ok(sprint > walk, `sprint ${sprint} > walk ${walk}`);
    assert.ok(sprintAmp > walkAmp, `sprint amplitude ${sprintAmp} > ${walkAmp}`);
    assert.ok(Math.abs(walkAgain - walk) <= 1, `walk again ${walkAgain} ~ ${walk}`);
});

test("animation is frame-rate independent", () => {
    const sample = fps => {
        const a = new PlayerAnimator();
        a.setTarget(player({speed: WALK, sneaking: true}));
        a.step(0); // first step snaps the blend-weights
        run(a, 1.5, fps);
        return {pos: a.limbPos, speed: a.limbSpeed, leg: a.pose.parts.rightLeg.rx, body: a.pose.parts.body.rx};
    };
    const ref = sample(240);
    for (const fps of [20, 30, 60, 144]) {
        const s = sample(fps);
        assert.ok(Math.abs(s.pos - ref.pos) < 0.05 * ref.pos, `${fps} fps limbPos ${s.pos} ~ ${ref.pos}`);
        assert.ok(Math.abs(s.speed - ref.speed) < 1e-3, `${fps} fps limbSpeed`);
        assert.ok(Math.abs(s.leg - ref.leg) < 0.1, `${fps} fps leg ${s.leg} ~ ${ref.leg}`);
        assert.ok(Math.abs(s.body - ref.body) < 1e-6, `${fps} fps body`);
    }
});

test("walk -> sneak -> walk blends continuously to the vanilla sneak-pose", () => {
    const a = new PlayerAnimator();
    a.setTarget(player({speed: WALK}));
    run(a, 1);

    a.setTarget(player({speed: SNEAK, sneaking: true}));
    let last = a.pose.parts.body.rx, maxJump = 0;
    run(a, 0.5, 60, pose => {
        maxJump = Math.max(maxJump, Math.abs(pose.parts.body.rx - last));
        last = pose.parts.body.rx;
    });
    assert.ok(maxJump < 0.2, `no jump in the body-pitch (${maxJump})`);
    const {head, body, rightLeg} = a.pose.parts;
    assert.ok(Math.abs(body.rx - 0.5) < 1e-3, "body leans forward by 0.5 rad");
    assert.ok(Math.abs(head.py + 4.2) < 1e-2, "head lower");
    assert.ok(Math.abs(rightLeg.pz + 4) < 1e-2, "legs move back");
    assert.ok(a.pose.rootY < -0.12, "whole model lower");

    a.setTarget(player({speed: WALK}));
    run(a, 0.5);
    assert.ok(Math.abs(a.pose.parts.body.rx) < 1e-3);
    assert.ok(Math.abs(a.pose.rootY) < 1e-3);
});

test("idle -> punch -> idle: a new swing-counter starts one swing of the right or left arm", () => {
    const a = new PlayerAnimator();
    a.setTarget(player({swing: {count: 7, arm: "right"}}));
    assert.equal(run(a, 0.5), false, "the first known counter is no swing (e.g. after joining or re-adding)");

    a.setTarget(player({swing: {count: 8, arm: "right"}}));
    let min = 0, active = false;
    run(a, SWING_DURATION * 0.9, 60, (pose, act) => {
        min = Math.min(min, pose.parts.rightArm.rx);
        active = active || act;
    });
    assert.equal(active, true);
    assert.ok(min < -1, `right arm swings forward (${min})`);
    assert.ok(Math.abs(a.pose.parts.leftArm.rx) < 0.25, "left arm stays");

    assert.equal(run(a, 0.2), false, "swing ends");
    assert.ok(Math.abs(a.pose.parts.rightArm.rx) < 0.1, "back to idle");
    assert.equal(a.pose.parts.body.ry, 0);

    a.setTarget(player({swing: {count: 9, arm: "left"}}));
    const leftMin = maxAbs(a, SWING_DURATION, p => Math.min(p.parts.leftArm.rx, 0));
    assert.ok(leftMin > 1, "left arm swings");

    // the same counter again is no new swing
    a.setTarget(player({swing: {count: 9, arm: "left"}}));
    assert.equal(a.step(1 / 60), false);
});

test("walk -> jump -> landing", () => {
    const a = new PlayerAnimator();
    a.setTarget(player({speed: WALK}));
    run(a, 1);
    const groundSpread = a.airWeight;

    a.setTarget(player({speed: WALK, onGround: false, vy: 8}));
    run(a, 0.3);
    assert.ok(groundSpread === 0 && a.airWeight > 0.9, `air-pose blended in (${a.airWeight})`);

    a.setTarget(player({speed: WALK, onGround: false, vy: -10}));
    const falling = a.fallSpeed;
    assert.ok(falling > 0);

    a.setTarget(player({speed: WALK}));
    run(a, 0.5);
    assert.ok(a.airWeight < 0.01, "landed");
});

test("flying and swimming: no air-pose, swimming leans the model around its center", () => {
    const a = new PlayerAnimator();
    a.setTarget(player({onGround: false, flying: true}));
    run(a, 1);
    assert.equal(a.airWeight < 0.01, true, "creative-flying is no jump");

    a.setTarget(player({speed: 2, onGround: false, swimming: true}));
    run(a, 2);
    assert.ok(Math.abs(a.pose.rootPitch - Math.PI / 2) < 1e-3, "horizontal");
    // the rotated center of the model (0.9375 blocks above the feet) ends at 0.3 blocks height above the position
    const c = 0.9375, p = a.pose.rootPitch;
    assert.ok(Math.abs(a.pose.rootY + c * Math.cos(p) - 0.3) < 1e-3);
    assert.ok(Math.abs(a.pose.rootZ + c * Math.sin(p)) < 1e-3);
});

test("reset (teleport, respawn, world-change) jumps to the target pose and keeps the swing-counter", () => {
    const a = new PlayerAnimator();
    a.setTarget(player({speed: WALK, swing: {count: 3, arm: "right"}}));
    run(a, 1);

    a.reset();
    a.setTarget(player({sneaking: true, swing: {count: 3, arm: "right"}}));
    a.step(1 / 60);
    assert.equal(a.limbSpeed, 0, "no running limbs after the reset");
    assert.equal(a.sneakWeight, 1, "target pose without blending");
    assert.equal(a.swingTime, -1, "no swing from the reset");
});

test("missing state, velocity and swing (older servers) give the idle pose", () => {
    const a = new PlayerAnimator();
    a.setTarget(parsePlayer({uuid: UUID, position: {x: 0, y: 0, z: 0}}));
    assert.equal(run(a, 1), false);
    assert.equal(Math.abs(a.pose.parts.rightLeg.rx), 0);
    assert.equal(a.pose.rootY, 0);
    assert.doesNotThrow(() => a.step(NaN));
    assert.doesNotThrow(() => a.step(-1));
});

test("several players animate independently, the pose-object is reused", () => {
    const walking = new PlayerAnimator(), sneaking = new PlayerAnimator();
    walking.setTarget(player({speed: WALK}));
    sneaking.setTarget(player({sneaking: true}));
    const pose = walking.pose;
    run(walking, 1);
    run(sneaking, 1);
    assert.equal(walking.pose, pose, "no new pose per frame");
    assert.notEqual(walking.pose, sneaking.pose);
    assert.ok(walking.limbSpeed > 0.8 && sneaking.limbSpeed === 0);
    assert.ok(walking.pose.parts.body.rx === 0 && sneaking.pose.parts.body.rx > 0.49);
});

test("riding: no walking, the vanilla sitting-pose and no air-pose", () => {
    const a = new PlayerAnimator();
    a.setTarget(player({speed: SPRINT, onGround: false, riding: true}));
    run(a, 1);
    const {rightArm, leftArm, rightLeg, leftLeg} = a.pose.parts;
    assert.equal(a.limbSpeed, 0);
    assert.ok(Math.abs(rightLeg.rx - -1.4137167) < 1e-6 && Math.abs(leftLeg.rx - -1.4137167) < 1e-6);
    assert.ok(Math.abs(rightLeg.ry + Math.PI / 10) < 1e-6 && Math.abs(leftLeg.ry - Math.PI / 10) < 1e-6, "legs spread");
    assert.ok(Math.abs(rightArm.rx - -Math.PI / 5) < 0.06 && Math.abs(leftArm.rx - -Math.PI / 5) < 0.06, "arms forward");
    assert.equal(a.inAir, false);
    assert.equal(parsePlayer({uuid: UUID, position: {x: 0, y: 0, z: 0}, state: {riding: true}}).state.riding, true);
});
