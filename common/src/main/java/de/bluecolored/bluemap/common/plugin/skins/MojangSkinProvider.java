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

import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParseException;
import com.google.gson.JsonParser;
import de.bluecolored.bluemap.api.plugin.SkinProvider;
import de.bluecolored.bluemap.core.logger.Logger;

import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.Reader;
import java.net.URI;
import java.net.URLConnection;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.Optional;
import java.util.UUID;

public class MojangSkinProvider implements SkinProvider {

    private static final int TIMEOUT_MILLIS = 10000;

    /**
     * The skin-image together with the model-variant from the players profile.
     */
    public record MojangSkin(BufferedImage image, SkinModel model) {}

    /**
     * The skin-texture information from a players profile.
     */
    record TextureInfo(String url, SkinModel model) {}

    @Override
    public Optional<BufferedImage> load(UUID playerUUID) throws IOException {
        return loadSkin(playerUUID).map(MojangSkin::image);
    }

    /**
     * Loads the skin and the model-variant (classic/slim) of the player from the mojang session-server.
     * Returns an empty optional if the player has no skin or the skin can not be loaded.
     */
    public Optional<MojangSkin> loadSkin(UUID playerUUID) {
        try {
            TextureInfo textureInfo;
            try (Reader reader = new InputStreamReader(
                    open("https://sessionserver.mojang.com/session/minecraft/profile/" + playerUUID),
                    StandardCharsets.UTF_8
            )) {
                textureInfo = readTextureInfo(JsonParser.parseReader(reader));
            }

            BufferedImage image;
            try (InputStream in = open(textureInfo.url())) {
                image = ImageIO.read(in);
            }
            if (image == null) throw new IOException("The skin-texture is not a valid image: " + textureInfo.url());

            return Optional.of(new MojangSkin(image, textureInfo.model()));
        } catch (IOException | JsonParseException ex) {
            Logger.global.logDebug("Failed to load skin from mojang for player: '" + playerUUID + "' - " + ex);
            return Optional.empty();
        }
    }

    private InputStream open(String url) throws IOException {
        URLConnection connection = URI.create(url).toURL().openConnection();
        connection.setConnectTimeout(TIMEOUT_MILLIS);
        connection.setReadTimeout(TIMEOUT_MILLIS);
        return connection.getInputStream();
    }

    /**
     * Reads the skin-url and the model-variant from a profile-json of the mojang session-server.
     * <p>Mojang only adds <code>metadata.model = "slim"</code> for slim skins, a missing model means classic.</p>
     */
    static TextureInfo readTextureInfo(JsonElement profile) throws IOException {
        try {
            String texturesJson = null;
            for (JsonElement element : profile.getAsJsonObject().getAsJsonArray("properties")) {
                JsonObject property = element.getAsJsonObject();
                if (property.get("name").getAsString().equals("textures")) {
                    texturesJson = new String(Base64.getDecoder().decode(property.get("value").getAsString()), StandardCharsets.UTF_8);
                    break;
                }
            }
            if (texturesJson == null) throw new IOException("No texture info found!");

            JsonObject skin = JsonParser.parseString(texturesJson).getAsJsonObject()
                    .getAsJsonObject("textures")
                    .getAsJsonObject("SKIN");
            if (skin == null) throw new IOException("Profile has no skin-texture!");

            String url = skin.get("url").getAsString();

            SkinModel model = SkinModel.CLASSIC;
            JsonObject metadata = skin.getAsJsonObject("metadata");
            if (metadata != null && metadata.has("model") && "slim".equals(metadata.get("model").getAsString())) {
                model = SkinModel.SLIM;
            }

            return new TextureInfo(url, model);
        } catch (NullPointerException | IllegalStateException | ClassCastException | UnsupportedOperationException |
                 IllegalArgumentException | JsonParseException e) {
            throw new IOException("Invalid profile-json: " + e, e);
        }
    }

}
