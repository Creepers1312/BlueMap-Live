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

export const ENTITY_MARKER_SET_ID = "bm-entities";

const MAX_ANIMATION_STEP = 0.25;

/**
 * Shows the entities around the players from live/entities.json (BlueMap Live): dropped items, thrown items and
 * arrow-like projectiles, in an own (toggleable) marker-set "Entities".
 * Animated in the existing render-loop of the map-viewer (bluemapRenderFrame), like the player-models.
 */
export class EntityMarkerManager extends MarkerManager {

    /**
     * @param root {MarkerSet} - The scene to which the entity-set is added
     * @param fileUrl {string} - live/entities.json of the map
     * @param events {EventTarget | null}
     * @param itemsUrl {string | null} - The url from which the item-models should be loaded
     * @param camera {import("three").Camera | null} - for billboards and the view-distance
     * @param redraw {function() | null} - requests high-fps rendering, called while an entity moves
     */
    constructor(root, fileUrl, events = null, itemsUrl = null, camera = null, redraw = null) {
        super(root, fileUrl, events);
        this.itemCache = new ItemAssetCache(itemsUrl);
        this.camera = camera;
        this.redraw = redraw;
        this.updateInterval = DEFAULT_UPDATE_INTERVAL;
        this.lastServerTime = null;

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
                marker = new EntityMarker(markerId, this.itemCache);
                set.add(marker);
            }
            marker.updateFromData(entity, this.updateInterval);
            updated.add(marker);
        }
        set.markers.forEach(marker => {
            if (!updated.has(marker)) set.remove(marker);
        });
        return true;
    }

    /**
     * @param dt {number} - seconds since the last frame
     */
    animateEntities(dt) {
        const set = this.getEntityMarkerSet(false);
        if (!set) return;
        dt = Math.min(Math.max(dt, 0), MAX_ANIMATION_STEP);
        let moving = false;
        set.markers.forEach(marker => {
            if (marker.isEntityMarker && marker.step(dt, this.camera) && marker.visible) moving = true;
        });
        if (moving && set.visible && this.redraw) this.redraw();
    }

    clear() {
        this.getEntityMarkerSet(false)?.clear();
    }

    dispose() {
        if (this.events) this.events.removeEventListener("bluemapRenderFrame", this.onRenderFrame);
        super.dispose();
        const set = this.getEntityMarkerSet(false);
        if (set) this.root.remove(set);
        this.itemCache.dispose();
    }

}
