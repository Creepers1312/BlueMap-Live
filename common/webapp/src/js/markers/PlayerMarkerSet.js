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

import {MarkerSet} from "./MarkerSet";
import {alert} from "../util/Utils";
import {PlayerMarker} from "./PlayerMarker";
import {DEFAULT_UPDATE_INTERVAL, isStaleResponse, parsePlayersResponse, resolveUpdateInterval} from "./LivePlayerData";

export class PlayerMarkerSet extends MarkerSet {

    /**
     * @param id {string}
     * @param playerheadsUrl {string}
     * @param data {object | null}
     * @param skinCache {import("./player/PlayerSkinCache").PlayerSkinCache | null}
     * @param playerskinsUrl {string | null}
     */
    constructor(id, playerheadsUrl, data = null, skinCache = null, playerskinsUrl = null) {
        super(id, data);
        this.data.label = "Player";
        this.data.toggleable = true;
        this.data.defaultHide = false;

        this.data.playerheadsUrl = playerheadsUrl;

        // not part of the (reactive) data
        this.skinCache = skinCache;
        this.playerskinsUrl = playerskinsUrl;

        this.lastServerTime = null;
        this.updateInterval = DEFAULT_UPDATE_INTERVAL;
    }

    /**
     * Binds this set to the urls and the skin-cache of a (new) player-marker-manager, e.g. after a map-switch.
     * Player-markers created afterwards use the new skin-cache. Responses of the previous map are no longer
     * compared to the new ones (their serverTimes are unrelated).
     * @param playerheadsUrl {string}
     * @param skinCache {import("./player/PlayerSkinCache").PlayerSkinCache | null}
     * @param playerskinsUrl {string | null}
     */
    bindSource(playerheadsUrl, skinCache, playerskinsUrl) {
        this.data.playerheadsUrl = playerheadsUrl;
        this.skinCache = skinCache;
        this.playerskinsUrl = playerskinsUrl;
        this.lastServerTime = null;
    }

    updateFromPlayerData(data) {
        let response = parsePlayersResponse(data);
        if (!response) {
            this.clear();
            return false;
        }

        // ignore responses that are older than the last one we processed (e.g. from a cache)
        if (isStaleResponse(this.lastServerTime, response.serverTime)) return true;
        if (response.serverTime !== null) this.lastServerTime = response.serverTime;

        this.updateInterval = resolveUpdateInterval(response.updateInterval);

        if (response.invalid > 0) {
            alert(this.events, `${response.invalid} invalid player-entries in live player data have been ignored.`, "fine");
        }

        /** @type Set<Marker> */
        let updatedPlayerMarkers = new Set();

        // update
        response.players.forEach(playerData => {
            try {
                let playerMarker = this.updatePlayerMarkerFromData(playerData);
                updatedPlayerMarkers.add(playerMarker);
            } catch (err) {
                alert(this.events, err, "fine");
            }
        });

        // remove
        this.markers.forEach(playerMarker => {
            if (!updatedPlayerMarkers.has(playerMarker)) {
                this.remove(playerMarker);
            }
        });

        return true;
    }

    updatePlayerMarkerFromData(markerData) {
        let playerUuid = markerData.uuid;
        if (!playerUuid) throw new Error("player-data has no uuid!");
        let markerId = this.getPlayerMarkerId(playerUuid);

        /** @type PlayerMarker */
        let marker = this.markers.get(markerId);

        // create new if not existent of wrong type
        if (!marker || !marker.isPlayerMarker) {
            if (marker) this.remove(marker);
            marker = new PlayerMarker(markerId, playerUuid, `${this.data.playerheadsUrl}${playerUuid}.png`, this.skinCache, this.playerskinsUrl);
            this.add(marker);
        }

        // update
        marker.updateFromData(markerData, this.updateInterval);

        // hide if from different world
        marker.visible = !markerData.foreign;

        return marker;
    }

    getPlayerMarker(playerUuid) {
        return this.markers.get(this.getPlayerMarkerId(playerUuid));
    }

    getPlayerMarkerId(playerUuid) {
        return "bm-player-" + playerUuid;
    }

}