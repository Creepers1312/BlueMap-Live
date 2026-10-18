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
package de.bluecolored.bluemap.common.web;

import de.bluecolored.bluemap.common.web.http.HttpHeader;
import de.bluecolored.bluemap.common.web.http.HttpRequest;
import de.bluecolored.bluemap.common.web.http.HttpResponse;
import org.junit.jupiter.api.Test;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.net.InetAddress;
import java.nio.channels.Channels;
import java.nio.charset.StandardCharsets;
import java.util.zip.GZIPInputStream;

import static org.junit.jupiter.api.Assertions.*;

public class JsonDataRequestHandlerTest {

    private static HttpRequest request(String acceptEncoding) {
        HttpRequest request = new HttpRequest(InetAddress.getLoopbackAddress());
        if (acceptEncoding != null) request.getHeaders().put("accept-encoding", new HttpHeader("Accept-Encoding", acceptEncoding));
        return request;
    }

    /** the body of the written http-message */
    private static byte[] body(HttpResponse response) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        while (!response.read(Channels.newChannel(out))) { /* until complete */ }
        byte[] message = out.toByteArray();
        String text = new String(message, StandardCharsets.ISO_8859_1);
        int pos = text.indexOf("\r\n\r\n") + 4;
        // the body is sent chunked: "<hex-size>\r\n<data>\r\n", until a chunk of size 0
        ByteArrayOutputStream body = new ByteArrayOutputStream();
        while (true) {
            int lineEnd = text.indexOf("\r\n", pos);
            int size = Integer.parseInt(text.substring(pos, lineEnd).trim(), 16);
            if (size == 0) break;
            body.write(message, lineEnd + 2, size);
            pos = lineEnd + 2 + size + 2;
        }
        return body.toByteArray();
    }

    @Test
    public void testLiveDataIsCompressedWhenWorthIt() throws IOException {
        String big = "{\"players\":[" + "{\"x\":1.5,\"y\":64,\"z\":-3.25},".repeat(100) + "{}]}";
        JsonDataRequestHandler handler = new JsonDataRequestHandler(() -> big);

        HttpResponse gzip = handler.handle(request("gzip, deflate, br"));
        assertTrue(gzip.hasHeaderValue("Content-Encoding", "gzip"));
        byte[] compressed = body(gzip);
        assertTrue(compressed.length < big.length() / 4, "compressed: " + compressed.length + " of " + big.length());
        try (GZIPInputStream in = new GZIPInputStream(new ByteArrayInputStream(compressed))) {
            assertEquals(big, new String(in.readAllBytes(), StandardCharsets.UTF_8));
        }

        HttpResponse plain = handler.handle(request(null));
        assertFalse(plain.hasHeaderValue("Content-Encoding", "gzip"), "the client does not accept gzip");
        assertEquals(big, new String(body(plain), StandardCharsets.UTF_8));

        HttpResponse small = new JsonDataRequestHandler(() -> "{\"players\":[]}").handle(request("gzip"));
        assertFalse(small.hasHeaderValue("Content-Encoding", "gzip"), "small responses are not compressed");
        assertEquals("{\"players\":[]}", new String(body(small), StandardCharsets.UTF_8));
    }

}
