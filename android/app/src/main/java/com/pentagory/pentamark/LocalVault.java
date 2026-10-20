package com.pentagory.pentamark;

import org.json.JSONArray;
import org.json.JSONObject;
import java.io.*;
import java.net.URI;
import java.net.URLDecoder;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.security.MessageDigest;
import java.util.*;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

/** App-private, filesystem-backed API. All entry points serialize reads and writes.
 * One instance is owned by LocalVaultPlugin. No Android dependencies. */
public final class LocalVault {
    public static final int MAX_UPLOAD_BYTES = 32 * 1024 * 1024;
    public static final int HISTORY_LIMIT = 50;
    public static final long HISTORY_BYTES = 64L * 1024 * 1024;
    private final File root;
    private final FileAccess access;
    private String vaultName = "PentaMark";

    public LocalVault(File directory) throws Exception {
        this(directory, new JvmFileAccess());
    }

    /** Android supplies API-24-safe OS operations; JVM tests use java.nio. */
    public interface FileAccess {
        void move(File source, File destination, boolean replace) throws IOException;
        boolean isSymbolicLink(File file) throws IOException;
        byte[] decodeBase64(String value);
    }
    private static final class JvmFileAccess implements FileAccess {
        public void move(File source, File destination, boolean replace) throws IOException {
            if (replace) Files.move(source.toPath(), destination.toPath(), StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
            else Files.move(source.toPath(), destination.toPath());
        }
        public boolean isSymbolicLink(File file) { return Files.isSymbolicLink(file.toPath()); }
        public byte[] decodeBase64(String value) { return Base64.getDecoder().decode(value); }
    }

    public LocalVault(File directory, FileAccess fileAccess) throws Exception {
        access = fileAccess;
        root = directory.getCanonicalFile();
        mkdir(root);
        File settings = internal(".config.json");
        if (settings.isFile()) vaultName = new JSONObject(read(settings)).optString("vaultName", "PentaMark");
        File marker = internal(".initialized");
        if (!marker.exists()) {
            File welcome = target("Boas-vindas.md", true);
            if (!welcome.exists()) atomic(welcome, new ByteArrayInputStream(("# Boas-vindas ao PentaMark\n\nSeu cofre local salva notas Markdown e anexos neste dispositivo.\n\nUse Exportar para guardar uma cópia do cofre.\n").getBytes(StandardCharsets.UTF_8)), MAX_UPLOAD_BYTES);
            atomic(marker, new ByteArrayInputStream(new byte[]{1}), 1);
        }
    }

    public String getRoot() { return root.getAbsolutePath(); }

    private static JSONObject obj(Object... pairs) throws Exception {
        JSONObject value = new JSONObject();
        for (int i = 0; i < pairs.length; i += 2) value.put((String)pairs[i], pairs[i + 1]);
        return value;
    }
    private static final class ApiError extends IOException {
        final int status;
        ApiError(int status, String message) { super(message); this.status = status; }
    }
    private static JSONObject response(int status, JSONObject data) throws Exception { return obj("status", status, "data", data); }

