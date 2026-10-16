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
package de.bluecolored.bluemap.common.plugin.items;

import com.google.gson.JsonParser;
import de.bluecolored.bluemap.core.storage.MapStorage;
import de.bluecolored.bluemap.core.storage.compression.Compression;
import de.bluecolored.bluemap.core.storage.file.FileMapStorage;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Collection;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

import static org.junit.jupiter.api.Assertions.*;

public class ItemAssetUpdaterTest {

    @TempDir
    Path temp;

    @Test
    public void testWritesEachItemOnceIntoAllMaps() throws Exception {
        List<MapStorage> maps = List.of(
                new FileMapStorage(temp.resolve("world"), Compression.NONE, false),
                new FileMapStorage(temp.resolve("world_the_nether"), Compression.NONE, false)
        );
        AtomicInteger loads = new AtomicInteger();
        ItemAssetUpdater updater = new ItemAssetUpdater(() -> maps, () -> {
            loads.incrementAndGet();
            return new ItemModelBakerTest.TestResources();
        }, Runnable::run);

        updater.request("minecraft:diamond_sword").join();
        updater.request("minecraft:diamond_sword").join();
        updater.request("minecraft:stone").join();
        updater.request("minecraft:../evil").join();

        assertEquals(1, loads.get(), "the resources are loaded once, when first needed");
        for (String map : List.of("world", "world_the_nether")) {
            Path sword = temp.resolve(map).resolve("assets/items/minecraft/diamond_sword.json");
            assertTrue(Files.isRegularFile(sword), map);
            assertEquals("minecraft:diamond_sword",
                    JsonParser.parseString(Files.readString(sword, StandardCharsets.UTF_8)).getAsJsonObject().get("item").getAsString());
            assertTrue(Files.isRegularFile(temp.resolve(map).resolve("assets/items/minecraft/stone.json")));
        }
        try (var files = Files.walk(temp)) {
            assertEquals(4, files.filter(Files::isRegularFile).count(), "nothing else written (no invalid item-ids)");
        }
    }

    @Test
    public void testNotReadyIsRetriedLater() throws Exception {
        MapStorage map = new FileMapStorage(temp.resolve("world"), Compression.NONE, false);
        AtomicReference<Collection<MapStorage>> storages = new AtomicReference<>(null);
        ItemAssetUpdater updater = new ItemAssetUpdater(storages::get, ItemModelBakerTest.TestResources::new, Runnable::run);

        updater.request("minecraft:apple").join();
        assertFalse(Files.exists(temp.resolve("world/assets/items/minecraft/apple.json")), "plugin not ready yet");

        storages.set(List.of(map));
        updater.request("minecraft:apple").join();
        assertTrue(Files.exists(temp.resolve("world/assets/items/minecraft/apple.json")), "written with the next request");
    }

    @Test
    public void testEntityAssets() throws Exception {
        MapStorage map = new FileMapStorage(temp.resolve("world"), Compression.NONE, false);
        ItemAssetUpdater updater = new ItemAssetUpdater(() -> List.of(map), ItemModelBakerTest.TestResources::new, Runnable::run);
        updater.requestEntity("minecraft:arrow").join();
        updater.requestEntity("minecraft:zombie").join(); // mob: its textures
        updater.requestEntity("minecraft:ender_dragon").join(); // no model in the webapp -> nothing written
        assertTrue(Files.isRegularFile(temp.resolve("world/assets/entities/minecraft/arrow.json")));
        assertTrue(Files.isRegularFile(temp.resolve("world/assets/entities/minecraft/zombie.json")));
        assertFalse(Files.exists(temp.resolve("world/assets/entities/minecraft/ender_dragon.json")));
    }

}
