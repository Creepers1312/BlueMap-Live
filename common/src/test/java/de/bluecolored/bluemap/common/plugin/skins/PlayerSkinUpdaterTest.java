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
package de.bluecolored.bluemap.common.plugin.skins;

import de.bluecolored.bluemap.api.plugin.SkinProvider;
import de.bluecolored.bluemap.core.storage.ItemStorage;
import de.bluecolored.bluemap.core.storage.MapStorage;
import de.bluecolored.bluemap.core.storage.compression.CompressedInputStream;
import org.junit.jupiter.api.Test;

import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.lang.reflect.Proxy;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.CompletionException;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.jupiter.api.Assertions.*;

public class PlayerSkinUpdaterTest {

    private static final UUID PLAYER = UUID.fromString("069a79f4-44e9-4726-a5be-fca90e38aaf5");

    /** in-memory asset-storage of one map */
    private static class TestStorage {
        final Map<String, byte[]> assets = new HashMap<>();

        final MapStorage mapStorage = (MapStorage) Proxy.newProxyInstance(
                MapStorage.class.getClassLoader(), new Class[]{ MapStorage.class },
                (proxy, method, args) -> switch (method.getName()) {
                    case "asset" -> item((String) args[0]);
                    case "hashCode" -> System.identityHashCode(proxy);
                    case "equals" -> proxy == args[0];
                    default -> throw new UnsupportedOperationException(method.getName());
                });

        ItemStorage item(String name) {
            return new ItemStorage() {
                @Override public OutputStream write() {
                    return new ByteArrayOutputStream() {
                        @Override public void close() throws IOException {
                            super.close();
                            assets.put(name, toByteArray());
                        }
                    };
                }
                @Override public CompressedInputStream read() {
                    byte[] data = assets.get(name);
                    return data == null ? null : new CompressedInputStream(new ByteArrayInputStream(data));
                }
                @Override public void delete() { assets.remove(name); }
                @Override public boolean exists() { return assets.containsKey(name); }
                @Override public boolean isClosed() { return false; }
            };
        }

        BufferedImage image(String name) throws IOException {
            return ImageIO.read(new ByteArrayInputStream(assets.get(name)));
        }

        String text(String name) {
            return new String(assets.get(name), StandardCharsets.UTF_8);
        }
    }

    private static class CountingProvider implements SkinProvider {
        final AtomicInteger calls = new AtomicInteger();
        Optional<BufferedImage> result;
        IOException failure;

        CountingProvider(Optional<BufferedImage> result) {
            this.result = result;
        }

        @Override
        public Optional<BufferedImage> load(UUID playerUUID) throws IOException {
            calls.incrementAndGet();
            if (failure != null) throw failure;
            return result;
        }
    }

    private static BufferedImage skin(int width, int height, int argb) {
        BufferedImage image = new BufferedImage(width, height, BufferedImage.TYPE_INT_ARGB);
        for (int y = 0; y < height; y++)
            for (int x = 0; x < width; x++)
                image.setRGB(x, y, argb);
        return image;
    }

    private static PlayerSkinUpdater updater(List<TestStorage> storages, AtomicBoolean download, SkinProvider provider) {
        PlayerSkinUpdater updater = new PlayerSkinUpdater(
                () -> storages.stream().map(s -> s.mapStorage).toList(),
                download::get,
                Runnable::run // synchronous, so the tests are deterministic
        );
        updater.setSkinProvider(provider);
        return updater;
    }

    @Test
    public void testAssetNames() {
        assertEquals("playerskins/069a79f4-44e9-4726-a5be-fca90e38aaf5.png", PlayerSkinUpdater.skinAssetName(PLAYER));
        assertEquals("playerskins/069a79f4-44e9-4726-a5be-fca90e38aaf5.json", PlayerSkinUpdater.skinInfoAssetName(PLAYER));
        assertEquals("playerheads/069a79f4-44e9-4726-a5be-fca90e38aaf5.png", PlayerSkinUpdater.headAssetName(PLAYER));
    }

