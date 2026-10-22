package com.pentagory.pentamark;

import org.json.*;
import org.junit.Test;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.Locale;
import static org.junit.Assert.*;

public class SyncVaultTest {
    @Test public void parentFirstDeletePlanReplaysChildrenBeforeDirectory()throws Exception {
        SyncFileJournal files=journal(Files.createTempDirectory("sync-order-").toFile());
        JSONObject parent=new JSONObject().put("path","Notes").put("kind","directory").put("deleted",false).put("blobHash",JSONObject.NULL).put("byteLength",0);
        JSONObject child=version(files.store(new ByteArrayInputStream(new byte[]{42}),100),"Notes/A.md");files.apply(null,parent);files.apply(null,child);
        JSONArray changes=new JSONArray();for(JSONObject v:new JSONObject[]{parent,child})changes.put(new JSONObject().put("before",new JSONObject().put("local",v)).put("after",new JSONObject().put("local",new JSONObject(v.toString()).put("deleted",true))));
        JSONArray ordered=SyncFileJournal.orderChanges(changes);
        for(int retry=0;retry<2;retry++)for(int i=0;i<ordered.length();i++){JSONObject c=ordered.getJSONObject(i);files.apply(c.getJSONObject("before").getJSONObject("local"),c.getJSONObject("after").getJSONObject("local"));}
        assertFalse(files.target("Notes").exists());files.require(child.getString("blobHash"),1);
    }
    static SyncFileJournal journal(File root) throws Exception {
        return new SyncFileJournal(root, new SyncFileJournal.DurableFiles() {
            public void rename(File a, File b) throws IOException { Files.move(a.toPath(), b.toPath(), java.nio.file.StandardCopyOption.REPLACE_EXISTING); }
            public void syncDirectory(File d) {} // Windows JVM cannot fsync directories; Android instrumentation checks Os implementation.
            public boolean isLink(File f) { return Files.isSymbolicLink(f.toPath()); }
        });
    }
    static JSONObject version(JSONObject blob, String path) throws Exception {
        return new JSONObject(blob.toString()).put("entryId", "one").put("revision", "r").put("path", path).put("kind", "note").put("deleted", false);
    }
    @Test public void replayKeepsOldObjectsAndRejectsUntrackedDestination() throws Exception {
        SyncFileJournal j = journal(Files.createTempDirectory("sync-journal-").toFile());
        JSONObject a = version(j.store(new ByteArrayInputStream("old".getBytes(StandardCharsets.UTF_8)), 100), "A.md");
        JSONObject b = version(j.store(new ByteArrayInputStream("new".getBytes(StandardCharsets.UTF_8)), 100), "A.md");
        j.apply(null, a); j.apply(a, b); j.apply(a, b);
        assertEquals("new", new String(Files.readAllBytes(j.target("A.md").toPath()), StandardCharsets.UTF_8));
        j.require(a.getString("blobHash"), 3);
        JSONObject other = version(a, "B.md"); Files.write(j.target("B.md").toPath(), "untracked".getBytes(StandardCharsets.UTF_8));
        try { j.apply(b, other); fail("overwrote unknown destination"); } catch (IOException expected) { assertEquals("path-collision", expected.getMessage()); }
        assertEquals("untracked", new String(Files.readAllBytes(j.target("B.md").toPath()), StandardCharsets.UTF_8));
    }
    @Test public void contentOver32MiBStreamsAndHashMismatchNeverPublishes() throws Exception {
        SyncFileJournal j = journal(Files.createTempDirectory("sync-large-").toFile());
        final long size = 33L * 1024 * 1024 + 17;
        InputStream generated = new InputStream() {
            long remaining = size;
            public int read() { if (remaining-- > 0) return 77; return -1; }
            public int read(byte[] b, int off, int len) { if (remaining == 0) return -1; int n = (int)Math.min(remaining, len); java.util.Arrays.fill(b, off, off+n, (byte)77); remaining -= n; return n; }
        };
        JSONObject blob = j.store(generated, size); j.require(blob.getString("blobHash"), size);
        assertEquals(size, j.object(blob.getString("blobHash")).length());
        File partial = j.partial(blob.getString("blobHash")); Files.write(partial.toPath(), new byte[]{1,2});
        try { j.publish(partial, blob.getString("blobHash"), 2); fail("invalid hash accepted"); } catch (IOException expected) { assertEquals("invalid-blob", expected.getMessage()); }
        j.require(blob.getString("blobHash"), size);
    }
    @Test public void reopenedStagingRequiresCompleteLengthAndDigestBeforePublication()throws Exception {
        File root=Files.createTempDirectory("sync-crash-staging-").toFile();SyncFileJournal j=journal(root);
        String hash="ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
        Files.write(j.partial(hash).toPath(),"a".getBytes(StandardCharsets.UTF_8));j=journal(root);
        try{j.publish(j.partial(hash),hash,3);fail("short staging published");}catch(IOException expected){assertEquals("invalid-blob",expected.getMessage());}
        assertFalse(j.object(hash).exists());
        Files.write(j.partial(hash).toPath(),"abd".getBytes(StandardCharsets.UTF_8));j=journal(root);
        try{j.publish(j.partial(hash),hash,3);fail("corrupt staging published");}catch(IOException expected){assertEquals("invalid-blob",expected.getMessage());}
        assertFalse(j.object(hash).exists());
        Files.write(j.partial(hash).toPath(),"abc".getBytes(StandardCharsets.UTF_8));j.publish(j.partial(hash),hash,3);j.require(hash,3);
    }
    static JSONObject fixtures() throws Exception {
        InputStream resource = SyncVaultTest.class.getResourceAsStream("/sync/contract-cases.json");
        if (resource == null) resource = new FileInputStream("tests/fixtures/sync/contract-cases.json");
        try (InputStream in = resource; ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] b = new byte[4096]; int n;
            while ((n = in.read(b)) != -1) out.write(b, 0, n);
            return new JSONObject(new String(out.toByteArray(), StandardCharsets.UTF_8));
        }
    }

    @Test public void sharedPathsAreLocaleIndependent() throws Exception {
        Locale previous = Locale.getDefault();
        try {
            Locale.setDefault(new Locale("tr", "TR"));
            Class<?> paths = Class.forName("com.pentagory.pentamark.SyncPaths");
            JSONArray cases = fixtures().getJSONArray("paths");
            for (int i = 0; i < cases.length(); i++) {
                JSONObject c = cases.getJSONObject(i), expected = c.getJSONObject("expected");
                JSONObject actual = (JSONObject)paths.getMethod("validate", String.class).invoke(null, c.getString("input"));
                assertEquals(c.toString(), expected.getBoolean("ok"), actual.getBoolean("ok"));
                for (String key : expected.keySet()) assertEquals(c.toString(), expected.get(key), actual.get(key));
            }
        } finally { Locale.setDefault(previous); }
    }
}
