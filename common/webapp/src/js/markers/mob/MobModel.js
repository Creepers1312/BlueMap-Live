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
import {Group, MathUtils, Mesh} from "three";
import {getLayerGeometries} from "./MobModelGeometry.js";
import {ANIMATIONS, createTransform, resetTransform} from "./MobAnimations.js";
import {creeperSwelling, creeperWhiteOverlay, deathAngle, isLayerShown, layerTextures, layerTint, slimeScale, VANILLA_MODELS} from "./MobTypes.js";
import {ItemView} from "../player/ItemView.js";
import {itemPredicates} from "../player/PlayerItemPoses.js";
import {ArmorView} from "./ArmorView.js";

const DEG = Math.PI / 180;

/**
 * A block-model (item-asset "minecraft:block/<id>", see the java ItemModelBaker) placed like vanilla's
 * renderBlockAsEntity: the model from 0 to 1. Falls back to the item-model if the block has no own model.
 */
class BlockModelView extends Group {

    constructor(itemCache) {
        super();
        this.view = new ItemView(itemCache, "none");
        this.view.position.set(0.5, 0.5, 0.5); // the ItemView-content starts at -0.5
        this.add(this.view);
        this.blockModel = null;
        this.fallback = false;
    }

    update(blockModel) {
        if (blockModel !== this.blockModel) {
            this.blockModel = blockModel;
            this.fallback = false;
        }
        const entry = this.view.entry;
        if (!this.fallback && blockModel && entry && entry.state === "loaded" && entry.models.length === 0 && this.view.itemId === blockModel) {
            this.fallback = true; // no block-model: the item-model
        }
        const id = !blockModel ? null : this.fallback ? blockModel.replace(":block/", ":") : blockModel;
        this.view.update(id, {});
        this.visible = !!blockModel;
    }

    dispose() {
        this.view.dispose();
    }

}

/** vanilla LivingEntityRenderer: the model is moved down by 1.501 blocks after the flip */
const MODEL_OFFSET = -1.501;

function nonInteractiveMesh(geometry, material) {
    const mesh = new Mesh(geometry, material);
    mesh.raycast = () => {};
    return mesh;
}

/**
 * The vanilla model of a mob (see MobTypes): the transformation-chain of vanilla LivingEntityRenderer
 * (body-yaw, death-rotation, flip, renderer-scale, -1.501) and one part-hierarchy per model-layer, all layers
 * follow the transforms of the main layer (like vanilla's copyStateTo). Geometries are shared per model-layer,
 * textures and materials per mob-type (MobAssetCache).
 * <p>The origin is at the feet of the mob.</p>
 */
export class MobModel extends Group {

