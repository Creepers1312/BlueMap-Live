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
 * The particles of BlueMap Live like the vanilla client (1.21, see docs/bluemap-live/phase-10.md and the CI-dump):
 * Particle / BillboardParticle / SpriteBillboardParticle, ExplosionLargeParticle ("explosion"),
 * ExplosionEmitterParticle ("explosion_emitter"), SpellParticle ("entity_effect", "effect", "instant_effect") and
 * ExplosionSmokeParticle ("poof"). Simulated with 20 ticks per second, drawn interpolated between two ticks.
 * Not like vanilla: the particles do not collide with blocks (the webapp has no block-collisions) and they are lit
 * by the shared entity-light instead of the light at their position.
 * No three.js, unit-tested with node.
 */

export const TICK_SECONDS = 0.05;
/** vanilla allows 16384 per sheet, the webapp draws all particles every frame */
export const MAX_PARTICLES = 4000;
/** at most this many ticks are simulated in one step (a hidden tab, a slow frame) */
const MAX_TICKS_PER_STEP = 10;

const range = (prefix, from, to) => {
    const keys = [];
    for (let i = from; from <= to ? i <= to : i >= to; from <= to ? i++ : i--) keys.push(prefix + i);
    return keys;
};

/** vanilla particles/*.json (the order of the sprites, the sprite for an age is picked from it) */
export const PARTICLE_SPRITES = {
    explosion: range("minecraft:particle/explosion_", 0, 15),
    entity_effect: range("minecraft:particle/effect_", 7, 0),
    effect: range("minecraft:particle/effect_", 7, 0),
    instant_effect: range("minecraft:particle/spell_", 7, 0),
    poof: range("minecraft:particle/generic_", 7, 0),
};

/** vanilla ModelLoader.FIRE_0 / FIRE_1 (block-textures, animated: the frames of their .mcmeta, 1 tick each) */
export const FIRE_TEXTURES = ["minecraft:block/fire_0", "minecraft:block/fire_1"];
export const FIRE_FRAMES = {
    "minecraft:block/fire_0": [...range("", 16, 31), ...range("", 0, 15)].map(Number),
    "minecraft:block/fire_1": null, // all frames in order
};

/** vanilla ParticleTextureSheet: lit (full-bright) particles are not darkened by the light */
export const SHEET_LIT = "lit";
export const SHEET_OPAQUE = "opaque";
export const SHEET_TRANSLUCENT = "translucent";

/**
 * vanilla SpriteProvider.getSprite(age, maxAge): sprites[age * (count - 1) / maxAge] (integer-division)
 * @returns {number}
 */
export function spriteIndex(age, maxAge, count) {
    if (maxAge <= 0) return 0;
    return Math.min(count - 1, Math.max(0, Math.trunc(age * (count - 1) / maxAge)));
}

/** gaussian random numbers like java Random.nextGaussian (mean 0, deviation 1) */
export function gaussian(random) {
    let u = 0;
    while (u === 0) u = random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * random());
}

/**
 * vanilla Particle: the base of all particles.
 */
export class Particle {

    /**
     * vanilla Particle(world, x, y, z)
     * @param system {ParticleSystem}
     */
    constructor(system, x, y, z) {
        const random = system.random;
        this.system = system;
        this.x = x; this.y = y; this.z = z;
        this.prevX = x; this.prevY = y; this.prevZ = z;
        this.vx = 0; this.vy = 0; this.vz = 0;
        this.red = 1; this.green = 1; this.blue = 1; this.alpha = 1;
        this.velocityMultiplier = 0.98;
        this.gravityStrength = 0;
        this.ascending = false;
        this.age = 0;
        this.maxAge = Math.trunc(4 / (random() * 0.9 + 0.1));
        this.dead = false;
        /** BillboardParticle: the half-size of the quad */
        this.scale = 0.1 * (random() * 0.5 + 0.5) * 2;
        this.sprites = null;
        this.sprite = 0;
        this.sheet = SHEET_OPAQUE;
        this.rendered = true;
    }

