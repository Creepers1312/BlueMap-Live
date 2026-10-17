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
import {MarkerManager} from "./MarkerManager";
import {MarkerSet} from "./MarkerSet";
import {EntityMarker} from "./EntityMarker";
import {entityKind, parseEntitiesResponse} from "./LiveEntityData";
import {DEFAULT_UPDATE_INTERVAL, isStaleResponse} from "./LivePlayerData";
import {ItemAssetCache} from "./player/ItemAssetCache";
import {MobAssetCache} from "./mob/MobAssetCache";
import {Frustum, Matrix4} from "three";
import {LIVE_CLOCK, LIVE_PLAYBACK} from "./LivePlayback.js";
import {ParticleSystem} from "./particles/LiveParticles.js";
import {ParticleView} from "./particles/ParticleView.js";
import {ChestLidView} from "./ChestLidView.js";
import {PreviewStore} from "./blocks/BlockPreviewData.js";
import {BlockAssetCache, BlockPreviewView} from "./blocks/BlockPreviewView.js";

/** effects that would be shown later than this (ms) after their playback-time are skipped (e.g. after a reload) */
const MAX_EFFECT_LATENESS = 1500;
/** vanilla PlayerEntity dimensions (standing, sneaking) */
const PLAYER_WIDTH = 0.6, PLAYER_HEIGHT = 1.8, PLAYER_SNEAKING_HEIGHT = 1.5;

export const ENTITY_MARKER_SET_ID = "bm-entities";

/**
 * dispatched after the entities of a frame are stepped (detail: {markers: Map<string, Marker>}), so riding players
 * are drawn on the drawn vehicle of the same frame (see PlayerMarker.attachTo)
 */
export const ENTITIES_STEPPED_EVENT = "bluemapLiveEntitiesStepped";

const MAX_ANIMATION_STEP = 0.25;

/**
 * Shows the entities around the players from live/entities.json (BlueMap Live): dropped items, thrown items,
 * arrows and other projectiles and mobs, in an own (toggleable) marker-set "Entities".
 * Animated in the existing render-loop of the map-viewer (bluemapRenderFrame), like the player-models.
 */
const frustum = new Frustum();
const projectionView = new Matrix4();

/**
 * @param camera {import("three").Camera}
 * @returns {Frustum} the view of the camera (shared object, valid until the next call)
 */
export function viewFrustum(camera) {
    camera.updateMatrixWorld();
    projectionView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    return frustum.setFromProjectionMatrix(projectionView);
}

export class EntityMarkerManager extends MarkerManager {

    /**
     * @param root {MarkerSet} - The scene to which the entity-set is added
     * @param fileUrl {string} - live/entities.json of the map
     * @param events {EventTarget | null}
     * @param itemsUrl {string | null} - The url from which the item-models should be loaded
     * @param camera {import("three").Camera | null} - for billboards and the view-distance
     * @param redraw {function() | null} - requests high-fps rendering, called while an entity moves
     * @param entitiesUrl {string | null} - The url from which own entity-models (arrow) should be loaded
     */
    constructor(root, fileUrl, events = null, itemsUrl = null, camera = null, redraw = null, entitiesUrl = null) {
        super(root, fileUrl, events);
        this.itemCache = new ItemAssetCache(itemsUrl);
        this.entityCache = new ItemAssetCache(entitiesUrl);
        this.mobCache = new MobAssetCache(entitiesUrl);
        this.camera = camera;
        this.redraw = redraw;
        this.updateInterval = DEFAULT_UPDATE_INTERVAL;
        this.lastServerTime = null;

        // BlueMap Live: particles and effects (see docs/bluemap-live/phase-10.md)
        this.particleSystem = new ParticleSystem();
        this.particleView = new ParticleView(this.itemCache.textures);
        /** the ids of the effects that were seen (each effect is shown once) */
        this.seenEffects = new Set();
        /** @type {Array<{due: number, effect: import("./particles/ParticleData.js").LiveEffect}>} */
        this.scheduledEffects = [];

        // BlueMap Live: the lids of opened chests (see docs/bluemap-live/phase-11.md)
        this.chestLids = new ChestLidView(this.itemCache.textures);
        /** @type {Array<{due: number, containers: object[]}>} */
        this.scheduledContainers = [];
        /** the uniforms of the map-shader (hidden boxes), set by the app */
        this.mapUniforms = null;

        // BlueMap Live: previews of block-changes until the tile is rendered again (see docs/bluemap-live/phase-11.md),
        // created by the app with the tile-settings of the map (initBlockPreviews)
        this.blockPreviews = null;
        this.blockView = null;
        this.blockAssets = null;
        /** @type {Array<{due: number, blocks: object[]}>} */
        this.scheduledBlocks = [];

        this.onRenderFrame = evt => this.animateEntities(evt.detail.delta / 1000);
        if (this.events) this.events.addEventListener("bluemapRenderFrame", this.onRenderFrame);
    }

