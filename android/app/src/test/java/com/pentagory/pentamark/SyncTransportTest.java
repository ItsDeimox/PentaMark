package com.pentagory.pentamark;

import org.junit.Test;
import org.json.JSONObject;
import java.io.*;
import java.net.*;
import java.nio.file.Files;
import static org.junit.Assert.*;

public class SyncTransportTest {
    @Test public void syncAllowlistRejectsOtherOriginsAndUnknownRoutes() throws Exception {
        RemoteConnection.validateSyncRequest("/api/sync/v1/hello", "GET");
        for (String route : new String[]{"https://example.com/api/sync/v1/hello", "//example.com/api/sync/v1/hello", "/api/sync/v1/../hello", "/api/sync/v1/hello?url=evil", "/api/sync/v1/blobs/abc"}) {
            try { RemoteConnection.validateSyncRequest(route, "GET"); fail(route); } catch (IllegalArgumentException expected) {}
        }
    }
    @Test public void resumedDownloadRequiresExactContentRangeAndPreservesPrefix() throws Exception {
        File dest = Files.createTempFile("sync-transfer-", ".part").toFile(); Files.write(dest.toPath(), new byte[]{1,2});
        try (ServerSocket server = new ServerSocket(0, 1, InetAddress.getLoopbackAddress())) {
            Thread worker = new Thread(() -> {
                try (Socket socket = server.accept()) {
                    BufferedReader reader = new BufferedReader(new InputStreamReader(socket.getInputStream(), "US-ASCII"));
                    String line; while ((line=reader.readLine())!=null && !line.isEmpty()) {}
                    socket.getOutputStream().write("HTTP/1.1 206 Partial Content\r\nContent-Type: application/octet-stream\r\nContent-Length: 2\r\nContent-Range: bytes 0-1/4\r\nConnection: close\r\n\r\nxx".getBytes("US-ASCII"));
                } catch (IOException e) { throw new RuntimeException(e); }
            }); worker.start();
            RemoteConnection connection = new RemoteConnection("http://100.64.0.1:3000", url -> (HttpURLConnection)new URL("http://127.0.0.1:"+server.getLocalPort()+url.getFile()).openConnection(Proxy.NO_PROXY));
            try { connection.downloadChunk("a".repeat(64), 4, 2, dest); fail("bad range accepted"); }
            catch (IOException expected) { assertEquals("invalid-range", expected.getMessage()); }
            finally { connection.close(); }
            worker.join(3000); assertArrayEquals(new byte[]{1,2}, Files.readAllBytes(dest.toPath()));
        }
    }
}
