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

import {CSS2DObject} from "../util/CSS2DRenderer";
import {htmlToElement} from "../util/Utils";
import {formatHearts, healthColor} from "./EntityLabel.js";

/** the label-element over an entity, shown by the CSS2DRenderer of the markers */
export class EntityLabel extends CSS2DObject {

    constructor() {
        super(htmlToElement(`<div class="bm-entity-label"><div class="bm-entity-name"></div><div class="bm-health"><div class="bm-health-fill"></div><span class="bm-health-text"></span></div></div>`));
        // the CSS2DObject wraps the element (and removes it from the page when the label is removed)
        const label = this.element.firstElementChild;
        this.nameElement = label.children[0];
        this.healthElement = label.children[1];
        this.fillElement = this.healthElement.children[0];
        this.textElement = this.healthElement.children[1];
        this.shown = "";
    }

    /**
     * @param content {{name: string | null, health: number | null, maxHealth: number | null, fraction: number | null}}
     */
    setContent(content) {
        const key = `${content.name}|${content.fraction}|${content.health}`;
        if (key === this.shown) return;
        this.shown = key;
        // textContent: names are chosen by players
        this.nameElement.textContent = content.name || "";
        this.nameElement.style.display = content.name ? "" : "none";
        if (content.fraction === null) {
            this.healthElement.style.display = "none";
        } else {
            this.healthElement.style.display = "";
            this.fillElement.style.width = (content.fraction * 100).toFixed(1) + "%";
            this.fillElement.style.backgroundColor = healthColor(content.fraction);
            this.textElement.textContent = "♥ " + formatHearts(content.health) + " / " + formatHearts(content.maxHealth);
        }
    }

}
