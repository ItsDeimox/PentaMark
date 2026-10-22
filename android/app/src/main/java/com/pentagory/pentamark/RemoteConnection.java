package com.pentagory.pentamark;

import java.net.URI;
import java.net.URL;
import java.net.HttpURLConnection;
import java.net.Proxy;
import java.net.URLEncoder;
import java.net.URLDecoder;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.HashMap;
import java.util.Collections;
import java.util.concurrent.*;
import java.util.function.BiConsumer;
import org.json.JSONObject;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;

/** Policy and native transport for an explicitly selected tailnet vault. Never persisted. */
public final class RemoteConnection {
    private static final int JSON_LIMIT = 8 * 1024 * 1024;
    private static final int UPLOAD_LIMIT = 32 * 1024 * 1024;
    private static final long MEDIA_LIMIT = 256L * 1024 * 1024;
    private static final ScheduledExecutorService DEADLINES = Executors.newSingleThreadScheduledExecutor(r -> {
        Thread thread = new Thread(r, "remote-deadlines"); thread.setDaemon(true); return thread;
    });
    private final String origin;
    interface ConnectionFactory { HttpURLConnection open(URL url) throws IOException; }
    private final ConnectionFactory factory;
    public static final int SYNC_CHUNK_BYTES = 1048576;
    private final Set<HttpURLConnection> active = new HashSet<>();
    private boolean closed;

    public RemoteConnection(String origin) { this(origin, url -> (HttpURLConnection)url.openConnection(Proxy.NO_PROXY)); }
    RemoteConnection(String origin, ConnectionFactory factory) { this.origin = validateOrigin(origin); this.factory = factory; }

    /** Closing an old profile aborts its in-flight work; it can never retarget a queued write. */
    public void close() {
        HttpURLConnection[] pending;
        synchronized (active) { closed = true; pending = active.toArray(new HttpURLConnection[0]); active.clear(); }
        for (HttpURLConnection connection : pending) connection.disconnect();
    }

    private HttpURLConnection open(String url, String method) throws IOException {
        HttpURLConnection connection = factory.open(new URL(origin + url));
        connection.setInstanceFollowRedirects(false);
        connection.setConnectTimeout(8000);
        connection.setReadTimeout(15000);
        connection.setUseCaches(false);
        connection.setRequestMethod(method);
        connection.setRequestProperty("Accept-Encoding", "identity");
        synchronized (active) {
            if (closed || active.size() >= 8) { connection.disconnect(); throw new IOException("Remote vault closed or busy"); }
            active.add(connection);
        }
        return connection;
    }

    private void release(HttpURLConnection connection) {
        synchronized (active) { active.remove(connection); }
        connection.disconnect();
    }

    private static int status(HttpURLConnection connection) throws IOException {
        int status = connection.getResponseCode();
        if (status < 200 || status >= 300 && status < 400) throw new IOException("Redirects and provisional responses are not allowed");
        return status;
    }

    private static String mime(HttpURLConnection connection) throws IOException {
        String type = connection.getContentType();
        if (type == null || type.length() > 200) throw new IOException("Missing or invalid content type");
        String encoding = connection.getHeaderField("Content-Encoding");
        if (encoding != null && !encoding.equalsIgnoreCase("identity")) throw new IOException("Encoded response not supported");
        return type.split(";", 2)[0].trim().toLowerCase(Locale.ROOT);
    }

    private static long length(HttpURLConnection connection, long limit) throws IOException {
        String raw = connection.getHeaderField("Content-Length");
        if (raw == null) return -1;
        try {
            if (!raw.matches("[0-9]{1,12}")) throw new NumberFormatException();
            long value = Long.parseLong(raw);
            if (value > limit) throw new IOException("Remote response exceeds size limit");
            return value;
        } catch (NumberFormatException e) { throw new IOException("Invalid content length", e); }
    }

    public JSONObject request(String url, String method, String body, String base64, String clientId) throws Exception {
        validateRequest(url, method);
        return requestJson(url, method, body, base64, clientId);
    }