    /**
     * vanilla Particle(world, x, y, z, vx, vy, vz): the velocity gets a random part and a random length,
     * plus 0.1 upwards
     */
    randomVelocity(vx, vy, vz) {
        const random = this.system.random;
        this.vx = vx + (random() * 2 - 1) * 0.4;
        this.vy = vy + (random() * 2 - 1) * 0.4;
        this.vz = vz + (random() * 2 - 1) * 0.4;
        const speed = (random() + random() + 1) * 0.15;
        const length = Math.sqrt(this.vx * this.vx + this.vy * this.vy + this.vz * this.vz);
        this.vx = this.vx / length * speed * 0.4;
        this.vy = this.vy / length * speed * 0.4 + 0.1;
        this.vz = this.vz / length * speed * 0.4;
        return this;
    }

    /** vanilla Particle.move(float): the velocity is multiplied (the vertical part around 0.1) */
    speed(factor) {
        this.vx *= factor;
        this.vy = (this.vy - 0.1) * factor + 0.1;
        this.vz *= factor;
        return this;
    }

    setColor(red, green, blue) {
        this.red = red; this.green = green; this.blue = blue;
    }

    /** vanilla SpriteBillboardParticle.setSpriteForAge */
    spriteForAge() {
        if (!this.dead && this.sprites) this.sprite = spriteIndex(this.age, this.maxAge, this.sprites.length);
    }

    /** vanilla Particle.tick (without block-collisions) */
    tick() {
        this.prevX = this.x; this.prevY = this.y; this.prevZ = this.z;
        if (this.age++ >= this.maxAge) {
            this.dead = true;
            return;
        }
        this.vy -= 0.04 * this.gravityStrength;
        this.x += this.vx; this.y += this.vy; this.z += this.vz;
        if (this.ascending && this.y === this.prevY) {
            this.vx *= 1.1;
            this.vz *= 1.1;
        }
        this.vx *= this.velocityMultiplier;
        this.vy *= this.velocityMultiplier;
        this.vz *= this.velocityMultiplier;
    }

    /** the texture-key of the current sprite */
    get texture() {
        return this.sprites ? this.sprites[this.sprite] : null;
    }

}

/** vanilla ExplosionLargeParticle ("explosion"): param is the progress of the emitter (0..1) */
export class ExplosionParticle extends Particle {
    constructor(system, x, y, z, param) {
        super(system, x, y, z);
        this.randomVelocity(0, 0, 0); // SpriteBillboardParticle(world, x, y, z, 0, 0, 0), not moved by its tick
        const random = system.random;
        this.maxAge = 6 + Math.floor(random() * 4);
        const gray = random() * 0.6 + 0.4;
        this.setColor(gray, gray, gray);
        this.scale = 2 * (1 - param * 0.5);
        this.sprites = PARTICLE_SPRITES.explosion;
        this.sheet = SHEET_LIT;
        this.spriteForAge();
    }

    tick() {
        this.prevX = this.x; this.prevY = this.y; this.prevZ = this.z;
        if (this.age++ >= this.maxAge) {
            this.dead = true;
            return;
        }
        this.spriteForAge();
    }
}

/** vanilla ExplosionEmitterParticle ("explosion_emitter"): not drawn, 6 explosion-particles per tick for 8 ticks */
export class ExplosionEmitterParticle extends Particle {
    constructor(system, x, y, z) {
        super(system, x, y, z);
        this.randomVelocity(0, 0, 0);
        this.maxAge = 8;
        this.rendered = false;
    }

    tick() {
        const random = this.system.random;
        for (let i = 0; i < 6; i++) {
            const x = this.x + (random() - random()) * 4;
            const y = this.y + (random() - random()) * 4;
            const z = this.z + (random() - random()) * 4;
            this.system.add(new ExplosionParticle(this.system, x, y, z, this.age / this.maxAge));
        }
        this.age++;
        if (this.age === this.maxAge) this.dead = true;
    }
}

/**
 * vanilla SpellParticle ("entity_effect", "effect", "instant_effect"): rises slowly, the sprites run from big to small
 */
export class SpellParticle extends Particle {
    constructor(system, type, x, y, z, vx, vy, vz) {
        super(system, x, y, z);
        const random = system.random;
        this.randomVelocity(0.5 - random(), vy, 0.5 - random());
        this.defaultAlpha = 1;
        this.velocityMultiplier = 0.96;
        this.gravityStrength = -0.1;
        this.ascending = true;
        this.vy *= 0.2;
        if (vx === 0 && vz === 0) {
            this.vx *= 0.1;
            this.vz *= 0.1;
        }
        this.scale *= 0.75;
        this.maxAge = Math.trunc(8 / (random() * 0.8 + 0.2));
        this.sprites = PARTICLE_SPRITES[type] || PARTICLE_SPRITES.effect;
        this.sheet = SHEET_TRANSLUCENT;
        this.spriteForAge();
    }

