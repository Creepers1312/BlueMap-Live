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

import de.bluecolored.bluemap.common.web.http.HttpRequest;
import de.bluecolored.bluemap.common.web.http.HttpRequestHandler;
import de.bluecolored.bluemap.common.web.http.HttpResponse;
import de.bluecolored.bluemap.common.web.http.HttpStatusCode;
import lombok.Getter;
import lombok.NonNull;
import lombok.Setter;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.function.Supplier;
import java.util.zip.GZIPOutputStream;

@Getter @Setter
public class JsonDataRequestHandler implements HttpRequestHandler {

    private @NonNull Supplier<String> dataSupplier;

    public JsonDataRequestHandler(Supplier<String> dataSupplier) {
        this.dataSupplier = dataSupplier;
    }

    /** BlueMap Live: smaller responses are not worth compressing */
    static final int MIN_COMPRESSED_SIZE = 1024;

    @Override
    public HttpResponse handle(HttpRequest request) {
        HttpResponse response = new HttpResponse(HttpStatusCode.OK);
        response.addHeader("Cache-Control", "no-cache");
        response.addHeader("Content-Type", "application/json");
        String data = dataSupplier.get();
        // BlueMap Live: the live-data (players.json, entities.json) is requested several times per second,
        // compressed it is a fraction of the size (faster over the internet)
        byte[] bytes = data.getBytes(StandardCharsets.UTF_8);
        if (bytes.length >= MIN_COMPRESSED_SIZE && request.hasHeaderValue("Accept-Encoding", "gzip")) {
            try {
                ByteArrayOutputStream compressed = new ByteArrayOutputStream(bytes.length / 4 + 64);
                try (GZIPOutputStream out = new GZIPOutputStream(compressed)) {
                    out.write(bytes);
                }
                response.addHeader("Content-Encoding", "gzip");
                response.addHeader("Vary", "Accept-Encoding");
                response.setData(new ByteArrayInputStream(compressed.toByteArray()));
                return response;
            } catch (IOException ignore) {
                // uncompressed below
            }
        }
        response.setData(new ByteArrayInputStream(bytes));
        return response;
    }

}