    /**
     * @param entityType {string}
     * @param mobType {import("./MobTypes.js").MobType}
     * @param assetCache {import("./MobAssetCache.js").MobAssetCache}
     * @param itemCache {import("../player/ItemAssetCache.js").ItemAssetCache | null}
     */
    constructor(entityType, mobType, assetCache, itemCache = null) {
        super();
        Object.defineProperty(this, 'isMobModel', {value: true});
        this.name = "bm-mob-model";
        this.entityType = entityType;
        this.mobType = mobType;
        this.assetCache = assetCache;
        this.asset = assetCache.acquire(entityType);
        this.onAssetChanged = () => this.updateMaterials();
        this.asset.listeners.add(this.onAssetChanged);

        // vanilla LivingEntityRenderer.render / setupTransforms
        this.yawGroup = new Group();
        this.deathGroup = new Group();
        this.flip = new Group();
        this.offset = new Group();
        this.root = new Group();
        this.root.scale.setScalar(1 / 16);
        this.offset.position.y = MODEL_OFFSET;
        this.add(this.yawGroup);
        this.yawGroup.add(this.deathGroup);
        // the poses of setupTransforms after the death-rotation: lying in a bed, the sleeping cat
        this.poseGroup = new Group();
        this.deathGroup.add(this.poseGroup);
        this.poseGroup.add(this.flip);
        this.flip.add(this.offset);
        this.offset.add(this.root);

        // vanilla AnimalModel: babies render the head- and the body-parts with own scales
        this.headGroup = new Group();
        this.bodyGroup = new Group();
        this.root.add(this.headGroup, this.bodyGroup);

        const mainLayer = VANILLA_MODELS.models[mobType.layers[0].model];
        this.mainParts = mainLayer.parts;

        /** part-path -> transform (vanilla ModelPart-state), animated */
        this.transforms = {};
        /** part-path -> model-data of the main layer */
        this.partData = {};
        const collect = (parts, prefix) => {
            for (const name in parts) {
                this.transforms[prefix + name] = createTransform(parts[name]);
                this.partData[prefix + name] = parts[name];
                if (parts[name].children) collect(parts[name].children, prefix + name + "/");
            }
        };
        collect(this.mainParts, "");

        /** per layer: {layer, bones: Map(path -> Group), meshes: Mesh[]} */
        this.layerViews = mobType.layers.map(layer => this.buildLayer(layer));

        // worn armor (biped mobs, vanilla ArmorFeatureRenderer): bones of the inner and outer armor-model
        this.armor = null;
        if (mobType.arms && itemCache) {
            const armorLayers = mobType.armorLayers || {inner: "minecraft:player#inner_armor", outer: "minecraft:player#outer_armor"};
            const armorBones = {};
            for (const model of ["inner", "outer"]) {
                const view = this.buildLayer({model: armorLayers[model]}, false);
                view.armor = true;
                this.layerViews.push(view);
                armorBones[model] = view.bones;
            }
            this.armor = new ArmorView(itemCache.textures, armorLayers, (model, part) => armorBones[model].get(part) || null);
        }

        this.mob = {variant: null, baby: false, flags: new Set()};
        this.hurt = false;
        this.white = 0;
        this.wasBaby = null;

        // held items (biped mobs)
        this.itemSlots = null;
        if (mobType.arms && itemCache) {
            this.itemSlots = {right: this.createItemSlot("right", itemCache), left: this.createItemSlot("left", itemCache)};
        }
        this.items = {mainHand: null, offHand: null, leftHanded: false};

        // block-models rendered with the mob (vanilla feature-renderers), in the model-space in blocks (after the flip)
        this.blocks = [];
        if (itemCache && mobType.mushrooms) this.createMushrooms(itemCache);
        if (itemCache && mobType.carriedBlock) this.createCarriedBlock(itemCache);

        this.visible = false; // until the textures are loaded
        this.updateMaterials();
    }

    /** @private */
    buildLayer(layer, withMeshes = true) {
        const data = VANILLA_MODELS.models[layer.model];
        const geometries = getLayerGeometries(layer.model, data);
        const hidden = new Set(this.mobType.hidden || []);
        const headParts = new Set(this.mobType.headParts || []);
        const bones = new Map();
        const meshes = [];
        const build = (parts, prefix, parent) => {
            for (const name in parts) {
                const path = prefix + name;
                if (hidden.has(path)) continue;
                const bone = new Group();
                bone.name = path;
                bone.rotation.order = "ZYX"; // vanilla ModelPart.rotate: rotationZYX(roll, yaw, pitch)
                const target = parent || (headParts.has(name) ? this.headGroup : this.bodyGroup);
                target.add(bone);
                bones.set(path, bone);
                const geometry = withMeshes ? geometries.get(path) : null;
                if (geometry) {
                    const mesh = nonInteractiveMesh(geometry, null);
                    mesh.visible = false;
                    bone.add(mesh);
                    meshes.push(mesh);
                }
                if (parts[name].children) build(parts[name].children, path + "/", bone);
            }
        };
        build(data.parts, "", null);
        return {layer, bones, meshes};
    }