    /**
     * @param create {boolean}
     * @returns {MarkerSet | undefined}
     */
    getEntityMarkerSet(create = true) {
        let set = this.root.markerSets.get(ENTITY_MARKER_SET_ID);
        if (!set && create) {
            set = new MarkerSet(ENTITY_MARKER_SET_ID);
            set.data.label = "Entities";
            set.data.toggleable = true;
            set.data.defaultHide = false;
            set.data.sorting = 1;
            this.root.add(set);
        }
        return set;
    }

    /**
     * @protected
     * @override
     */
    updateFromData(data) {
        const response = parseEntitiesResponse(data);
        if (!response) {
            this.clear();
            return false;
        }
        if (isStaleResponse(this.lastServerTime, response.serverTime)) return true;
        if (response.serverTime !== null) this.lastServerTime = response.serverTime;
        this.updateInterval = response.updateInterval;

        const set = this.getEntityMarkerSet(true);
        const updated = new Set();
        for (const entity of response.entities) {
            if (!entityKind(entity)) continue;
            const markerId = "bm-entity-" + entity.id;
            let marker = set.markers.get(markerId);
            if (marker && (!marker.isEntityMarker || marker.entityType !== entity.type)) {
                set.remove(marker);
                marker = null;
            }
            if (!marker) {
                marker = new EntityMarker(markerId, this.itemCache, this.entityCache, this.mobCache);
                set.add(marker);
            }
            marker.updateFromData(entity, this.updateInterval);
            updated.add(marker);
        }
        set.markers.forEach(marker => {
            if (updated.has(marker)) return;
            // removed when the playback reaches the removal (with the death-poof of a dying mob)
            if (!marker.isEntityMarker || marker.scheduleRemoval(this.updateInterval)) this.removeMarker(set, marker);
        });
        this.scheduleEffects(response.effects || []);
        this.scheduleContainers(response.containers || [], response.serverTime);
        if (this.blockPreviews && response.blocks && response.blocks.length > 0) this.scheduleBlocks(response.blocks);
        // the particle-textures are loaded as soon as something emits particles (before the playback shows it)
        if ((response.effects && response.effects.length > 0) || response.entities.some(entity => entity.particles)) {
            this.particleView.load();
        }
        return true;
    }

    /** @private */
    removeMarker(set, marker) {
        if (marker.isEntityMarker && marker.dying && set.visible && marker.visible !== false) {
            const mob = marker.lastData && marker.lastData.mob;
            if (mob) this.particleSystem.deathPoof(marker.position.x, marker.position.y, marker.position.z, mob.width, mob.height);
        }
        set.remove(marker);
    }

    /**
     * The new effects of a response are shown at their playback-time (like the entities), at once without a delay.
     * @private
     */
    scheduleEffects(effects) {
        const now = Date.now();
        const ids = new Set();
        for (const effect of effects) {
            ids.add(effect.id);
            if (this.seenEffects.has(effect.id)) continue;
            const playback = LIVE_PLAYBACK.delay > 0 && effect.time !== null ?
                LIVE_CLOCK.playbackTime(effect.time, LIVE_PLAYBACK.delay + this.updateInterval) : null;
            const due = playback !== null ? playback : now;
            // too old: e.g. the effects of the last seconds (kept by the server) when the map is opened
            const age = effect.time !== null && this.lastServerTime !== null ? this.lastServerTime - effect.time : 0;
            if (due < now - MAX_EFFECT_LATENESS || age > this.updateInterval + LIVE_PLAYBACK.delay + MAX_EFFECT_LATENESS) continue;
            this.scheduledEffects.push({due, effect});
        }
        // the ids that are not in the data anymore are not needed (the server keeps an effect for some seconds)
        this.seenEffects = ids;
    }

