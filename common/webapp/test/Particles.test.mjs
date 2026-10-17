import {test} from "node:test";
import assert from "node:assert/strict";

import {parseEffect, parseEffects, parseParticles} from "../src/js/markers/particles/ParticleData.js";
import {ExplosionEmitterParticle, ExplosionParticle, fireLayers, MAX_PARTICLES, PARTICLE_SPRITES, ParticleSystem, PoofParticle,
    SHEET_LIT, SHEET_OPAQUE, SHEET_TRANSLUCENT, SpellParticle, spriteIndex} from "../src/js/markers/particles/LiveParticles.js";
import {ATLAS_TEXTURES, atlasLayout, fireFrame} from "../src/js/markers/particles/ParticleView.js";
import {entityKind, parseEntitiesResponse, parseEntity} from "../src/js/markers/LiveEntityData.js";
import {parsePlayer} from "../src/js/markers/LivePlayerData.js";
import {LIVE_PLAYBACK, LiveClock, PlaybackQueue} from "../src/js/markers/LivePlayback.js";

/** a fixed sequence of random numbers (repeated) */
const sequence = (...values) => {
    let i = 0;
    return () => values[i++ % values.length];
};

test("particle-data: fire, swirls and clouds are validated, nothing emitted is null", () => {
    assert.equal(parseParticles(null), null);
    assert.equal(parseParticles({}), null);
    assert.equal(parseParticles({swirls: ["red", -1, 2 ** 33]}), null, "only ARGB-integers");
    assert.deepEqual(parseParticles({fire: true}), {fire: true, swirls: [], ambient: false, invisible: false, cloud: null});
    const swirls = parseParticles({swirls: Array.from({length: 40}, (_, i) => 0xFF000000 + i), ambient: true});
    assert.equal(swirls.swirls.length, 16, "at most 16 colors");
    assert.equal(swirls.ambient, true);
    assert.deepEqual(parseParticles({cloud: {radius: 100, color: 0xFFF82423, waiting: true}}).cloud,
        {radius: 32, color: 0xFFF82423, waiting: true}, "vanilla MAX_RADIUS");
    assert.equal(parseParticles({cloud: {radius: -1, color: 0}}), null);
});

test("particle-data: effects of the entities-response", () => {
    assert.deepEqual(parseEffect({id: 3, type: "explosion", x: 1, y: 64, z: -2.5, power: 3, destroy: true, time: 1000}),
        {id: 3, type: "explosion", position: {x: 1, y: 64, z: -2.5}, power: 3, destroy: true, color: 0, time: 1000});
    assert.equal(parseEffect({id: 3, type: "lightning", x: 1, y: 2, z: 3}), null, "unknown types are skipped");
    assert.equal(parseEffect({id: "3", type: "splash", x: 1, y: 2, z: 3}), null);
    assert.equal(parseEffect({id: 4, type: "splash", x: 1, y: 2, z: 3, color: 0xFF385DC6}).color, 0x385DC6);
    assert.deepEqual(parseEffects("x"), []);

    const response = parseEntitiesResponse({protocol: 1, serverTime: 5, updateInterval: 250, entities: [],
        effects: [{id: 1, type: "instant_splash", x: 0, y: 0, z: 0, color: 0xF82423}, {id: 2}]});
    assert.equal(response.effects.length, 1);
    assert.deepEqual(parseEntitiesResponse({protocol: 1, entities: []}).effects, [], "older servers: none");
});

test("particle-data: entities and players with particles, clouds are drawn as particles only", () => {
    const cloud = parseEntity({id: 7, type: "minecraft:area_effect_cloud", position: {x: 0, y: 64, z: 0},
        particles: {cloud: {radius: 3, color: 0xFF7DBEE8}}});
    assert.equal(entityKind(cloud), "particles");
    assert.equal(entityKind(parseEntity({id: 7, type: "minecraft:area_effect_cloud", position: {x: 0, y: 64, z: 0}})), null);
    const player = parsePlayer({uuid: "a", position: {x: 0, y: 0, z: 0}, particles: {fire: true, swirls: [0xFFF82423]}});
    assert.deepEqual(player.particles.swirls, [0xFFF82423]);
    assert.equal(parsePlayer({uuid: "a", position: {x: 0, y: 0, z: 0}}).particles, null);
});

test("particles: vanilla SpriteProvider.getSprite(age, maxAge) with integer-division", () => {
    assert.equal(spriteIndex(0, 8, 8), 0);
    assert.equal(spriteIndex(7, 8, 8), 6); // 7 * 7 / 8 = 6
    assert.equal(spriteIndex(8, 8, 8), 7);
    assert.equal(spriteIndex(3, 0, 8), 0);
    assert.equal(PARTICLE_SPRITES.entity_effect[0], "minecraft:particle/effect_7", "the big sprite first");
    assert.equal(PARTICLE_SPRITES.explosion[15], "minecraft:particle/explosion_15");
});

