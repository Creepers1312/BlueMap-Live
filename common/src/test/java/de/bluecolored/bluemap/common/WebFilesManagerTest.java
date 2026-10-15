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
package de.bluecolored.bluemap.common;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.IOException;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

import static org.junit.jupiter.api.Assertions.*;

public class WebFilesManagerTest {

    @TempDir
    Path temp;

    private Path createWebapp(String name, String indexContent) throws IOException {
        Path zip = temp.resolve(name);
        try (OutputStream out = Files.newOutputStream(zip); ZipOutputStream zipOut = new ZipOutputStream(out)) {
            zipOut.putNextEntry(new ZipEntry("index.html"));
            zipOut.write(indexContent.getBytes(StandardCharsets.UTF_8));
            zipOut.closeEntry();
        }
        return zip;
    }

    @Test
    public void testMissingFilesNeedUpdate() throws IOException {
        Path webRoot = temp.resolve("web");
        WebFilesManager manager = new WebFilesManager(webRoot, createWebapp("a.zip", "A").toUri().toURL());
        assertTrue(manager.filesNeedUpdate());

        manager.updateFiles();
        assertEquals("A", Files.readString(webRoot.resolve("index.html")));
        assertFalse(manager.filesNeedUpdate(), "same bundled web-app -> no update");
    }

    @Test
    public void testChangedWebappIsUpdated() throws IOException {
        Path webRoot = temp.resolve("web");
        new WebFilesManager(webRoot, createWebapp("a.zip", "A").toUri().toURL()).updateFiles();

        // the map-data in the webroot is not part of the web-app and must survive the update
        Path mapData = webRoot.resolve("maps/world/settings.json");
        Files.createDirectories(mapData.getParent());
        Files.writeString(mapData, "{}");

        WebFilesManager newer = new WebFilesManager(webRoot, createWebapp("b.zip", "B").toUri().toURL());
        assertTrue(newer.filesNeedUpdate(), "different bundled web-app -> update");
        newer.updateFiles();
        assertEquals("B", Files.readString(webRoot.resolve("index.html")));
        assertEquals("{}", Files.readString(mapData));
        assertFalse(newer.filesNeedUpdate());
    }

    @Test
    public void testOldInstallationWithoutHashIsUpdated() throws IOException {
        // web-app extracted by an earlier version (no hash-file)
        Path webRoot = temp.resolve("web");
        Files.createDirectories(webRoot);
        Files.writeString(webRoot.resolve("index.html"), "old");

        WebFilesManager manager = new WebFilesManager(webRoot, createWebapp("a.zip", "A").toUri().toURL());
        assertTrue(manager.filesNeedUpdate());
    }

    @Test
    public void testNoBundledWebapp() throws IOException {
        Path webRoot = temp.resolve("web");
        Files.createDirectories(webRoot);
        Files.writeString(webRoot.resolve("index.html"), "custom");

        WebFilesManager manager = new WebFilesManager(webRoot, null);
        assertFalse(manager.filesNeedUpdate(), "existing files are kept if there is nothing to compare with");
        assertThrows(IOException.class, manager::updateFiles);
    }

}