    /**
     * The opened chests of a response are shown at its playback-time (like the entities), at once without a delay.
     * @private
     */
    scheduleContainers(containers, serverTime) {
        const now = Date.now();
        const playback = LIVE_PLAYBACK.delay > 0 && serverTime !== null ?
            LIVE_CLOCK.playbackTime(serverTime, LIVE_PLAYBACK.delay + this.updateInterval) : null;
        this.scheduledContainers.push({due: playback !== null ? Math.min(playback, now + 5000) : now, containers});
        if (this.scheduledContainers.length > 50) this.scheduledContainers.shift();
    }

    /**
     * Applies the latest due container-state and animates the lids.
     * @private
     * @returns {boolean} if a lid is drawn
     */
    animateChests(set, dt) {
        const now = Date.now();
        let latest = null;
        while (this.scheduledContainers.length > 0 && this.scheduledContainers[0].due <= now) latest = this.scheduledContainers.shift();
        if (!set.visible) {
            this.chestLids.clear();
            this.chestLids.applyHiddenBoxes(this.mapUniforms);
            return false;
        }
        if (latest) this.chestLids.setOpen(latest.containers);
        if (this.chestLids.group.parent !== set) set.add(this.chestLids.group);
        const drawn = this.chestLids.step(dt);
        this.chestLids.applyHiddenBoxes(this.mapUniforms);
        return drawn;
    }

    /**
     * @param hires {{tileSize: {x: number, z: number}, translate: {x: number, z: number}}} - the hires-settings of the map
     * @param blocksUrl {string} - assets/blocks/ of the map
     */
    initBlockPreviews(hires, blocksUrl) {
        this.blockPreviews = new PreviewStore(hires);
        this.blockAssets = new BlockAssetCache(blocksUrl, () => this.blockView && this.blockView.invalidate());
        this.blockView = new BlockPreviewView(this.blockPreviews, this.blockAssets);
    }

    /**
     * A tile was rendered again (see LiveTileUpdater): its confirmed previews are removed.
     * @param tile {{x: number, z: number, chunks: number[]}}
     */
    confirmTile(tile) {
        if (this.blockPreviews) this.blockPreviews.confirm(tile);
    }

    /**
     * The block-changes are shown at their playback-time (like the entities that cause them), at once without a delay.
     * @private
     */
    scheduleBlocks(blocks) {
        const now = Date.now();
        const byDue = new Map();
        for (const block of blocks) {
            const playback = LIVE_PLAYBACK.delay > 0 ? LIVE_CLOCK.playbackTime(block.time, LIVE_PLAYBACK.delay + this.updateInterval) : null;
            const due = playback !== null ? Math.min(playback, now + 5000) : now;
            const key = Math.round(due / 50);
            if (!byDue.has(key)) byDue.set(key, {due, blocks: []});
            byDue.get(key).blocks.push(block);
        }
        byDue.forEach(item => this.scheduledBlocks.push(item));
        this.scheduledBlocks.sort((a, b) => a.due - b.due);
        if (this.scheduledBlocks.length > 200) this.scheduledBlocks.splice(0, this.scheduledBlocks.length - 200);
    }

    /**
     * Applies the due block-changes and draws the previews.
     * @private
     * @returns {boolean} if something changed
     */
    animateBlocks(set) {
        if (!this.blockPreviews) return false;
        const now = Date.now();
        while (this.scheduledBlocks.length > 0 && this.scheduledBlocks[0].due <= now) {
            this.blockPreviews.apply(this.scheduledBlocks.shift().blocks);
        }
        this.blockPreviews.expire();
        // the previews are part of the map (shown with a hidden entity-set as well)
        if (this.blockView.group.parent !== this.root) this.root.add(this.blockView.group);
        const changed = this.blockView.update();
        const animated = this.blockView.animate(Date.now());
        this.blockView.applyHiddenBlocks(this.mapUniforms);
        return changed || animated;
    }

    /** @private shows the effects whose time has come */
    releaseEffects(visible) {
        if (this.scheduledEffects.length === 0) return;
        const now = Date.now();
        this.scheduledEffects = this.scheduledEffects.filter(({due, effect}) => {
            if (due > now) return true;
            if (!visible) return false;
            const p = effect.position;
            if (effect.type === "explosion") this.particleSystem.explosion(p.x, p.y, p.z, effect.power, effect.destroy);
            else this.particleSystem.splash(p.x, p.y, p.z, effect.color, effect.type === "instant_splash");
            return false;
        });
    }