    /**
     * Sets the state of the mob that changes the model (not the animation).
     * @param mob {{variant: string | null, baby: boolean, flags: Set<string>, size: number}}
     * @param items {{mainHand: object | null, offHand: object | null, leftHanded: boolean}}
     */
    setState(mob, items) {
        const changed = mob.variant !== this.mob.variant || mob.baby !== this.mob.baby ||
            [...mob.flags].join() !== [...this.mob.flags].join();
        this.mob = mob;
        this.items = items;
        if (this.armor) this.armor.update(items.armor || null);
        if (changed) this.updateMaterials();

        if (mob.baby !== this.wasBaby) {
            this.wasBaby = mob.baby;
            this.updateBabyTransforms();
        }

        // vanilla renderer-scales
        const type = this.mobType;
        let scale = type.scale || 1;
        if (mob.baby && type.babyScale) scale *= type.babyScale;
        if (type.slime) scale *= slimeScale(mob.size);
        this.baseScale = scale;
        this.flip.scale.set(-scale, -scale, scale);
        this.flip.position.y = type.slime ? 0.001 * scale : 0;
    }

    /** vanilla AnimalModel.render for babies (child-parameters of the mob-type) @private */
    updateBabyTransforms() {
        const child = this.mobType.child;
        this.headGroup.position.set(0, 0, 0);
        this.headGroup.scale.setScalar(1);
        this.bodyGroup.position.set(0, 0, 0);
        this.bodyGroup.scale.setScalar(1);
        if (!this.wasBaby || !child) return;
        const [headScaled, headY, headZ, invertedHeadScale, invertedBodyScale, bodyY] = child;
        const headScale = headScaled ? 1.5 / invertedHeadScale : 1;
        // vanilla scales first and translates (in blocks) after: as a group the translation is scaled
        this.headGroup.scale.setScalar(headScale);
        this.headGroup.position.set(0, headY * headScale, headZ * headScale);
        const bodyScale = 1 / invertedBodyScale;
        this.bodyGroup.scale.setScalar(bodyScale);
        this.bodyGroup.position.set(0, bodyY * bodyScale, 0);
    }

    /**
     * Applies the animation and the renderer-transformations.
     * @param input {import("./MobAnimations.js").AnimationInput}
     * @param bodyYaw {number} - degrees (minecraft convention)
     * @param deathTicks {number} - vanilla deathTime (+ tick-progress), 0 if alive
     * @param hurt {boolean} - the red overlay
     * @param fuse {number} - creeper: vanilla getClientFuseTime (0: not swelling)
     */
    animate(input, bodyYaw, deathTicks, hurt, fuse = 0) {
        // vanilla CreeperEntityRenderer.getAnimationCounter: white flashing while the fuse burns
        const white = this.mobType.creeper ? creeperWhiteOverlay(fuse) : 0;
        if (white !== this.white) {
            this.white = white;
            this.updateMaterials();
        }
        if (this.mobType.creeper && this.baseScale) {
            const swelling = creeperSwelling(fuse);
            this.flip.scale.set(-this.baseScale * swelling.horizontal, -this.baseScale * swelling.vertical, this.baseScale * swelling.horizontal);
        }

        for (const path in this.transforms) resetTransform(this.transforms[path], this.partData[path]);
        const animation = ANIMATIONS[this.mobType.animation];
        if (animation) animation(this.transforms, input);

        for (const {bones} of this.layerViews) {
            for (const [path, bone] of bones) {
                const t = this.transforms[path];
                if (!t) continue;
                bone.position.set(t.pivotX, t.pivotY, t.pivotZ);
                bone.rotation.set(t.pitch, t.yaw, t.roll);
                bone.visible = t.visible;
            }
        }

        // vanilla LivingEntityRenderer: in a bed (EntityPose.SLEEPING) moved towards the head-end, turned by the direction
        // of the bed instead of the body (getYaw), lying (getLyingAngle 90) and turned by 270 degrees
        const bed = input.bed;
        const dying = deathTicks > 0;
        this.yawGroup.position.set(bed ? bed.x : 0, 0, bed ? bed.z : 0);
        this.yawGroup.rotation.y = MathUtils.degToRad(bed ? bed.yaw : 180 - bodyYaw);
        this.deathGroup.rotation.z = MathUtils.degToRad(bed && !dying ? 90 : deathAngle(deathTicks, this.mobType.lyingAngle || 90));
        this.poseGroup.position.set(0, 0, 0);
        this.poseGroup.rotation.set(0, bed && !dying ? MathUtils.degToRad(270) : 0, 0);
        // vanilla PandaEntityRenderer.setupTransforms: sitting (up by 0.8, tilted back, down by 1), lying on the back
        // (up by 1.3, turned over); T1 * R * T2 as one group: position T1 + R * T2
        const pandaPose = input.panda;
        if (pandaPose && (pandaPose.sit > 0 || pandaPose.lie > 0)) {
            const pitch = input.entityPitch || 0;
            let angle = 0, y = 0, z = 0;
            if (pandaPose.sit > 0) {
                angle = MathUtils.degToRad(pitch + 90 * pandaPose.sit);
                y = 0.8 * pandaPose.sit - pandaPose.sit * Math.cos(angle);
                z = -pandaPose.sit * Math.sin(angle);
            }
            if (pandaPose.lie > 0) {
                // the second transform follows the first one: rotated by the first angle
                const lift = (input.baby ? 0.5 : 1.3) * pandaPose.lie;
                y += lift * Math.cos(angle);
                z += lift * Math.sin(angle);
                angle += MathUtils.degToRad(pitch + 180 * pandaPose.lie);
            }
            this.poseGroup.position.set(0, y, z);
            this.poseGroup.rotation.x = angle;
        }
        // vanilla CatEntityRenderer.setupTransforms: the lying cat is moved and rolled to its side
        const catSleep = input.cat ? input.cat.sleep : 0;
        if (catSleep > 0) {
            this.poseGroup.position.set(0.4 * catSleep, 0.15 * catSleep, 0.1 * catSleep);
            this.poseGroup.rotation.z = MathUtils.degToRad(90 * catSleep);
        }

        if (hurt !== this.hurt) {
            this.hurt = hurt;
            this.updateMaterials();
        }

        // vanilla EnergySwirlOverlayFeatureRenderer (charged creeper): the texture moves by 0.01 per tick
        for (const {layer, meshes} of this.layerViews) {
            if (!layer.type || layer.type !== "energy" || !meshes[0] || !meshes[0].material || !meshes[0].material.map) continue;
            const shift = (input.age * 0.01) % 1;
            meshes[0].material.map.offset.set(shift, -shift);
        }
        if (this.itemSlots) this.updateItems();
        if (this.blocks.length) this.updateBlocks();
    }

