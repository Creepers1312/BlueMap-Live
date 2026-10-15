// Unit-tests for src/js/markers/LivePlayerData.js
// Run with: npm test   (uses the node built-in test-runner, no additional dependencies)

import {test} from "node:test";
import assert from "node:assert/strict";

import {
    angleDelta,
    DEFAULT_UPDATE_INTERVAL,
    interpolationDuration,
    isDiscontinuous,
    isStaleResponse,
    MAX_UPDATE_INTERVAL,
    MIN_UPDATE_INTERVAL,
    parsePlayer,
    parsePlayersResponse,
    resolveUpdateInterval,
    SUPPORTED_PROTOCOL,
} from "../src/js/markers/LivePlayerData.js";

const UUID = "069a79f4-44e9-4726-a5be-fca90e38aaf5";

// this is exactly the output of the java LivePlayersJson writer (see LivePlayersJsonTest)
const v1Player = () => ({
    uuid: UUID, name: "Notch", foreign: false,
    position: {x: 10.5, y: 64, z: -20.25},
    rotation: {pitch: 15, yaw: 90, roll: 0},
    world: "minecraft:overworld", generation: 3, time: 123456789, bodyYaw: 80,
    velocity: {x: 4.3, y: 0, z: 0},
    state: {sneaking: true, sprinting: false, onGround: true, swimming: false, flying: false, fallFlying: true},
});

const v1Response = (players = [v1Player()]) => ({protocol: 1, serverTime: 1000, updateInterval: 250, players});

test("parses a complete protocol-1 response", () => {
    const r = parsePlayersResponse(v1Response());
    assert.equal(r.protocol, 1);
    assert.equal(r.supported, true);
    assert.equal(r.serverTime, 1000);
    assert.equal(r.updateInterval, 250);
    assert.equal(r.invalid, 0);
    assert.equal(r.players.length, 1);

    const p = r.players[0];
    assert.equal(p.uuid, UUID);
    assert.equal(p.name, "Notch");
    assert.equal(p.foreign, false);
    assert.deepEqual(p.position, {x: 10.5, y: 64, z: -20.25});
    assert.deepEqual(p.rotation, {pitch: 15, yaw: 90, roll: 0});
    assert.equal(p.bodyYaw, 80);
    assert.equal(p.world, "minecraft:overworld");
    assert.equal(p.generation, 3);
    assert.equal(p.time, 123456789);
    assert.deepEqual(p.velocity, {x: 4.3, y: 0, z: 0});
    assert.deepEqual(p.state, {sneaking: true, sprinting: false, onGround: true, swimming: false, flying: false, fallFlying: true});
});

test("parses the legacy format of older servers (no protocol field)", () => {
    const r = parsePlayersResponse({players: [{
        uuid: UUID, name: "Notch", foreign: false,
        position: {x: 1, y: 2, z: 3}, rotation: {pitch: 4, yaw: 5, roll: 0},
    }]});
    assert.equal(r.protocol, 0);
    assert.equal(r.supported, true);
    assert.equal(r.serverTime, null);
    assert.equal(r.updateInterval, null);

    const p = r.players[0];
    assert.deepEqual(p.position, {x: 1, y: 2, z: 3});
    assert.equal(p.bodyYaw, 5, "bodyYaw falls back to the head-yaw");
    assert.equal(p.generation, null);
    assert.equal(p.world, null);
    assert.equal(p.state, null);
});

test("unsupported (newer) protocol: only the guaranteed original fields are used", () => {
    const data = v1Response();
    data.protocol = SUPPORTED_PROTOCOL + 1;
    const r = parsePlayersResponse(data);
    assert.equal(r.supported, false);

    const p = r.players[0];
    assert.deepEqual(p.position, {x: 10.5, y: 64, z: -20.25});
    assert.deepEqual(p.rotation, {pitch: 15, yaw: 90, roll: 0});
    assert.equal(p.generation, null);
    assert.equal(p.state, null);
    assert.equal(p.velocity, null);
    assert.equal(p.bodyYaw, 90);
});

test("rejects responses that are no players-data at all", () => {
    assert.equal(parsePlayersResponse(null), null);
    assert.equal(parsePlayersResponse("BlueMap - Exception handling this request"), null);
    assert.equal(parsePlayersResponse({}), null);
    assert.equal(parsePlayersResponse({players: {}}), null);
});

test("skips invalid player-entries and counts them", () => {
    const valid = v1Player();
    const r = parsePlayersResponse(v1Response([
        valid,
        null,
        "player",
        {name: "no uuid", position: {x: 0, y: 0, z: 0}},
        {uuid: "", position: {x: 0, y: 0, z: 0}},
        {uuid: "no-position"},
        {uuid: "nan-position", position: {x: NaN, y: 0, z: 0}},
        {uuid: "string-position", position: {x: "1", y: 0, z: 0}},
    ]));
    assert.equal(r.players.length, 1);
    assert.equal(r.players[0].uuid, UUID);
    assert.equal(r.invalid, 7);
});

