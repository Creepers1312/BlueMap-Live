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
import {
    BoxGeometry, CanvasTexture, Color, EdgesGeometry, Group, LineBasicMaterial, LineSegments, Mesh, MeshBasicMaterial,
    MathUtils, Sprite, SpriteMaterial,
} from "three";

/** shared by all placeholders (never disposed) */
const BOX = new BoxGeometry(1, 1, 1);
const EDGES = new EdgesGeometry(BOX);
const FILL = new MeshBasicMaterial({color: 0x808080, transparent: true, opacity: 0.25, depthWrite: false});
const FILL_HURT = new MeshBasicMaterial({color: 0xFF4040, transparent: true, opacity: 0.35, depthWrite: false});
const LINES = new LineBasicMaterial({color: 0xE0E0E0, transparent: true, opacity: 0.8});
const FRONT = new MeshBasicMaterial({color: new Color(0xE0E0E0), transparent: true, opacity: 0.8, depthWrite: false});

/**
 * "minecraft:magma_cube" -> "Magma Cube"
 * @param type {string}
 * @returns {string}
 */
export function placeholderLabel(type) {
    const path = type.substring(type.indexOf(":") + 1);
    return path.split(/[_/]/).filter(Boolean).map(word => word[0].toUpperCase() + word.substring(1)).join(" ");
}

/**
 * A living entity without a model in the webapp (BlueMap Live): its hitbox as a translucent box, a mark at the
 * front (the body-direction) and its name above.
 */
export class PlaceholderModel extends Group {

    /**
     * @param entityType {string}
     */
    constructor(entityType) {
        super();
        Object.defineProperty(this, 'isPlaceholderModel', {value: true});
        this.name = "bm-mob-placeholder";
        this.entityType = entityType;

        this.box = new Group();
        this.fill = new Mesh(BOX, FILL);
        this.edges = new LineSegments(EDGES, LINES);
        this.front = new Mesh(BOX, FRONT);
        this.front.scale.set(0.3, 0.15, 0.02);
        for (const object of [this.fill, this.edges, this.front]) object.raycast = () => {};
        this.box.add(this.fill, this.edges, this.front);
        this.add(this.box);

        this.label = null;
        this.labelTexture = null;
        if (typeof document !== "undefined") this.createLabel(placeholderLabel(entityType));
        this.setSize(0.6, 1.8);
    }

    /** @private */
    createLabel(text) {
        const canvas = document.createElement("canvas");
        const context = canvas.getContext("2d");
        if (!context) return;
        const font = "bold 32px sans-serif";
        context.font = font;
        canvas.width = Math.ceil(context.measureText(text).width) + 16;
        canvas.height = 44;
        context.font = font;
        context.fillStyle = "rgba(0, 0, 0, 0.5)";
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.fillStyle = "#ffffff";
        context.textBaseline = "middle";
        context.fillText(text, 8, canvas.height / 2);
        this.labelTexture = new CanvasTexture(canvas);
        this.label = new Sprite(new SpriteMaterial({map: this.labelTexture, depthWrite: false}));
        this.label.raycast = () => {};
        this.label.scale.set(canvas.width / canvas.height * 0.3, 0.3, 1);
        this.add(this.label);
    }

    /**
     * @param width {number} - blocks
     * @param height {number} - blocks
     */
    setSize(width, height) {
        this.box.scale.set(1, 1, 1);
        this.fill.scale.set(width, height, width);
        this.fill.position.y = height / 2;
        this.edges.scale.copy(this.fill.scale);
        this.edges.position.copy(this.fill.position);
        this.front.position.set(0, height * 0.75, width / 2 + 0.011);
        if (this.label) this.label.position.y = height + 0.3;
    }

    /**
     * @param bodyYaw {number} - degrees (minecraft convention)
     * @param hurt {boolean}
     */
    animate(bodyYaw, hurt) {
        // minecraft: yaw 0 looks to +z (south)
        this.box.rotation.y = MathUtils.degToRad(-bodyYaw);
        this.fill.material = hurt ? FILL_HURT : FILL;
    }

    dispose() {
        if (this.label) this.label.material.dispose();
        if (this.labelTexture) this.labelTexture.dispose();
        this.clear();
    }

}
