package com.pentagory.pentamark;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Before;
import org.junit.Rule;
import org.junit.Test;
import org.junit.Assume;
import org.junit.rules.TemporaryFolder;
import java.io.*;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.*;
import java.util.concurrent.*;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;
import static org.junit.Assert.*;

public class LocalVaultTest {
    @Rule public TemporaryFolder temporary = new TemporaryFolder();
    private File root;
    private LocalVault vault;
    @Before public void setup() throws Exception { root = temporary.newFolder("vault"); vault = new LocalVault(root); }
    private JSONObject request(String route, String method, JSONObject body, int expected) throws Exception {
        JSONObject response = vault.request("/api/" + route, method, body == null ? null : body.toString(), null);
        assertEquals(response.toString(), expected, response.getInt("status"));
        return response.getJSONObject("data");
    }
    private JSONObject create(String path, String content) throws Exception {
        return request("note", "POST", new JSONObject().put("path", path).put("content", content), 201);
    }
    private String path(String route, String path) throws Exception { return route + "?path=" + URLEncoder.encode(path, "UTF-8"); }
    private Set<String> strings(JSONArray values) throws Exception {
        Set<String> result = new HashSet<>(); for (int i=0; i<values.length(); i++) result.add(values.getString(i)); return result;
    }
    private Map<String, byte[]> export() throws Exception {
        ByteArrayOutputStream out = new ByteArrayOutputStream(); vault.exportZip(out);
        Map<String, byte[]> files = new HashMap<>();
        try (ZipInputStream zip = new ZipInputStream(new ByteArrayInputStream(out.toByteArray()))) {
            ZipEntry entry; byte[] buffer = new byte[8192];
            while ((entry = zip.getNextEntry()) != null) {
                ByteArrayOutputStream data = new ByteArrayOutputStream(); int n;
                while ((n = zip.read(buffer)) != -1) data.write(buffer, 0, n);
                files.put(entry.getName(), data.toByteArray());
            }
        }
        return files;
    }

    @Test public void persistsMarkdownConfigAndWelcomeOnlyOnce() throws Exception {
        create("Área/ação 日本語.md", "Olá 🌌");
        request("config", "PUT", new JSONObject().put("vaultName", "Meu cofre"), 200);
        request(path("note", "Boas-vindas.md"), "DELETE", null, 200);
        vault = new LocalVault(root);
        assertEquals("Olá 🌌", request(path("note", "Área/ação 日本語.md"), "GET", null, 200).getString("content"));
        assertFalse(new File(root, "Boas-vindas.md").exists());
        assertEquals("Meu cofre", request("state", "GET", null, 200).getString("vaultName"));
        assertEquals("Olá 🌌", new String(Files.readAllBytes(new File(root, "Área/ação 日本語.md").toPath()), StandardCharsets.UTF_8));
    }

    @Test public void revisionMatchesServerAndDetectsStaleAndDeletedNotes() throws Exception {
        JSONObject created = create("a.md", "hello");
        assertEquals("2cf24dba5fb0a30e26e8", created.getString("revision"));
        JSONObject update = new JSONObject().put("content", "world").put("baseRevision", created.getString("revision"));
        JSONObject changed = request("note?path=a.md", "PUT", update, 200);
        assertEquals(changed.getString("revision"), request("note?path=a.md", "PUT", update, 409).getString("currentRevision"));
        update.put("baseRevision", changed.getString("revision"));
        assertTrue(request("note?path=a.md", "PUT", update, 200).getBoolean("unchanged"));
        request("note?path=a.md", "DELETE", null, 200);
        request("note?path=a.md", "PUT", update, 409);
        assertFalse(new File(root, "a.md").exists());
    }

    @Test public void rejectsTraversalAbsoluteHiddenAndReservedPaths() throws Exception {
        for (String invalid : Arrays.asList("../escape.md", "a/../../escape.md", "/escape.md", "C:/escape.md", "a//b.md", ".history/a.md", ".trash/a.md", "a/.secret.md", "a/../b.md", "a/./b.md", "a\\..\\b.md", "nul.md", "a\u0000.md", "node_modules/a.md")) {
            request("note", "POST", new JSONObject().put("path", invalid), 400);
        }
        request("note?path=%2e%2e%2fescape.md", "GET", null, 400);
        request("note", "POST", new JSONObject().put("path", "a\nb\nc.md"), 400);
        assertFalse(new File(root.getParentFile(), "escape.md").exists());
    }

    @Test public void rejectsSymlinksOutsideAndToHiddenFiles() throws Exception {
        File outside = temporary.newFolder("outside");
        try { Files.createSymbolicLink(new File(root, "link").toPath(), outside.toPath()); }
        catch (IOException | UnsupportedOperationException | SecurityException e) { Assume.assumeNoException(e); }
        request("note", "POST", new JSONObject().put("path", "link/escape.md"), 400);
        assertFalse(new File(outside, "escape.md").exists());
        Files.createSymbolicLink(new File(root, "alias.md").toPath(), new File(root, ".initialized").toPath());
        request("note?path=alias.md", "GET", null, 400);
        assertFalse(strings(request("state", "GET", null, 200).getJSONArray("assetPaths")).contains("alias.md"));
    }