    @Test
    public void testWritesHeadSkinAndInfoToAllMaps() throws Exception {
        TestStorage a = new TestStorage(), b = new TestStorage();
        CountingProvider provider = new CountingProvider(Optional.of(skin(64, 64, 0xFF336699)));
        PlayerSkinUpdater updater = updater(List.of(a, b), new AtomicBoolean(true), provider);

        updater.updateSkin(PLAYER).join();

        for (TestStorage storage : List.of(a, b)) {
            assertTrue(storage.assets.containsKey(PlayerSkinUpdater.headAssetName(PLAYER)), "head-icon still written");
            BufferedImage stored = storage.image(PlayerSkinUpdater.skinAssetName(PLAYER));
            assertEquals(64, stored.getWidth());
            assertEquals(64, stored.getHeight());
            assertEquals(0xFF336699, stored.getRGB(20, 20));

            SkinInfo info = SkinInfo.fromJson(storage.text(PlayerSkinUpdater.skinInfoAssetName(PLAYER)));
            assertNotNull(info);
            assertEquals(updater.getSkinInfo(PLAYER), info);
        }
        // a custom provider gives no model -> inferred from the image (fully opaque -> classic)
        assertEquals(SkinModel.CLASSIC, updater.getSkinInfo(PLAYER).model());
    }

    @Test
    public void testLegacySkinIsStoredAs64x64() throws Exception {
        TestStorage storage = new TestStorage();
        PlayerSkinUpdater updater = updater(List.of(storage), new AtomicBoolean(true),
                new CountingProvider(Optional.of(skin(64, 32, 0xFF112233))));

        updater.updateSkin(PLAYER).join();

        BufferedImage stored = storage.image(PlayerSkinUpdater.skinAssetName(PLAYER));
        assertEquals(64, stored.getHeight());
        assertEquals(0xFF112233, stored.getRGB(37, 52), "left arm created from the right arm");
        assertEquals(0, stored.getRGB(37, 36) >>> 24, "no invented second layer");
    }

    @Test
    public void testMojangModelIsUsed() throws Exception {
        TestStorage storage = new TestStorage();
        // looks classic (fully opaque), but the profile says slim
        BufferedImage image = skin(64, 64, 0xFF445566);
        MojangSkinProvider mojang = new MojangSkinProvider() {
            @Override
            public Optional<MojangSkin> loadSkin(UUID playerUUID) {
                return Optional.of(new MojangSkin(image, SkinModel.SLIM));
            }
        };
        PlayerSkinUpdater updater = updater(List.of(storage), new AtomicBoolean(true), mojang);

        updater.updateSkin(PLAYER).join();

        assertEquals(SkinModel.SLIM, updater.getSkinInfo(PLAYER).model());
        assertEquals(SkinModel.SLIM, SkinInfo.fromJson(storage.text(PlayerSkinUpdater.skinInfoAssetName(PLAYER))).model());
    }

    @Test
    public void testUnsupportedSizeOnlyWritesHead() {
        TestStorage storage = new TestStorage();
        PlayerSkinUpdater updater = updater(List.of(storage), new AtomicBoolean(true),
                new CountingProvider(Optional.of(skin(128, 128, 0xFF000000))));

        updater.updateSkin(PLAYER).join();

        assertTrue(storage.assets.containsKey(PlayerSkinUpdater.headAssetName(PLAYER)));
        assertFalse(storage.assets.containsKey(PlayerSkinUpdater.skinAssetName(PLAYER)));
        assertFalse(storage.assets.containsKey(PlayerSkinUpdater.skinInfoAssetName(PLAYER)));
        assertNull(updater.getSkinInfo(PLAYER));
    }

    @Test
    public void testMissingSkin() {
        TestStorage storage = new TestStorage();
        PlayerSkinUpdater updater = updater(List.of(storage), new AtomicBoolean(true), new CountingProvider(Optional.empty()));

        updater.updateSkin(PLAYER).join();

        assertTrue(storage.assets.isEmpty());
        assertNull(updater.getSkinInfo(PLAYER));
    }