    /** vanilla SpellParticle.setAlpha: also the alpha it returns to */
    setAlpha(alpha) {
        this.alpha = alpha;
        this.defaultAlpha = alpha;
    }

    tick() {
        super.tick();
        this.spriteForAge();
        this.alpha += 0.05 * (this.defaultAlpha - this.alpha);
    }
}

/** vanilla ExplosionSmokeParticle ("poof") */
export class PoofParticle extends Particle {
    constructor(system, x, y, z, vx, vy, vz) {
        super(system, x, y, z);
        const random = system.random;
        this.gravityStrength = -0.1;
        this.velocityMultiplier = 0.9;
        this.vx = vx + (random() * 2 - 1) * 0.05;
        this.vy = vy + (random() * 2 - 1) * 0.05;
        this.vz = vz + (random() * 2 - 1) * 0.05;
        const gray = random() * 0.3 + 0.7;
        this.setColor(gray, gray, gray);
        this.scale = 0.1 * (random() * random() * 6 + 1);
        this.maxAge = Math.trunc(16 / (random() * 0.8 + 0.2)) + 2;
        this.sprites = PARTICLE_SPRITES.poof;
        this.sheet = SHEET_OPAQUE;
        this.spriteForAge();
    }

    tick() {
        super.tick();
        this.spriteForAge();
    }
}

/** an entity-effect particle of an ARGB-color (vanilla SpellParticle.EntityFactory) */
function entityEffect(system, x, y, z, vx, vy, vz, argb) {
    const particle = new SpellParticle(system, "entity_effect", x, y, z, vx, vy, vz);
    particle.setColor(((argb >>> 16) & 255) / 255, ((argb >>> 8) & 255) / 255, (argb & 255) / 255);
    particle.setAlpha(((argb >>> 24) & 255) / 255);
    return particle;
}

/**
 * The emitting things of a tick: entities and players with their drawn position and size.
 * @typedef {{x: number, y: number, z: number, width: number, height: number,
 *     particles: import("./ParticleData.js").LiveParticles}} ParticleSource
 */

export class ParticleSystem {

    /**
     * @param random {function(): number}
     */
    constructor(random = Math.random) {
        this.random = random;
        /** @type {Particle[]} */
        this.particles = [];
        /** vanilla ParticleManager.newParticles: added after the tick of the existing particles */
        this.pending = [];
        this.accumulator = 0;
        /** the ticks since the start (for the animated fire) */
        this.ticks = 0;
    }

    /** @param particle {Particle} */
    add(particle) {
        if (this.particles.length + this.pending.length < MAX_PARTICLES) this.pending.push(particle);
    }

    get count() {
        return this.particles.length + this.pending.length;
    }

    /** the part of the next tick that has passed (vanilla tickDelta, for the interpolation) */
    get tickDelta() {
        return this.accumulator / TICK_SECONDS;
    }

    /**
     * vanilla Explosion.affectWorld (client): a large explosion-emitter if the power is at least 2 and blocks are
     * destroyed, otherwise one explosion-particle (param 1)
     */
    explosion(x, y, z, power, destroy) {
        if (power < 2 || !destroy) this.add(new ExplosionParticle(this, x, y, z, 1));
        else this.add(new ExplosionEmitterParticle(this, x, y, z));
    }

    /**
     * vanilla WorldRenderer.processWorldEvent 2002 / 2007 (a splash-potion breaks): 100 effect-particles
     * (instant_effect for 2007) in a ring, at the bottom-center of the block. The 8 item-particles of the bottle
     * are not drawn.
     * @param color {number} - RGB
     */
    splash(x, y, z, color, instant) {
        const random = this.random;
        const red = ((color >> 16) & 255) / 255, green = ((color >> 8) & 255) / 255, blue = (color & 255) / 255;
        for (let i = 0; i < 100; i++) {
            const distance = random() * 4;
            const angle = random() * Math.PI * 2;
            const vx = Math.cos(angle) * distance, vy = 0.01 + random() * 0.5, vz = Math.sin(angle) * distance;
            const particle = new SpellParticle(this, instant ? "instant_effect" : "effect",
                x + vx * 0.1, y + 0.3, z + vz * 0.1, vx, vy, vz);
            const brightness = 0.75 + random() * 0.25;
            particle.setColor(red * brightness, green * brightness, blue * brightness);
            particle.speed(distance);
            this.add(particle);
        }
    }

