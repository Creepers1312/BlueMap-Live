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

import java.awt.image.BufferedImage;

import static org.junit.jupiter.api.Assertions.*;

public class SkinUtilTest {

    /** a unique opaque color for every pixel, so copied pixels can be traced back to their source */
    private static int sourceColor(int x, int y) {
        return 0xFF000000 | (x << 16) | (y << 8) | 0x5A;
    }

    private static BufferedImage uniqueSkin(int width, int height) {
        BufferedImage image = new BufferedImage(width, height, BufferedImage.TYPE_INT_ARGB);
        for (int y = 0; y < height; y++)
            for (int x = 0; x < width; x++)
                image.setRGB(x, y, sourceColor(x, y));
        return image;
    }

    private static BufferedImage filled(int width, int height, int argb) {
        BufferedImage image = new BufferedImage(width, height, BufferedImage.TYPE_INT_ARGB);
        for (int y = 0; y < height; y++)
            for (int x = 0; x < width; x++)
                image.setRGB(x, y, argb);
        return image;
    }

    @Test
    public void testSupportedFormats() {
        assertTrue(SkinUtil.isSupportedFormat(new BufferedImage(64, 64, BufferedImage.TYPE_INT_ARGB)));
        assertTrue(SkinUtil.isSupportedFormat(new BufferedImage(64, 32, BufferedImage.TYPE_INT_ARGB)));
        assertFalse(SkinUtil.isSupportedFormat(new BufferedImage(128, 128, BufferedImage.TYPE_INT_ARGB)));
        assertFalse(SkinUtil.isSupportedFormat(new BufferedImage(32, 32, BufferedImage.TYPE_INT_ARGB)));
        assertFalse(SkinUtil.isSupportedFormat(new BufferedImage(64, 48, BufferedImage.TYPE_INT_ARGB)));

        assertThrows(IllegalArgumentException.class, () -> SkinUtil.normalize(new BufferedImage(16, 16, BufferedImage.TYPE_INT_ARGB)));
    }

    @Test
    public void testModernSkinIsCopiedUnchanged() {
        BufferedImage skin = uniqueSkin(64, 64);
        skin.setRGB(40, 8, 0x00000000); // a transparent overlay pixel must stay transparent
        BufferedImage normalized = SkinUtil.normalize(skin);

        assertNotSame(skin, normalized);
        assertEquals(64, normalized.getWidth());
        assertEquals(64, normalized.getHeight());
        for (int y = 0; y < 64; y++)
            for (int x = 0; x < 64; x++)
                assertEquals(skin.getRGB(x, y), normalized.getRGB(x, y), "pixel " + x + "," + y);
    }

    @Test
    public void testNormalizeConvertsToArgb() {
        BufferedImage rgb = new BufferedImage(64, 64, BufferedImage.TYPE_INT_RGB);
        rgb.setRGB(3, 4, 0x123456);
        BufferedImage normalized = SkinUtil.normalize(rgb);
        assertEquals(BufferedImage.TYPE_INT_ARGB, normalized.getType());
        assertEquals(0xFF123456, normalized.getRGB(3, 4));
    }

    @Test
    public void testLegacySkinKeepsExistingPixels() {
        BufferedImage legacy = uniqueSkin(64, 32);
        BufferedImage normalized = SkinUtil.normalize(legacy);

        assertEquals(64, normalized.getHeight());
        // the hat-area of this test-skin is fully opaque -> treated as unused, everything else unchanged
        for (int y = 0; y < 32; y++) {
            for (int x = 0; x < 64; x++) {
                boolean hat = x >= 32 && y < 16;
                assertEquals(hat ? 0 : legacy.getRGB(x, y), normalized.getRGB(x, y), "pixel " + x + "," + y);
            }
        }
    }