    /** url may be relative or absolute; only its /api route and query are used. */
    public synchronized JSONObject request(String url, String method, String body, String base64) {
        try {
            URI uri = new URI(url);
            Map<String, String> query = new HashMap<>();
            if (uri.getRawQuery() != null) for (String pair : uri.getRawQuery().split("&")) {
                String[] p = pair.split("=", 2);
                query.put(URLDecoder.decode(p[0], "UTF-8"), p.length == 2 ? URLDecoder.decode(p[1], "UTF-8") : "");
            }
            String route = uri.getPath();
            method = method == null ? "GET" : method.toUpperCase(Locale.ROOT);
            if (base64 != null && !("/api/upload".equals(route) && "POST".equals(method))) throw new ApiError(400, "base64 somente para uploads");
            if (body != null && body.getBytes(StandardCharsets.UTF_8).length > 10 * 1024 * 1024) throw new ApiError(413, "Conteúdo grande demais");
            JSONObject data = body == null || body.isEmpty() ? new JSONObject() : new JSONObject(body);
            if ("/api/state".equals(route) && "GET".equals(method)) return response(200, state());
            if ("/api/config".equals(route)) {
                if ("GET".equals(method)) return response(200, config());
                if ("PUT".equals(method) || "PATCH".equals(method)) {
                    JSONObject current = config();
                    Iterator<String> keys = data.keys();
                    while (keys.hasNext()) {
                        String key = keys.next();
                        if (!key.equals("vaultName") && (!current.has(key) || !current.get(key).toString().equals(data.get(key).toString())))
                            throw new ApiError(400, "Configuração indisponível no modo local: " + key);
                    }
                    String name = data.has("vaultName") ? data.getString("vaultName").trim() : vaultName;
                    if (name.isEmpty()) name = "PentaMark";
                    name = name.substring(0, Math.min(80, name.length()));
                    atomic(internal(".config.json"), bytes(obj("vaultName", name).toString()), MAX_UPLOAD_BYTES);
                    vaultName = name;
                    return response(200, config().put("restartRequired", false));
                }
            }
            if ("/api/presence".equals(route) && "POST".equals(method)) return response(200, obj("ok", true, "lock", JSONObject.NULL));
            if ("/api/upload".equals(route) && "POST".equals(method)) {
                if (base64 == null || (body != null && !body.isEmpty())) throw new ApiError(400, "Upload requer base64, sem body");
                if (base64.length() > ((MAX_UPLOAD_BYTES + 2L) / 3L) * 4L) throw new ApiError(413, "Arquivo grande demais");
                byte[] decoded = access.decodeBase64(base64);
                if (decoded.length > MAX_UPLOAD_BYTES) throw new ApiError(413, "Arquivo grande demais");
                File file = unique("assets", safeName(query.getOrDefault("name", "arquivo")));
                atomic(file, new ByteArrayInputStream(decoded), MAX_UPLOAD_BYTES);
                String name = file.getName(), path = relative(file);
                String markdown = kind(name).equals("file") ? "[[" + path + "|" + name + "]]" : "![[" + path + "]]";
                return response(201, obj("name", name, "url", "/uploads/" + URLEncoder.encode(name, "UTF-8").replace("+", "%20"), "size", file.length(), "markdown", markdown));
            }
            boolean note = "/api/note".equals(route), folder = "/api/folder".equals(route), asset = "/api/asset".equals(route);
            if (!note && !folder && !asset) return response(404, obj("error", "Rota não encontrada"));
            if ("POST".equals(method) && (note || folder)) {
                File file = target(data.getString("path"), note);
                if (file.exists()) throw new ApiError(409, "Esse caminho já existe");
                if (folder) mkdir(file);
                else atomic(file, bytes(data.optString("content", "")), MAX_UPLOAD_BYTES);
                JSONObject result = obj("path", relative(file));
                if (note) result.put("revision", revision(read(file)));
                return response(201, result);
            }
            File file = target(query.get("path"), note);
            if (note && "PUT".equals(method)) {
                String content = data.getString("content");
                String expected = data.optString("baseRevision", "");
                if (file.exists()) {
                    if (!file.isFile()) throw new ApiError(400, "Não é um arquivo");
                    String old = read(file), rev = revision(old);
                    if (!expected.isEmpty() && !expected.equals(rev)) return response(409, obj("error", "A nota foi alterada", "currentRevision", rev));
                    if (old.equals(content)) return response(200, obj("path", relative(file), "revision", rev, "unchanged", true));
                    backup(file);
                } else if (!expected.isEmpty()) return response(409, obj("error", "A nota foi removida ou movida", "currentRevision", JSONObject.NULL));
                atomic(file, bytes(content), MAX_UPLOAD_BYTES);
                return response(200, obj("path", relative(file), "revision", revision(content)));
            }
            if (!file.exists()) throw new ApiError(404, "Arquivo não encontrado");
            if (folder != file.isDirectory()) throw new ApiError(400, "Tipo de caminho inválido");
            if (note && "GET".equals(method)) {
                String content = read(file);
                return response(200, metadata(file, true).put("content", content).put("revision", revision(content)));
            }
            if ("PATCH".equals(method)) {
                File destination = target(data.getString("newPath"), note);
                if (folder && (destination.equals(file) || destination.getPath().startsWith(file.getPath() + File.separator))) throw new ApiError(400, "Não é possível mover uma pasta para dentro dela mesma");
                if (destination.exists()) throw new ApiError(409, "Já existe um arquivo nesse caminho");
                mkdir(destination.getParentFile());
                access.move(file, destination, false);
                return response(200, obj("path", relative(destination)));
            }
            if ("DELETE".equals(method)) {
                String path = relative(file);
                File trash = internal(".trash/" + stamp() + "/" + path);
                mkdir(trash.getParentFile());
                access.move(file, trash, false);
                return response(200, obj("deleted", path));
            }
            return response(405, obj("error", "Método indisponível"));
        } catch (Exception e) {
            try { return response(e instanceof ApiError ? ((ApiError)e).status : e instanceof FileNotFoundException ? 404 : e instanceof IOException ? 500 : 400,
                    obj("error", e.getMessage() == null ? "Erro no cofre local" : e.getMessage())); }
            catch (Exception impossible) { throw new IllegalStateException(impossible); }
        }
    }