    public JSONObject syncRequest(String url, String method, JSONObject body) throws Exception {
        validateSyncRequest(url, method);
        if (relative(url).getPath().startsWith("/api/sync/v1/blobs/")) throw new IllegalArgumentException("native-stream-required");
        return requestJson(url, method, body == null ? null : body.toString(), null, null);
    }

    private JSONObject requestJson(String url, String method, String body, String base64, String clientId) throws Exception {
        if (clientId != null && !clientId.matches("[a-zA-Z0-9_-]{1,80}")) throw new IllegalArgumentException("Invalid clientId");
        boolean upload = relative(url).getPath().equals("/api/upload");
        if (body != null && base64 != null || base64 != null && !upload || body != null && method.equals("GET"))
            throw new IllegalArgumentException("Unexpected request payload");
        byte[] payload = null;
        if (base64 != null) {
            if (base64.length() > (UPLOAD_LIMIT + 2L) / 3 * 4) throw new IllegalArgumentException("Upload too large");
            payload = decodeUpload(base64);
            if (payload.length > UPLOAD_LIMIT) throw new IllegalArgumentException("Upload too large");
        } else if (body != null) {
            if (body.length() > JSON_LIMIT) throw new IllegalArgumentException("JSON body too large");
            payload = body.getBytes(StandardCharsets.UTF_8);
            if (payload.length > JSON_LIMIT) throw new IllegalArgumentException("JSON body too large");
            new JSONObject(body);
        }
        if (upload && base64 == null) throw new IllegalArgumentException("Upload requires base64");
        HttpURLConnection connection = open(url, method);
        ScheduledFuture<?> deadline = DEADLINES.schedule(() -> release(connection), 45, TimeUnit.SECONDS);
        try {
            connection.setRequestProperty("Accept", "application/json");
            if (clientId != null) connection.setRequestProperty("X-PentaMark-Client", clientId);
            if (payload != null) {
                connection.setDoOutput(true);
                connection.setRequestProperty("Content-Type", upload ? "application/octet-stream" : "application/json; charset=utf-8");
                connection.setFixedLengthStreamingMode(payload.length);
                try (OutputStream output = connection.getOutputStream()) { output.write(payload); }
            }
            int status = status(connection);
            if (!mime(connection).equals("application/json")) throw new IOException("Expected JSON response");
            long expected = length(connection, JSON_LIMIT);
            InputStream raw = status >= 400 ? connection.getErrorStream() : connection.getInputStream();
            if (raw == null) throw new IOException("Missing JSON response");
            try (InputStream input = raw; ByteArrayOutputStream output = new ByteArrayOutputStream()) {
                byte[] buffer = new byte[8192]; int count;
                while ((count = input.read(buffer)) != -1) {
                    if (output.size() + count > JSON_LIMIT) throw new IOException("JSON response too large");
                    output.write(buffer, 0, count);
                }
                if (expected >= 0 && expected != output.size()) throw new IOException("Truncated JSON response");
                JSONObject data = new JSONObject(new String(output.toByteArray(), StandardCharsets.UTF_8));
                return new JSONObject().put("status", status).put("data", data);
            }
        } finally { deadline.cancel(false); release(connection); }
    }

    public static void validateSyncRequest(String url, String method) {
        URI uri = relative(url); String allowed, keys = "";
        switch (uri.getPath()) {
            case "/api/sync/v1/hello": allowed = "GET"; break;
            case "/api/sync/v1/snapshot": allowed = "GET|POST"; keys = "|snapshotToken|cursor|"; break;
            case "/api/sync/v1/changes": allowed = "GET"; keys = "|cursor|limit|"; break;
            case "/api/sync/v1/apply": allowed = "POST"; break;
            default:
                if (!uri.getPath().matches("/api/sync/v1/blobs/[0-9a-f]{64}")) throw new IllegalArgumentException("invalid-sync-route");
                allowed = "GET|PUT"; keys = "|offset|";
        }
        if (method == null || !("|"+allowed+"|").contains("|"+method+"|")) throw new IllegalArgumentException("invalid-sync-method");
        query(uri, keys);
    }

