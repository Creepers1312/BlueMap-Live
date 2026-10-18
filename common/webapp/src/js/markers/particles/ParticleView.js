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
import {BufferAttribute, BufferGeometry, CanvasTexture, DoubleSide, Group, Mesh, MeshBasicMaterial, NearestFilter,
    Vector3} from "three";
import {applyEntityShader} from "../EntityLighting.js";
import {FIRE_FRAMES, FIRE_TEXTURES, fireLayers, PARTICLE_SPRITES, SHEET_LIT} from "./LiveParticles.js";

/*
 * Draws the particles of a ParticleSystem and the fire of burning entities (BlueMap Live): all quads of a frame in
 * two meshes (lit: full-bright like vanilla PARTICLE_SHEET_LIT and the fire, shaded: darkened by the entity-light),
 * the sprites in one atlas that is built from the resource-pack textures (assets/textures/, see the java
 * ParticleState.TEXTURES).
 */

const ATLAS_COLUMNS = 16;
const MAX_CELL = 64;

/** all textures of the atlas */
export const ATLAS_TEXTURES = [...new Set([...Object.values(PARTICLE_SPRITES).flat(), ...FIRE_TEXTURES])];

/**
 * The layout of the atlas: every sprite (and every frame of an animated texture: a vertical strip of square frames)
 * gets one square cell.
 * @param sizes {Map<string, {width: number, height: number}>} - the loaded textures
 * @returns {{cell: number, columns: number, rows: number, cells: Map<string, number[]>}} - cells: per texture the
 *   cell-indices of its frames
 */
export function atlasLayout(sizes) {
    let cell = 1;
    sizes.forEach(size => cell = Math.max(cell, size.width));
    cell = Math.min(cell, MAX_CELL);
    const cells = new Map();
    let next = 0;
    sizes.forEach((size, key) => {
        const frames = Math.max(1, Math.floor(size.height / Math.max(1, size.width)));
        const indices = [];
        for (let i = 0; i < frames; i++) indices.push(next++);
        cells.set(key, indices);
    });
    return {cell, columns: ATLAS_COLUMNS, rows: Math.max(1, Math.ceil(next / ATLAS_COLUMNS)), cells};
}

/**
 * The frame of an animated fire-texture at a tick (vanilla: one frame per tick, in the order of the .mcmeta)
 * @returns {number} the index into the frames of the texture
 */
export function fireFrame(texture, ticks, frameCount) {
    const order = FIRE_FRAMES[texture];
    const length = order ? order.length : frameCount;
    const frame = order ? order[Math.floor(ticks) % length] : Math.floor(ticks) % length;
    return Math.min(Math.max(frame, 0), frameCount - 1);
}

class QuadBuffer {
    constructor(material) {
        this.geometry = new BufferGeometry();
        this.capacity = 0;
        this.count = 0;
        this.mesh = new Mesh(this.geometry, material);
        this.mesh.frustumCulled = false;
        this.mesh.raycast = () => {}; // not clickable (the geometry changes every frame)
        this.mesh.renderOrder = 10;
        this.ensure(64);
    }

    ensure(quads) {
        if (quads <= this.capacity) return;
        let capacity = Math.max(64, this.capacity);
        while (capacity < quads) capacity *= 2;
        this.capacity = capacity;
        this.positions = new Float32Array(capacity * 12);
        this.uvs = new Float32Array(capacity * 8);
        this.colors = new Float32Array(capacity * 16);
        const index = new Uint32Array(capacity * 6);
        for (let i = 0; i < capacity; i++) index.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3], i * 6);
        this.geometry.dispose();
        this.geometry.setAttribute("position", new BufferAttribute(this.positions, 3));
        this.geometry.setAttribute("uv", new BufferAttribute(this.uvs, 2));
        this.geometry.setAttribute("color", new BufferAttribute(this.colors, 4));
        this.geometry.setIndex(new BufferAttribute(index, 1));
    }

    begin() {
        this.count = 0;
    }

    /** a quad: 4 corners (x, y, z) with their uv and one rgba-color */
    quad(corners, uvs, r, g, b, a) {
        if (this.count >= this.capacity) {
            const positions = this.positions, uvArray = this.uvs, colors = this.colors, count = this.count;
            this.ensure(this.count + 1);
            this.positions.set(positions.subarray(0, count * 12));
            this.uvs.set(uvArray.subarray(0, count * 8));
            this.colors.set(colors.subarray(0, count * 16));
        }
        const i = this.count++;
        this.positions.set(corners, i * 12);
        this.uvs.set(uvs, i * 8);
        const colors = this.colors;
        for (let v = i * 16, end = v + 16; v < end; v += 4) {
            colors[v] = r; colors[v + 1] = g; colors[v + 2] = b; colors[v + 3] = a;
        }
    }

    end() {
        for (const name of ["position", "uv", "color"]) this.geometry.getAttribute(name).needsUpdate = true;
        this.geometry.setDrawRange(0, this.count * 6);
        this.mesh.visible = this.count > 0;
    }

    dispose() {
        this.geometry.dispose();
    }
}