    @Test public void renamesFoldersAndMovesDeletesToRecoverableTrash() throws Exception {
        create("Origem/ação.md", "não perder");
        request("folder?path=Origem", "PATCH", new JSONObject().put("newPath", "Origem/dentro"), 400);
        request("folder?path=Origem", "PATCH", new JSONObject().put("newPath", "Destino"), 200);
        request(path("note", "Destino/ação.md"), "PATCH", new JSONObject().put("newPath", "Destino/日本語.md"), 200);
        request("folder?path=Destino", "DELETE", null, 200);
        assertFalse(new File(root, "Destino").exists());
        Map<String, byte[]> files = export();
        String trashed = files.keySet().stream().filter(p -> p.startsWith(".trash/") && p.endsWith("Destino/日本語.md")).findFirst().get();
        assertEquals("não perder", new String(files.get(trashed), StandardCharsets.UTF_8));
    }

    @Test public void uploadsUnicodeWithServerShapeAndCollisionSuffix() throws Exception {
        byte[] bytes = {0, 1, 2, (byte)255};
        String url = "/api/upload?name=" + URLEncoder.encode("ação 日本語.png", "UTF-8");
        JSONObject first = vault.request(url, "POST", null, Base64.getEncoder().encodeToString(bytes));
        assertEquals(201, first.getInt("status"));
        JSONObject data = first.getJSONObject("data");
        assertEquals("ação 日本語.png", data.getString("name"));
        assertEquals("![[assets/ação 日本語.png]]", data.getString("markdown"));
        assertTrue(data.getString("url").startsWith("/uploads/"));
        assertEquals(4, data.getInt("size"));
        assertArrayEquals(bytes, Files.readAllBytes(new File(root, "assets/ação 日本語.png").toPath()));
        JSONObject second = vault.request(url, "POST", null, Base64.getEncoder().encodeToString(bytes));
        assertEquals("ação 日本語-1.png", second.getJSONObject("data").getString("name"));
        JSONObject state = request("state", "GET", null, 200);
        assertTrue(strings(state.getJSONArray("assetPaths")).containsAll(Arrays.asList("Boas-vindas.md", "assets/ação 日本語.png", "assets/ação 日本語-1.png")));
        assertFalse(strings(state.getJSONArray("assetPaths")).contains(".initialized"));
    }

    @Test public void assetsRenameTrashAndDuplicateProtection() throws Exception {
        vault.importDocument("anexo.bin", new ByteArrayInputStream(new byte[]{10}));
        request("asset?path=assets/anexo.bin", "PATCH", new JSONObject().put("newPath", "mídia/anexo.bin"), 200);
        vault.importDocument("anexo.bin", new ByteArrayInputStream(new byte[]{20}));
        request("asset?path=assets/anexo.bin", "PATCH", new JSONObject().put("newPath", "mídia/anexo.bin"), 409);
        request(path("asset", "mídia/anexo.bin"), "DELETE", null, 200);
        assertTrue(export().keySet().stream().anyMatch(p -> p.startsWith(".trash/") && p.endsWith("mídia/anexo.bin")));
    }

    @Test public void offlineConfigRejectsUnsupportedChangesWithoutPartialSave() throws Exception {
        JSONObject config = request("config", "GET", null, 200);
        assertFalse(config.getBoolean("isHost"));
        assertEquals(32, config.getInt("maxUploadMB"));
        for (String key : Arrays.asList("aiBridgeEnabled", "openBrowser", "lockEditedNotes", "cleanupUnusedAssets")) {
            request("config", "PUT", new JSONObject().put("vaultName", "Wrong").put(key, true), 400);
        }
        request("config", "PUT", new JSONObject().put("port", 3417), 400);
        assertEquals("PentaMark", request("config", "GET", null, 200).getString("vaultName"));
        assertTrue(request("presence", "POST", new JSONObject(), 200).getBoolean("ok"));
    }

    @Test public void importsBinaryAndMarkdownWithoutOverwritingAndExportsEverything() throws Exception {
        String first = vault.importDocument("texto.markdown", new ByteArrayInputStream("primeiro".getBytes(StandardCharsets.UTF_8)));
        String second = vault.importDocument("texto.markdown", new ByteArrayInputStream("segundo".getBytes(StandardCharsets.UTF_8)));
        assertEquals("texto.md", first); assertEquals("texto-1.md", second);
        byte[] binary = {(byte)255, 0, (byte)128};
        assertEquals("assets/custom.unknown", vault.importDocument("custom.unknown", new ByteArrayInputStream(binary)));
        request("note?path=texto.md", "PUT", new JSONObject().put("content", "editado"), 200);
        Map<String, byte[]> files = export();
        assertArrayEquals(binary, files.get("assets/custom.unknown"));
        assertTrue(files.containsKey(".initialized"));
        assertTrue(files.keySet().stream().anyMatch(p -> p.startsWith(".history/") && p.endsWith("texto.md")));
        assertEquals("segundo", request("note?path=texto-1.md", "GET", null, 200).getString("content"));
    }

