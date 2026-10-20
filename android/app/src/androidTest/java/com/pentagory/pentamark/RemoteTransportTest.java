package com.pentagory.pentamark;

import static org.junit.Assert.*;
import org.junit.Test;
import org.json.JSONObject;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.lang.reflect.InvocationTargetException;
import java.util.concurrent.*;

/** Real HttpURLConnection/socket tests, runnable both by AndroidJUnitRunner and plain JUnit.
 * The URL handler is installed ONLY in the test process: it routes the validated tailnet
 * URL to a loopback fixture. There is no production localhost exception or injected transport.
 */
public class RemoteTransportTest {
    private static volatile URL endpoint;
    private static boolean installed;
    private static synchronized void install() throws Exception {
        if (installed) return;
        // Retain the platform handler before installing the test-only routing handler.
        endpoint = new URL("http://127.0.0.1:1");
        URL.setURLStreamHandlerFactory(protocol -> !protocol.equals("http") ? null : new URLStreamHandler() {
            @Override protected URLConnection openConnection(URL url) throws IOException {
                if (!url.getHost().equals("100.64.0.1")) throw new IOException("Unexpected fixture destination");
                return new URL(endpoint, url.getFile()).openConnection(Proxy.NO_PROXY);
            }
            @Override protected URLConnection openConnection(URL url, Proxy proxy) throws IOException { return openConnection(url); }
        });
        installed = true;
    }

    static final class Fixture implements AutoCloseable {
        final ServerSocket server = new ServerSocket(0, 4, InetAddress.getByName("127.0.0.1"));
        final CompletableFuture<String> request = new CompletableFuture<>();
        final CompletableFuture<Boolean> disconnected = new CompletableFuture<>();
        Fixture(String response) throws Exception {
            this(response.getBytes(StandardCharsets.UTF_8));
        }
        Fixture(byte[] response) throws Exception {
            this(response, false);
        }
        Fixture(byte[] response, boolean linger) throws Exception {
            install();
            endpoint = new URL(endpoint, "http://127.0.0.1:" + server.getLocalPort());
            Thread worker = new Thread(() -> {
                try (Socket client = server.accept()) {
                    client.setSoTimeout(4000);
                    BufferedReader reader = new BufferedReader(new InputStreamReader(client.getInputStream(), StandardCharsets.UTF_8));
                    StringBuilder received = new StringBuilder();
                    String line;
                    int length = 0;
                    while ((line = reader.readLine()) != null && !line.isEmpty()) {
                        received.append(line).append('\n');
                        if (line.toLowerCase().startsWith("content-length:")) length = Integer.parseInt(line.substring(15).trim());
                    }
                    for (int i = 0; i < length; i++) received.append((char)reader.read());
                    request.complete(received.toString());
                    client.getOutputStream().write(response);
                    client.getOutputStream().flush();
                    if (linger) disconnected.complete(client.getInputStream().read() == -1);
                } catch (Exception e) { request.completeExceptionally(e); }
            }, "remote-http-fixture");
            worker.setDaemon(true);
            worker.start();
        }
        public void close() throws IOException { server.close(); }
    }

    private Object connection() throws Exception {
        try { return RemoteConnection.class.getConstructor(String.class).newInstance("http://100.64.0.1:3030"); }
        catch (NoSuchMethodException e) { throw new AssertionError("Native HTTP transport is missing", e); }
    }
    private Object call(Object target, String method, Class<?>[] types, Object... args) throws Exception {
        try { return target.getClass().getMethod(method, types).invoke(target, args); }
        catch (NoSuchMethodException e) { throw new AssertionError("Missing native behavior: " + method, e); }
        catch (InvocationTargetException e) { throw (Exception)e.getCause(); }
    }
    private JSONObject request(Object connection, String path, String method, String body, String base64) throws Exception {
        return (JSONObject)call(connection, "request", new Class<?>[]{String.class,String.class,String.class,String.class,String.class},
                path, method, body, base64, "android_test");
    }
    static String response(int status, String type, String body) {
        return "HTTP/1.1 " + status + " Fixture\r\nContent-Type: " + type + "\r\nContent-Length: "
            + body.getBytes(StandardCharsets.UTF_8).length + "\r\nConnection: close\r\n\r\n" + body;
    }

    @Test public void preservesConflictStatusBodyAndClientIdentity() throws Exception {
        try (Fixture fixture = new Fixture(response(409, "application/json", "{\"error\":\"conflict\",\"revision\":\"v2\"}"))) {
            JSONObject result = request(connection(), "/api/note?path=a.md", "PUT", "{\"baseRevision\":\"v1\"}", null);
            assertEquals(409, result.getInt("status"));
            assertEquals("v2", result.getJSONObject("data").getString("revision"));
            String sent = fixture.request.get(5, TimeUnit.SECONDS);
            assertTrue(sent, sent.startsWith("PUT /api/note?path=a.md HTTP/1.1"));
            assertTrue(sent, sent.toLowerCase().contains("x-pentamark-client: android_test"));
            assertTrue(sent, sent.contains("{\"baseRevision\":\"v1\"}"));
        }
    }