    private JSONObject config() throws Exception {
        return obj("vaultName", vaultName, "port", 0, "openBrowser", false, "maxUploadMB", 32,
                "lockEditedNotes", false, "cleanupUnusedAssets", false, "aiBridgeEnabled", false,
                "aiBridgeToken", "", "userPermissions", new JSONObject(), "isHost", false);
    }
    private JSONObject state() throws Exception {
        JSONArray notes = new JSONArray(), assets = new JSONArray(), folders = new JSONArray(), paths = new JSONArray();
        walk(root, notes, assets, folders, paths);
        return obj("app", "PentaMark", "protocolVersion", 6, "notes", notes, "assets", assets, "folders", folders,
                "assetPaths", paths, "clients", 1, "connections", new JSONArray(), "locks", new JSONArray(), "urls", new JSONArray(), "vaultName", vaultName, "isHost", false);
    }
    private void walk(File directory, JSONArray notes, JSONArray assets, JSONArray folders, JSONArray paths) throws Exception {
        for (File file : children(directory)) {
            if (file.getName().startsWith(".") || file.getName().equals("node_modules") || access.isSymbolicLink(file)) continue;
            target(relative(file), false);
            if (file.isDirectory()) { folders.put(relative(file)); walk(file, notes, assets, folders, paths); }
            else if (file.isFile()) {
                paths.put(relative(file));
                boolean note = file.getName().toLowerCase(Locale.ROOT).endsWith(".md");
                (note ? notes : assets).put(metadata(file, note));
            }
        }
    }
    private JSONObject metadata(File file, boolean note) throws Exception {
        String name = file.getName();
        JSONObject value = obj("path", relative(file), "title", note ? name.substring(0, name.length()-3) : name, "size", file.length(), "modified", file.lastModified());
        if (!note) value.put("extension", extension(name)).put("kind", kind(name));
        return value;
    }
    private static String extension(String name) { int dot = name.lastIndexOf('.'); return dot < 0 ? "" : name.substring(dot+1).toLowerCase(Locale.ROOT); }
    private static String kind(String name) {
        String ext = extension(name);
        if (Arrays.asList("avif", "bmp", "gif", "jpeg", "jpg", "png", "svg", "webp").contains(ext)) return "image";
        if (Arrays.asList("flac", "m4a", "mp3", "ogg", "wav", "3gp").contains(ext)) return "audio";
        if (Arrays.asList("mkv", "mov", "mp4", "ogv", "webm").contains(ext)) return "video";
        return ext.equals("pdf") ? "pdf" : "file";
    }
    private File target(String input, boolean note) throws Exception {
        if (input == null) throw new ApiError(400, "Caminho inválido");
        String path = input.trim().replace('\\', '/');
        if (path.isEmpty() || path.startsWith("/") || (note && !path.toLowerCase(Locale.ROOT).endsWith(".md"))) throw new ApiError(400, "Caminho inválido");
        for (String part : path.split("/", -1)) {
            if (part.isEmpty() || part.startsWith(".") || part.equals("node_modules") || part.matches("(?s).*[<>:\"|?*\\p{Cntrl}].*") || part.endsWith(".") || part.endsWith(" ") || part.matches("(?i)(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\\..*)?")) throw new ApiError(400, "Caminho inválido");
        }
        return contained(path);
    }
    private File internal(String path) throws Exception { return contained(path); }
    private File contained(String path) throws Exception {
        File raw = new File(root, path);
        File canonical = raw.getCanonicalFile();
        if (!canonical.getPath().startsWith(root.getPath() + File.separator)) throw new ApiError(400, "Caminho fora do cofre");
        // Reject all symlinks, including internal aliases to hidden files and dangling links.
        for (File f = raw; f != null && !f.equals(root); f = f.getParentFile())
            if (access.isSymbolicLink(f)) throw new ApiError(400, "Links simbólicos não são permitidos");
        return canonical;
    }
    private String relative(File file) { return file.getAbsolutePath().substring(root.getAbsolutePath().length() + 1).replace(File.separatorChar, '/'); }
    private static void mkdir(File file) throws IOException { if (!file.isDirectory() && !file.mkdirs()) throw new IOException("Não foi possível criar pasta"); }
    private static File[] children(File file) throws IOException {
        File[] files = file.listFiles();
        if (files == null) throw new IOException("Não foi possível ler pasta");
        Arrays.sort(files, Comparator.comparing(File::getName));
        return files;
    }
    private static String read(File file) throws IOException {
        try (InputStream in = new FileInputStream(file); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            copy(in, out, MAX_UPLOAD_BYTES);
            return new String(out.toByteArray(), StandardCharsets.UTF_8);
        }
    }
    private static InputStream bytes(String text) { return new ByteArrayInputStream(text.getBytes(StandardCharsets.UTF_8)); }
    private static String revision(String content) throws Exception {
        byte[] digest = MessageDigest.getInstance("SHA-256").digest(content.getBytes(StandardCharsets.UTF_8));
        StringBuilder result = new StringBuilder();
        for (int i = 0; i < 10; i++) result.append(String.format(Locale.ROOT, "%02x", digest[i] & 255));
        return result.toString();
    }
    private static String stamp() { return String.format(Locale.ROOT, "%013d-%s", System.currentTimeMillis(), UUID.randomUUID()); }
    private static long copy(InputStream input, OutputStream output, long limit) throws IOException {
        byte[] buffer = new byte[32768]; long count = 0; int n;
        while ((n = input.read(buffer)) != -1) {
            count += n;
            if (count > limit) throw new ApiError(413, "Arquivo grande demais");
            output.write(buffer, 0, n);
        }
        return count;
    }
    private void atomic(File destination, InputStream input, long limit) throws Exception {
        mkdir(destination.getParentFile());
        File temporary = File.createTempFile(".pentamark-", ".tmp", destination.getParentFile());
        try {
            try (FileOutputStream out = new FileOutputStream(temporary)) { copy(input, out, limit); out.getFD().sync(); }
            // Fail closed if atomic replacement is unavailable; never unlink the original.
            access.move(temporary, destination, true);
        } finally { if (temporary.exists() && !temporary.delete()) temporary.deleteOnExit(); }
    }
    private void backup(File file) throws Exception {
        File history = internal(".history"); mkdir(history);
        File snapshot = internal(".history/" + stamp() + "/" + relative(file));
        try (InputStream in = new FileInputStream(file)) { atomic(snapshot, in, Long.MAX_VALUE); }
        File[] entries = children(history); long total = 0;
        for (File entry : entries) total += treeSize(entry);
        int remaining = entries.length;
        for (File entry : entries) {
            if (remaining <= HISTORY_LIMIT && total <= HISTORY_BYTES) break;
            total -= treeSize(entry); removeHistory(entry); remaining--;
        }
    }
    private long treeSize(File file) throws Exception {
        internal(relative(file));
        if (file.isFile()) return file.length();
        long size = 0; for (File child : children(file)) size += treeSize(child); return size;
    }
    private void removeHistory(File file) throws Exception {
        internal(relative(file));
        if (!file.getPath().startsWith(new File(root, ".history").getPath() + File.separator)) throw new IOException("Histórico inválido");
        if (file.isDirectory()) for (File child : children(file)) removeHistory(child);
        if (!file.delete()) throw new IOException("Não foi possível remover histórico antigo");
    }
    private String safeName(String input) throws Exception {
        // Provider display names are untrusted; never let them select a directory.
        target(input, false);
        if (input.contains("/") || input.contains("\\")) throw new ApiError(400, "Nome de arquivo inválido");
        return input.trim();
    }
    private File unique(String folder, String name) throws Exception {
        int dot = name.lastIndexOf('.');
        String stem = dot > 0 ? name.substring(0, dot) : name, suffix = dot > 0 ? name.substring(dot) : "";
        for (int i = 0; i < 10000; i++) {
            File candidate = target((folder.isEmpty() ? "" : folder + "/") + stem + (i == 0 ? "" : "-" + i) + suffix, false);
            if (!candidate.exists()) return candidate;
        }
        throw new ApiError(409, "Não foi possível escolher um nome");
    }
    /** Copies provider bytes; never deletes or modifies the source. Caller closes input. */
    public synchronized String importDocument(String displayName, InputStream input) throws Exception {
        String name = safeName(displayName);
        File file = unique(name.toLowerCase(Locale.ROOT).endsWith(".md") || name.toLowerCase(Locale.ROOT).endsWith(".markdown") ? "" : "assets", name.toLowerCase(Locale.ROOT).endsWith(".markdown") ? name.substring(0, name.length()-9) + ".md" : name);
        atomic(file, input, MAX_UPLOAD_BYTES);
        return relative(file);
    }
    /** Caller owns output. Exports visible files AND config, initialization, history and trash. */
    public synchronized void exportZip(OutputStream output) throws Exception {
        // Close the compressor, but leave the caller's SAF stream ownership intact.
        try (ZipOutputStream zip = new ZipOutputStream(new FilterOutputStream(output) {
            @Override public void close() throws IOException { flush(); }
        })) {
            zipDirectory(root, zip);
            zip.finish();
        }
    }
    private void zipDirectory(File directory, ZipOutputStream zip) throws Exception {
        for (File file : children(directory)) {
            if (access.isSymbolicLink(file)) throw new IOException("Link simbólico no cofre");
            internal(relative(file));
            if (file.getName().startsWith(".pentamark-") && file.getName().endsWith(".tmp")) continue;
            ZipEntry entry = new ZipEntry(relative(file) + (file.isDirectory() ? "/" : ""));
            entry.setTime(file.lastModified()); zip.putNextEntry(entry);
            if (file.isFile()) try (InputStream in = new FileInputStream(file)) { copy(in, zip, Long.MAX_VALUE); }
            zip.closeEntry();
            if (file.isDirectory()) zipDirectory(file, zip);
        }
    }
}