test("particles: explosion like vanilla ExplosionLargeParticle (lit, 6..9 ticks, gray, size by the emitter-progress)", () => {
    const system = new ParticleSystem(() => 0.5);
    const particle = new ExplosionParticle(system, 1, 2, 3, 0.5);
    assert.equal(particle.maxAge, 6 + 2);
    assert.equal(particle.red, 0.5 * 0.6 + 0.4);
    assert.equal(particle.scale, 2 * (1 - 0.25));
    assert.equal(particle.sheet, SHEET_LIT);
    for (let i = 0; i < 8; i++) particle.tick();
    assert.equal(particle.dead, false);
    assert.equal(particle.sprite, spriteIndex(8, 8, 16));
    assert.deepEqual([particle.x, particle.y, particle.z], [1, 2, 3], "does not move");
    particle.tick();
    assert.equal(particle.dead, true);
});

test("particles: Explosion.affectWorld - one particle for small or harmless explosions, else the emitter", () => {
    const system = new ParticleSystem(() => 0.5);
    system.explosion(0, 64, 0, 1, true); // e.g. a ghast-fireball
    system.explosion(0, 64, 0, 3, false); // a creeper without mob-griefing
    system.tick();
    assert.equal(system.particles.length, 2);
    assert.ok(system.particles.every(p => p instanceof ExplosionParticle && p.scale === 1), "param 1: half size");

    const big = new ParticleSystem(() => 0.25);
    big.explosion(0, 64, 0, 3, true); // a creeper
    big.tick(); // the emitter is added
    assert.ok(big.particles[0] instanceof ExplosionEmitterParticle);
    for (let i = 0; i < 8; i++) big.tick();
    const explosions = big.particles.filter(p => p instanceof ExplosionParticle);
    assert.equal(explosions.length, 6 * 8, "6 per tick for 8 ticks");
    assert.equal(big.particles.some(p => p instanceof ExplosionEmitterParticle), false, "the emitter is gone");
    assert.equal(explosions[0].scale, 2, "the first ones: param 0");
});

test("particles: new particles are ticked from the next tick on (vanilla ParticleManager.newParticles)", () => {
    const system = new ParticleSystem(() => 0.5);
    system.add(new PoofParticle(system, 0, 0, 0, 0, 0, 0));
    assert.equal(system.count, 1);
    system.tick();
    assert.equal(system.particles[0].age, 0);
    system.tick();
    assert.equal(system.particles[0].age, 1);
});

test("particles: SpellParticle (entity_effect) rises slowly, alpha and color of the effect", () => {
    const system = new ParticleSystem(() => 0.5);
    system.emit({x: 0, y: 64, z: 0, width: 0.6, height: 1.8,
        particles: {swirls: [0x26F82423], ambient: false, invisible: false, cloud: null}});
    // random 0.5: floor(0.5 * 4) = 2, no swirl in this tick
    assert.equal(system.count, 0);
    const lucky = new ParticleSystem(sequence(0.1, 0.5));
    lucky.emit({x: 0, y: 64, z: 0, width: 0.6, height: 1.8,
        particles: {swirls: [0x26F82423], ambient: false, invisible: false, cloud: null}});
    lucky.tick();
    const particle = lucky.particles[0];
    assert.ok(particle instanceof SpellParticle);
    assert.equal(particle.sheet, SHEET_TRANSLUCENT);
    assert.equal(Math.round(particle.red * 255), 0xF8);
    assert.equal(Math.round(particle.alpha * 255), 0x26, "ambient effects have a low alpha (from the server)");
    assert.equal(particle.defaultAlpha, particle.alpha);
    const y = particle.y;
    particle.tick();
    assert.ok(particle.y > y, "negative gravity: it rises");
    assert.equal(particle.texture, "minecraft:particle/effect_7");
});

test("particles: the swirl-chance of vanilla tickStatusEffects (1/4, ambient 1/20, invisible 1/15)", () => {
    const count = (ambient, invisible) => {
        let spawned = 0;
        for (let i = 0; i < 400; i++) {
            const system = new ParticleSystem(sequence(i / 400, 0.5));
            system.emit({x: 0, y: 0, z: 0, width: 1, height: 1, particles: {swirls: [0xFFFFFFFF], ambient, invisible, cloud: null}});
            spawned += system.count;
        }
        return spawned;
    };
    assert.equal(count(false, false), 100);
    assert.equal(count(true, false), 20);
    assert.equal(count(false, true), 400 / 15 | 0 + 1);
});

test("particles: area-effect-cloud like vanilla (ceil(pi r^2) particles, waiting: 2 or none)", () => {
    const system = new ParticleSystem(() => 0.7);
    system.emit({x: 0, y: 64, z: 0, width: 6, height: 0.5, particles: {swirls: [], cloud: {radius: 3, color: 0xFF7DBEE8, waiting: false}}});
    assert.equal(system.count, Math.ceil(Math.PI * 9));
    system.tick();
    assert.ok(system.particles.every(p => p.y === 64), "on the disk");
    assert.ok(system.particles.every(p => Math.hypot(p.x, p.z) <= 3));

    const waiting = new ParticleSystem(() => 0.7);
    waiting.emit({x: 0, y: 64, z: 0, width: 1, height: 0.5, particles: {swirls: [], cloud: {radius: 3, color: 0xFF7DBEE8, waiting: true}}});
    assert.equal(waiting.count, 2);
    const skipped = new ParticleSystem(() => 0.2);
    skipped.emit({x: 0, y: 64, z: 0, width: 1, height: 0.5, particles: {swirls: [], cloud: {radius: 3, color: 0xFF7DBEE8, waiting: true}}});
    assert.equal(skipped.count, 0, "waiting: half of the ticks nothing");
});

