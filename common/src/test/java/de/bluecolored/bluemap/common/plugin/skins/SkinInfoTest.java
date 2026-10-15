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

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

public class SkinInfoTest {

    @Test
    public void testJsonRoundTrip() {
        SkinInfo info = new SkinInfo(SkinModel.SLIM, "0123456789abcdef");
        assertEquals(info, SkinInfo.fromJson(info.toJson()));
        assertEquals(new SkinInfo(SkinModel.CLASSIC, "ab"), SkinInfo.fromJson("{\"model\":\"classic\",\"version\":\"ab\"}"));
    }

    @Test
    public void testInvalidJson() {
        assertNull(SkinInfo.fromJson(null));
        assertNull(SkinInfo.fromJson(""));
        assertNull(SkinInfo.fromJson("not json {"));
        assertNull(SkinInfo.fromJson("[]"));
        assertNull(SkinInfo.fromJson("{}"));
        assertNull(SkinInfo.fromJson("{\"model\":\"giant\",\"version\":\"ab\"}"));
        assertNull(SkinInfo.fromJson("{\"model\":\"slim\"}"));
        assertNull(SkinInfo.fromJson("{\"model\":\"slim\",\"version\":\"../../etc\"}"));
        assertNull(SkinInfo.fromJson("{\"model\":{},\"version\":\"ab\"}"));
    }

    @Test
    public void testInvalidVersionIsRejected() {
        assertThrows(IllegalArgumentException.class, () -> new SkinInfo(SkinModel.SLIM, "XYZ"));
        assertThrows(IllegalArgumentException.class, () -> new SkinInfo(SkinModel.SLIM, ""));
        assertThrows(NullPointerException.class, () -> new SkinInfo(null, "ab"));
    }

    @Test
    public void testModelIds() {
        assertEquals("classic", SkinModel.CLASSIC.getId());
        assertEquals("slim", SkinModel.SLIM.getId());
        assertEquals(SkinModel.SLIM, SkinModel.fromId("slim"));
        assertNull(SkinModel.fromId("SLIM"));
        assertNull(SkinModel.fromId(null));
    }

}
