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

import de.bluecolored.bluemap.core.resources.pack.Pack;
import de.bluecolored.bluemap.core.resources.pack.PackVersion;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;
import java.io.IOException;
import java.io.OutputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

import static org.junit.jupiter.api.Assertions.*;

public class ItemResourceIndexTest {

    @TempDir
    Path temp;

    private static final Pack PACK = new Pack(new PackVersion(34, 0)) {
        @Override
        public void loadResources(Iterable<Path> roots) {}
    };

    private static void png(Path file, int w, int h, int argb) throws IOException {
        BufferedImage image = new BufferedImage(w, h, BufferedImage.TYPE_INT_ARGB);
        for (int x = 0; x < w; x++) for (int y = 0; y < h; y++) image.setRGB(x, y, argb);
        Files.createDirectories(file.getParent());
        ImageIO.write(image, "png", file.toFile());
    }

    private static void text(Path file, String content) throws IOException {
        Files.createDirectories(file.getParent());
        Files.writeString(file, content);
    }

    @Test
    public void testPriorityAndZipAndAnimatedTextures() throws IOException, InterruptedException {
        // a resource-pack folder (higher priority) and a zip (like the minecraft client-jar)
        Path pack = temp.resolve("pack");
        text(pack.resolve("assets/minecraft/models/item/stick.json"), "{\"from\":\"pack\"}");
        png(pack.resolve("assets/minecraft/textures/item/stick.png"), 16, 16, 0xFFFF0000);

        Path vanillaFolder = temp.resolve("vanilla");
        text(vanillaFolder.resolve("assets/minecraft/models/item/stick.json"), "{\"from\":\"vanilla\"}");
        text(vanillaFolder.resolve("assets/minecraft/models/item/handheld.json"), "{}");
        png(vanillaFolder.resolve("assets/minecraft/textures/item/stick.png"), 16, 16, 0xFF00FF00);
        png(vanillaFolder.resolve("assets/minecraft/textures/block/sea_lantern.png"), 16, 80, 0xFF0000FF); // animated: 5 frames
        png(vanillaFolder.resolve("assets/minecraft/textures/gui/widgets.png"), 16, 16, 0xFF000000);

        Path vanillaZip = temp.resolve("client.jar");
        try (OutputStream out = Files.newOutputStream(vanillaZip); ZipOutputStream zip = new ZipOutputStream(out)) {
            try (var files = Files.walk(vanillaFolder)) {
                for (Path file : files.filter(Files::isRegularFile).toList()) {
                    zip.putNextEntry(new ZipEntry(vanillaFolder.relativize(file).toString().replace('\\', '/')));
                    zip.write(Files.readAllBytes(file));
                    zip.closeEntry();
                }
            }
        }

        ItemResourceIndex index = ItemResourceIndex.load(PACK, List.of(pack, vanillaZip));

        assertEquals("{\"from\":\"pack\"}", index.modelJson("minecraft:item/stick"), "the first root wins");
        assertEquals("{}", index.modelJson("minecraft:item/handheld"));
        assertEquals(0xFFFF0000, index.texture("minecraft:item/stick").getRGB(0, 0));

        BufferedImage animated = index.texture("minecraft:block/sea_lantern");
        assertEquals(16, animated.getWidth());
        assertEquals(16, animated.getHeight(), "first frame of an animated texture");

        assertNull(index.texture("minecraft:gui/widgets"), "textures that items never use are not kept");
        assertNull(index.modelJson("minecraft:item/missing"));
    }

}
