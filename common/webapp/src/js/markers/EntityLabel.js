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

import {LIVE_DISPLAY} from "./LiveDisplay.js";

/*
 * BlueMap Live: the name-tag of a named mob and the health-bar of a mob or player (settings nameTags and healthBars,
 * see LiveDisplay). Only near the camera, like the name-tags in the game (64 blocks).
 */

/**
 * Creates the label-element (EntityLabelView, set by the EntityMarkerManager: the views need the page, the markers
 * are also tested without one), null: no labels.
 * @type {{create: (() => import("./EntityLabelView.js").EntityLabel) | null}}
 */
export const ENTITY_LABELS = {create: null};

/** labels further than this from the camera are not shown (blocks, vanilla EntityRenderer: 64 for name-tags) */
export const LABEL_DISTANCE = 64;

/**
 * @param health {number | null}
 * @param maxHealth {number | null}
 * @returns {number | null} 0..1, null if unknown
 */
export function healthFraction(health, maxHealth) {
    if (health === null || maxHealth === null || !(maxHealth > 0)) return null;
    return Math.max(0, Math.min(1, health / maxHealth));
}

/**
 * What the label of an entity shows with the current settings.
 * @param name {string | null} - the custom name (mobs) or the player-name
 * @param health {number | null}
 * @param maxHealth {number | null}
 * @param display {{nameTags: boolean, healthBars: boolean}}
 * @returns {{name: string | null, health: number | null, maxHealth: number | null, fraction: number | null} | null} null: no label
 */
export function labelContent(name, health, maxHealth, display = LIVE_DISPLAY) {
    const shownName = display.nameTags && name ? name : null;
    const fraction = display.healthBars ? healthFraction(health, maxHealth) : null;
    if (shownName === null && fraction === null) return null;
    return {name: shownName, health: fraction === null ? null : health, maxHealth: fraction === null ? null : maxHealth, fraction};
}

/**
 * The color of the health-bar: green, over yellow to red.
 * @param fraction {number} 0..1
 * @returns {string} css-color
 */
export function healthColor(fraction) {
    return `hsl(${Math.round(Math.max(0, Math.min(1, fraction)) * 120)}, 80%, 45%)`;
}

/** formats health in hearts like the game (2 health = 1 heart), e.g. "7.5" */
export function formatHearts(health) {
    const hearts = Math.round(health) / 2;
    return Number.isInteger(hearts) ? hearts.toFixed(0) : hearts.toFixed(1);
}