    private static void validateChunk(String hash, long total, long offset) throws IOException {
        if (hash == null || !hash.matches("[0-9a-f]{64}") || total < 0 || total > 9007199254740991L || offset < 0 || offset > total)
            throw new IOException("invalid-transfer");
    }

    /** Exactly one segment per call. Caller persists the returned offset only after fsync. */
    public long downloadChunk(String hash, long total, long offset, File staging) throws Exception {
        validateChunk(hash, total, offset);
        if (staging.length() != offset) throw new IOException("invalid-offset");
        if (offset == total) { if (!staging.exists()) try (FileOutputStream out = new FileOutputStream(staging)) { out.getFD().sync(); } return offset; }
        long count = Math.min(SYNC_CHUNK_BYTES, total-offset), end = offset+count-1;
        HttpURLConnection connection = open("/api/sync/v1/blobs/"+hash, "GET");
        ScheduledFuture<?> deadline = DEADLINES.schedule(() -> release(connection), 45, TimeUnit.SECONDS);
        try {
            connection.setRequestProperty("Range", "bytes="+offset+"-"+end);
            if (status(connection) != 206 || !mime(connection).equals("application/octet-stream")) throw new IOException("invalid-transfer-response");
            if (!("bytes "+offset+"-"+end+"/"+total).equals(connection.getHeaderField("Content-Range")) || length(connection, SYNC_CHUNK_BYTES) != count) throw new IOException("invalid-range");
            try (InputStream in = connection.getInputStream(); RandomAccessFile file = new RandomAccessFile(staging, "rw")) {
                file.seek(offset); long received=0; byte[] buffer=new byte[65536];
                try {
                    while(received<count) { int n=in.read(buffer,0,(int)Math.min(buffer.length,count-received)); if(n<0)throw new EOFException("truncated-transfer"); file.write(buffer,0,n); received+=n; }
                    if(in.read()!=-1)throw new IOException("oversized-transfer"); file.getFD().sync();
                } catch (Exception error) { file.setLength(offset); file.getFD().sync(); throw error; }
            }
            return offset+count;
        } finally { deadline.cancel(false); release(connection); }
    }

    public long uploadChunk(String hash, long total, long offset, File object) throws Exception {
        validateChunk(hash,total,offset); if(object.length()!=total)throw new IOException("invalid-blob");
        long count=Math.min(SYNC_CHUNK_BYTES,total-offset);
        HttpURLConnection connection=open("/api/sync/v1/blobs/"+hash+"?offset="+offset,"PUT");
        ScheduledFuture<?> deadline=DEADLINES.schedule(() -> release(connection),45,TimeUnit.SECONDS);
        try {
            connection.setDoOutput(true); connection.setRequestProperty("Content-Type","application/octet-stream");
            connection.setRequestProperty("Content-Range",total==0?"bytes */0":"bytes "+offset+"-"+(offset+count-1)+"/"+total);
            connection.setFixedLengthStreamingMode(count);
            try(RandomAccessFile in=new RandomAccessFile(object,"r"); OutputStream out=connection.getOutputStream()) {
                in.seek(offset); long remaining=count; byte[] buffer=new byte[65536];
                while(remaining>0){int n=in.read(buffer,0,(int)Math.min(buffer.length,remaining));if(n<0)throw new EOFException();out.write(buffer,0,n);remaining-=n;}
            }
            if(status(connection)!=200 || !mime(connection).equals("application/json"))throw new IOException("upload-not-confirmed");
            length(connection,8192);
            ByteArrayOutputStream out=new ByteArrayOutputStream();
            try(InputStream in=connection.getInputStream()){byte[] b=new byte[1024];int n;while((n=in.read(b))!=-1){if(out.size()+n>8192)throw new IOException("oversized-response");out.write(b,0,n);}}
            JSONObject progress=new JSONObject(new String(out.toByteArray(),StandardCharsets.UTF_8));
            Object raw=progress.get("verifiedBytes");
            if(!(raw instanceof Number))throw new IOException("invalid-transfer-progress");
            double number=((Number)raw).doubleValue();long verified=((Number)raw).longValue();
            // Replaying an old segment may acknowledge further durable segments or a finished object.
            if(number!=verified || verified<offset+count || verified>total || verified!=total && verified%SYNC_CHUNK_BYTES!=0
                || !hash.equals(progress.getString("blobHash")) || !(progress.get("complete") instanceof Boolean)
                || progress.getBoolean("complete")!=(verified==total))throw new IOException("invalid-transfer-progress");
            return verified;
        } finally {deadline.cancel(false);release(connection);}
    }