test("particles: splash-potion (world-event 2002/2007) and death-poof", () => {
    const system = new ParticleSystem(() => 0.5);
    system.splash(10.5, 64, 10.5, 0xF82423, false);
    system.tick();
    assert.equal(system.particles.length, 100);
    assert.ok(system.particles.every(p => p.texture.startsWith("minecraft:particle/effect_")));
    assert.ok(system.particles.every(p => p.y === 64.3));
    const instant = new ParticleSystem(() => 0.5);
    instant.splash(0, 0, 0, 0xF82423, true);
    instant.tick();
    assert.ok(instant.particles.every(p => p.texture.startsWith("minecraft:particle/spell_")));

    const poof = new ParticleSystem(() => 0.5);
    poof.deathPoof(0, 64, 0, 0.6, 1.95);
    poof.tick();
    assert.equal(poof.particles.length, 20);
    assert.ok(poof.particles.every(p => p instanceof PoofParticle && p.sheet === SHEET_OPAQUE));
});

test("particles: at most MAX_PARTICLES, at most 10 ticks per step", () => {
    const system = new ParticleSystem(() => 0.5);
    for (let i = 0; i < MAX_PARTICLES / 100 + 5; i++) system.splash(0, 0, 0, 0, false);
    assert.equal(system.count, MAX_PARTICLES);
    assert.equal(system.step(5), 10);
    assert.equal(system.step(0.06), 1);
    assert.ok(Math.abs(system.tickDelta - 0.2) < 1e-9);
});

test("particles: the fire-layers of vanilla renderFire", () => {
    // a zombie: 0.6 x 1.95, scale 0.84, h = 2.32 -> 6 layers
    const layers = fireLayers(0.6, 1.95);
    assert.equal(layers.length, 6);
    assert.ok(Math.abs(layers[0].x1 - 0.5 * 0.84) < 1e-9);
    assert.ok(Math.abs(layers[0].y1 - 1.4 * 0.84) < 1e-9);
    assert.ok(Math.abs(layers[1].y0 - 0.45 * 0.84) < 1e-9);
    assert.ok(Math.abs(layers[0].z - (0.3 - 2 * 0.02) * 0.84) < 1e-9);
    assert.deepEqual(layers.map(l => l.texture), [0, 1, 0, 1, 0, 1]);
    assert.deepEqual(layers.map(l => l.flip), [true, true, false, false, true, true]);
});

test("particle-atlas: one cell per sprite and per frame, fire-frames of the mcmeta", () => {
    const sizes = new Map([["minecraft:particle/explosion_0", {width: 32, height: 32}],
        ["minecraft:particle/effect_0", {width: 8, height: 8}], ["minecraft:block/fire_0", {width: 16, height: 512}]]);
    const layout = atlasLayout(sizes);
    assert.equal(layout.cell, 32);
    assert.deepEqual(layout.cells.get("minecraft:particle/effect_0"), [1]);
    assert.equal(layout.cells.get("minecraft:block/fire_0").length, 32);
    assert.equal(layout.rows, Math.ceil(34 / 16));
    assert.equal(fireFrame("minecraft:block/fire_0", 0, 32), 16);
    assert.equal(fireFrame("minecraft:block/fire_0", 16, 32), 0);
    assert.equal(fireFrame("minecraft:block/fire_1", 33, 32), 1);
    assert.ok(ATLAS_TEXTURES.includes("minecraft:particle/generic_0") && ATLAS_TEXTURES.includes("minecraft:block/fire_1"));
});

test("playback-queue: scheduled samples (an entity-removal) do not change the clock", () => {
    LIVE_PLAYBACK.delay = 400;
    let now = 10000;
    const applied = [];
    const clock = new LiveClock();
    const queue = new PlaybackQueue((sample, start) => applied.push([sample, start]), clock, () => now);
    queue.push("a", 10000);
    queue.schedule("removed", 10250);
    assert.equal(clock.offset, 0);
    assert.equal(applied.length, 1);
    now = 10400;
    queue.release();
    assert.deepEqual(applied[1], ["removed", 10400]);
    queue.push("b", 10250); // the entity is back with the next sample: still applied
    now = 10650;
    queue.release();
    assert.equal(applied[2][0], "b");

    LIVE_PLAYBACK.delay = 0;
    const direct = new PlaybackQueue(sample => applied.push([sample]), new LiveClock(), () => now);
    direct.schedule("at once", 5);
    assert.deepEqual(applied[3], ["at once"]);
});
