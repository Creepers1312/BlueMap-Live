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
package de.bluecolored.bluemap.common.config;

import org.junit.jupiter.api.Test;

import java.lang.reflect.Field;
import java.net.InetAddress;
import java.net.InetSocketAddress;

import static org.junit.jupiter.api.Assertions.*;

public class WebserverConfigTest {

    private static WebserverConfig withIp(String ip) throws Exception {
        WebserverConfig config = new WebserverConfig();
        Field field = WebserverConfig.class.getDeclaredField("ip");
        field.setAccessible(true);
        field.set(config, ip);
        return config;
    }

    private static final InetAddress ANY = new InetSocketAddress(0).getAddress();

    @Test
    public void testUnconfiguredIp() throws Exception {
        WebserverConfig config = new WebserverConfig();
        assertFalse(config.isIpConfigured());
        assertEquals("0.0.0.0", config.getIp(), "unchanged value for existing callers");

        // dedicated server: all interfaces, like before
        assertEquals(ANY, config.resolveBindAddress(false));
        assertEquals(ANY, config.resolveIp());

        // integrated (singleplayer) server: loopback only
        InetAddress singleplayer = config.resolveBindAddress(true);
        assertEquals("127.0.0.1", singleplayer.getHostAddress());
        assertTrue(singleplayer.isLoopbackAddress());
    }

    @Test
    public void testExplicitIpIsAlwaysUsed() throws Exception {
        WebserverConfig all = withIp("0.0.0.0");
        assertTrue(all.isIpConfigured());
        assertEquals(ANY, all.resolveBindAddress(true), "explicit 0.0.0.0 also in singleplayer");
        assertEquals(ANY, all.resolveBindAddress(false));

        WebserverConfig local = withIp("127.0.0.1");
        assertEquals("127.0.0.1", local.resolveBindAddress(false).getHostAddress(), "explicit loopback on a dedicated server");

        WebserverConfig empty = withIp("");
        assertEquals(ANY, empty.resolveBindAddress(true), "an empty ip keeps its old meaning (all interfaces)");
    }

}