    public static final class Media {
        public final int status;
        public final String mime;
        public final Map<String,String> headers;
        public final InputStream stream;
        Media(int status, String mime, Map<String,String> headers, InputStream stream) {
            this.status = status; this.mime = mime; this.headers = Collections.unmodifiableMap(headers); this.stream = stream;
        }
    }

    public Media openMedia(String path, String range) throws IOException {
        String expectedMime = mediaMime(path);
        // The host does not implement suffix ranges correctly; only explicit start ranges are forwarded.
        if (range != null && !range.matches("bytes=[0-9]{1,12}-[0-9]{0,12}")) throw new IllegalArgumentException("Unsupported range");
        HttpURLConnection connection = open("/api/file?path=" + URLEncoder.encode(path, "UTF-8"), "GET");
        ScheduledFuture<?> deadline = DEADLINES.schedule(() -> release(connection), 120, TimeUnit.SECONDS);
        try {
            if (range != null) connection.setRequestProperty("Range", range);
            int status = status(connection);
            if (status != 200 && status != 206) throw new IOException("Media unavailable (" + status + ")");
            String actualMime = mime(connection);
            if (!actualMime.equals(expectedMime)) throw new IOException("Unsafe or mismatched media type");
            long expectedLength = length(connection, MEDIA_LIMIT);
            Map<String,String> headers = new HashMap<>();
            headers.put("Cache-Control", "no-store");
            headers.put("X-Content-Type-Options", "nosniff");
            headers.put("Content-Security-Policy", "sandbox; default-src 'none'");
            headers.put("Cross-Origin-Resource-Policy", "same-origin");
            if (expectedLength >= 0) headers.put("Content-Length", Long.toString(expectedLength));
            if (status == 206) {
                String contentRange = connection.getHeaderField("Content-Range");
                if (range == null || contentRange == null || !contentRange.matches("bytes [0-9]{1,12}-[0-9]{1,12}/[0-9]{1,12}"))
                    throw new IOException("Invalid media range");
                String[] values = contentRange.substring(6).split("[-/]");
                long start = Long.parseLong(values[0]), end = Long.parseLong(values[1]), total = Long.parseLong(values[2]);
                String[] requested = range.substring(6).split("-", -1);
                if (start != Long.parseLong(requested[0]) || end < start || end >= total
                        || expectedLength >= 0 && expectedLength != end - start + 1
                        || !requested[1].isEmpty() && end != Math.min(Long.parseLong(requested[1]), total - 1))
                    throw new IOException("Inconsistent media range");
                headers.put("Content-Range", contentRange);
            }
            headers.put("Accept-Ranges", "bytes");
            InputStream stream = new FilterInputStream(connection.getInputStream()) {
                long received; boolean finished;
                @Override public int read() throws IOException { byte[] one = new byte[1]; return read(one, 0, 1) < 0 ? -1 : one[0] & 255; }
                @Override public int read(byte[] bytes, int offset, int size) throws IOException {
                    if (size == 0) return 0;
                    if (finished) return -1;
                    try {
                        int count = in.read(bytes, offset, (int)Math.min(size, MEDIA_LIMIT - received + 1));
                        if (count == -1) {
                            if (expectedLength >= 0 && received != expectedLength) throw new IOException("Truncated media");
                            close(); return -1;
                        }
                        received += count;
                        if (received > MEDIA_LIMIT || expectedLength >= 0 && received > expectedLength) throw new IOException("Media exceeds size limit");
                        return count;
                    } catch (IOException e) { close(); throw e; }
                }
                @Override public long skip(long count) throws IOException {
                    byte[] buffer = new byte[8192]; long skipped = 0;
                    while (skipped < count) { int read = read(buffer, 0, (int)Math.min(buffer.length, count - skipped)); if (read < 0) break; skipped += read; }
                    return skipped;
                }
                @Override public void close() throws IOException {
                    if (finished) return; finished = true;
                    try { super.close(); } finally { deadline.cancel(false); release(connection); }
                }
            };
            return new Media(status, actualMime, headers, stream);
        } catch (IOException | RuntimeException e) { deadline.cancel(false); release(connection); throw e; }
    }