const right = new Vector3(), up = new Vector3(), toCamera = new Vector3();
const corners = new Float32Array(12), uvs = new Float32Array(8);

export class ParticleView {

    /**
     * @param textureCache {import("../mob/TextureAssetCache.js").TextureAssetCache | null}
     */
    constructor(textureCache) {
        this.textureCache = textureCache;
        this.group = new Group();
        this.group.userData.noCss2d = true; // see CSS2DRenderer
        this.group.name = "bm-live-particles";
        this.texture = null;
        this.layout = null;
        this.entries = null;
        this.litMaterial = null;
        this.shadedMaterial = null;
        this.lit = null;
        this.shaded = null;
    }

    /** the textures are only loaded when the first particle is drawn */
    load() {
        if (this.entries || !this.textureCache) return;
        this.onTextureChanged = () => this.dirty = true;
        this.entries = ATLAS_TEXTURES.map(key => {
            const entry = this.textureCache.acquire(key);
            entry.listeners.add(this.onTextureChanged);
            return entry;
        });
        this.dirty = true;
    }

    /**
     * (re-)builds the atlas when textures were loaded: the textures are created by the server when they are
     * requested the first time, so the first attempts can fail (retried like the armor-textures)
     */
    updateAtlas() {
        if (!this.entries) return;
        for (const entry of this.entries) if (entry.state === "failed") this.textureCache.retry(entry);
        if (!this.dirty || this.entries.some(entry => entry.state === "loading")) return;
        this.dirty = false;
        const sizes = new Map();
        for (const entry of this.entries) {
            const image = entry.state === "loaded" && entry.texture ? entry.texture.image : null;
            if (image && image.width > 0) sizes.set(entry.key, {width: image.width, height: image.height});
        }
        if (sizes.size === 0 || typeof document === "undefined") return;
        if (this.layout && sizes.size === this.layout.cells.size) return;
        const layout = atlasLayout(sizes);
        const canvas = document.createElement("canvas");
        canvas.width = layout.cell * layout.columns;
        canvas.height = layout.cell * layout.rows;
        const context = canvas.getContext("2d");
        context.imageSmoothingEnabled = false;
        for (const entry of this.entries) {
            const cells = layout.cells.get(entry.key);
            if (!cells) continue;
            const image = entry.texture.image, size = image.width;
            cells.forEach((cell, frame) => {
                context.drawImage(image, 0, frame * size, size, size,
                    (cell % layout.columns) * layout.cell, Math.floor(cell / layout.columns) * layout.cell, layout.cell, layout.cell);
            });
        }
        const texture = new CanvasTexture(canvas);
        texture.magFilter = texture.minFilter = NearestFilter;
        texture.generateMipmaps = false;
        texture.flipY = false;
        this.layout = layout;
        if (this.texture) {
            // more textures were loaded: the materials get the new atlas
            this.texture.dispose();
            this.texture = texture;
            this.litMaterial.map = this.shadedMaterial.map = texture;
            return;
        }
        this.texture = texture;
        // vanilla particle-shader: alpha < 0.1 is discarded; translucent particles are blended
        const options = {map: texture, vertexColors: true, transparent: true, alphaTest: 0.1, depthWrite: true, side: DoubleSide};
        this.litMaterial = new MeshBasicMaterial(options);
        this.shadedMaterial = applyEntityShader(new MeshBasicMaterial(options), "", "particles");
        this.lit = new QuadBuffer(this.litMaterial);
        this.shaded = new QuadBuffer(this.shadedMaterial);
        this.group.add(this.lit.mesh, this.shaded.mesh);
    }

