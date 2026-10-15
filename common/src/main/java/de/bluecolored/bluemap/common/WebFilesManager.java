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

import com.google.gson.FieldNamingPolicy;
import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import de.bluecolored.bluemap.common.config.WebappConfig;
import de.bluecolored.bluemap.core.BlueMap;
import de.bluecolored.bluemap.core.logger.Logger;
import de.bluecolored.bluemap.core.resources.adapter.ResourcesGson;
import de.bluecolored.bluemap.core.util.FileHelper;

import java.io.*;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.file.StandardOpenOption;
import java.security.DigestInputStream;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HashSet;
import java.util.HexFormat;
import java.util.Set;

public class WebFilesManager {

    private static final Gson GSON = ResourcesGson.addAdapter(new GsonBuilder())
            .setFieldNamingPolicy(FieldNamingPolicy.IDENTITY)
            //.setPrettyPrinting() // enable pretty printing for easy editing
            .create();

    /** stores the hash of the bundled webapp the files in the webroot were extracted from */
    static final String WEBAPP_HASH_FILE = ".bluemap-webapp-hash";

    private final Path webRoot;
    private final URL bundledWebapp;
    private Settings settings;

    public WebFilesManager(Path webRoot) {
        this(webRoot, WebFilesManager.class.getResource("/de/bluecolored/bluemap/webapp.zip"));
    }

    WebFilesManager(Path webRoot, URL bundledWebapp) {
        this.webRoot = webRoot;
        this.bundledWebapp = bundledWebapp;
        this.settings = new Settings();
    }

    public Path getSettingsFile() {
        return webRoot.resolve("settings.json");
    }

    public void loadSettings() throws IOException {
        try (BufferedReader reader = Files.newBufferedReader(getSettingsFile())) {
            this.settings = GSON.fromJson(reader, Settings.class);
        }
    }

    public void saveSettings() throws IOException {
        FileHelper.createDirectories(getSettingsFile().getParent());
        try (BufferedWriter writer = Files.newBufferedWriter(getSettingsFile(),
                StandardOpenOption.CREATE, StandardOpenOption.TRUNCATE_EXISTING)) {
            GSON.toJson(this.settings, writer);
        }
    }

    public void resetSettings() {
        this.settings = new Settings();
    }

    public void addMap(String mapId) {
        this.settings.maps.add(mapId);
    }

    public void removeMap(String mapId) {
        this.settings.maps.remove(mapId);
    }

    public Set<String> getScripts() {
        return this.settings.scripts;
    }

    public Set<String> getStyles() {
        return this.settings.styles;
    }

    public void setFrom(WebappConfig webappConfig) {
        this.settings.setFrom(webappConfig);
    }

    public void addFrom(WebappConfig webappConfig) {
        this.settings.addFrom(webappConfig);
    }

    /**
     * The web-app files need an update if they are missing, or if they were extracted from a different
     * (older or newer) bundled web-app than the one of this BlueMap version.
     * Files in the webroot that are not part of the bundled web-app (e.g. the map-data) are never touched.
     */
    public boolean filesNeedUpdate() {
        if (!Files.exists(webRoot.resolve("index.html"))) return true;
        if (bundledWebapp == null) return false;

        try {
            Path hashFile = webRoot.resolve(WEBAPP_HASH_FILE);
            if (!Files.exists(hashFile)) return true;
            return !Files.readString(hashFile, StandardCharsets.UTF_8).trim().equals(bundledWebappHash());
        } catch (IOException ex) {
            Logger.global.logWarning("Failed to check if the web-app files are up to date: " + ex);
            return false;
        }
    }

    public void updateFiles() throws IOException {
        if (bundledWebapp == null) throw new IOException("Failed to open bundled webapp.");

        // extract zip to webroot
        Files.createDirectories(webRoot);
        FileHelper.extractZipFile(bundledWebapp, webRoot, StandardCopyOption.REPLACE_EXISTING);

        Files.writeString(webRoot.resolve(WEBAPP_HASH_FILE), bundledWebappHash(), StandardCharsets.UTF_8);
    }

    private String bundledWebappHash() throws IOException {
        MessageDigest digest;
        try {
            digest = MessageDigest.getInstance("SHA-256");
        } catch (NoSuchAlgorithmException ex) {
            throw new IOException(ex);
        }
        try (InputStream in = new DigestInputStream(bundledWebapp.openStream(), digest)) {
            in.transferTo(OutputStream.nullOutputStream());
        }
        return HexFormat.of().formatHex(digest.digest());
    }

    @SuppressWarnings({"FieldMayBeFinal", "FieldCanBeLocal", "unused", "MismatchedQueryAndUpdateOfCollection"})
    private static class Settings {

        private String version = BlueMap.VERSION;

        private boolean useCookies = true;

        private boolean defaultToFlatView = false;

        private String startLocation = null;

        private float resolutionDefault = 1;

        private int minZoomDistance = 5;
        private int maxZoomDistance = 100000;

        private int hiresSliderMax = 500;
        private int hiresSliderDefault = 200;
        private int hiresSliderMin = 50;

        private int lowresSliderMax = 10000;
        private int lowresSliderDefault = 2000;
        private int lowresSliderMin = 500;

        private String mapDataRoot = "maps";
        private String liveDataRoot = "maps";

        private Set<String> maps = new HashSet<>();
        private Set<String> scripts = new HashSet<>();
        private Set<String> styles = new HashSet<>();

        public void setFrom(WebappConfig config) {
            this.useCookies = config.isUseCookies();
            this.defaultToFlatView = config.isDefaultToFlatView();
            this.startLocation = config.getStartLocation().orElse(null);
            this.resolutionDefault = config.getResolutionDefault();

            this.minZoomDistance = config.getMinZoomDistance();
            this.maxZoomDistance = config.getMaxZoomDistance();

            this.hiresSliderMax = config.getHiresSliderMax();
            this.hiresSliderDefault = config.getHiresSliderDefault();
            this.hiresSliderMin = config.getHiresSliderMin();

            this.lowresSliderMax = config.getLowresSliderMax();
            this.lowresSliderDefault = config.getLowresSliderDefault();
            this.lowresSliderMin = config.getLowresSliderMin();

            this.mapDataRoot = config.getMapDataRoot();
            this.liveDataRoot = config.getLiveDataRoot();

            this.styles.clear();
            this.scripts.clear();

            addFrom(config);
        }

        public void addFrom(WebappConfig config) {
            Set<String> scripts = config.getScripts();
            for (String script : scripts) {
                this.scripts.add(script);
                Logger.global.logDebug("Registering script from Webapp Config: " + script);
            }

            Set<String> styles = config.getStyles();
            for (String style : styles) {
                this.styles.add(style);
                Logger.global.logDebug("Registering style from Webapp Config: " + style);
            }
        }

    }

}
