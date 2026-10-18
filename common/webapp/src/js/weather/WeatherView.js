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

import {
    AdditiveBlending, BufferAttribute, BufferGeometry, DoubleSide, Group, Mesh, MeshBasicMaterial, NearestFilter,
    PlaneGeometry, Points, PointsMaterial, RepeatWrapping, Scene, ShaderChunk, ShaderMaterial, Vector3
} from "three";
import {TextureAssetCache} from "../markers/mob/TextureAssetCache.js";
import {
    CLOUD_HEIGHT, CLOUD_SCALE, cloudBrightness, cloudOffset, cloudOpacity, FALL_SPEED, generateStars, lightningFlash,
    MOON_SIZE, moonUv, nextLightningDelay, precipitationAt, precipitationBox, cameraPrecipitationBox, SKY_DISTANCE, starBrightness, SUN_SIZE,
    WEATHER_TEXTURES
} from "./WeatherData.js";
import {skyAngle} from "../markers/WorldTime.js";

/** the drops of the rain and snow around the point the camera looks at and around the camera (at most, fewer while it starts or stops raining) */
const DROP_COUNT = 4000;
const CAMERA_DROP_COUNT = 1200;
/** the clouds are drawn this far around the camera (blocks, at least) */
const CLOUD_RADIUS = 1536;

// language=GLSL (with the logarithmic depth of BlueMaps renderer)
const DROP_VERTEX_SHADER = `
#include <common>
${ShaderChunk.logdepthbuf_pars_vertex}
attribute vec4 seed;
attribute vec2 corner;
uniform vec3 center;
uniform vec3 cameraPos;
uniform float radius;
uniform float height;
uniform float time;
uniform float speed;
uniform float size;
uniform float stretch;
uniform float drift;
uniform float amount;
varying vec2 vUv;
varying float vVisible;

void main() {
    vVisible = seed.w < amount ? 1.0 : 0.0;
    float fall = mod(seed.z * height + time * speed, height);
    vec3 base = center + vec3(seed.x * radius, height * 0.5 - fall, seed.y * radius);
    base.x += sin(time * 0.7 + seed.z * 40.0) * drift;
    vec3 toCamera = vec3(cameraPos.x - base.x, 0.0, cameraPos.z - base.z);
    vec3 right = length(toCamera) > 0.001 ? normalize(vec3(toCamera.z, 0.0, -toCamera.x)) : vec3(1.0, 0.0, 0.0);
    vec3 position = base + right * corner.x * size * 0.5 + vec3(0.0, corner.y * size * stretch * 0.5, 0.0);
    // one of the 4 columns of the texture, a random part of it
    float column = floor(fract(seed.z * 7.0) * 4.0);
    vUv = vec2((column + corner.x * 0.5 + 0.5) / 4.0, fract(seed.x * 3.0) * 0.75 + (corner.y * 0.5 + 0.5) * 0.25);
    gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
    ${ShaderChunk.logdepthbuf_vertex}
}
`;

// language=GLSL
const DROP_FRAGMENT_SHADER = `
#include <common>
${ShaderChunk.logdepthbuf_pars_fragment}
uniform sampler2D map;
uniform float opacity;
uniform float brightness;
varying vec2 vUv;
varying float vVisible;

void main() {
    if (vVisible < 0.5) discard;
    vec4 color = texture2D(map, vUv);
    if (color.a < 0.1) discard;
    gl_FragColor = vec4(color.rgb * brightness, color.a * opacity);
    ${ShaderChunk.logdepthbuf_fragment}
}
`;

/**
 * BlueMap Live: draws the sky (sun, moon, stars: a scene drawn after BlueMaps sky with the sky-camera) and the weather
 * (clouds, rain, snow: a group in the marker-scene) in the live world-time mode, and lights the map for lightning.
 */
export class WeatherView {

