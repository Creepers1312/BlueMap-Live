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
import de.bluecolored.bluemap.core.resources.pack.Pack;
import org.jetbrains.annotations.Nullable;

import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Stream;

/**
 * The model-jsons and the (item-relevant) textures of the resource-packs, read once from the same pack-roots
 * (and with the same priority: the first root that has a resource wins) that BlueMap uses to render the maps.
 * <p>BlueMap itself does not keep the display-transformations, overrides and item-textures, so they are read here.
 * Only the raw files are kept in memory (model-jsons and the pngs of item/block textures, a few MB for vanilla).</p>
 */
public class ItemResourceIndex implements ItemModelBaker.Resources {

    /** texture-folders of the minecraft namespace that are never used by item-models */
    private static final Set<String> SKIPPED_TEXTURE_FOLDERS = Set.of(
            "gui", "environment", "painting", "particle", "font", "map", "mob_effect", "trims", "colormap",
            "effect", "models", "misc"
    );

    private final Map<String, String> models = new HashMap<>();
    private final Map<String, byte[]> textures = new HashMap<>();

    /**
     * @param pack used to traverse the roots like BlueMap does (zip-files, nested mod-jars, overlays)
     * @param roots the pack-roots in priority-order (highest first)
     */
    public static ItemResourceIndex load(Pack pack, Iterable<Path> roots) throws IOException, InterruptedException {
        ItemResourceIndex index = new ItemResourceIndex();
        for (Path root : roots) {
            pack.loadResourcePath(root, index::loadRoot);
        }
        return index;
    }

    /** for tests */
    ItemResourceIndex() {}

    void putModel(String key, String json) {
        models.putIfAbsent(key, json);
    }

    void putTexture(String key, byte[] png) {
        textures.putIfAbsent(key, png);
    }

    private void loadRoot(Path root) {
        try (Stream<Path> namespaces = Pack.list(root.resolve("assets"))) {
            namespaces.filter(Files::isDirectory).forEach(namespaceRoot -> {
                String namespace = namespaceRoot.getFileName().toString().replace("/", "");

                Path modelsRoot = namespaceRoot.resolve("models");
                try (Stream<Path> files = Pack.walk(modelsRoot)) {
                    files.filter(file -> file.getFileName().toString().endsWith(".json"))
                            .filter(Files::isRegularFile)
                            .forEach(file -> {
                                String key = namespace + ":" + relativeKey(modelsRoot, file, ".json");
                                if (models.containsKey(key)) return;
                                try {
                                    models.put(key, Files.readString(file, StandardCharsets.UTF_8));
                                } catch (IOException ex) {
                                    Logger.global.logDebug("Failed to read model '" + file + "': " + ex);
                                }
                            });
                }

                Path texturesRoot = namespaceRoot.resolve("textures");
                try (Stream<Path> files = Pack.walk(texturesRoot)) {
                    files.filter(file -> file.getFileName().toString().endsWith(".png"))
                            .filter(Files::isRegularFile)
                            .forEach(file -> {
                                String value = relativeKey(texturesRoot, file, ".png");
                                if (!isItemRelevantTexture(namespace, value)) return;
                                String key = namespace + ":" + value;
                                if (textures.containsKey(key)) return;
                                try {
                                    textures.put(key, Files.readAllBytes(file));
                                } catch (IOException ex) {
                                    Logger.global.logDebug("Failed to read texture '" + file + "': " + ex);
                                }
                            });
                }
            });
        }
    }

    static boolean isItemRelevantTexture(String namespace, String value) {
        if (!namespace.equals("minecraft")) return true;
        if (value.startsWith("entity/")) return true; // shield, projectiles and the mob-textures
        int slash = value.indexOf('/');
        return slash < 0 || !SKIPPED_TEXTURE_FOLDERS.contains(value.substring(0, slash));
    }

    private static String relativeKey(Path root, Path file, String extension) {
        StringBuilder key = new StringBuilder();
        for (Path part : root.relativize(file)) {
            if (!key.isEmpty()) key.append('/');
            key.append(part.toString().replace("/", ""));
        }
        String value = key.toString();
        return value.substring(0, value.length() - extension.length());
    }

    @Override
    public @Nullable String modelJson(String key) {
        return models.get(key);
    }

    @Override
    public @Nullable BufferedImage texture(String key) {
        byte[] png = textures.get(key);
        if (png == null) return null;
        try {
            BufferedImage image = ImageIO.read(new ByteArrayInputStream(png));
            if (image == null) return null;

            // animated textures are vertical strips of square frames: use the first frame (entity-textures are never animated)
            int w = image.getWidth(), h = image.getHeight();
            if (h > w && h % w == 0 && !key.contains(":entity/")) image = image.getSubimage(0, 0, w, w);

            // always 32-bit ARGB, so the alpha-channel can be read the same way for all images
            BufferedImage argb = new BufferedImage(image.getWidth(), image.getHeight(), BufferedImage.TYPE_INT_ARGB);
            argb.getGraphics().drawImage(image, 0, 0, null);
            return argb;
        } catch (IOException | RuntimeException ex) {
            Logger.global.logDebug("Failed to read texture '" + key + "': " + ex);
            return null;
        }
    }

    @Override
    public List<String> textureKeys(String folder) {
        return textures.keySet().stream().filter(key -> key.startsWith(folder)).sorted().toList();
    }

    public int getModelCount() {
        return models.size();
    }

    public int getTextureCount() {
        return textures.size();
    }

}
