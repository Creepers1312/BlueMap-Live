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

import de.bluecolored.bluemap.api.plugin.PlayerIconFactory;
import de.bluecolored.bluemap.api.plugin.SkinProvider;
import de.bluecolored.bluemap.common.BlueMapService;
import de.bluecolored.bluemap.common.plugin.Plugin;
import de.bluecolored.bluemap.common.serverinterface.ServerEventListener;
import de.bluecolored.bluemap.core.BlueMap;
import de.bluecolored.bluemap.core.logger.Logger;
import de.bluecolored.bluemap.core.map.BmMap;
import de.bluecolored.bluemap.core.storage.MapStorage;
import de.bluecolored.bluemap.core.storage.compression.CompressedInputStream;
import org.jetbrains.annotations.Nullable;

import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.*;
import java.util.function.BooleanSupplier;
import java.util.function.Supplier;

/**
 * Loads the skins of joining players and writes them into the asset-storage of all maps:
 * <ul>
 *     <li><code>playerheads/&lt;uuid&gt;.png</code> – the head-icon for the player-markers (unchanged)</li>
 *     <li><code>playerskins/&lt;uuid&gt;.png</code> – the full skin, normalized to 64x64</li>
 *     <li><code>playerskins/&lt;uuid&gt;.json</code> – model-variant and version of the full skin</li>
 * </ul>
 * Skins are downloaded at most once per hour per player, and only if <code>skin-download</code> is enabled.
 */
public class PlayerSkinUpdater implements ServerEventListener {

    private static final long UPDATE_INTERVAL_MILLIS = TimeUnit.HOURS.toMillis(1);

    private final Supplier<Collection<MapStorage>> storages;
    private final BooleanSupplier skinDownloadEnabled;
    private final Executor executor;

    private final Map<UUID, Long> skinUpdates;
    private final Map<UUID, SkinInfo> skinInfos;
    private final Set<UUID> storedInfoRequested;

    private SkinProvider skinProvider;
    private PlayerIconFactory playerMarkerIconFactory;

    public PlayerSkinUpdater(Plugin plugin) {
        this(
                () -> {
                    BlueMapService blueMap = plugin.getBlueMap();
                    if (blueMap == null) return null;
                    Map<String, BmMap> maps = blueMap.getMaps();
                    if (maps == null) return null;
                    return maps.values().stream().map(BmMap::getStorage).toList();
                },
                () -> {
                    BlueMapService blueMap = plugin.getBlueMap();
                    return blueMap != null && blueMap.getConfig().getPluginConfig().isSkinDownload();
                },
                BlueMap.THREAD_POOL
        );
    }

    /**
     * @param storages supplies the storages of all maps the skins should be written to, returns null if not ready
     * @param skinDownloadEnabled if false, no skins are downloaded, only already stored skin-infos are used
     * @param executor the executor for the (blocking) download and storage operations
     */
    PlayerSkinUpdater(Supplier<Collection<MapStorage>> storages, BooleanSupplier skinDownloadEnabled, Executor executor) {
        this.storages = storages;
        this.skinDownloadEnabled = skinDownloadEnabled;
        this.executor = executor;

        this.skinUpdates = new ConcurrentHashMap<>();
        this.skinInfos = new ConcurrentHashMap<>();
        this.storedInfoRequested = ConcurrentHashMap.newKeySet();

        skinProvider = new MojangSkinProvider();
        playerMarkerIconFactory = new DefaultPlayerIconFactory();
    }

    public CompletableFuture<Void> updateSkin(final UUID playerUuid) {

        // skin-download disabled: never download anything, just use what is already stored
        if (!skinDownloadEnabled.getAsBoolean()) {
            return loadStoredSkinInfo(playerUuid);
        }

        // only update if last update was longer then an hour ago
        long lastUpdate = skinUpdates.getOrDefault(playerUuid, 0L);
        long now = System.currentTimeMillis();
        if (now - lastUpdate < UPDATE_INTERVAL_MILLIS) return CompletableFuture.completedFuture(null);
        skinUpdates.put(playerUuid, now);

        // do the update async
        return CompletableFuture.supplyAsync(() -> {
            try {
                return loadSkin(playerUuid);
            } catch (IOException e) {
                throw new CompletionException("The skin provider threw an exception while loading the skin for UUID: '" + playerUuid + "'!", e);
            }
        }, executor).thenAcceptAsync(skin -> {
            if (skin.isEmpty()) {
                Logger.global.logDebug("No player-skin provided for UUID: " + playerUuid);
                return;
            }

            Collection<MapStorage> mapStorages = storages.get();
            if (mapStorages == null) {
                Logger.global.logDebug("Could not update skin, since the plugin seems not to be ready.");
                return;
            }

            writeSkin(playerUuid, skin.get(), mapStorages);
        }, executor);
    }

