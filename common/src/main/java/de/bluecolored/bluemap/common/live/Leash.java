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
package de.bluecolored.bluemap.common.live;

import com.flowpowered.math.vector.Vector3d;
import org.jetbrains.annotations.Nullable;

import java.util.UUID;

/**
 * The leash of a mob or boat (vanilla EntityRenderer.renderLeash), so the webapp draws the rope between the drawn
 * entity and the drawn holder. Both ends are taken in the same tick and given in the frame of their entity
 * (see {@link Vehicle#toLocal}, relative to the drawn yaw), so they follow the separately interpolated entities.
 *
 * @param holderEntity the entity-id of the holder (mob, boat, leash-knot), or null if the holder is a player
 * @param holderPlayer the uuid of the holding player, or null
 * @param start the end at the leashed entity (vanilla getLeashOffset, turned by its yaw), relative to its position
 * @param end the end at the holder (vanilla getLeashPos, e.g. the hand of a player), relative to its position
 */
public record Leash(@Nullable Integer holderEntity, @Nullable UUID holderPlayer, Vector3d start, Vector3d end) {}