    /**
     * @param texturesUrl {string | null} - assets/textures/ of the map
     */
    constructor(texturesUrl) {
        this.textures = new TextureAssetCache(texturesUrl);
        this.entries = {};
        for (const [name, key] of Object.entries(WEATHER_TEXTURES)) this.entries[name] = this.textures.acquire(key);

        // --- sky ---
        this.skyScene = new Scene();
        this.celestial = new Group();
        this.celestial.rotation.order = "YXZ";
        this.skyScene.add(this.celestial);

        this.sun = new Mesh(new PlaneGeometry(SUN_SIZE * 2, SUN_SIZE * 2), new MeshBasicMaterial({transparent: true,
            blending: AdditiveBlending, depthWrite: false, depthTest: false, side: DoubleSide}));
        this.sun.rotation.x = Math.PI / 2;
        this.sun.position.y = SKY_DISTANCE;
        this.sun.renderOrder = 2;
        this.celestial.add(this.sun);

        this.moon = new Mesh(new PlaneGeometry(MOON_SIZE * 2, MOON_SIZE * 2), new MeshBasicMaterial({transparent: true,
            blending: AdditiveBlending, depthWrite: false, depthTest: false, side: DoubleSide}));
        this.moon.rotation.x = -Math.PI / 2;
        this.moon.position.y = -SKY_DISTANCE;
        this.moon.renderOrder = 2;
        this.moonPhase = -1;
        this.celestial.add(this.moon);

        const stars = generateStars();
        const starPositions = new Float32Array(stars.length * 3);
        stars.forEach((star, i) => starPositions.set([star.x, star.y, star.z], i * 3));
        const starGeometry = new BufferGeometry();
        starGeometry.setAttribute("position", new BufferAttribute(starPositions, 3));
        this.stars = new Points(starGeometry, new PointsMaterial({color: 0xffffff, size: 1.5, sizeAttenuation: false,
            transparent: true, depthWrite: false, depthTest: false, blending: AdditiveBlending}));
        this.stars.renderOrder = 1;
        this.celestial.add(this.stars);

        // --- weather in the world ---
        this.group = new Group();
        this.group.userData.noCss2d = true; // see CSS2DRenderer
        this.group.name = "bm-live-weather";

        // alphaTest compares the alpha after the opacity (0.3 from above): low, the texels of clouds.png are 0 or 1
        this.clouds = new Mesh(new PlaneGeometry(1, 1), new MeshBasicMaterial({transparent: true, depthWrite: false,
            side: DoubleSide, alphaTest: 0.05}));
        this.clouds.rotation.x = -Math.PI / 2;
        this.clouds.visible = false;
        this.cloudTexture = null;
        this.group.add(this.clouds);

        const dropMaterial = () => new ShaderMaterial({
            uniforms: {
                map: {value: null}, center: {value: new Vector3()}, cameraPos: {value: new Vector3()},
                radius: {value: 10}, height: {value: 20}, time: {value: 0}, speed: {value: 10}, size: {value: 1},
                stretch: {value: 4}, drift: {value: 0}, amount: {value: 0}, opacity: {value: 1}, brightness: {value: 1},
            },
            vertexShader: DROP_VERTEX_SHADER,
            fragmentShader: DROP_FRAGMENT_SHADER,
            transparent: true, depthWrite: false, side: DoubleSide,
        });
        // around the point the camera looks at (seen from far away) and around the camera (fills the view)
        this.drops = new Mesh(createDropGeometry(DROP_COUNT), dropMaterial());
        this.cameraDrops = new Mesh(createDropGeometry(CAMERA_DROP_COUNT), dropMaterial());
        for (const drops of [this.drops, this.cameraDrops]) {
            drops.frustumCulled = false;
            drops.visible = false;
            this.group.add(drops);
        }

        this.time = 0;
        this.nextFlash = nextLightningDelay();
        this.flashAge = Infinity;
        /** the brightness-boost of the current lightning-flash (0..1) */
        this.flash = 0;
        this.precipitation = "none";
        this.active = false;
    }

