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
import { PlayerMarkerSet } from "./PlayerMarkerSet";
import { MarkerManager } from "./MarkerManager";
import { DEFAULT_UPDATE_INTERVAL } from "./LivePlayerData";
import { PlayerSkinCache } from "./player/PlayerSkinCache";
import { ItemAssetCache } from "./player/ItemAssetCache";
import { WORLD_TIME_EVENT } from "./WorldTimeLighting";
import { ENTITIES_STEPPED_EVENT, ENTITY_MARKER_SET_ID, viewFrustum } from "./EntityMarkerManager";
import { Sphere } from "three";

/** the sphere around the marker (at head-height) that is tested against the view, in blocks */
const PLAYER_VIEW_RADIUS = 2.5;
const viewSphere = new Sphere();
import { applyDynamicLights, playerLights } from "./DynamicLights";

export const PLAYER_MARKER_SET_ID = "bm-players";

/** frames that took longer (e.g. a background-tab) are animated as if they took this long (seconds) */
const MAX_ANIMATION_STEP = 0.25;

export class PlayerMarkerManager extends MarkerManager {

    /**
     * @constructor
     * @param root {MarkerSet} - The scene to which all markers will be added
     * @param fileUrl {string} - The marker file from which this manager updates its markers
     * @param playerheadsUrl {string} - The url from which playerhead images should be loaded
     * @param events {EventTarget}
     * @param playerskinsUrl {string | null} - The url from which the full player-skins should be loaded
     * @param texturesUrl {string | null} - The textures.json of the map (contains the default skin)
     * @param redraw {function() | null} - requests high-fps rendering from the map-viewer, called while a model is animated
     * @param itemsUrl {string | null} - The url from which the item-models of held items should be loaded
     */
    constructor(root, fileUrl, playerheadsUrl, events = null, playerskinsUrl = null, texturesUrl = null, redraw = null, itemsUrl = null) {
        super(root, fileUrl, events);

        this.playerheadsUrl = playerheadsUrl;
        this.playerskinsUrl = playerskinsUrl;

        this.skinCache = new PlayerSkinCache();
        if (texturesUrl) this.skinCache.loadDefaultSkinFromTextures(texturesUrl);

        this.itemCache = new ItemAssetCache(itemsUrl);

        // the models are animated in the existing render-loop of the map-viewer (no own animation-loop)
        this.redraw = redraw;
        this.onRenderFrame = evt => this.animatePlayers(evt.detail.delta / 1000);
        if (this.events) this.events.addEventListener("bluemapRenderFrame", this.onRenderFrame);
        this.onEntitiesStepped = evt => this.attachRiders(evt.detail.markers);
        if (this.events) this.events.addEventListener(ENTITIES_STEPPED_EVENT, this.onEntitiesStepped);
    }

    /**
     * Draws riding players on their drawn vehicles (after the entities of the frame are stepped): the player- and
     * the entity-samples are taken at different ticks, interpolated separately they would not fit together.
     * @param entityMarkers {Map<string, object>}
     */
    attachRiders(entityMarkers) {
        const playerMarkerSet = this.getPlayerMarkerSet(false);
        if (!playerMarkerSet) return;
        const entitySet = this.root.markerSets.get(ENTITY_MARKER_SET_ID);
        const visible = !!(entitySet && entitySet.visible);
        playerMarkerSet.markers.forEach(marker => {
            if (!marker.isPlayerMarker) return;
            const vehicle = marker.vehicle;
            marker.attachTo(vehicle && visible ? entityMarkers.get("bm-entity-" + vehicle.id) : null);
        });
    }