test("missing or invalid optional fields get defaults", () => {
    const p = parsePlayer({
        uuid: UUID,
        position: {x: 1, y: 2, z: 3},
        rotation: {pitch: "x", yaw: null},
        generation: 1.5,
        time: "now",
        velocity: {x: 1},
        state: {sneaking: "yes", sprinting: true},
        world: 5,
        foreign: "true",
    });
    assert.equal(p.name, UUID, "name falls back to uuid");
    assert.deepEqual(p.rotation, {pitch: 0, yaw: 0, roll: 0});
    assert.equal(p.generation, null);
    assert.equal(p.time, null);
    assert.equal(p.velocity, null);
    assert.equal(p.world, null);
    assert.equal(p.foreign, false, "only boolean true counts as foreign");
    assert.equal(p.state.sneaking, false, "only boolean true counts");
    assert.equal(p.state.sprinting, true);
    assert.equal(p.state.swimming, false);
});

test("position and rotation updates are taken over", () => {
    const a = parsePlayer(v1Player());
    const raw = v1Player();
    raw.position = {x: 11, y: 65, z: -20};
    raw.rotation = {pitch: -10, yaw: 120, roll: 0};
    const b = parsePlayer(raw);
    assert.deepEqual(b.position, {x: 11, y: 65, z: -20});
    assert.deepEqual(b.rotation, {pitch: -10, yaw: 120, roll: 0});
    assert.equal(isDiscontinuous(a, b), false, "normal movement is interpolated");
});

test("rotation only (no movement) is continuous", () => {
    const a = parsePlayer(v1Player());
    const raw = v1Player();
    raw.rotation = {pitch: 80, yaw: -170, roll: 0};
    assert.equal(isDiscontinuous(a, parsePlayer(raw)), false);
});

test("generation change (teleport/respawn) is discontinuous", () => {
    const a = parsePlayer(v1Player());
    const raw = v1Player();
    raw.generation = 4;
    raw.position = {x: 11, y: 64, z: -20}; // even if close-by
    assert.equal(isDiscontinuous(a, parsePlayer(raw)), true);
});

test("dimension change is discontinuous", () => {
    const a = parsePlayer(v1Player());

    const sameGenOtherWorld = v1Player();
    sameGenOtherWorld.world = "minecraft:the_nether";
    assert.equal(isDiscontinuous(a, parsePlayer(sameGenOtherWorld)), true);

    const foreign = v1Player();
    foreign.foreign = true;
    assert.equal(isDiscontinuous(a, parsePlayer(foreign)), true);
});

test("without generation (legacy servers) large jumps are still not interpolated", () => {
    const a = parsePlayer({uuid: UUID, position: {x: 0, y: 64, z: 0}});
    const near = parsePlayer({uuid: UUID, position: {x: 5, y: 64, z: 0}});
    const far = parsePlayer({uuid: UUID, position: {x: 500, y: 64, z: 0}});
    assert.equal(isDiscontinuous(a, near), false);
    assert.equal(isDiscontinuous(a, far), true);
});

test("first update is always discontinuous", () => {
    assert.equal(isDiscontinuous(null, parsePlayer(v1Player())), true);
});

test("stale responses are detected", () => {
    assert.equal(isStaleResponse(null, 1000), false);
    assert.equal(isStaleResponse(1000, null), false);
    assert.equal(isStaleResponse(1000, 1000), false);
    assert.equal(isStaleResponse(1000, 1250), false);
    assert.equal(isStaleResponse(1250, 1000), true);
});

test("update-interval is clamped", () => {
    assert.equal(resolveUpdateInterval(null), DEFAULT_UPDATE_INTERVAL);
    assert.equal(resolveUpdateInterval(NaN), DEFAULT_UPDATE_INTERVAL);
    assert.equal(resolveUpdateInterval(250), 250);
    assert.equal(resolveUpdateInterval(1), MIN_UPDATE_INTERVAL);
    assert.equal(resolveUpdateInterval(1e9), MAX_UPDATE_INTERVAL);
});

test("angleDelta takes the shortest way", () => {
    assert.equal(angleDelta(0, 90), 90);
    assert.equal(angleDelta(170, -170), 20);
    assert.equal(angleDelta(-170, 170), -20);
    assert.equal(angleDelta(0, 720), 0);
    assert.equal(angleDelta(10, 190), -180);
});

test("interpolation duration follows the sample times", () => {
    const a = parsePlayer({...v1Player(), time: 1000});
    const b = parsePlayer({...v1Player(), time: 1250});
    assert.equal(interpolationDuration(a, b, 1000), 250);
    assert.equal(interpolationDuration(null, b, 400), 400);
    assert.equal(interpolationDuration(b, a, 400), 400, "non-increasing times fall back to the interval");
    assert.equal(interpolationDuration(a, parsePlayer({...v1Player(), time: 1001}), 400), 50, "lower bound");
    assert.equal(interpolationDuration(a, parsePlayer({...v1Player(), time: 11000}), 250), 250, "never longer than the update-interval");
});