    /** Only one session is retained by the plugin. Its caller owns close() on pause/switch. */
    public final class EventSession implements AutoCloseable {
        private final HttpURLConnection connection;
        private final BiConsumer<String,String> sink;
        private volatile boolean stopped;
        private EventSession(HttpURLConnection connection, BiConsumer<String,String> sink) {
            this.connection = connection; this.sink = sink;
        }
        private void run() {
            try {
                if (status(connection) != 200 || !mime(connection).equals("text/event-stream")) throw new IOException("Expected event stream");
                if (!stopped) sink.accept("open", "");
                try (InputStream stream = connection.getInputStream()) {
                    readEvents(stream, (type, data) -> { if (!stopped) sink.accept(type, data); });
                }
                if (!stopped) sink.accept("error", "Remote event stream disconnected");
            } catch (Exception e) {
                if (!stopped) sink.accept("error", "Remote event stream unavailable");
            } finally { release(connection); }
        }
        @Override public void close() { stopped = true; release(connection); }
    }

    public EventSession startEvents(String url, BiConsumer<String,String> sink) throws IOException {
        URI uri = relative(url);
        if (!uri.getPath().equals("/api/events")) throw new IllegalArgumentException("Invalid events URL");
        query(uri, "|clientId|name|");
        HttpURLConnection connection = open(url, "GET");
        connection.setReadTimeout(30000); // Server emits a heartbeat every 20 seconds.
        connection.setRequestProperty("Accept", "text/event-stream");
        EventSession session = new EventSession(connection, sink);
        Thread worker = new Thread(session::run, "remote-events");
        worker.setDaemon(true);
        worker.start();
        return session;
    }

    static void readEvents(InputStream input, BiConsumer<String,String> sink) throws IOException {
        // Read characters incrementally: BufferedReader.readLine() itself is unbounded.
        Reader reader = new BufferedReader(new InputStreamReader(input, StandardCharsets.UTF_8));
        StringBuilder line = new StringBuilder();
        StringBuilder data = new StringBuilder();
        String type = "";
        int frameSize = 0;
        boolean afterCr = false;
        int value;
        while ((value = reader.read()) != -1) {
            char ch = (char)value;
            if (afterCr && ch == '\n') { afterCr = false; continue; }
            afterCr = ch == '\r';
            if (++frameSize > 1024 * 1024) throw new IOException("Event frame too large");
            if (ch != '\r' && ch != '\n') {
                if (line.length() >= 512 * 1024) throw new IOException("Event line too large");
                line.append(ch); continue;
            }
            String text = line.toString(); line.setLength(0);
            if (text.isEmpty()) {
                if (data.length() > 0 && (type.equals("state") || type.equals("notes") || type.equals("note")
                        || type.equals("config") || type.equals("presence") || type.equals("error"))) {
                    sink.accept(type, data.substring(0, data.length() - 1));
                }
                type = ""; data.setLength(0); frameSize = 0;
            } else {
                int colon = text.indexOf(':');
                String field = colon < 0 ? text : text.substring(0, colon);
                String content = colon < 0 ? "" : text.substring(colon + 1);
                if (content.startsWith(" ")) content = content.substring(1);
                if (field.equals("event")) type = content;
                if (field.equals("data")) data.append(content).append('\n');
            }
        }
    }