    /**
     * Advances the animations of all player-models by one frame.
     * While a visible model is moving, high-fps rendering is requested, otherwise the map-viewer keeps its normal
     * (low) frame-rate.
     * @param dt {number} - seconds since the last rendered frame
     */
    animatePlayers(dt) {
        const playerMarkerSet = this.getPlayerMarkerSet(false);
        if (!playerMarkerSet) return;

        const setVisible = playerMarkerSet.visible;
        // only players in the view of the camera need a high frame-rate (BlueMapApp sets the camera)
        const frustum = this.camera ? viewFrustum(this.camera) : null;
        dt = Math.min(Math.max(dt, 0), MAX_ANIMATION_STEP);
        let active = false;
        // without (shown) live entities there is no vehicle to draw a rider on
        const entitySet = this.root.markerSets.get(ENTITY_MARKER_SET_ID);
        const noEntities = !entitySet || !entitySet.visible;
        playerMarkerSet.markers.forEach(marker => {
            if (!marker.isPlayerMarker) return;
            if (noEntities) marker.attachTo(null);
            if (marker.stepAnimation(dt) && setVisible && marker.visible && marker.model.visible &&
                (!frustum || frustum.intersectsSphere(viewSphere.set(marker.position, PLAYER_VIEW_RADIUS)))) active = true;
        });
        // dynamic lights: players holding light-emitting items light the map (only shown players)
        if (this.lightUniforms) {
            const lights = setVisible ? playerLights(playerMarkerSet.markers.values()) : [];
            if (applyDynamicLights(this.lightUniforms, lights)) active = true;
        }
        if (active && this.redraw) this.redraw();
    }

    /**
     * @protected
     * @override
     * @param markerFileData
     * @returns {boolean}
     */
    updateFromData(markerFileData) {
        let playerMarkerSet = this.getPlayerMarkerSet(Array.isArray(markerFileData.players));
        // BlueMap Live: a successful response for the live-indicator (see LiveConnection)
        if (Array.isArray(markerFileData.players) && this.onLiveData) this.onLiveData(Date.now());
        if (!playerMarkerSet) return false;
        const result = playerMarkerSet.updateFromPlayerData(markerFileData);
        // BlueMap Live: every response is a new sample of the world-time (see WorldTimeLighting)
        this.dispatchWorldTime(playerMarkerSet.worldTime ?? null);
        return result;
    }

    /** @param world {object | null} */
    dispatchWorldTime(world) {
        if (this.events) this.events.dispatchEvent(new CustomEvent(WORLD_TIME_EVENT, {detail: {world}}));
    }

    /**
     * @private
     * @returns {PlayerMarkerSet}
     */
    getPlayerMarkerSet(create = true) {
        /** @type {PlayerMarkerSet} */
        let playerMarkerSet = /** @type {PlayerMarkerSet} */ this.root.markerSets.get(PLAYER_MARKER_SET_ID);

        if (!playerMarkerSet && create) {
            playerMarkerSet = new PlayerMarkerSet(PLAYER_MARKER_SET_ID, this.playerheadsUrl, null, this.skinCache, this.playerskinsUrl, this.itemCache);
            this.root.add(playerMarkerSet);
        }

        // the set stays in the marker-scene when the map is switched (and the previous manager is disposed),
        // so a new manager has to bind it to its own (map-specific) skin-cache and urls
        if (playerMarkerSet && playerMarkerSet.skinCache !== this.skinCache) {
            playerMarkerSet.bindSource(this.playerheadsUrl, this.skinCache, this.playerskinsUrl, this.itemCache);
        }

        return playerMarkerSet;
    }

    /**
     * @param playerUuid {string}
     * @returns {PlayerMarker | undefined}
     */
    getPlayerMarker(playerUuid) {
        return this.getPlayerMarkerSet().getPlayerMarker(playerUuid)
    }

    /**
     * The polling interval (ms) announced by the server in the last received data
     * @returns {number}
     */
    get updateInterval() {
        return this.getPlayerMarkerSet(false)?.updateInterval ?? DEFAULT_UPDATE_INTERVAL;
    }

    clear() {
        this.getPlayerMarkerSet(false)?.clear();
    }

    dispose() {
        if (this.lightUniforms) applyDynamicLights(this.lightUniforms, []);
        if (this.events) this.events.removeEventListener("bluemapRenderFrame", this.onRenderFrame);
        if (this.events) this.events.removeEventListener(ENTITIES_STEPPED_EVENT, this.onEntitiesStepped);
        this.dispatchWorldTime(null);
        super.dispose();
        this.skinCache.dispose();
        this.itemCache.dispose();
    }

}