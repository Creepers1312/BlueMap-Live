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

import {currentDayTime, worldSunlight} from "./WorldTime.js";
import {ENTITY_LIGHT, entityLight} from "./EntityLighting.js";

/*
 * BlueMap Live: lights the map like the day-night-cycle of the Minecraft world (an additional option next to BlueMaps
 * own day/night-switch, see docs/bluemap-live/phase-8.md). No three.js, so it can be unit-tested with node.
 */

/** the event the live player-data dispatches with the sampled time of the world (detail: {world}) */
export const WORLD_TIME_EVENT = "bluemapLiveWorldTime";

/** how often (ms) the map-lighting follows the running world-time */
export const WORLD_TIME_TICK = 1000;

/** changes of the sunlight smaller than this are not redrawn */
const MIN_CHANGE = 0.002;

export class WorldTimeLighting {

    /**
     * @param uniforms {{sunlightStrength: {value: number}, ambientLight: {value: number}}} - the map-uniforms
     * @param state {{enabled: boolean, available: boolean}} - reactive ui-state
     * @param events {EventTarget | null}
     * @param redraw {function() | null}
     * @param now {function(): number} - ms
     */
    constructor(uniforms, state, events = null, redraw = null, now = () => Date.now()) {
        this.uniforms = uniforms;
        this.state = state;
        this.events = events;
        this.redraw = redraw;
        this.now = now;

        /** @type {{dayTime: number, rain: number, thunder: number, cycle: boolean} | null} */
        this.world = null;
        this.sampleTime = 0;

        this.onWorldTime = evt => this.setWorld(evt.detail?.world ?? null);
        this.onRenderFrame = () => this.updateEntityLight();
        if (events) {
            events.addEventListener(WORLD_TIME_EVENT, this.onWorldTime);
            events.addEventListener("bluemapRenderFrame", this.onRenderFrame);
        }
        this.interval = setInterval(() => this.update(), WORLD_TIME_TICK);
    }

    /**
     * @param world {{dayTime: number, rain: number, thunder: number, cycle: boolean} | null} - null: the world has no
     *  day-night-cycle (nether, end) or the server sends no world-time
     */
    setWorld(world) {
        if (world === this.world) return; // the same sample again (e.g. a stale response)
        this.world = world;
        this.sampleTime = this.now();
        this.state.available = !!world;
        this.update();
    }

    /** @param enabled {boolean} */
    setEnabled(enabled) {
        this.state.enabled = !!enabled;
        this.update();
    }

    /** The current sunlight-strength of the world, null if not available */
    get worldSunlight() {
        if (!this.world) return null;
        const dayTime = currentDayTime(this.world, (this.now() - this.sampleTime) / 1000);
        return worldSunlight(dayTime, this.world.rain, this.world.thunder);
    }

    /** applies the world-time to the map-lighting (if enabled and available) */
    update() {
        if (this.state.enabled) {
            const sunlight = this.worldSunlight;
            if (sunlight !== null && Math.abs(this.uniforms.sunlightStrength.value - sunlight) >= MIN_CHANGE) {
                this.uniforms.sunlightStrength.value = sunlight;
                if (this.redraw) this.redraw();
            }
        }
        this.updateEntityLight();
    }

    /** the live entities are lit like the map (outdoors), see EntityLighting */
    updateEntityLight() {
        ENTITY_LIGHT.value = entityLight(this.uniforms.sunlightStrength.value, this.uniforms.ambientLight.value);
    }

    dispose() {
        clearInterval(this.interval);
        if (this.events) {
            this.events.removeEventListener(WORLD_TIME_EVENT, this.onWorldTime);
            this.events.removeEventListener("bluemapRenderFrame", this.onRenderFrame);
        }
    }

}