    @Test public void refusesRedirectsAndNonJsonAndOversizedResponses() throws Exception {
        for (String reply : new String[]{"HTTP/1.1 302 Found\r\nLocation: http://127.0.0.1:9/\r\nContent-Length: 0\r\n\r\n",
                response(200,"text/html","<html>active</html>"),
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 999999999\r\n\r\n"}) {
            try (Fixture fixture = new Fixture(reply)) {
                try { request(connection(), "/api/state", "GET", null, null); fail("Unsafe HTTP response accepted"); }
                catch (IOException expected) { }
            }
        }
    }

    @Test public void streamsMediaRangeWithSafeMetadata() throws Exception {
        try (Fixture fixture = new Fixture("HTTP/1.1 206 Partial Content\r\nContent-Type: image/png\r\n"
                + "Content-Length: 3\r\nContent-Range: bytes 2-4/10\r\n\r\nPNG")) {
            Object media = call(connection(), "openMedia", new Class<?>[]{String.class,String.class}, "assets/a.png", "bytes=2-4");
            assertEquals(206, media.getClass().getField("status").get(media));
            try (InputStream input = (InputStream)media.getClass().getField("stream").get(media)) {
                assertEquals('P', input.read()); assertEquals('N', input.read()); assertEquals('G', input.read()); assertEquals(-1, input.read());
            }
            String sent = fixture.request.get(5, TimeUnit.SECONDS);
            assertTrue(sent, sent.contains("/api/file?path=assets%2Fa.png"));
            assertTrue(sent, sent.toLowerCase().contains("range: bytes=2-4"));
        }
    }

    @Test public void rejectsActiveMimeEvenWithPassiveFilename() throws Exception {
        try (Fixture fixture = new Fixture(response(200,"image/svg+xml","<svg/>"))) {
            try { call(connection(), "openMedia", new Class<?>[]{String.class,String.class}, "a.png", null); fail("SVG accepted"); }
            catch (IOException expected) { }
        }
    }

    @Test public void rejectsInconsistentContentRanges() throws Exception {
        for (String range : new String[]{"bytes 2-1/10", "bytes 2-4/3", "bytes 3-5/10", "bytes 2-5/10"}) {
            try (Fixture fixture = new Fixture("HTTP/1.1 206 Partial Content\r\nContent-Type: image/png\r\nContent-Length: 3\r\nContent-Range: " + range + "\r\n\r\nPNG")) {
                try {
                    Object media = call(connection(), "openMedia", new Class<?>[]{String.class,String.class}, "a.png", "bytes=2-4");
                    ((InputStream)media.getClass().getField("stream").get(media)).close();
                    fail("Inconsistent range accepted: " + range);
                } catch (IOException expected) { }
            }
        }
    }

    @Test public void sseRegistersClientDeliversEventsAndReportsDisconnect() throws Exception {
        try (Fixture fixture = new Fixture(response(200, "text/event-stream", "event: presence\ndata: {\"clients\":1}\n\n"))) {
            java.util.List<String> events = new java.util.concurrent.CopyOnWriteArrayList<>();
            CountDownLatch disconnected = new CountDownLatch(1);
            java.util.function.BiConsumer<String,String> sink = (type, data) -> {
                events.add(type + ":" + data); if (type.equals("error")) disconnected.countDown();
            };
            Object session = call(connection(), "startEvents", new Class<?>[]{String.class, java.util.function.BiConsumer.class},
                "/api/events?clientId=android_test&name=Phone", sink);
            try {
                assertTrue("No disconnect event", disconnected.await(5, TimeUnit.SECONDS));
                assertEquals("open:", events.get(0));
                assertEquals("presence:{\"clients\":1}", events.get(1));
                assertTrue(fixture.request.get(5, TimeUnit.SECONDS).contains("/api/events?clientId=android_test&name=Phone"));
            } finally { ((AutoCloseable)session).close(); }
        }
    }

    @Test public void stoppingEventsClosesSocketWithoutReconnectError() throws Exception {
        byte[] reply = "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\n\r\n: ready\n\n".getBytes(StandardCharsets.UTF_8);
        try (Fixture fixture = new Fixture(reply, true)) {
            CountDownLatch opened = new CountDownLatch(1);
            java.util.List<String> events = new java.util.concurrent.CopyOnWriteArrayList<>();
            java.util.function.BiConsumer<String,String> sink = (type, data) -> { events.add(type); if (type.equals("open")) opened.countDown(); };
            Object session = call(connection(), "startEvents", new Class<?>[]{String.class,java.util.function.BiConsumer.class}, "/api/events?clientId=android_test", sink);
            assertTrue(opened.await(5, TimeUnit.SECONDS));
            ((AutoCloseable)session).close();
            assertTrue(fixture.disconnected.get(2, TimeUnit.SECONDS));
            assertEquals(java.util.Collections.singletonList("open"), events);
        }
    }

    @Test public void closedOriginCannotExecuteAQueuedWrite() throws Exception {
        Object target = connection();
        call(target, "close", new Class<?>[0]);
        try { request(target, "/api/note?path=a.md", "PUT", "{}", null); fail("Closed origin accepted a write"); }
        catch (IOException expected) { assertTrue(expected.getMessage().contains("closed")); }
    }
}
