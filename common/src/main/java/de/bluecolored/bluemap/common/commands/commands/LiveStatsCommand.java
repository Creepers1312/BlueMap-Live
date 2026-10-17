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
package de.bluecolored.bluemap.common.commands.commands;

import de.bluecolored.bluecommands.annotations.Command;
import de.bluecolored.bluemap.common.commands.Permission;
import de.bluecolored.bluemap.common.config.PluginConfig;
import de.bluecolored.bluemap.common.live.LiveStats;
import de.bluecolored.bluemap.common.plugin.Plugin;
import lombok.RequiredArgsConstructor;
import net.kyori.adventure.text.Component;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;

import static de.bluecolored.bluemap.common.commands.TextFormat.*;
import static net.kyori.adventure.text.Component.text;

/**
 * BlueMap Live: what the live-features cost on this server in the last minute (see docs/bluemap-live/phase-11.md).
 */
@RequiredArgsConstructor
public class LiveStatsCommand {

    private final Plugin plugin;

    @Command("live-stats")
    @Permission("bluemap.live-stats")
    public Component liveStats() {
        Map<String, long[]> stats = LiveStats.snapshot();
        List<Component> lines = new ArrayList<>();

        lines.add(text("Server thread (one tick may take 50 ms):").color(BASE_COLOR));
        long[] flush = stats.getOrDefault(LiveStats.BLOCK_FLUSH_NANOS, new long[3]);
        long[] changes = stats.getOrDefault(LiveStats.BLOCK_CHANGES, new long[3]);
        long[] dropped = stats.getOrDefault(LiveStats.BLOCK_CHANGES_DROPPED, new long[3]);
        lines.add(format("  Block-changes: % per second, % not previewed (limit), % ms per tick on average, % ms at most",
                value(perSecond(changes[1])), value(Long.toString(dropped[1])), value(ms(average(flush))), value(ms(flush[2])))
                .color(BASE_COLOR));
        long[] sample = stats.getOrDefault(LiveStats.ENTITY_SAMPLE_NANOS, new long[3]);
        lines.add(format("  Entities, chests, world-time: % samples per second, % ms on average, % ms at most",
                value(perSecond(sample[0])), value(ms(average(sample))), value(ms(sample[2]))).color(BASE_COLOR));
        long tickNanos = flush[1] + sample[1];
        lines.add(format("  Together: % of the server-thread", value(String.format(Locale.ROOT, "%.2f %%",
                tickNanos / (LiveStats.WINDOW * 1e9) * 100))).color(BASE_COLOR));

        lines.add(text("Render threads (beside the game):").color(BASE_COLOR));
        long[] tiles = stats.getOrDefault(LiveStats.TILES_RENDERED, new long[3]);
        long[] lowres = stats.getOrDefault(LiveStats.LOWRES_SAVE_NANOS, new long[3]);
        lines.add(format("  Tiles rendered again: % in the last minute, immediate lowres-saves: % (% ms on average)",
                value(Long.toString(tiles[0])), value(Long.toString(lowres[0])), value(ms(average(lowres)))).color(BASE_COLOR));
        long[] assets = stats.getOrDefault(LiveStats.BLOCK_ASSET_NANOS, new long[3]);
        lines.add(format("  Block-models baked: % (% ms on average)", value(Long.toString(assets[0])), value(ms(average(assets))))
                .color(BASE_COLOR));

        lines.add(text("Webserver (per browser-request, cached):").color(BASE_COLOR));
        for (String[] json : new String[][] {{"players.json", LiveStats.PLAYERS_JSON_NANOS},
                {"entities.json", LiveStats.ENTITIES_JSON_NANOS}, {"tiles.json", LiveStats.TILES_JSON_NANOS}}) {
            long[] values = stats.getOrDefault(json[1], new long[3]);
            lines.add(format("  %: % per second, % ms on average, % ms at most", text(json[0]).color(HIGHLIGHT_COLOR),
                    value(perSecond(values[0])), value(ms(average(values))), value(ms(values[2]))).color(BASE_COLOR));
        }

        PluginConfig config = plugin.getBlueMap() != null ? plugin.getBlueMap().getConfig().getPluginConfig() : null;
        if (config != null) {
            lines.add(format("Settings: live-block-updates %, live-block-preview %, region-cooldown % s",
                    value(Boolean.toString(config.isLiveBlockUpdates())), value(Boolean.toString(config.isLiveBlockPreviewEnabled())),
                    value(Long.toString(config.getEffectiveUpdateCooldown().toSeconds()))).color(BASE_COLOR));
        }
        return paragraph("BlueMap Live - last minute", lines(lines));
    }

    private static Component value(String value) {
        return text(value).color(HIGHLIGHT_COLOR);
    }

    private static long average(long[] values) {
        return values[0] > 0 ? values[1] / values[0] : 0;
    }

    private static String ms(long nanos) {
        return String.format(Locale.ROOT, "%.3f", nanos / 1e6);
    }

    private static String perSecond(long count) {
        return String.format(Locale.ROOT, "%.1f", count / (double) LiveStats.WINDOW);
    }

}
