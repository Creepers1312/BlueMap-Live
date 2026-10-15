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

import java.awt.image.BufferedImage;
import java.nio.ByteBuffer;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;

/**
 * Helper-methods for player-skin images.
 */
public final class SkinUtil {

    public static final int SKIN_SIZE = 64;

    /**
     * Regions that are copied (horizontally mirrored) from the right arm/leg to the left arm/leg when converting a
     * legacy 64x32 skin to the 64x64 format: { sourceX, sourceY, width, height, targetX, targetY }.
     * This is the same conversion Minecraft applies to legacy skins.
     */
    private static final int[][] LEGACY_COPY_REGIONS = {
            // leg: top, bottom, right(outer), front, left(inner), back
            { 4, 16, 4, 4, 20, 48 },
            { 8, 16, 4, 4, 24, 48 },
            { 0, 20, 4, 12, 24, 52 },
            { 4, 20, 4, 12, 20, 52 },
            { 8, 20, 4, 12, 16, 52 },
            { 12, 20, 4, 12, 28, 52 },
            // arm: top, bottom, right(outer), front, left(inner), back
            { 44, 16, 4, 4, 36, 48 },
            { 48, 16, 4, 4, 40, 48 },
            { 40, 20, 4, 12, 40, 52 },
            { 44, 20, 4, 12, 36, 52 },
            { 48, 20, 4, 12, 32, 52 },
            { 52, 20, 4, 12, 44, 52 },
    };

    /**
     * Areas that are only used by the classic model. On slim skins they are unused (transparent):
     * { x, y, width, height }
     */
    private static final int[][] SLIM_UNUSED_REGIONS = {
            { 50, 16, 2, 4 },
            { 54, 20, 2, 12 },
            { 42, 48, 2, 4 },
            { 46, 52, 2, 12 },
    };

    private SkinUtil() {}

    /**
     * @return true if the image has a supported skin-format (64x64, or the legacy format 64x32)
     */
    public static boolean isSupportedFormat(BufferedImage skin) {
        return skin.getWidth() == SKIN_SIZE && (skin.getHeight() == SKIN_SIZE || skin.getHeight() == SKIN_SIZE / 2);
    }

    /**
     * @return true if the image is a legacy (pre 1.8) 64x32 skin
     */
    public static boolean isLegacyFormat(BufferedImage skin) {
        return skin.getWidth() == SKIN_SIZE && skin.getHeight() == SKIN_SIZE / 2;
    }

    /**
     * Converts the skin into a new 64x64 ARGB image.
     * <p>A 64x64 skin is copied unchanged.
     * A legacy 64x32 skin is converted like Minecraft does it: the existing pixels stay at their place, the
     * left arm and left leg are created as horizontally mirrored copies of the right arm and right leg, all
     * second-layer areas that did not exist in the legacy format stay transparent. Like in Minecraft, a completely
     * opaque hat-layer of a legacy skin is treated as unused (made transparent), because many old skins filled
     * that area with a solid color.</p>
     *
     * @throws IllegalArgumentException if the image does not have a supported skin-format
     */
    public static BufferedImage normalize(BufferedImage skin) {
        if (!isSupportedFormat(skin))
            throw new IllegalArgumentException("Unsupported skin-size: " + skin.getWidth() + "x" + skin.getHeight());

        BufferedImage result = new BufferedImage(SKIN_SIZE, SKIN_SIZE, BufferedImage.TYPE_INT_ARGB);
        for (int y = 0; y < skin.getHeight(); y++) {
            for (int x = 0; x < skin.getWidth(); x++) {
                result.setRGB(x, y, skin.getRGB(x, y));
            }
        }

        if (isLegacyFormat(skin)) {
            for (int[] r : LEGACY_COPY_REGIONS) {
                copyMirrored(result, r[0], r[1], r[2], r[3], r[4], r[5]);
            }

            if (isFullyOpaque(result, 32, 0, 32, 16)) {
                clear(result, 32, 0, 32, 16);
            }
        }

        return result;
    }

    /**
     * Guesses the model-variant of a (normalized) skin, used if the skin-provider does not tell the model.
     * <p>A skin is considered slim if one of the areas that only the classic model uses contains a transparent
     * pixel, or if all of these areas are completely black or completely white. Otherwise it is classic.</p>
     */
    public static SkinModel inferModel(BufferedImage skin) {
        if (skin.getWidth() != SKIN_SIZE || skin.getHeight() != SKIN_SIZE) return SkinModel.CLASSIC;

        boolean anyTransparent = false, allBlack = true, allWhite = true;
        for (int[] r : SLIM_UNUSED_REGIONS) {
            for (int y = r[1]; y < r[1] + r[3]; y++) {
                for (int x = r[0]; x < r[0] + r[2]; x++) {
                    int argb = skin.getRGB(x, y);
                    int alpha = argb >>> 24;
                    int rgb = argb & 0xFFFFFF;
                    if (alpha != 0xFF) anyTransparent = true;
                    if (rgb != 0x000000) allBlack = false;
                    if (rgb != 0xFFFFFF) allWhite = false;
                }
            }
        }

        return (anyTransparent || allBlack || allWhite) ? SkinModel.SLIM : SkinModel.CLASSIC;
    }

    /**
     * Calculates a short, stable hash of the skins pixels. It changes whenever the skin changes and is used as
     * version to invalidate cached skin-images in the browser.
     */
    public static String version(BufferedImage skin) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            ByteBuffer buffer = ByteBuffer.allocate(4);
            digest.update(buffer.putInt(0, skin.getWidth()).array());
            digest.update(buffer.putInt(0, skin.getHeight()).array());
            for (int y = 0; y < skin.getHeight(); y++) {
                for (int x = 0; x < skin.getWidth(); x++) {
                    digest.update(buffer.putInt(0, skin.getRGB(x, y)).array());
                }
            }
            return HexFormat.of().formatHex(digest.digest(), 0, 8);
        } catch (NoSuchAlgorithmException ex) {
            throw new IllegalStateException("SHA-256 is not available", ex);
        }
    }

    private static void copyMirrored(BufferedImage image, int sourceX, int sourceY, int width, int height, int targetX, int targetY) {
        for (int y = 0; y < height; y++) {
            for (int x = 0; x < width; x++) {
                image.setRGB(targetX + width - 1 - x, targetY + y, image.getRGB(sourceX + x, sourceY + y));
            }
        }
    }

    private static boolean isFullyOpaque(BufferedImage image, int x0, int y0, int width, int height) {
        for (int y = y0; y < y0 + height; y++) {
            for (int x = x0; x < x0 + width; x++) {
                if ((image.getRGB(x, y) >>> 24) < 128) return false;
            }
        }
        return true;
    }

    private static void clear(BufferedImage image, int x0, int y0, int width, int height) {
        for (int y = y0; y < y0 + height; y++) {
            for (int x = x0; x < x0 + width; x++) {
                image.setRGB(x, y, 0);
            }
        }
    }

}