    @Test
    public void testFailedDownloadDoesNotWriteAnything() {
        TestStorage storage = new TestStorage();
        CountingProvider provider = new CountingProvider(Optional.empty());
        provider.failure = new IOException("connect timed out");
        PlayerSkinUpdater updater = updater(List.of(storage), new AtomicBoolean(true), provider);

        CompletionException ex = assertThrows(CompletionException.class, () -> updater.updateSkin(PLAYER).join());
        assertInstanceOf(IOException.class, ex.getCause());
        assertTrue(storage.assets.isEmpty());
        assertNull(updater.getSkinInfo(PLAYER));

        // onPlayerJoin must swallow the failure (only logs it)
        PlayerSkinUpdater joinUpdater = updater(List.of(storage), new AtomicBoolean(true), provider);
        assertDoesNotThrow(() -> joinUpdater.onPlayerJoin(PLAYER));
        assertEquals(2, provider.calls.get());
        assertTrue(storage.assets.isEmpty());
    }

    @Test
    public void testSkinIsDownloadedAtMostOncePerHour() {
        TestStorage storage = new TestStorage();
        CountingProvider provider = new CountingProvider(Optional.of(skin(64, 64, 0xFF336699)));
        PlayerSkinUpdater updater = updater(List.of(storage), new AtomicBoolean(true), provider);

        updater.updateSkin(PLAYER).join();
        updater.updateSkin(PLAYER).join();
        updater.onPlayerJoin(PLAYER);

        assertEquals(1, provider.calls.get());
    }

    @Test
    public void testDisabledSkinDownload() throws Exception {
        TestStorage storage = new TestStorage();
        AtomicBoolean download = new AtomicBoolean(true);
        CountingProvider provider = new CountingProvider(Optional.of(skin(64, 64, 0xFF336699)));

        // a skin stored earlier (e.g. before the option was disabled)
        updater(List.of(storage), download, provider).updateSkin(PLAYER).join();
        SkinInfo stored = SkinInfo.fromJson(storage.text(PlayerSkinUpdater.skinInfoAssetName(PLAYER)));
        assertEquals(1, provider.calls.get());

        // new updater (e.g. after a restart) with disabled download
        download.set(false);
        PlayerSkinUpdater updater = updater(List.of(storage), download, provider);
        updater.onPlayerJoin(PLAYER);
        updater.updateSkin(PLAYER).join();

        assertEquals(1, provider.calls.get(), "no download with skin-download: false");
        assertEquals(stored, updater.getSkinInfo(PLAYER), "the already stored skin is still used");
    }

    @Test
    public void testStoredSkinInfoIsLoadedLazily() {
        TestStorage storage = new TestStorage();
        storage.assets.put(PlayerSkinUpdater.skinInfoAssetName(PLAYER),
                new SkinInfo(SkinModel.SLIM, "abcdef").toJson().getBytes(StandardCharsets.UTF_8));
        CountingProvider provider = new CountingProvider(Optional.empty());
        PlayerSkinUpdater updater = updater(List.of(storage), new AtomicBoolean(true), provider);

        // first lookup triggers loading from the storage (synchronous executor -> available right after)
        updater.getSkinInfo(PLAYER);
        assertEquals(new SkinInfo(SkinModel.SLIM, "abcdef"), updater.getSkinInfo(PLAYER));
        assertEquals(0, provider.calls.get(), "lookups never download");
    }

    @Test
    public void testInvalidStoredSkinInfoIsIgnored() {
        TestStorage storage = new TestStorage();
        storage.assets.put(PlayerSkinUpdater.skinInfoAssetName(PLAYER), "garbage".getBytes(StandardCharsets.UTF_8));
        PlayerSkinUpdater updater = updater(List.of(storage), new AtomicBoolean(false), new CountingProvider(Optional.empty()));

        updater.getSkinInfo(PLAYER);
        assertNull(updater.getSkinInfo(PLAYER));
    }

    @Test
    public void testNotReady() {
        CountingProvider provider = new CountingProvider(Optional.of(skin(64, 64, 0xFF336699)));
        PlayerSkinUpdater updater = new PlayerSkinUpdater(() -> null, () -> true, Runnable::run);
        updater.setSkinProvider(provider);

        assertDoesNotThrow(() -> updater.updateSkin(PLAYER).join());
        assertNull(updater.getSkinInfo(PLAYER));
    }

}