    /** @private the uv-rect of a cell: [u0, v0, u1, v1] (v0 is the top of the cell, the atlas is not flipped) */
    cellUv(cell) {
        const layout = this.layout;
        const u0 = (cell % layout.columns) / layout.columns, v0 = Math.floor(cell / layout.columns) / layout.rows;
        return [u0, v0, u0 + 1 / layout.columns, v0 + 1 / layout.rows];
    }

    /**
     * Draws a frame.
     * @param system {import("./LiveParticles.js").ParticleSystem}
     * @param burning {Array<{x: number, y: number, z: number, width: number, height: number}>} - the drawn burning entities
     * @param camera {import("three").Camera}
     */
    update(system, burning, camera) {
        if (system.count > 0 || burning.length > 0) this.load();
        this.updateAtlas();
        if (!this.layout) return;
        this.lit.begin();
        this.shaded.begin();
        camera.updateMatrixWorld();
        right.setFromMatrixColumn(camera.matrixWorld, 0);
        up.setFromMatrixColumn(camera.matrixWorld, 1);
        const delta = system.tickDelta;

        for (const particle of system.particles) {
            if (!particle.rendered) continue;
            const cells = this.layout.cells.get(particle.texture);
            if (!cells) continue;
            const [u0, v0, u1, v1] = this.cellUv(cells[0]);
            const x = particle.prevX + (particle.x - particle.prevX) * delta;
            const y = particle.prevY + (particle.y - particle.prevY) * delta;
            const z = particle.prevZ + (particle.z - particle.prevZ) * delta;
            const s = particle.scale;
            // vanilla BillboardParticle: corners (-1,-1) (-1,1) (1,1) (1,-1) turned like the camera, u mirrored to x
            const signs = [-1, -1, -1, 1, 1, 1, 1, -1];
            for (let c = 0; c < 4; c++) {
                const sx = signs[c * 2] * s, sy = signs[c * 2 + 1] * s;
                corners[c * 3] = x + right.x * sx + up.x * sy;
                corners[c * 3 + 1] = y + right.y * sx + up.y * sy;
                corners[c * 3 + 2] = z + right.z * sx + up.z * sy;
            }
            uvs.set([u1, v1, u1, v0, u0, v0, u0, v1]);
            (particle.sheet === SHEET_LIT ? this.lit : this.shaded)
                .quad(corners, uvs, particle.red, particle.green, particle.blue, particle.alpha);
        }

        // the fire turned towards the camera around the y-axis only
        if (burning.length > 0) {
            camera.getWorldPosition(toCamera);
            for (const entity of burning) {
                const dx = toCamera.x - entity.x, dz = toCamera.z - entity.z;
                const length = Math.hypot(dx, dz) || 1;
                const fx = dx / length, fz = dz / length; // towards the camera
                const rx = fz, rz = -fx; // to the right (seen from the camera)
                for (const layer of fireLayers(entity.width, entity.height)) {
                    const key = FIRE_TEXTURES[layer.texture];
                    const cells = this.layout.cells.get(key);
                    if (!cells) continue;
                    const [u0, v0, u1, v1] = this.cellUv(cells[fireFrame(key, system.ticks, cells.length)]);
                    const left = layer.flip ? u0 : u1, rightU = layer.flip ? u1 : u0;
                    const points = [[layer.x0, layer.y0], [layer.x1, layer.y0], [layer.x1, layer.y1], [layer.x0, layer.y1]];
                    points.forEach(([px, py], c) => {
                        corners[c * 3] = entity.x + rx * px + fx * layer.z;
                        corners[c * 3 + 1] = entity.y + py;
                        corners[c * 3 + 2] = entity.z + rz * px + fz * layer.z;
                    });
                    uvs.set([left, v1, rightU, v1, rightU, v0, left, v0]);
                    this.lit.quad(corners, uvs, 1, 1, 1, 1);
                }
            }
        }

        this.lit.end();
        this.shaded.end();
    }

    dispose() {
        if (this.entries) {
            for (const entry of this.entries) {
                entry.listeners.delete(this.onTextureChanged);
                this.textureCache.release(entry);
            }
        }
        this.entries = null;
        if (this.lit) this.lit.dispose();
        if (this.shaded) this.shaded.dispose();
        if (this.litMaterial) this.litMaterial.dispose();
        if (this.shadedMaterial) this.shadedMaterial.dispose();
        if (this.texture) this.texture.dispose();
        if (this.group.parent) this.group.parent.remove(this.group);
    }

}
