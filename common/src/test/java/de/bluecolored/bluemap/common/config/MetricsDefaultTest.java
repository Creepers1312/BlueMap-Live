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

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;

import static org.junit.jupiter.api.Assertions.*;

/**
 * BlueMap Live disables the metrics-reports to the original projects server by default,
 * but explicit configurations must still be respected.
 */
public class MetricsDefaultTest {

    private static BlueMapConfigManager load(Path root, boolean useMetricsConfig) throws Exception {
        return BlueMapConfigManager.builder()
                .configRoot(root.resolve("config"))
                .minecraftVersion("1.21.1")
                .defaultDataFolder(root.resolve("data"))
                .defaultWebroot(root.resolve("web"))
                .packsFolder(root.resolve("config").resolve("packs"))
                .useMetricsConfig(useMetricsConfig)
                .build();
    }

    private static Path coreConf(Path root) {
        return root.resolve("config").resolve("core.conf");
    }

    @Test
    public void testFieldDefault() {
        // used if the key is missing in the config-file
        assertFalse(new CoreConfig().isMetrics());
    }

    @Test
    public void testNewInstallationHasMetricsDisabled(@TempDir Path root) throws Exception {
        BlueMapConfigManager config = load(root, true);

        assertFalse(config.getCoreConfig().isMetrics());
        String generated = Files.readString(coreConf(root), StandardCharsets.UTF_8);
        assertTrue(generated.contains("\nmetrics: false"), "generated core.conf contains 'metrics: false'");
        assertFalse(generated.contains("\nmetrics: true"));
    }

    @Test
    public void testNewInstallationWithoutMetricsSection(@TempDir Path root) throws Exception {
        // platforms with their own metrics-setting (e.g. sponge) get no metrics-entry in the core.conf
        BlueMapConfigManager config = load(root, false);

        assertFalse(Files.readString(coreConf(root), StandardCharsets.UTF_8).contains("metrics:"));
        assertFalse(config.getCoreConfig().isMetrics());
    }

    @Test
    public void testExistingConfigIsRespectedAndNotChanged(@TempDir Path root) throws Exception {
        Files.createDirectories(coreConf(root).getParent());

        String explicitlyEnabled = "accept-download: false\nmetrics: true\n";
        Files.writeString(coreConf(root), explicitlyEnabled, StandardCharsets.UTF_8);
        assertTrue(load(root, true).getCoreConfig().isMetrics(), "explicit metrics: true is respected");
        assertEquals(explicitlyEnabled, Files.readString(coreConf(root), StandardCharsets.UTF_8), "existing core.conf is not rewritten");

        Files.writeString(coreConf(root), "accept-download: false\nmetrics: false\n", StandardCharsets.UTF_8);
        assertFalse(load(root, true).getCoreConfig().isMetrics(), "explicit metrics: false is respected");

        Files.writeString(coreConf(root), "accept-download: false\n", StandardCharsets.UTF_8);
        assertFalse(load(root, true).getCoreConfig().isMetrics(), "missing key -> disabled");
    }

}