    /** Strict RFC 4648 decoder without the API-26 java.util.Base64 dependency. */
    static byte[] decodeUpload(String value) {
        if (value.length() > (UPLOAD_LIMIT + 2L) / 3 * 4 || value.length() % 4 != 0)
            throw new IllegalArgumentException("Invalid or oversized base64 upload");
        int padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
        int size = value.length() / 4 * 3 - padding;
        if (size < 0 || size > UPLOAD_LIMIT) throw new IllegalArgumentException("Upload too large");
        byte[] result = new byte[size];
        String alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        int bits = 0, count = 0, offset = 0;
        for (int i = 0; i < value.length() - padding; i++) {
            int digit = alphabet.indexOf(value.charAt(i));
            if (digit < 0) throw new IllegalArgumentException("Invalid base64 upload");
            bits = (bits << 6) | digit; count += 6;
            if (count >= 8) { count -= 8; result[offset++] = (byte)(bits >> count); }
        }
        if ((bits & ((1 << count) - 1)) != 0) throw new IllegalArgumentException("Invalid base64 padding");
        return result;
    }

    public static String validateOrigin(String value) {
        try {
            if (value == null || value.length() > 300) throw new IllegalArgumentException("Invalid origin");
            URI uri = new URI(value);
            String host = uri.getHost();
            String scheme = uri.getScheme();
            if (host == null || !("http".equals(scheme) || "https".equals(scheme))
                    || uri.getRawUserInfo() != null || !"".equals(uri.getRawPath())
                    || uri.getRawQuery() != null || uri.getRawFragment() != null
                    || uri.getPort() == 0 || uri.getPort() > 65535
                    || !uri.getRawAuthority().equals(host + (uri.getPort() == -1 ? "" : ":" + uri.getPort()))) {
                throw new IllegalArgumentException("Expected a bare tailnet origin");
            }
            boolean tailnet = false;
            if (host.matches("[0-9]+\\.[0-9]+\\.[0-9]+\\.[0-9]+")) {
                String[] parts = host.split("\\.");
                int[] ip = new int[4];
                for (int i = 0; i < 4; i++) {
                    ip[i] = Integer.parseInt(parts[i]);
                    if (ip[i] > 255 || !parts[i].equals(Integer.toString(ip[i]))) throw new IllegalArgumentException("Invalid IPv4");
                }
                tailnet = ip[0] == 100 && ip[1] >= 64 && ip[1] <= 127;
            } else if ("https".equals(scheme)) {
                tailnet = host.toLowerCase(Locale.ROOT).endsWith(".ts.net")
                    && host.matches("(?i)[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*");
            }
            if (!tailnet) throw new IllegalArgumentException("Only Tailscale origins are allowed");
            return value;
        } catch (java.net.URISyntaxException | NumberFormatException e) {
            throw new IllegalArgumentException("Invalid origin", e);
        }
    }

    private static URI relative(String url) {
        try {
            if (url == null || url.length() > 8192 || url.contains("\\") || url.matches("(?s).*[\\x00-\\x20\\x7f].*"))
                throw new IllegalArgumentException("Invalid request URL");
            URI uri = new URI(url);
            if (uri.isAbsolute() || uri.getRawAuthority() != null || uri.getRawFragment() != null
                    || !uri.getRawPath().startsWith("/api/") || !uri.getRawPath().equals(uri.getPath()))
                throw new IllegalArgumentException("Only relative API URLs are allowed");
            return uri;
        } catch (java.net.URISyntaxException e) { throw new IllegalArgumentException("Invalid URL", e); }
    }

