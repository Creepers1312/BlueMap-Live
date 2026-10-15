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
import { MarkerManager } from "./MarkerManager";
import { PLAYER_MARKER_SET_ID } from "./PlayerMarkerManager";
import { ENTITY_MARKER_SET_ID } from "./EntityMarkerManager";

// BlueMap Live: the live entity-set is managed by the EntityMarkerManager, it must not be removed by markers.json updates
const IGNORED_MARKER_SETS = [PLAYER_MARKER_SET_ID, ENTITY_MARKER_SET_ID, "bm-popup-set"];

export class NormalMarkerManager extends MarkerManager {

    /**
     * @constructor
     * @param root {MarkerSet} - The scene to which all markers will be added
     * @param fileUrl {string} - The marker file from which this manager updates its markers
     * @param events {EventTarget}
     */
    constructor(root, fileUrl, events = null) {
        super(root, fileUrl, events);
    }

    /**
     * @protected
     * @override
     * @param markerData
     * @returns {boolean}
     */
    updateFromData(markerData) {
        this.root.updateMarkerSetsFromData(markerData, IGNORED_MARKER_SETS);
        return true;
    }

    clear() {
        this.root.updateMarkerSetsFromData({}, IGNORED_MARKER_SETS);
    }

}