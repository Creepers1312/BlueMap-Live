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
package de.bluecolored.bluemap.common.config;

import lombok.Getter;
import org.spongepowered.configurate.objectmapping.ConfigSerializable;

import java.time.Duration;
import java.util.ArrayList;
import java.util.List;

@SuppressWarnings({"FieldMayBeFinal", "FieldCanBeLocal"})
@ConfigSerializable
@Getter
public class PluginConfig {

    private boolean livePlayerMarkers = true;
    private int livePlayerUpdateInterval = 250;
    private boolean livePlayerExtendedData = true;

    private List<String> hiddenGameModes = new ArrayList<>();
    private boolean hideVanished = true;
    private boolean hideInvisible = true;
    private boolean hideSneaking = false;
    private boolean hideDifferentWorld = false;
    private int hideBelowSkyLight = 0;
    private int hideBelowBlockLight = 0;

    private int writeMarkersInterval = 0;
    private int writePlayersInterval = 0;

    private boolean skinDownload = true;

    private boolean liveEntities = true;
    private int liveEntitiesRadius = 30;
    private int liveEntitiesLimit = 200;
    private List<String> liveEntitiesHiddenTypes = new ArrayList<>();

    private boolean liveBlockUpdates = true;
    private int liveBlockUpdateCooldown = 10;

    private int playerRenderLimit = -1;

    private int updateCooldown = 60;
    private int fullUpdateInterval = 1440;

    /**
     * The interval in milliseconds in which player-data is sampled on the server and refreshed for the webapp.
     * Clamped to 50 (one tick) .. 10000.
     */
    public int getLivePlayerUpdateInterval() {
        return Math.max(50, Math.min(10000, livePlayerUpdateInterval));
    }

    /**
     * The radius (blocks) around the shown players in which entities are sent to the webapp. Clamped to 0 .. 128.
     */
    public int getLiveEntitiesRadius() {
        return Math.max(0, Math.min(128, liveEntitiesRadius));
    }

    /**
     * The maximum number of entities that are sent to the webapp per map (the nearest first). Clamped to 0 .. 1000.
     */
    public int getLiveEntitiesLimit() {
        return Math.max(0, Math.min(1000, liveEntitiesLimit));
    }

    /**
     * BlueMap Live: the cooldown of a region between two renders while live-block-updates are on (instead of the
     * update-cooldown if that is longer). Clamped to 1 .. 3600 seconds.
     */
    public Duration getLiveBlockUpdateCooldown() {
        return Duration.ofSeconds(Math.max(1, Math.min(3600, liveBlockUpdateCooldown)));
    }

    /** the cooldown of a region between two renders (shorter with live-block-updates) */
    public Duration getEffectiveUpdateCooldown() {
        Duration cooldown = getUpdateCooldown();
        if (liveBlockUpdates && getLiveBlockUpdateCooldown().compareTo(cooldown) < 0) return getLiveBlockUpdateCooldown();
        return cooldown;
    }

    public Duration getUpdateCooldown() {
        return Duration.ofSeconds(updateCooldown);
    }

    public Duration getFullUpdateInterval() {
        return Duration.ofMinutes(fullUpdateInterval);
    }

}