    @Test
    public void testLegacySkinMirrorsRightArmAndLeg() {
        BufferedImage normalized = SkinUtil.normalize(uniqueSkin(64, 32));

        // { sourceX, sourceY, width, height, targetX, targetY }
        int[][] regions = {
                { 4, 16, 4, 4, 20, 48 }, { 8, 16, 4, 4, 24, 48 },
                { 0, 20, 4, 12, 24, 52 }, { 4, 20, 4, 12, 20, 52 }, { 8, 20, 4, 12, 16, 52 }, { 12, 20, 4, 12, 28, 52 },
                { 44, 16, 4, 4, 36, 48 }, { 48, 16, 4, 4, 40, 48 },
                { 40, 20, 4, 12, 40, 52 }, { 44, 20, 4, 12, 36, 52 }, { 48, 20, 4, 12, 32, 52 }, { 52, 20, 4, 12, 44, 52 },
        };
        for (int[] r : regions) {
            for (int y = 0; y < r[3]; y++) {
                for (int x = 0; x < r[2]; x++) {
                    int expected = sourceColor(r[0] + x, r[1] + y);
                    int actual = normalized.getRGB(r[4] + r[2] - 1 - x, r[5] + y);
                    assertEquals(expected, actual, "mirrored copy of " + (r[0] + x) + "," + (r[1] + y));
                }
            }
        }
    }

    @Test
    public void testLegacySkinHasNoInventedSecondLayer() {
        BufferedImage normalized = SkinUtil.normalize(uniqueSkin(64, 32));

        // second-layer areas of body, arms and legs (did not exist in the legacy format) stay fully transparent
        int[][] secondLayers = {
                { 0, 32, 16, 16 },  // right leg layer 2
                { 16, 32, 24, 16 }, // body layer 2
                { 40, 32, 16, 16 }, // right arm layer 2
                { 0, 48, 16, 16 },  // left leg layer 2
                { 48, 48, 16, 16 }, // left arm layer 2
        };
        for (int[] r : secondLayers)
            for (int y = r[1]; y < r[1] + r[3]; y++)
                for (int x = r[0]; x < r[0] + r[2]; x++)
                    assertEquals(0, normalized.getRGB(x, y) >>> 24, "alpha at " + x + "," + y);
    }

    @Test
    public void testLegacyTransparentHatIsKept() {
        BufferedImage legacy = uniqueSkin(64, 32);
        legacy.setRGB(40, 8, 0x00000000); // the hat-layer is used (has transparency) -> must be kept
        BufferedImage normalized = SkinUtil.normalize(legacy);
        assertEquals(legacy.getRGB(41, 8), normalized.getRGB(41, 8));
        assertEquals(legacy.getRGB(56, 12), normalized.getRGB(56, 12));
    }

    @Test
    public void testInferModel() {
        BufferedImage classic = uniqueSkin(64, 64);
        assertEquals(SkinModel.CLASSIC, SkinUtil.inferModel(classic));

        BufferedImage slim = uniqueSkin(64, 64);
        slim.setRGB(55, 25, 0x00000000); // unused area of slim right arm
        assertEquals(SkinModel.SLIM, SkinUtil.inferModel(slim));

        assertEquals(SkinModel.SLIM, SkinUtil.inferModel(filled(64, 64, 0xFF000000)), "all unused areas black");
        assertEquals(SkinModel.SLIM, SkinUtil.inferModel(filled(64, 64, 0xFFFFFFFF)), "all unused areas white");
        assertEquals(SkinModel.CLASSIC, SkinUtil.inferModel(new BufferedImage(64, 32, BufferedImage.TYPE_INT_ARGB)), "non-normalized -> fallback");

        // converted legacy skins are classic (the slim model did not exist back then)
        assertEquals(SkinModel.CLASSIC, SkinUtil.inferModel(SkinUtil.normalize(uniqueSkin(64, 32))));
    }

    @Test
    public void testVersion() {
        BufferedImage a = uniqueSkin(64, 64);
        String version = SkinUtil.version(a);

        assertTrue(version.matches("[0-9a-f]{16}"), version);
        assertEquals(version, SkinUtil.version(uniqueSkin(64, 64)), "same pixels -> same version");

        BufferedImage b = uniqueSkin(64, 64);
        b.setRGB(10, 10, 0xFFFFFFFF);
        assertNotEquals(version, SkinUtil.version(b), "changed pixel -> new version");
    }

}