    /**
     * Returns the info about the stored full skin of the player, or null if it is not (yet) known.
     * <p>If the info is not known yet (e.g. after a restart, a reload, or with disabled skin-download),
     * it is loaded asynchronously from the storage, so a later call can return it.</p>
     */
    public @Nullable SkinInfo getSkinInfo(UUID playerUuid) {
        SkinInfo info = skinInfos.get(playerUuid);
        if (info == null && storedInfoRequested.add(playerUuid)) {
            loadStoredSkinInfo(playerUuid).exceptionally(ex -> {
                Logger.global.logDebug("Failed to load stored skin-info for " + playerUuid + ": " + ex);
                return null;
            });
        }
        return info;
    }

    @Override
    public void onPlayerJoin(UUID playerUuid) {
        updateSkin(playerUuid).exceptionally(ex -> {
            Logger.global.logError("Failed to update player skin: " + playerUuid, ex);
            return null;
        });
    }

    public SkinProvider getSkinProvider() {
        return skinProvider;
    }

    public void setSkinProvider(SkinProvider skinProvider) {
        this.skinProvider = Objects.requireNonNull(skinProvider, "skinProvider can not be null");
    }

    public PlayerIconFactory getPlayerMarkerIconFactory() {
        return playerMarkerIconFactory;
    }

    public void setPlayerMarkerIconFactory(PlayerIconFactory playerMarkerIconFactory) {
        this.playerMarkerIconFactory = Objects.requireNonNull(playerMarkerIconFactory, "playerMarkerIconFactory can not be null");
    }

    public static String skinAssetName(UUID playerUuid) {
        return "playerskins/" + playerUuid + ".png";
    }

    public static String skinInfoAssetName(UUID playerUuid) {
        return "playerskins/" + playerUuid + ".json";
    }

    public static String headAssetName(UUID playerUuid) {
        return "playerheads/" + playerUuid + ".png";
    }

    private record LoadedSkin(BufferedImage image, @Nullable SkinModel model) {}

    private Optional<LoadedSkin> loadSkin(UUID playerUuid) throws IOException {
        SkinProvider provider = this.skinProvider;

        // the mojang-provider knows the model-variant, other (custom) providers only provide the image
        if (provider instanceof MojangSkinProvider mojangSkinProvider) {
            return mojangSkinProvider.loadSkin(playerUuid)
                    .map(skin -> new LoadedSkin(skin.image(), skin.model()));
        }

        return provider.load(playerUuid)
                .map(image -> new LoadedSkin(image, null));
    }

    private void writeSkin(UUID playerUuid, LoadedSkin skin, Collection<MapStorage> mapStorages) {

        // head-icon (unchanged behaviour)
        BufferedImage playerHead = playerMarkerIconFactory.apply(playerUuid, skin.image());
        for (MapStorage storage : mapStorages) {
            try (OutputStream out = storage.asset(headAssetName(playerUuid)).write()) {
                ImageIO.write(playerHead, "png", out);
            } catch (IOException ex) {
                Logger.global.logError("Failed to write player skin to storage: " + playerUuid, ex);
            }
        }

        // full skin
        if (!SkinUtil.isSupportedFormat(skin.image())) {
            Logger.global.logDebug("Skin of player " + playerUuid + " has an unsupported size (" +
                    skin.image().getWidth() + "x" + skin.image().getHeight() + "), only the head-icon is stored.");
            return;
        }

        BufferedImage normalized = SkinUtil.normalize(skin.image());
        SkinModel model = skin.model() != null ? skin.model() : SkinUtil.inferModel(normalized);
        SkinInfo info = new SkinInfo(model, SkinUtil.version(normalized));

        boolean written = false;
        for (MapStorage storage : mapStorages) {
            try {
                // write the image first, the info-file marks the skin as available
                try (OutputStream out = storage.asset(skinAssetName(playerUuid)).write()) {
                    ImageIO.write(normalized, "png", out);
                }
                try (OutputStream out = storage.asset(skinInfoAssetName(playerUuid)).write()) {
                    out.write(info.toJson().getBytes(StandardCharsets.UTF_8));
                }
                written = true;
            } catch (IOException ex) {
                Logger.global.logError("Failed to write full player skin to storage: " + playerUuid, ex);
            }
        }

        if (written) skinInfos.put(playerUuid, info);
    }

    /**
     * Loads the skin-info of a previously stored skin from the first storage that has one. Does no network requests.
     */
    private CompletableFuture<Void> loadStoredSkinInfo(UUID playerUuid) {
        return CompletableFuture.runAsync(() -> {
            Collection<MapStorage> mapStorages = storages.get();
            if (mapStorages == null) return;

            for (MapStorage storage : mapStorages) {
                try {
                    CompressedInputStream compressed = storage.asset(skinInfoAssetName(playerUuid)).read();
                    if (compressed == null) continue;

                    SkinInfo info;
                    try (InputStream in = compressed.decompress()) {
                        info = SkinInfo.fromJson(new String(in.readNBytes(4096), StandardCharsets.UTF_8));
                    }
                    if (info == null) continue;

                    skinInfos.putIfAbsent(playerUuid, info);
                    return;
                } catch (IOException ex) {
                    Logger.global.logDebug("Failed to read stored skin-info for " + playerUuid + ": " + ex);
                }
            }
        }, executor);
    }

}
