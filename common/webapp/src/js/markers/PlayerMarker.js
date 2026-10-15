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
import {Marker} from "./Marker";
import {CSS2DObject} from "../util/CSS2DRenderer";
import {animate, htmlToElement} from "../util/Utils";
import {BoxGeometry, Group, MathUtils, Mesh, MeshBasicMaterial} from "three";
import {angleDelta, DEFAULT_UPDATE_INTERVAL, interpolationDuration, isDiscontinuous, isStaleResponse} from "./LivePlayerData";

/** Height of the head-marker above the players feet (also the height of the placeholder-model) */
const PLAYER_HEIGHT = 1.8;

/** Beyond this camera-distance only the head/name marker is shown, the 3d-model is hidden */
const MODEL_MAX_DISTANCE = 1000;

/**
 * Geometries and materials of the temporary placeholder-model.
 * They are shared between all player-markers and are never disposed.
 * (BlueMap Live phase 2: technical prototype, NOT the final player-model)
 */
let placeholderResources = null;
function getPlaceholderResources() {
    if (!placeholderResources) {
        placeholderResources = {
            bodyGeometry: new BoxGeometry(0.5, 1.3, 0.3).translate(0, 0.65, 0),
            headGeometry: new BoxGeometry(0.5, 0.5, 0.5).translate(0, 0.25, 0),
            faceGeometry: new BoxGeometry(0.3, 0.1, 0.05).translate(0, 0.3, 0.27),
            bodyMaterial: new MeshBasicMaterial({color: 0x3b6fd1}),
            headMaterial: new MeshBasicMaterial({color: 0xd9a066}),
            faceMaterial: new MeshBasicMaterial({color: 0x222222}),
        };
    }
    return placeholderResources;
}

/**
 * Creates a mesh that is ignored by raycasting, so the model never intercepts the normal map-interactions (clicks)
 */
function placeholderMesh(geometry, material) {
    const mesh = new Mesh(geometry, material);
    mesh.raycast = () => {};
    return mesh;
}

export class PlayerMarker extends Marker {

    /**
     * @param markerId {string}
     * @param playerUuid {string}
     * @param playerHead {string}
     */
    constructor(markerId, playerUuid, playerHead = "assets/steve.png") {
        super(markerId);
        Object.defineProperty(this, 'isPlayerMarker', {value: true});
        this.data.type = "player";

        this.data.playerUuid = playerUuid;
        this.data.name = playerUuid;
        this.data.playerHead = playerHead;
        this.data.rotation = {
            pitch: 0,
            yaw: 0
        };

        this.elementObject = new CSS2DObject(htmlToElement(`
<div id="bm-marker-${this.data.id}" class="bm-marker-${this.data.type}">
    <img src="${this.data.playerHead}" alt="playerhead" draggable="false">
    <div class="bm-player-name"></div>
</div>
        `));
        this.elementObject.onBeforeRender = (renderer, scene, camera) => this.onBeforeRender(renderer, scene, camera);

        this.playerHeadElement = this.element.getElementsByTagName("img")[0];
        this.playerNameElement = this.element.getElementsByTagName("div")[0];

        this.addEventListener( 'removed', () => {
            if (this.element.parentNode) this.element.parentNode.removeChild(this.element);
        });

        this.playerHeadElement.addEventListener('error', () => {
            this.playerHeadElement.src = "assets/steve.png";
        }, {once: true});

        this.add(this.elementObject);

        // temporary 3d placeholder-model, rendered in the normal marker-scene (same camera & depth-buffer as the map)
        this.model = this.createPlaceholderModel();
        this.add(this.model);

        /** @type {import("./LivePlayerData").LivePlayer | null} */
        this.lastPlayerData = null;
        this.displayed = {x: 0, y: 0, z: 0, bodyYaw: 0, headYaw: 0, pitch: 0};
        this.movementAnimation = null;
    }

    /**
     * @private
     * @returns {Group}
     */
    createPlaceholderModel() {
        const res = getPlaceholderResources();

        const model = new Group();
        model.name = "bm-player-placeholder-model";
        model.position.y = -PLAYER_HEIGHT; // the marker itself sits at head-height

        model.add(placeholderMesh(res.bodyGeometry, res.bodyMaterial));

        this.headPivot = new Group();
        this.headPivot.position.y = 1.3; // neck
        this.headPivot.rotation.order = "YXZ";
        this.headPivot.add(placeholderMesh(res.headGeometry, res.headMaterial));
        this.headPivot.add(placeholderMesh(res.faceGeometry, res.faceMaterial));
        model.add(this.headPivot);

        return model;
    }