    /**
     * @param dt {number} - seconds
     * @param params {{
     *     world: {dayTime: number, rain: number, thunder: number, moonPhase: number} | null, - null: not shown
     *     ticks: number, - world-ticks for the clouds
     *     camera: import("three").Camera,
     *     target: {x: number, y: number, z: number}, - the point the camera looks at
     *     distance: number,
     *     players: Array<{x: number, z: number, precipitation: string | null}>
     * }}
     * @returns {boolean} if something moves (redraw)
     */
    update(dt, params) {
        const world = params.world;
        this.active = !!world;
        this.skyScene.visible = this.active;
        this.group.visible = this.active;
        if (!world) {
            this.flash = 0;
            return false;
        }
        this.time += dt;
        Object.values(this.entries).forEach(entry => this.textures.retry(entry));

        // sun, moon and stars (vanilla renderSky)
        this.celestial.rotation.set(skyAngle(world.dayTime) * Math.PI * 2, -Math.PI / 2, 0);
        const celestialAlpha = 1 - world.rain;
        this.setMap(this.sun, this.entries.sun);
        this.sun.material.opacity = celestialAlpha;
        this.sun.visible = !!this.sun.material.map && celestialAlpha > 0;
        this.setMap(this.moon, this.entries.moon);
        if (this.moon.material.map && world.moonPhase !== this.moonPhase) {
            this.moonPhase = world.moonPhase;
            setPlaneUv(this.moon.geometry, moonUv(world.moonPhase));
        }
        this.moon.material.opacity = celestialAlpha;
        this.moon.visible = !!this.moon.material.map && celestialAlpha > 0;
        const stars = starBrightness(world.dayTime, world.rain);
        this.stars.material.opacity = Math.min(1, stars * 2);
        this.stars.visible = stars > 0.001;

        // clouds: a flat layer like the "fast" clouds of vanilla, moving west
        const cloudEntry = this.entries.clouds;
        if (cloudEntry.state === "loaded" && !this.cloudTexture) {
            this.cloudTexture = cloudEntry.texture.clone();
            this.cloudTexture.wrapS = this.cloudTexture.wrapT = RepeatWrapping;
            this.cloudTexture.magFilter = this.cloudTexture.minFilter = NearestFilter;
            this.cloudTexture.needsUpdate = true;
            this.clouds.material.map = this.cloudTexture;
            this.clouds.material.needsUpdate = true;
        }
        if (this.cloudTexture) {
            const tile = 256 * CLOUD_SCALE;
            const radius = Math.max(CLOUD_RADIUS, params.distance * 2);
            const cx = Math.round(params.camera.position.x / CLOUD_SCALE) * CLOUD_SCALE;
            const cz = Math.round(params.camera.position.z / CLOUD_SCALE) * CLOUD_SCALE;
            this.clouds.position.set(cx, CLOUD_HEIGHT + 0.33, cz);
            this.clouds.scale.set(radius * 2, radius * 2, 1);
            this.cloudTexture.repeat.set(radius * 2 / tile, radius * 2 / tile);
            // u at the west-edge of the plane; the plane is turned (rotation.x = -90 degrees), v grows towards north
            this.cloudTexture.offset.set((cx - radius + cloudOffset(params.ticks)) / tile, -(cz + radius) / tile);
            const brightness = cloudBrightness(world.dayTime, world.rain, world.thunder);
            this.clouds.material.color.setRGB(brightness, brightness, brightness);
            this.clouds.material.opacity = cloudOpacity(params.camera.position.y);
            this.clouds.visible = true;
        }

        // rain and snow around the point the camera looks at
        this.precipitation = world.rain > 0 ? precipitationAt(params.players, params.target) : "none";
        let moving = false;
        const dropEntry = this.precipitation === "none" ? null : this.entries[this.precipitation];
        const loaded = dropEntry && dropEntry.state === "loaded";
        const box = precipitationBox(params.distance);
        const cameraBox = cameraPrecipitationBox(params.camera.position.y);
        const cam = params.camera.position;
        this.updateDrops(this.drops, loaded ? box : null, params.target.x, params.target.y + box.height * 0.25, params.target.z, dropEntry, world, cam);
        this.updateDrops(this.cameraDrops, loaded ? cameraBox : null, cam.x, cam.y, cam.z, dropEntry, world, cam);
        if (this.drops.visible || this.cameraDrops.visible) moving = true;

        // lightning-flashes in a thunderstorm (vanilla isThundering: thunder-gradient > 0.9)
        this.flash = 0;
        if (world.thunder > 0.9) {
            this.nextFlash -= dt;
            if (this.nextFlash <= 0) {
                this.flashAge = 0;
                this.nextFlash = nextLightningDelay();
            }
        }
        if (this.flashAge !== Infinity) {
            this.flashAge += dt;
            this.flash = lightningFlash(this.flashAge);
            if (this.flash > 0) moving = true;
            else if (this.flashAge > 1) this.flashAge = Infinity;
        }
        return moving;
    }

