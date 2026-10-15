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
import com.google.gson.JsonParser;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.Base64;

import static org.junit.jupiter.api.Assertions.*;

public class MojangSkinProviderTest {

    /** builds a profile-json like the mojang session-server returns it */
    private static JsonElement profile(String texturesJson) {
        String value = Base64.getEncoder().encodeToString(texturesJson.getBytes(StandardCharsets.UTF_8));
        return JsonParser.parseString("""
                {"id":"069a79f444e94726a5befca90e38aaf5","name":"Notch",
                 "properties":[{"name":"textures","value":"%s"}]}
                """.formatted(value));
    }

    @Test
    public void testClassicSkinHasNoMetadata() throws IOException {
        MojangSkinProvider.TextureInfo info = MojangSkinProvider.readTextureInfo(profile("""
                {"timestamp":1,"profileId":"069a79f444e94726a5befca90e38aaf5","profileName":"Notch",
                 "textures":{"SKIN":{"url":"http://textures.minecraft.net/texture/abc"}}}
                """));
        assertEquals("http://textures.minecraft.net/texture/abc", info.url());
        assertEquals(SkinModel.CLASSIC, info.model());
    }

    @Test
    public void testSlimSkin() throws IOException {
        MojangSkinProvider.TextureInfo info = MojangSkinProvider.readTextureInfo(profile("""
                {"textures":{"SKIN":{"url":"http://textures.minecraft.net/texture/def","metadata":{"model":"slim"}},
                             "CAPE":{"url":"http://textures.minecraft.net/texture/cape"}}}
                """));
        assertEquals("http://textures.minecraft.net/texture/def", info.url());
        assertEquals(SkinModel.SLIM, info.model());
    }

    @Test
    public void testUnknownModelFallsBackToClassic() throws IOException {
        MojangSkinProvider.TextureInfo info = MojangSkinProvider.readTextureInfo(profile("""
                {"textures":{"SKIN":{"url":"http://x/y","metadata":{"model":"something-new"}}}}
                """));
        assertEquals(SkinModel.CLASSIC, info.model());
    }

    @Test
    public void testInvalidProfiles() {
        // profile without skin (default skin)
        assertThrows(IOException.class, () -> MojangSkinProvider.readTextureInfo(profile("{\"textures\":{}}")));
        // no textures-property
        assertThrows(IOException.class, () -> MojangSkinProvider.readTextureInfo(JsonParser.parseString(
                "{\"id\":\"x\",\"properties\":[{\"name\":\"other\",\"value\":\"e30=\"}]}")));
        // no properties / empty response / wrong types
        assertThrows(IOException.class, () -> MojangSkinProvider.readTextureInfo(JsonParser.parseString("{\"id\":\"x\"}")));
        assertThrows(IOException.class, () -> MojangSkinProvider.readTextureInfo(JsonParser.parseString("")));
        assertThrows(IOException.class, () -> MojangSkinProvider.readTextureInfo(JsonParser.parseString("[1,2]")));
        // value is not base64 / not json
        assertThrows(IOException.class, () -> MojangSkinProvider.readTextureInfo(JsonParser.parseString(
                "{\"properties\":[{\"name\":\"textures\",\"value\":\"%%%\"}]}")));
        assertThrows(IOException.class, () -> MojangSkinProvider.readTextureInfo(profile("not json")));
    }

}
