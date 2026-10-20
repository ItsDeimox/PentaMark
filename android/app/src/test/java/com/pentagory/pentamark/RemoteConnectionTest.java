package com.pentagory.pentamark;

import java.io.ByteArrayInputStream;
import java.lang.reflect.InvocationTargetException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import org.junit.Test;
import static org.junit.Assert.*;

public class RemoteConnectionTest {
    // Reflection makes the initial RED an assertion about the missing transport,
    // rather than a compilation failure. All calls exercise production validation.
    private Object invoke(String name, Class<?>[] types, Object... values) throws Exception {
        Class<?> target;
        try { target = Class.forName("com.pentagory.pentamark.RemoteConnection"); }
        catch (ClassNotFoundException e) { throw new AssertionError("Remote transport is not implemented", e); }
        try { return target.getDeclaredMethod(name, types).invoke(null, values); }
        catch (NoSuchMethodException e) { throw new AssertionError("Missing transport behavior: " + name, e); }
        catch (InvocationTargetException e) { throw (Exception)e.getCause(); }
    }

    private String origin(String value) throws Exception {
        return (String)invoke("validateOrigin", new Class<?>[]{String.class}, value);
    }

    @Test public void acceptsOnlyTailnetOrigins() throws Exception {
        assertEquals("http://100.64.0.1:3030", origin("http://100.64.0.1:3030"));
        assertEquals("https://100.127.255.254", origin("https://100.127.255.254"));
        assertEquals("https://pc.example.ts.net", origin("https://pc.example.ts.net"));
        for (String value : new String[]{"http://100.63.255.255", "http://100.128.0.1",
                "http://127.0.0.1", "https://example.com", "http://pc.ts.net", "https://ts.net",
                "https://pc.ts.net.evil.org", "https://user@pc.ts.net", "https://pc.ts.net/",
                "https://pc.ts.net/a", "https://pc.ts.net?x=1", "https://pc.ts.net#x",
                "http://100.064.0.1", "https://[::1]", "http://100.64.0.1:0", "http://100.64.0.1:65536"}) {
            try { origin(value); fail("Accepted " + value); } catch (IllegalArgumentException expected) { }
        }
    }

    @Test public void limitsApiRoutesAndMethods() throws Exception {
        for (String[] pair : new String[][]{{"/api/state", "GET"}, {"/api/note?path=a.md", "PUT"},
                {"/api/note?path=a.md", "PATCH"}, {"/api/upload?name=a.png", "POST"}}) {
            invoke("validateRequest", new Class<?>[]{String.class, String.class}, pair[0], pair[1]);
        }
        for (String[] pair : new String[][]{{"https://100.64.0.1/api/state", "GET"},
                {"//evil.org/api/state", "GET"}, {"/api/../api/state", "GET"}, {"/api/%73tate", "GET"},
                {"/api/file?path=a.html", "GET"}, {"/api/events", "GET"}, {"/mcp", "POST"},
                {"/api/state", "POST"}, {"/api/note#frag", "GET"}, {"/api/note?path=a&token=x", "GET"}}) {
            try { invoke("validateRequest", new Class<?>[]{String.class, String.class}, pair[0], pair[1]);
                fail("Accepted " + pair[0]); } catch (IllegalArgumentException expected) { }
        }
    }

    @Test public void mediaOnlyAllowsRelativePassiveFiles() throws Exception {
        assertEquals("image/png", invoke("mediaMime", new Class<?>[]{String.class}, "assets/ação.png"));
        for (String path : new String[]{"a.svg", "a.html", "a.pdf", "../a.png", "/a.png",
                "https://evil.org/a.png", "assets\\a.png", "assets/../a.png"}) {
            try { invoke("mediaMime", new Class<?>[]{String.class}, path); fail("Accepted " + path); }
            catch (IllegalArgumentException expected) { }
        }
    }

    @Test public void sseAllowsOnlyNamedEventsAndJoinsDataLines() throws Exception {
        List<String> events = new ArrayList<>();
        java.util.function.BiConsumer<String,String> sink = (type, data) -> events.add(type + ":" + data);
        String source = ": heartbeat\r\nevent: note\r\ndata: first\r\ndata: second\r\n\r\n"
            + "event: execute\ndata: malicious\n\nevent: state\ndata: {}\n\n";
        invoke("readEvents", new Class<?>[]{java.io.InputStream.class, java.util.function.BiConsumer.class},
            new ByteArrayInputStream(source.getBytes(StandardCharsets.UTF_8)), sink);
        assertEquals(java.util.Arrays.asList("note:first\nsecond", "state:{}"), events);
    }

    @Test public void mediaProxyRequiresSameOriginGetAndNeverDocumentNavigation() throws Exception {
        Class<?>[] types = {String.class,String.class,String.class,boolean.class,String.class};
        String url = "https://localhost/_pm_remote/file?path=assets%2Fa.png";
        assertEquals("assets/a.png", invoke("mediaPath", types, "https://localhost/", url, "GET", false, "image"));
        for (Object[] args : new Object[][]{
                {"https://localhost/", url, "GET", true, "image"},
                {"https://localhost/", url, "GET", false, "iframe"},
                {"https://localhost/", url, "POST", false, "image"},
                {"https://localhost/", url.replace("localhost", "evil.org"), "GET", false, "image"},
                {"https://localhost/", url + "&path=b.png", "GET", false, "image"},
                {"https://localhost/", url.replace("assets%2Fa.png", "..%2Fa.png"), "GET", false, "image"},
                {"https://localhost/", url.replace("a.png", "a.svg"), "GET", false, "image"}}) {
            try { invoke("mediaPath", types, args); fail("Unsafe media request accepted"); }
            catch (IllegalArgumentException expected) { }
        }
    }

    @Test public void sseBoundsLinesAndFramesIncludingUnknownFields() throws Exception {
        java.util.function.BiConsumer<String,String> sink = (type, data) -> fail("Oversized frame delivered");
        for (String source : new String[]{"data: " + new String(new char[600000]).replace('\0','x'),
                "event: note\n" + new String(new char[200000]).replace("\0", "id: x\n")}) {
            try {
                invoke("readEvents", new Class<?>[]{java.io.InputStream.class, java.util.function.BiConsumer.class},
                    new ByteArrayInputStream(source.getBytes(StandardCharsets.UTF_8)), sink);
                fail("Unbounded SSE accepted");
            } catch (java.io.IOException expected) { }
        }
    }

    @Test public void uploadDecoderWorksOnApi24AndRejectsMalformedBase64() throws Exception {
        assertArrayEquals(new byte[]{0,1,2,(byte)255}, (byte[])invoke("decodeUpload", new Class<?>[]{String.class}, "AAEC/w=="));
        assertArrayEquals(new byte[]{97}, (byte[])invoke("decodeUpload", new Class<?>[]{String.class}, "YQ=="));
        for (String input : new String[]{"Y Q==", "Y===", "YQ==AAAA", "!!!!", "A"}) {
            try { invoke("decodeUpload", new Class<?>[]{String.class}, input); fail("Invalid base64 accepted"); }
            catch (IllegalArgumentException expected) { }
        }
    }
}