    /** @private */
    updateMaterials() {
        const asset = this.asset;
        if (asset.state === "failed") this.assetCache.retry(asset);
        let any = false;
        for (const {layer, meshes, armor} of this.layerViews) {
            if (armor) continue;
            const shown = isLayerShown(layer, this.mob);
            const tint = layerTint(layer, this.mob);
            const overlay = layer.type !== "eyes" && layer.type !== "energy";
            const material = shown ? this.assetCache.material(asset, layerTextures(layer, this.mob), layer.type || "cutout", tint,
                this.hurt && overlay, overlay ? this.white : 0) : null;
            for (const mesh of meshes) {
                mesh.material = material;
                mesh.visible = !!material;
            }
            // the main layer decides if the mob is shown at all
            if (layer === this.mobType.layers[0]) any = !!material;
        }
        this.visible = any;
    }

    /**
     * vanilla MooshroomMushroomFeatureRenderer (1.21): two mushrooms on the back, one on the head.
     * @private
     */
    createMushrooms(itemCache) {
        const mushroom = (parent, steps) => {
            let group = parent;
            for (const step of steps) {
                const next = new Group();
                if (step.t) next.position.set(...step.t);
                if (step.ry !== undefined) next.rotation.y = step.ry * DEG;
                if (step.s) next.scale.set(...step.s);
                group.add(next);
                group = next;
            }
            // scale(-1, -1, 1), translate(-0.5): the ItemView-content is already at -0.5
            const flip = new Group();
            flip.scale.set(-1, -1, 1);
            group.add(flip);
            const view = new ItemView(itemCache, "none");
            flip.add(view);
            this.blocks.push({view, role: "mushroom"});
        };
        mushroom(this.offset, [{t: [0.2, -0.35, 0.5]}, {ry: -48}]);
        mushroom(this.offset, [{t: [0.2, -0.35, 0.5]}, {ry: 42}, {t: [0.1, 0, -0.6]}, {ry: -48}]);
        // on the head: head.rotate (pixels), then in blocks
        const headBone = this.layerViews[0].bones.get("head");
        if (headBone) {
            const blocks = new Group();
            blocks.scale.setScalar(16);
            headBone.add(blocks);
            mushroom(blocks, [{t: [0, -0.7, -0.2]}, {ry: -78}]);
        }
    }