    /**
     * The drawn entities and players that emit particles.
     * @private
     * @returns {import("./particles/LiveParticles.js").ParticleSource[]}
     */
    particleSources(set) {
        const sources = [];
        set.markers.forEach(marker => {
            if (!marker.isEntityMarker || marker.visible === false) return;
            const source = marker.particleSource;
            if (source) sources.push(source);
        });
        const players = this.root.markerSets.get("bm-players");
        if (players && players.visible) {
            players.markers.forEach(marker => {
                const data = marker.lastPlayerData;
                if (!data || !data.particles || marker.visible === false || !marker.anchor) return;
                const position = marker.anchor.position;
                const sneaking = data.state && data.state.sneaking;
                sources.push({x: position.x, y: position.y, z: position.z, width: PLAYER_WIDTH,
                    height: sneaking ? PLAYER_SNEAKING_HEIGHT : PLAYER_HEIGHT, particles: data.particles});
            });
        }
        return sources;
    }

    /**
     * Advances and draws the particles of a frame.
     * @private
     * @returns {boolean} if something is drawn (needs high-fps rendering)
     */
    animateParticles(set, dt) {
        const visible = set.visible;
        this.releaseEffects(visible);
        if (!visible) {
            this.particleSystem.clear();
            this.particleView.group.visible = false;
            return false;
        }
        this.particleView.updateAtlas();
        const sources = this.particleSources(set);
        if (sources.length === 0 && this.particleSystem.count === 0) {
            this.particleView.group.visible = false;
            return false;
        }
        this.particleSystem.step(dt, () => sources);
        if (this.particleView.group.parent !== set) set.add(this.particleView.group);
        this.particleView.group.visible = true;
        if (this.camera) {
            this.particleView.update(this.particleSystem, sources.filter(source => source.particles.fire), this.camera);
        }
        return true;
    }

    /**
     * @param dt {number} - seconds since the last frame
     */
    animateEntities(dt) {
        const set = this.getEntityMarkerSet(false);
        if (!set) return;
        dt = Math.min(Math.max(dt, 0), MAX_ANIMATION_STEP);
        if (this.animateBlocks(set) && this.redraw) this.redraw();
        let moving = false;
        // the view of the camera: entities outside of it are not animated and need no high frame-rate
        const frustum = this.camera ? viewFrustum(this.camera) : null;
        set.markers.forEach(marker => {
            if (marker.isEntityMarker && marker.step(dt, this.camera, frustum) && marker.visible) moving = true;
            if (marker.isEntityMarker && marker.removed) this.removeMarker(set, marker);
        });
        if (this.animateParticles(set, dt)) moving = true;
        if (this.animateChests(set, dt)) moving = true;
        if (moving && set.visible && this.redraw) this.redraw();
        this.updateLeashes(set);
        if (this.events) this.events.dispatchEvent(new CustomEvent(ENTITIES_STEPPED_EVENT, {detail: {markers: set.markers}}));
    }

    /**
     * The leashes of the frame: from the drawn entity to its drawn holder (an entity or a player).
     * @param set {MarkerSet}
     */
    updateLeashes(set) {
        const players = this.root.markerSets.get("bm-players");
        set.markers.forEach(marker => {
            if (!marker.isEntityMarker) return;
            const leash = marker.leash;
            let holder = null;
            if (leash && leash.entity !== null) holder = set.markers.get("bm-entity-" + leash.entity);
            else if (leash && leash.player !== null && players && players.visible) holder = players.markers.get("bm-player-" + leash.player);
            marker.updateLeash(holder && holder.visible !== false && holder.anchor ? holder.anchor : null);
        });
    }

    clear() {
        this.getEntityMarkerSet(false)?.clear();
    }

    dispose() {
        if (this.events) this.events.removeEventListener("bluemapRenderFrame", this.onRenderFrame);
        super.dispose();
        const set = this.getEntityMarkerSet(false);
        if (set) this.root.remove(set);
        this.particleView.dispose();
        this.particleSystem.clear();
        this.chestLids.dispose();
        this.chestLids.applyHiddenBoxes(this.mapUniforms);
        if (this.blockView) {
            this.blockPreviews.clear();
            this.blockView.update();
            this.blockView.applyHiddenBlocks(this.mapUniforms);
            this.blockView.dispose();
            this.blockAssets.dispose();
        }
        this.itemCache.dispose();
        this.entityCache.dispose();
        this.mobCache.dispose();
    }

}