    /** @private one layer of drops in a box (null: hidden) */
    updateDrops(drops, box, x, y, z, entry, world, camera) {
        drops.visible = !!box;
        if (!box) return;
        const snow = this.precipitation === "snow";
        const uniforms = drops.material.uniforms;
        uniforms.map.value = entry.texture;
        uniforms.center.value.set(x, y, z);
        uniforms.cameraPos.value.copy(camera);
        uniforms.radius.value = box.radius;
        uniforms.height.value = box.height;
        uniforms.time.value = this.time;
        uniforms.speed.value = FALL_SPEED[this.precipitation] * Math.max(1, box.radius / 20);
        uniforms.size.value = box.dropSize * (snow ? 0.6 : 0.25);
        uniforms.stretch.value = snow ? 1 : 6;
        uniforms.drift.value = snow ? box.dropSize * 0.5 : 0;
        uniforms.amount.value = world.rain;
        // the drops around the camera are close and large: lighter
        uniforms.opacity.value = (snow ? 0.9 : 0.6) * (drops === this.cameraDrops ? 0.6 : 1);
        uniforms.brightness.value = cloudBrightness(world.dayTime, 0, world.thunder) * 0.8 + 0.2;
    }

    /** @private */
    setMap(mesh, entry) {
        const map = entry.state === "loaded" ? entry.texture : null;
        if (mesh.material.map !== map) {
            mesh.material.map = map;
            mesh.material.needsUpdate = true;
        }
    }

    dispose() {
        Object.values(this.entries).forEach(entry => this.textures.release(entry));
        this.textures.dispose();
        if (this.cloudTexture) this.cloudTexture.dispose();
        [this.sun, this.moon, this.stars, this.clouds, this.drops, this.cameraDrops].forEach(object => {
            object.geometry.dispose();
            object.material.dispose();
        });
        if (this.group.parent) this.group.parent.remove(this.group);
    }

}

/** quads of the drops: 4 corners each, the same random seed */
function createDropGeometry(count) {
    const seeds = new Float32Array(count * 4 * 4), corners = new Float32Array(count * 4 * 2), index = new Uint32Array(count * 6);
    const cornerValues = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    for (let i = 0; i < count; i++) {
        const seed = [Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random(), i / count];
        for (let c = 0; c < 4; c++) {
            seeds.set(seed, (i * 4 + c) * 4);
            corners.set(cornerValues[c], (i * 4 + c) * 2);
        }
        index.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3], i * 6);
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(new Float32Array(count * 4 * 3), 3));
    geometry.setAttribute("seed", new BufferAttribute(seeds, 4));
    geometry.setAttribute("corner", new BufferAttribute(corners, 2));
    geometry.setIndex(new BufferAttribute(index, 1));
    return geometry;
}

/** sets the uv of a PlaneGeometry to a part of the texture (v from the top, the textures are flipped) */
function setPlaneUv(geometry, {u0, v0, u1, v1}) {
    const uv = geometry.getAttribute("uv");
    // PlaneGeometry: top-left, top-right, bottom-left, bottom-right
    uv.setXY(0, u0, 1 - v0);
    uv.setXY(1, u1, 1 - v0);
    uv.setXY(2, u0, 1 - v1);
    uv.setXY(3, u1, 1 - v1);
    uv.needsUpdate = true;
}
