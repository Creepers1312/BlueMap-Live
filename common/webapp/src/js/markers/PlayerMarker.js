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
import {MathUtils} from "three";
import {angleDelta, DEFAULT_UPDATE_INTERVAL, interpolationDuration, isDiscontinuous, isStaleResponse} from "./LivePlayerData";
import {PlayerModel} from "./player/PlayerModel";
import {PlayerSkinCache} from "./player/PlayerSkinCache";
import {PlayerAnimator} from "./player/PlayerAnimator";

/** Height of the head-marker above the players feet */
const PLAYER_HEIGHT = 1.8;

/** Beyond this camera-distance only the head/name marker is shown, the 3d-model is hidden */
const MODEL_MAX_DISTANCE = 1000;

/** used if no skin-cache is provided */
let fallbackSkinCache = null;

export class PlayerMarker extends Marker {

    /**
     * @param markerId {string}
     * @param playerUuid {string}
     * @param playerHead {string}
     * @param skinCache {PlayerSkinCache | null} - shared skin-textures
     * @param playerskinsUrl {string | null} - the url-prefix of the full skins (assets/playerskins/)
     * @param itemCache {import("./player/ItemAssetCache").ItemAssetCache | null} - shared item-models of held items
     */
    constructor(markerId, playerUuid, playerHead = "assets/steve.png", skinCache = null, playerskinsUrl = null, itemCache = null) {
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

        // 3d player-model, rendered in the normal marker-scene (same camera & depth-buffer as the map)
        if (!skinCache) skinCache = fallbackSkinCache || (fallbackSkinCache = new PlayerSkinCache());
        this.playerskinsUrl = playerskinsUrl;
        this.model = new PlayerModel(skinCache, itemCache);
        this.model.position.y = -PLAYER_HEIGHT; // the marker itself sits at head-height, the model origin is at the feet
        this.headPivot = this.model.parts.head;
        this.add(this.model);

        /** @type {import("./LivePlayerData").LivePlayer | null} */
        this.lastPlayerData = null;
        this.displayed = {x: 0, y: 0, z: 0, bodyYaw: 0, headYaw: 0, pitch: 0};
        this.movementAnimation = null;

        // limb-animations, stepped by the PlayerMarkerManager in the render-loop of the map-viewer
        this.animator = new PlayerAnimator();
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

        this.model.visible = this.model.hasSkin && distance <= MODEL_MAX_DISTANCE;
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
            // teleport, respawn, world-change: the animation starts fresh as well
            if (isDiscontinuous(previous, markerData)) this.animator.reset();
            this.animator.setTarget(markerData);
            this.updateMovement(previous, markerData, updateInterval);
            this.lastPlayerData = markerData;
        }

        this.updateSkin(markerData.skin);

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
     * @param skin {{model: string, version: string} | null}
     */
    updateSkin(skin) {
        const url = skin && this.playerskinsUrl ?
            `${this.playerskinsUrl}${this.data.playerUuid}.png?v=${skin.version}` :
            null;
        this.model.setSkin(url, skin ? skin.model : "classic");
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

    /**
     * Advances the limb-animation and applies it to the model. Called once per rendered frame.
     * @param dt {number} - seconds since the last frame
     * @returns {boolean} true if the model is currently moving and should be rendered with a high frame-rate
     */
    stepAnimation(dt) {
        const active = this.animator.step(dt,
            MathUtils.degToRad(this.displayed.pitch),
            MathUtils.degToRad(angleDelta(this.displayed.bodyYaw, this.displayed.headYaw))
        );
        this.model.applyPose(this.animator.pose);
        return active;
    }

    dispose() {
        super.dispose();

        if (this.movementAnimation) {
            this.movementAnimation.cancel();
            this.movementAnimation = null;
        }

        // releases the skin, the shared geometries and materials are not disposed here
        this.model.dispose();
        this.remove(this.model);

        let element = this.elementObject.element;
        if (element.parentNode) element.parentNode.removeChild(element);
    }

}