    /**
     * vanilla LivingEntity.addDeathParticles (entity-status 60, when the death-animation ends): 20 poof-particles
     */
    deathPoof(x, y, z, width, height) {
        const random = this.random;
        for (let i = 0; i < 20; i++) {
            const vx = gaussian(random) * 0.02, vy = gaussian(random) * 0.02, vz = gaussian(random) * 0.02;
            this.add(new PoofParticle(this,
                x + width * (2 * random() - 1), y + height * random(), z + width * (2 * random() - 1), vx, vy, vz));
        }
    }

    /**
     * The particles one source emits in one tick: vanilla LivingEntity.tickStatusEffects (potion-swirls) and
     * AreaEffectCloudEntity.tick (client).
     * @param source {ParticleSource}
     */
    emit(source) {
        const random = this.random;
        const particles = source.particles;
        if (particles.swirls.length > 0) {
            const chance = (particles.invisible ? 15 : 4) * (particles.ambient ? 5 : 1);
            if (Math.floor(random() * chance) === 0) {
                const color = particles.swirls[Math.floor(random() * particles.swirls.length)];
                this.add(entityEffect(this,
                    source.x + source.width * (2 * random() - 1) * 0.5,
                    source.y + source.height * random(),
                    source.z + source.width * (2 * random() - 1) * 0.5,
                    1, 1, 1, color));
            }
        }
        const cloud = particles.cloud;
        if (cloud) {
            if (cloud.waiting && random() < 0.5) return;
            const count = cloud.waiting ? 2 : Math.ceil(Math.PI * cloud.radius * cloud.radius);
            const radius = cloud.waiting ? 0.2 : cloud.radius;
            for (let i = 0; i < count; i++) {
                const angle = random() * Math.PI * 2;
                const distance = Math.sqrt(random()) * radius;
                const color = cloud.waiting && random() < 0.5 ? 0xFFFFFFFF : cloud.color;
                this.add(entityEffect(this, source.x + Math.cos(angle) * distance, source.y,
                    source.z + Math.sin(angle) * distance, 0, 0, 0, color));
            }
        }
    }

    /**
     * Advances the simulation.
     * @param dt {number} - seconds
     * @param sources {function(): ParticleSource[]} - called once per tick
     * @returns {number} the simulated ticks
     */
    step(dt, sources = () => []) {
        this.accumulator += Math.max(0, dt);
        let ticks = 0;
        while (this.accumulator >= TICK_SECONDS) {
            this.accumulator -= TICK_SECONDS;
            if (ticks >= MAX_TICKS_PER_STEP) continue;
            this.tick(sources());
            ticks++;
        }
        return ticks;
    }

    /** one client-tick: the entities emit, then the particles tick, then the new particles are added */
    tick(sources = []) {
        this.ticks++;
        for (const source of sources) this.emit(source);
        const alive = [];
        for (const particle of this.particles) {
            particle.tick();
            if (!particle.dead) alive.push(particle);
        }
        for (const particle of this.pending) alive.push(particle);
        this.pending = [];
        this.particles = alive;
    }

    clear() {
        this.particles = [];
        this.pending = [];
    }

}

/**
 * vanilla EntityRenderDispatcher.renderFire: the burning layers of an entity, in the frame turned towards the camera
 * (yaw only), from the feet of the entity: x to the right, y up, z towards the camera.
 * @param width {number}
 * @param height {number}
 * @returns {Array<{x0: number, x1: number, y0: number, y1: number, z: number, texture: number, flip: boolean}>}
 *  - texture 0: fire_0, 1: fire_1; flip: u is mirrored
 */
export function fireLayers(width, height) {
    const scale = width * 1.4;
    let h = height / scale;
    let r = 0.5, yy = 0, zz = 0;
    const offset = 0.3 - Math.trunc(h) * 0.02;
    const layers = [];
    for (let i = 0; h > 0 && i < 64; i++) {
        layers.push({
            x0: -r * scale, x1: r * scale,
            y0: -yy * scale, y1: (1.4 - yy) * scale,
            z: (zz + offset) * scale,
            texture: i % 2,
            flip: Math.trunc(i / 2) % 2 === 0,
        });
        h -= 0.45;
        yy -= 0.45;
        r *= 0.9;
        zz -= 0.03;
    }
    return layers;
}