    @Test public void boundedHistoryKeepsRecentVersions() throws Exception {
        create("history.md", "v0");
        for (int i=1; i<=55; i++) request("note?path=history.md", "PUT", new JSONObject().put("content", "v" + i), 200);
        assertEquals(LocalVault.HISTORY_LIMIT, Objects.requireNonNull(new File(root, ".history").list()).length);
        assertEquals("v55", request("note?path=history.md", "GET", null, 200).getString("content"));
    }

    @Test public void oversizedImportLeavesNoPartialFileAndPreservesExisting() throws Exception {
        vault.importDocument("large.bin", new ByteArrayInputStream(new byte[]{7}));
        InputStream oversized = new InputStream() {
            long left = LocalVault.MAX_UPLOAD_BYTES + 1L;
            @Override public int read() { if (left == 0) return -1; left--; return 0; }
            @Override public int read(byte[] bytes, int offset, int length) {
                if (left == 0) return -1;
                int n = (int)Math.min(left, length); Arrays.fill(bytes, offset, offset+n, (byte)0); left -= n; return n;
            }
        };
        try { vault.importDocument("large.bin", oversized); fail("Expected size rejection"); }
        catch (IOException expected) { assertTrue(expected.getMessage().contains("grande")); }
        assertArrayEquals(new byte[]{7}, Files.readAllBytes(new File(root, "assets/large.bin").toPath()));
        assertFalse(new File(root, "assets/large-1.bin").exists());
        assertEquals(1, Objects.requireNonNull(new File(root, "assets").list()).length);
        assertEquals(400, vault.request("/api/upload?name=a.bin", "POST", null, "%%%").getInt("status"));
        assertEquals(400, vault.request("/api/state", "GET", null, "AA==").getInt("status"));
    }

    @Test public void concurrentStaleWritersHaveOneWinner() throws Exception {
        String revision = create("race.md", "original").getString("revision");
        ExecutorService workers = Executors.newFixedThreadPool(2);
        try {
            CountDownLatch start = new CountDownLatch(1);
            List<Future<Integer>> results = new ArrayList<>();
            for (int i=0; i<2; i++) {
                final int index = i;
                results.add(workers.submit(() -> {
                    start.await();
                    return vault.request("/api/note?path=race.md", "PUT", new JSONObject().put("content", "writer"+index).put("baseRevision", revision).toString(), null).getInt("status");
                }));
            }
            start.countDown();
            Set<Integer> statuses = new HashSet<>(); for (Future<Integer> result : results) statuses.add(result.get(10, TimeUnit.SECONDS));
            assertEquals(new HashSet<>(Arrays.asList(200, 409)), statuses);
        } finally { workers.shutdownNow(); }
    }

    @Test public void failedAtomicReplacementPreservesOriginalAndCleansTemporary() throws Exception {
        create("preserve.md", "original");
        vault = new LocalVault(root, new LocalVault.FileAccess() {
            public void move(File source, File destination, boolean replace) throws IOException {
                if (destination.getName().equals("preserve.md") && destination.getParentFile().equals(root)) throw new IOException("simulated disk error");
                Files.move(source.toPath(), destination.toPath(), java.nio.file.StandardCopyOption.ATOMIC_MOVE, java.nio.file.StandardCopyOption.REPLACE_EXISTING);
            }
            public boolean isSymbolicLink(File file) { return Files.isSymbolicLink(file.toPath()); }
            public byte[] decodeBase64(String value) { return Base64.getDecoder().decode(value); }
        });
        request("note?path=preserve.md", "PUT", new JSONObject().put("content", "replacement"), 500);
        assertEquals("original", request("note?path=preserve.md", "GET", null, 200).getString("content"));
        for (String name : Objects.requireNonNull(root.list())) assertFalse(name.startsWith(".pentamark-"));
    }

    @Test public void oversizedBase64UploadIsRejectedBeforeWriting() throws Exception {
        char[] chars = new char[((LocalVault.MAX_UPLOAD_BYTES + 2) / 3) * 4 + 4];
        Arrays.fill(chars, 'A');
        assertEquals(413, vault.request("/api/upload?name=too-large.bin", "POST", null, new String(chars)).getInt("status"));
        assertFalse(new File(root, "assets/too-large.bin").exists());
    }
}