    /**
     * vanilla EndermanBlockFeatureRenderer (1.21): the carried block in front of the enderman.
     * @private
     */
    createCarriedBlock(itemCache) {
        const a = new Group();
        a.position.set(0, 0.6875, -0.75);
        const b = new Group();
        b.rotation.set(20 * DEG, 45 * DEG, 0, "XYZ");
        const c = new Group();
        c.position.set(0.25, 0.1875, 0.25);
        const d = new Group();
        d.scale.set(-0.5, -0.5, 0.5);
        const e = new Group();
        e.rotation.y = 90 * DEG;
        this.offset.add(a);
        a.add(b);
        b.add(c);
        c.add(d);
        d.add(e);
        const view = new BlockModelView(itemCache);
        e.add(view);
        this.blocks.push({view, role: "carried"});
    }

    /** @private */
    updateBlocks() {
        const model = this.mob.models && this.mob.models[0] || null;
        for (const {view, role} of this.blocks) {
            if (role === "mushroom") {
                const shown = !!model && !this.mob.baby && this.visible;
                view.update(shown ? model : null, {});
                view.visible = shown;
            } else {
                const shown = !!model && this.mob.flags.has("carrying") && this.visible;
                view.update(shown ? model : null);
            }
        }
    }

    /**
     * vanilla HeldItemFeatureRenderer for biped models: arm.rotate -> rotate x -90°, y 180° -> translate
     * (+-1/16, 2/16, -10/16) -> the item (display-transformation). In the model-space of the root (pixels).
     * @private
     */
    createItemSlot(side, itemCache) {
        const anchor = new Group();
        anchor.name = side + "-item-anchor";
        anchor.rotation.order = "ZYX";
        this.bodyGroup.add(anchor);

        const blocks = new Group();
        blocks.scale.setScalar(16);
        anchor.add(blocks);

        const hand = new Group();
        hand.rotation.set(-Math.PI / 2, Math.PI, 0, "XYZ");
        blocks.add(hand);

        const offset = new Group();
        offset.position.set((side === "left" ? -1 : 1) / 16, 0.125, -0.625);
        hand.add(offset);

        const view = new ItemView(itemCache, side);
        view.anchor = anchor;
        offset.add(view);
        return view;
    }

    /** @private */
    updateItems() {
        const items = this.items;
        const state = {
            leftHanded: items.leftHanded, mainHand: items.mainHand, offHand: items.offHand,
            fishing: false, use: null, useTicks: 0, swinging: false,
        };
        for (const side of ["right", "left"]) {
            const slot = this.itemSlots[side];
            const isMainHand = (side === "left") === items.leftHanded;
            const item = isMainHand ? items.mainHand : items.offHand;
            const arm = this.transforms[side === "right" ? "right_arm" : "left_arm"];
            // vanilla SkeletonEntityModel.setArmAngle: the thin arms hold the item 1 px further outside
            const shift = this.mobType.slimArms ? (side === "right" ? 1 : -1) : 0;
            slot.anchor.position.set(arm.pivotX + shift, arm.pivotY, arm.pivotZ);
            slot.anchor.rotation.set(arm.pitch, arm.yaw, arm.roll);
            slot.anchor.visible = this.visible;
            slot.update(item ? item.id : null, itemPredicates(state, isMainHand));
        }
    }

    dispose() {
        for (const {view} of this.blocks) view.dispose();
        if (this.armor) this.armor.dispose();
        if (this.itemSlots) {
            this.itemSlots.right.dispose();
            this.itemSlots.left.dispose();
        }
        this.asset.listeners.delete(this.onAssetChanged);
        this.assetCache.release(this.asset);
        this.asset = null;
        this.clear();
    }

}
