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

import de.bluecolored.bluemap.core.logger.Logger;
import de.bluecolored.bluemap.core.storage.MapStorage;
import org.jetbrains.annotations.Nullable;

import java.io.IOException;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.Collection;
import java.util.Set;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executor;
import java.util.function.Supplier;

/**
 * Writes the baked item-model (see {@link ItemModelBaker}) of every item that is held by a player into the
 * asset-storage of all maps (<code>assets/items/&lt;namespace&gt;/&lt;path&gt;.json</code>), once per item and
 * (re)load, when it is first needed. The webapp loads it from there like the player-skins.
 */
public class ItemAssetUpdater {

    /** protection against flooding the storage with assets (e.g. a mod with a huge amount of items) */
    static final int MAX_ITEMS = 4096;

    public interface ResourcesLoader {
        /** @return the resources, or null if they are not available (yet) */
        @Nullable ItemModelBaker.Resources load() throws Exception;
    }

    private final Supplier<Collection<MapStorage>> storages;
    private final ResourcesLoader resourcesLoader;
    private final Executor executor;

    private final Set<String> requested = ConcurrentHashMap.newKeySet();
    private @Nullable ItemModelBaker.Resources resources;

    /**
     * @param storages supplies the storages of all maps, returns null if not ready
     * @param resourcesLoader loads the resources once (on the executor), when the first item is requested
     * @param executor the executor for the (blocking) baking and storage operations
     */
    public ItemAssetUpdater(Supplier<Collection<MapStorage>> storages, ResourcesLoader resourcesLoader, Executor executor) {
        this.storages = storages;
        this.resourcesLoader = resourcesLoader;
        this.executor = executor;
    }

    public static String assetName(String itemId) {
        ItemModelBaker.Key key = ItemModelBaker.Key.parse(itemId);
        return "items/" + key.namespace() + "/" + key.path() + ".json";
    }

    /**
     * Makes sure the asset of the item exists (asynchronously). Cheap if the item was requested before.
     * Invalid item-ids are ignored.
     */
    public CompletableFuture<Void> request(String itemId) {
        if (requested.contains(itemId) || requested.size() >= MAX_ITEMS) return CompletableFuture.completedFuture(null);
        if (!ItemModelBaker.Key.isValid(itemId)) return CompletableFuture.completedFuture(null);
        if (!requested.add(itemId)) return CompletableFuture.completedFuture(null);

        return CompletableFuture.runAsync(() -> {
            try {
                if (!write(itemId)) requested.remove(itemId); // not ready yet, try again with the next request
            } catch (Exception ex) {
                Logger.global.logWarning("Failed to create the item-asset for '" + itemId + "': " + ex);
            }
        }, executor);
    }

    private boolean write(String itemId) throws Exception {
        Collection<MapStorage> mapStorages = storages.get();
        if (mapStorages == null) return false;

        ItemModelBaker.Resources resources = getResources();
        if (resources == null) return false;

        byte[] json = new ItemModelBaker(resources).bake(itemId).getBytes(StandardCharsets.UTF_8);
        String assetName = assetName(itemId);
        for (MapStorage storage : mapStorages) {
            try (OutputStream out = storage.asset(assetName).write()) {
                out.write(json);
            } catch (IOException ex) {
                Logger.global.logError("Failed to write item-asset to storage: " + itemId, ex);
            }
        }
        return true;
    }

    private synchronized @Nullable ItemModelBaker.Resources getResources() throws Exception {
        if (resources == null) resources = resourcesLoader.load();
        return resources;
    }

}