    private static void query(URI uri, String allowed) {
        if (uri.getRawQuery() == null) return;
        Set<String> seen = new HashSet<>();
        for (String part : uri.getRawQuery().split("&", -1)) {
            int equals = part.indexOf('=');
            if (equals < 1) throw new IllegalArgumentException("Invalid query");
            String key = part.substring(0, equals);
            if (!allowed.contains("|" + key + "|") || !seen.add(key)) throw new IllegalArgumentException("Unexpected query parameter");
            String value;
            try { value = URLDecoder.decode(part.substring(equals + 1), "UTF-8"); }
            catch (Exception e) { throw new IllegalArgumentException("Invalid query encoding", e); }
            if (value.matches("(?s).*[\\x00-\\x1f\\x7f].*")) throw new IllegalArgumentException("Invalid query value");
        }
    }

    public static void validateRequest(String url, String method) {
        URI uri = relative(url);
        String methods;
        String keys = "";
        switch (uri.getPath()) {
            case "/api/state": methods = "|GET|"; break;
            case "/api/config": methods = "|GET|PUT|"; break;
            case "/api/permission": methods = "|PUT|"; break;
            case "/api/presence": methods = "|POST|"; break;
            case "/api/note": methods = "|GET|POST|PUT|PATCH|DELETE|"; keys = "|path|clientId|"; break;
            case "/api/folder": methods = "|POST|PATCH|DELETE|"; keys = "|path|clientId|"; break;
            case "/api/asset": methods = "|PATCH|DELETE|"; keys = "|path|clientId|"; break;
            case "/api/upload": methods = "|POST|"; keys = "|name|"; break;
            default: throw new IllegalArgumentException("API route not allowed");
        }
        if (method == null || !method.matches("[A-Z]+") || !methods.contains("|" + method + "|"))
            throw new IllegalArgumentException("API method not allowed");
        query(uri, keys);
    }

    public static String mediaMime(String path) {
        if (path == null || path.isEmpty() || path.length() > 4096 || path.startsWith("/")
                || path.contains("\\") || path.contains(":") || path.contains("%")
                || path.matches("(?s).*[\\x00-\\x1f\\x7f?#].*")) throw new IllegalArgumentException("Invalid media path");
        for (String part : path.split("/", -1)) {
            if (part.isEmpty() || part.equals(".") || part.equals("..")) throw new IllegalArgumentException("Invalid media path");
        }
        String extension = path.substring(path.lastIndexOf('.') + 1).toLowerCase(Locale.ROOT);
        switch (extension) {
            case "png": return "image/png";
            case "jpg": case "jpeg": return "image/jpeg";
            case "gif": return "image/gif";
            case "webp": return "image/webp";
            case "avif": return "image/avif";
            case "mp3": return "audio/mpeg";
            case "wav": return "audio/wav";
            case "ogg": return "audio/ogg";
            case "m4a": return "audio/mp4";
            case "mp4": return "video/mp4";
            case "webm": return "video/webm";
            default: throw new IllegalArgumentException("Only passive raster images, audio and video are supported");
        }
    }

    public static String mediaPath(String localOrigin, String url, String method, boolean mainFrame, String destination) {
        return mediaPath(localOrigin, url, method, mainFrame, destination, "/_pm_remote/file");
    }

    static String mediaPath(String localOrigin, String url, String method, boolean mainFrame, String destination, String route) {
        try {
            URI local = new URI(localOrigin);
            URI request = new URI(url);
            if (!"GET".equals(method) || mainFrame || request.getRawUserInfo() != null
                    || !local.getScheme().equals(request.getScheme()) || !local.getRawAuthority().equals(request.getRawAuthority())
                    || !route.equals(request.getRawPath()) || request.getRawFragment() != null
                    || destination != null && !destination.isEmpty() && !destination.equals("empty")
                        && !destination.equals("image") && !destination.equals("audio") && !destination.equals("video"))
                throw new IllegalArgumentException("Remote media cannot be used as a document");
            String query = request.getRawQuery();
            if (query == null || !query.startsWith("path=") || query.contains("&")) throw new IllegalArgumentException("Invalid media query");
            String path = URLDecoder.decode(query.substring(5), "UTF-8");
            mediaMime(path);
            return path;
        } catch (java.net.URISyntaxException | UnsupportedEncodingException e) { throw new IllegalArgumentException("Invalid media URL", e); }
    }
}
