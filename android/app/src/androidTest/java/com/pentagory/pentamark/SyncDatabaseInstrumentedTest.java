package com.pentagory.pentamark;

import android.content.Context;
import androidx.test.core.app.ApplicationProvider;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import org.junit.*;
import org.junit.runner.RunWith;
import org.json.*;
import java.io.*;
import java.util.UUID;
import static org.junit.Assert.*;

@RunWith(AndroidJUnit4.class)
public class SyncDatabaseInstrumentedTest {
    Context context; SyncVault vault; JSONObject profile;
    @Before public void setup() throws Exception {
        context = ApplicationProvider.getApplicationContext();
        profile = new JSONObject().put("vaultId", UUID.randomUUID().toString()).put("replicaId", UUID.randomUUID().toString())
            .put("serverId", "test-server").put("origin", "http://100.64.0.1:3000").put("offlineEnabled", true).put("mode", "manual");
        vault = new SyncVault(context, profile);
    }
    @After public void close() { if (vault != null) vault.close(); }
    JSONObject write(String content) throws Exception {
        return vault.request("/api/note", "PUT", new JSONObject().put("path", "A.md").put("content", content));
    }
    JSONObject row() throws Exception { return vault.snapshot().getJSONArray("entries").getJSONObject(0); }
    JSONObject decision(String action, JSONObject row, Object remote) throws Exception {
        return new JSONObject().put("decision", new JSONObject().put("action", action).put("reason", "fixture")
            .put("base", row.get("base")).put("local", row.get("local")).put("remote", remote))
            .put("expectedLocalHead", row.getString("localHead"));
    }
    @Test public void sqliteUsesWalFullAndForeignKeys() throws Exception {
        assertEquals("wal", vault.database.pragma("journal_mode"));
        assertEquals("2", vault.database.pragma("synchronous"));
        assertEquals("1", vault.database.pragma("foreign_keys"));
    }
    @Test public void immutablePreparationSurvivesReopenAndOldAckPreservesNewEdit() throws Exception {
        write("first");
        JSONObject op = vault.preparePending(100).getJSONObject(0);
        write("second");
        vault.close(); vault = new SyncVault(context, profile);
        assertEquals(op.toString(), vault.preparePending(100).getJSONObject(0).toString());
        JSONObject confirmed = new JSONObject(row().getJSONObject("local").toString());
        confirmed.put("blobHash", op.getJSONObject("after").get("blobHash")).put("byteLength", 5).put("revision", "host-one");
        vault.confirm(new JSONObject().put("opId", op.getString("opId")).put("status", "applied").put("confirmed", confirmed));
        assertEquals("second", vault.request("/api/note?path=A.md", "GET", null).getJSONObject("data").getString("content"));
        JSONObject next = vault.preparePending(100).getJSONObject(0);
        assertEquals("host-one", next.getString("baseRevision"));
        assertNotEquals(op.getString("opId"), next.getString("opId"));
    }
    @Test public void stalePageRejectsEntireBatchAndCursor() throws Exception {
        write("first"); JSONObject before = row(); write("newer");
        JSONObject batch = new JSONObject().put("nextCursor", "must-not-advance").put("items", new JSONArray()
            .put(decision("push", row(), JSONObject.NULL)).put(decision("push", before, JSONObject.NULL)));
        try { vault.persistIncoming(batch); fail("stale page accepted"); }
        catch (IOException expected) { assertEquals("stale-local-head", expected.getMessage()); }
        assertTrue(vault.snapshot().isNull("cursor"));
        assertEquals("newer", vault.request("/api/note?path=A.md", "GET", null).getJSONObject("data").getString("content"));
    }
    @Test public void initialPagesDoNotConfirmCursorUntilFinalPage() throws Exception {
        JSONObject progress = new JSONObject().put("snapshotToken", "token").put("atCursor", "S").put("pageCursor", "page2");
        vault.persistIncoming(new JSONObject().put("epoch", "e").put("initialCopy", progress).put("nextCursor", "S").put("items", new JSONArray()));
        vault.close(); vault = new SyncVault(context, profile);
        assertTrue(vault.snapshot().isNull("cursor"));
        assertFalse(vault.snapshot().getJSONObject("status").getBoolean("snapshotComplete"));
        assertEquals("page2", vault.snapshot().getJSONObject("initialCopy").getString("pageCursor"));
        progress.put("pageCursor", JSONObject.NULL);
        vault.persistIncoming(new JSONObject().put("epoch", "e").put("initialCopy", progress).put("nextCursor", "S").put("items", new JSONArray()));
        assertEquals("S", vault.snapshot().getString("cursor"));
        assertTrue(vault.snapshot().getJSONObject("status").getBoolean("snapshotComplete"));
    }
    @Test public void conflictResolutionRejectsStaleHeadAndRetainsMergedBytes() throws Exception {
        write("local"); JSONObject r = row();
        JSONObject remote = new JSONObject(r.getJSONObject("local").toString()).put("revision", "remote-r");
        vault.persistIncoming(new JSONObject().put("nextCursor", "c").put("items", new JSONArray().put(decision("conflict", r, remote))));
        JSONObject conflict = vault.snapshot().getJSONArray("conflicts").getJSONObject(0);
        write("later");
        try { vault.resolve(new JSONObject().put("conflictId", conflict.getString("conflictId"))
            .put("expectedLocalHead", r.getString("localHead")).put("expectedRemoteRevision", "remote-r")
            .put("choice", "merged").put("mergedContent", "user merge")); fail("stale resolution accepted"); }
        catch (IOException expected) { assertEquals("stale-local-head", expected.getMessage()); }
        assertEquals(1, vault.snapshot().getJSONArray("conflicts").length());
        assertEquals("later", vault.request("/api/note?path=A.md", "GET", null).getJSONObject("data").getString("content"));
        assertTrue(vault.database.count("versions") >= 3);
    }
    @Test public void committedIntentReplaysAfterFileRenameBeforeMetadataCommit() throws Exception {
        write("before"); JSONObject before=row();
        JSONObject old=vault.database.all("entries").getJSONObject(0), next=new JSONObject(old.toString());
        JSONObject blob=vault.files.store(new ByteArrayInputStream("after".getBytes("UTF-8")),100);
        JSONObject local=new JSONObject(before.getJSONObject("local").toString()).put("blobHash",blob.getString("blobHash")).put("byteLength",5).put("revision","after-local");
        next.put("local",local).put("localHead","new-head").put("dirty",true);
        JSONObject plan=SyncVault.obj("id","crash","rows",new JSONArray().put(SyncVault.obj("before",old,"after",next)),"conflicts",new JSONArray(),
            "removeConflicts",new JSONArray(),"removePending",new JSONArray(),"applied",new JSONArray(),"meta",vault.database.get("vaults","meta"));
        vault.database.put("file_intents","crash",plan);
        vault.files.apply(old.getJSONObject("local"),local);
        vault.close();vault=new SyncVault(context,profile);
        assertEquals("after",vault.request("/api/note?path=A.md","GET",null).getJSONObject("data").getString("content"));
        assertEquals(0,vault.database.count("file_intents"));
        assertEquals("new-head",row().getString("localHead"));
        assertEquals(1,vault.preparePending(100).length());
        vault.files.require(old.getJSONObject("local").getString("blobHash"),6);
    }
    @Test public void caseOnlyRenamePreservesIdentityAndBytes() throws Exception {
        write("same");String entry=row().getJSONObject("local").getString("entryId");
        vault.request("/api/note?path=A.md","PATCH",new JSONObject().put("newPath","a.md"));
        assertEquals(entry,row().getJSONObject("local").getString("entryId"));
        assertEquals("a.md",row().getJSONObject("local").getString("path"));
        assertEquals("same",vault.request("/api/note?path=a.md","GET",null).getJSONObject("data").getString("content"));
        vault.close();vault=new SyncVault(context,profile);
        assertEquals("a.md",row().getJSONObject("local").getString("path"));
    }
    @Test public void incomingDuplicatePathNeverOverwritesDistinctIdentity() throws Exception {
        JSONObject blob=vault.files.store(new ByteArrayInputStream(new byte[]{1}),100);
        JSONArray items=new JSONArray();
        for(String id:new String[]{"one","two"}) {
            JSONObject remote=SyncVault.obj("entryId",id,"kind","note","path","same.md","revision","r","blobHash",blob.getString("blobHash"),"byteLength",1,"deleted",false);
            items.put(SyncVault.obj("expectedLocalHead","","decision",SyncVault.obj("action","pull","reason","remote-only","base",null,"local",null,"remote",remote)));
        }
        try{vault.persistIncoming(SyncVault.obj("nextCursor","bad","items",items));fail("collision accepted");}catch(IOException expected){assertEquals("path-collision",expected.getMessage());}
        assertEquals(0,vault.snapshot().getJSONArray("entries").length());assertTrue(vault.snapshot().isNull("cursor"));
    }
}