    /**
     * @returns {Element}
     */
    get element() {
        return this.elementObject.element.getElementsByTagName("div")[0];
    }

    onBeforeRender(renderer, scene, camera) {
        let distance = Marker.calculateDistanceToCameraPlane(this.position, camera);

        let value = "near";
        if (distance > 1000) {
            value = "med";
        }
        if (distance > 5000) {
            value = "far";
        }

        this.element.setAttribute("distance-data", value);

        this.model.visible = distance <= MODEL_MAX_DISTANCE;
    }

    /**
     * @typedef PlayerLike {{
     *      uuid: string,
     *      name: string,
     *      foreign: boolean,
     *      position: {x: number, y: number, z: number},
     *      rotation: {yaw: number, pitch: number, roll: number}
     * }}
     */

    /**
     * @param markerData {import("./LivePlayerData").LivePlayer} - normalized player-data (see LivePlayerData.parsePlayer)
     * @param updateInterval {number} - the expected time until the next update in ms
     */
    updateFromData(markerData, updateInterval = DEFAULT_UPDATE_INTERVAL) {
        const previous = this.lastPlayerData;

        // ignore position-updates that are older than the current state
        if (!previous || !isStaleResponse(previous.time, markerData.time)) {
            this.updateMovement(previous, markerData, updateInterval);
            this.lastPlayerData = markerData;
        }

        // update name
        let name = markerData.name || this.data.playerUuid;
        this.data.name = name;
        if (this.playerNameElement.innerHTML !== name)
            this.playerNameElement.innerHTML = name;

        // update world
        this.data.foreign = markerData.foreign;
    }

    /**
     * @private
     */
    updateMovement(previous, next, updateInterval) {
        const target = {
            x: next.position.x,
            y: next.position.y,
            z: next.position.z,
            bodyYaw: next.bodyYaw,
            headYaw: next.rotation.yaw,
            pitch: next.rotation.pitch,
        };

        if (this.movementAnimation) {
            this.movementAnimation.cancel();
            this.movementAnimation = null;
        }

        // teleport, respawn, world-change, first update: jump directly to the new state
        if (isDiscontinuous(previous, next)) {
            this.applyMovement(target);
            return;
        }

        // interpolate linearly from the currently displayed state to the target over the time until the next update
        const start = {...this.displayed};
        const delta = {
            x: target.x - start.x,
            y: target.y - start.y,
            z: target.z - start.z,
            bodyYaw: angleDelta(start.bodyYaw, target.bodyYaw),
            headYaw: angleDelta(start.headYaw, target.headYaw),
            pitch: target.pitch - start.pitch,
        };

        if (!delta.x && !delta.y && !delta.z && !delta.bodyYaw && !delta.headYaw && !delta.pitch) return;

        this.movementAnimation = animate(progress => {
            this.applyMovement({
                x: start.x + delta.x * progress,
                y: start.y + delta.y * progress,
                z: start.z + delta.z * progress,
                bodyYaw: start.bodyYaw + delta.bodyYaw * progress,
                headYaw: start.headYaw + delta.headYaw * progress,
                pitch: start.pitch + delta.pitch * progress,
            });
        }, interpolationDuration(previous, next, updateInterval));
    }

    /**
     * @private
     * Applies a (possibly interpolated) state to the marker and the model.
     * Minecraft-convention: yaw 0 = facing +z (south), yaw 90 = facing -x (west), positive pitch = looking down.
     */
    applyMovement(state) {
        this.displayed = state;

        this.position.set(state.x, state.y + PLAYER_HEIGHT, state.z);
        this.data.rotation.pitch = state.pitch;
        this.data.rotation.yaw = state.headYaw;

        this.model.rotation.y = MathUtils.degToRad(-state.bodyYaw);
        this.headPivot.rotation.y = MathUtils.degToRad(-(state.headYaw - state.bodyYaw));
        this.headPivot.rotation.x = MathUtils.degToRad(state.pitch);
    }

    dispose() {
        super.dispose();

        if (this.movementAnimation) {
            this.movementAnimation.cancel();
            this.movementAnimation = null;
        }

        // the placeholder geometries/materials are shared and therefore not disposed here
        this.remove(this.model);

        let element = this.elementObject.element;
        if (element.parentNode) element.parentNode.removeChild(element);
    }

}
