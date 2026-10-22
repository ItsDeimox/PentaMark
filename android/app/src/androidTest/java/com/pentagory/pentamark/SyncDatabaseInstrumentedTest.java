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
        for(int reopen=0;reopen<2;reopen++) {
            java.util.concurrent.ExecutorService reader=java.util.concurrent.Executors.newSingleThreadExecutor();
            try {
                for(int attempt=0;attempt<3;attempt++) {
                    assertEquals("wal", vault.database.pragma("journal_mode"));
                    assertEquals("2", vault.database.pragma("synchronous"));
                    assertEquals("1", vault.database.pragma("foreign_keys"));
                    reader.submit(() -> {
                        assertEquals("wal",vault.database.pragma("journal_mode"));
                        assertEquals("2",vault.database.pragma("synchronous"));
                        assertEquals("1",vault.database.pragma("foreign_keys"));
                    }).get(5,java.util.concurrent.TimeUnit.SECONDS);
                    vault.database.transaction(() -> assertEquals("2",vault.database.pragma("synchronous")));
                }
            }finally{reader.shutdownNow();}
            vault.close();vault=new SyncVault(context,profile);
        }
    }
    @Test public void privateRootAliasWorksButWorkingSymlinkRemainsForbidden()throws Exception {
        assertEquals(vault.files.working.getCanonicalFile(),vault.files.working);
        write("private");assertTrue(vault.files.target("A.md").isFile());
        File link=new File(vault.files.working,"escape");
        android.system.Os.symlink(vault.files.objects.getAbsolutePath(),link.getAbsolutePath());
        try{vault.files.target("escape/object");fail("working symlink followed");}
        catch(IOException expected){assertEquals("unsafe-path",expected.getMessage());}
    }
    @Test public void parentFirstIncomingDeletesCommitAndReopenWithoutStuckIntent()throws Exception {
        vault.request("/api/folder","POST",SyncVault.obj("path","Notes"));vault.request("/api/note","PUT",SyncVault.obj("path","Notes/A.md","content","retained"));
        JSONArray rows=vault.snapshot().getJSONArray("entries"),items=new JSONArray();
        for(int i=0;i<rows.length();i++){JSONObject row=rows.getJSONObject(i),deleted=new JSONObject(row.getJSONObject("local").toString()).put("revision","host-delete").put("deleted",true).put("blobHash",JSONObject.NULL).put("byteLength",0);items.put(decision("pull",row,deleted));}
        vault.persistIncoming(SyncVault.obj("nextCursor","deleted-cursor","items",items));
        assertEquals(0,vault.database.count("file_intents"));assertFalse(vault.files.target("Notes").exists());
        vault.close();vault=new SyncVault(context,profile);assertEquals("deleted-cursor",vault.snapshot().getString("cursor"));assertEquals(0,vault.database.count("file_intents"));
    }
    @Test public void directorySyncChecksOpenedDescriptorType()throws Exception {
        SyncFileJournal.DurableFiles fs=SyncVault.androidFiles();fs.syncDirectory(vault.files.working);
        File ordinary=new File(vault.files.working,"ordinary");try(FileOutputStream out=new FileOutputStream(ordinary)){out.write(1);}
        try{fs.syncDirectory(ordinary);fail("regular file accepted as directory");}catch(IOException expected){assertEquals("unsafe-path",expected.getMessage());}
        File link=new File(vault.files.working,"link");android.system.Os.symlink(vault.files.objects.getAbsolutePath(),link.getAbsolutePath());
        try{fs.syncDirectory(link);fail("directory symlink followed");}catch(IOException expected){}
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
    @Test public void editThenRenameConfirmsMoveWithoutLosingPendingContentUpdate()throws Exception {
        write("old");JSONObject create=vault.preparePending(100).getJSONObject(0),base=new JSONObject(row().getJSONObject("local").toString()).put("revision","host-base");
        vault.confirm(SyncVault.obj("opId",create.getString("opId"),"status","applied","confirmed",base));write("edited");
        vault.request("/api/note?path=A.md","PATCH",SyncVault.obj("newPath","B.md"));JSONObject move=vault.preparePending(100).getJSONObject(0);
        assertEquals("move",move.getString("kind"));assertEquals(base.getString("blobHash"),move.getJSONObject("after").getString("blobHash"));
        vault.close();vault=new SyncVault(context,profile);assertEquals(move.toString(),vault.preparePending(100).getJSONObject(0).toString());
        JSONObject moved=new JSONObject(base.toString()).put("path","B.md").put("revision","host-moved");vault.confirm(SyncVault.obj("opId",move.getString("opId"),"status","applied","confirmed",moved));
        assertEquals("edited",vault.request("/api/note?path=B.md","GET",null).getJSONObject("data").getString("content"));assertEquals(1,vault.status().getInt("pendingCount"));
        JSONObject put=vault.preparePending(100).getJSONObject(0);assertEquals("put",put.getString("kind"));assertEquals("B.md",put.getJSONObject("after").getString("path"));assertEquals("host-moved",put.getString("baseRevision"));assertNotEquals(move.getString("opId"),put.getString("opId"));
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
        boolean retained=false;JSONArray history=vault.history(r.getJSONObject("local").getString("entryId"));
        for(int i=0;i<history.length();i++)if(vault.readVersion(history.getJSONObject(i)).getString("content").equals("user merge"))retained=true;
        assertTrue("stale resolution discarded user merge",retained);
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
    @Test public void folderDeletionPlansChildrenFirstAndKeepsUnknownFiles() throws Exception {
        vault.request("/api/folder","POST",SyncVault.obj("path","Notes"));
        vault.request("/api/note","POST",SyncVault.obj("path","Notes/A.md","content","keep"));
        // Prepare first so deleting a formerly visible folder cannot be consolidated away.
        JSONArray prepared=vault.preparePending(100);
        for(int i=0;i<prepared.length();i++) {
            JSONObject op=prepared.getJSONObject(i), after=op.getJSONObject("after");
            vault.confirm(SyncVault.obj("opId",op.getString("opId"),"status","applied","confirmed",SyncVault.obj("entryId",op.getString("entryId"),
                "kind",after.getString("kind"),"path",after.getString("path"),"blobHash",after.get("blobHash"),"byteLength",after.getLong("byteLength"),"deleted",false,"revision","confirmed-"+i)));
        }
        File unknown=new File(vault.files.working,"Notes/unknown.bin");try(FileOutputStream out=new FileOutputStream(unknown)){out.write(7);out.getFD().sync();}
        try{vault.request("/api/folder?path=Notes","DELETE",null);fail("unknown child removed");}catch(IOException expected){assertEquals("directory-not-empty",expected.getMessage());}
        assertTrue(unknown.exists());assertEquals("keep",vault.request("/api/note?path=Notes/A.md","GET",null).getJSONObject("data").getString("content"));
        assertTrue(unknown.delete());
        vault.request("/api/folder?path=Notes","DELETE",null);
        JSONArray ops=vault.preparePending(100);assertEquals(2,ops.length());
        assertEquals("delete",ops.getJSONObject(0).getString("kind"));assertEquals("rmdir",ops.getJSONObject(1).getString("kind"));
        assertEquals(ops.getJSONObject(0).getString("opId"),ops.getJSONObject(1).getJSONArray("dependsOn").getString(0));
    }
    @Test public void folderRenameMovesKnownChildrenAndRetainsHistory() throws Exception {
        vault.request("/api/folder","POST",SyncVault.obj("path","Notes"));
        vault.request("/api/note","POST",SyncVault.obj("path","Notes/A.md","content","bytes"));
        vault.request("/api/folder?path=Notes","PATCH",SyncVault.obj("newPath","Renamed"));
        assertEquals("bytes",vault.request("/api/note?path=Renamed/A.md","GET",null).getJSONObject("data").getString("content"));
        assertFalse(new File(vault.files.working,"Notes").exists());
        vault.close();vault=new SyncVault(context,profile);
        assertEquals("bytes",vault.request("/api/note?path=Renamed/A.md","GET",null).getJSONObject("data").getString("content"));
    }
    @Test public void confirmedFolderRenameUsesMkdirChildMoveRmdirWithConditionalDependencies()throws Exception {
        vault.request("/api/folder","POST",SyncVault.obj("path","Notes"));vault.request("/api/note","POST",SyncVault.obj("path","Notes/A.md","content","bytes"));
        JSONArray initial=vault.preparePending(100);
        for(int i=0;i<initial.length();i++){JSONObject op=initial.getJSONObject(i),v=new JSONObject(op.getJSONObject("after").toString()).put("entryId",op.getString("entryId")).put("deleted",false).put("revision","base-"+i);vault.confirm(SyncVault.obj("opId",op.getString("opId"),"status","applied","confirmed",v));}
        vault.request("/api/folder?path=Notes","PATCH",SyncVault.obj("newPath","Renamed"));vault.close();vault=new SyncVault(context,profile);
        JSONArray ops=vault.preparePending(100);assertEquals(3,ops.length());
        JSONObject mkdir=ops.getJSONObject(0),move=ops.getJSONObject(1),rmdir=ops.getJSONObject(2);
        assertEquals("mkdir",mkdir.getString("kind"));assertTrue(mkdir.isNull("baseRevision"));
        assertEquals("move",move.getString("kind"));assertEquals("note",move.getJSONObject("after").getString("kind"));assertEquals("base-1",move.getString("baseRevision"));
        assertEquals(mkdir.getString("opId"),move.getJSONArray("dependsOn").getString(0));
        assertEquals("rmdir",rmdir.getString("kind"));assertEquals("base-0",rmdir.getString("baseRevision"));assertEquals(move.getString("opId"),rmdir.getJSONArray("dependsOn").getString(0));
        assertNotEquals(initial.getJSONObject(0).getString("entryId"),mkdir.getString("entryId"));assertEquals(initial.getJSONObject(1).getString("entryId"),move.getString("entryId"));
        assertEquals(ops.toString(),vault.preparePending(100).toString());assertEquals("bytes",vault.request("/api/note?path=Renamed/A.md","GET",null).getJSONObject("data").getString("content"));
    }
    @Test public void keepBothResolvesDistinctIdsWithoutReassigningIdentity() throws Exception {
        write("local");JSONObject before=row();JSONObject blob=vault.files.store(new ByteArrayInputStream("remote".getBytes("UTF-8")),100);
        JSONObject remote=SyncVault.obj("entryId","other","kind","note","path","A.md","revision","remote","blobHash",blob.getString("blobHash"),"byteLength",6,"deleted",false);
        vault.persistIncoming(SyncVault.obj("nextCursor","c","items",new JSONArray().put(decision("conflict",before,remote))));
        JSONObject conflict=vault.snapshot().getJSONArray("conflicts").getJSONObject(0);
        vault.resolve(SyncVault.obj("conflictId",conflict.getString("conflictId"),"expectedLocalHead",before.getString("localHead"),"expectedRemoteRevision","remote","choice","keep-both"));
        assertEquals(0,vault.snapshot().getJSONArray("conflicts").length());assertEquals(2,vault.snapshot().getJSONArray("entries").length());
        assertEquals("remote",vault.request("/api/note?path=A.md","GET",null).getJSONObject("data").getString("content"));
        JSONObject op=vault.preparePending(100).getJSONObject(0);assertEquals(before.getJSONObject("local").getString("entryId"),op.getString("entryId"));
        assertTrue(op.getJSONObject("after").getString("path").startsWith("A.md.conflict-"));
    }
    @Test public void crossIdentityResolutionNeverOverwritesOtherDirtyPreparedOrNewerHead()throws Exception {
        write("A bytes");JSONObject a=row();vault.request("/api/note","PUT",SyncVault.obj("path","B.md","content","B bytes"));
        JSONObject b=vault.database.all("entries").getJSONObject(1),remote=new JSONObject(b.getJSONObject("local").toString()).put("path","A.md").put("revision","remote-old");
        vault.persistIncoming(SyncVault.obj("nextCursor","c","items",new JSONArray().put(decision("conflict",a,remote))));
        String conflictId=vault.snapshot().getJSONArray("conflicts").getJSONObject(0).getString("conflictId");
        JSONObject input=SyncVault.obj("conflictId",conflictId,"expectedLocalHead",a.getString("localHead"),"expectedRemoteRevision","remote-old","choice","keep-both");
        for(int scenario=0;scenario<3;scenario++) {
            if(scenario==1)vault.preparePending(100);
            if(scenario==2) {
                JSONArray pending=vault.database.all("pending_ops");for(int i=0;i<pending.length();i++)vault.database.remove("pending_ops",pending.getJSONObject(i).getJSONObject("operation").getString("opId"));
                JSONObject newer=new JSONObject(b.getJSONObject("local").toString()).put("revision","newer-confirmed");b.put("base",newer).put("local",newer).put("dirty",false).put("localHead","newer-head");vault.database.put("entries",b.getString("entryId"),b);
            }
            String before=vault.snapshot().toString();try{vault.resolve(input);fail("other identity overwritten, case "+scenario);}catch(IOException expected){assertEquals("stale-local-head",expected.getMessage());}
            assertEquals(before,vault.snapshot().toString());assertEquals("B bytes",vault.request("/api/note?path=B.md","GET",null).getJSONObject("data").getString("content"));
        }
    }
    @Test public void retainedHistoryCanBeReadAfterReopen()throws Exception {
        write("old bytes");JSONObject old=row().getJSONObject("local");write("new bytes");
        vault.close();vault=new SyncVault(context,profile);
        assertTrue(vault.history(old.getString("entryId")).length()>=2);
        assertEquals("old bytes",vault.readVersion(old).getString("content"));
    }
    @Test public void offlineStateKeepsNotesAssetsAndFoldersInTheirApiCollections()throws Exception {
        vault.request("/api/folder","POST",SyncVault.obj("path","Notes"));
        vault.request("/api/note","POST",SyncVault.obj("path","Notes/A.md","content","note"));
        vault.importStream("pic.png",new ByteArrayInputStream(new byte[]{1,2,3}),100);
        JSONObject state=vault.request("/api/state","GET",null).getJSONObject("data");
        assertEquals(1,state.getJSONArray("notes").length());assertEquals(1,state.getJSONArray("assets").length());
        assertEquals("A",state.getJSONArray("notes").getJSONObject(0).getString("title"));
        assertEquals("image",state.getJSONArray("assets").getJSONObject(0).getString("kind"));
        assertEquals("Notes",state.getJSONArray("folders").getString(0));assertEquals(2,state.getJSONArray("assetPaths").length());
        assertEquals(0,state.getJSONArray("locks").length());
        JSONObject config=vault.request("/api/config","GET",null).getJSONObject("data");
        assertFalse(config.getBoolean("isHost"));assertFalse(config.getBoolean("cleanupUnusedAssets"));
        assertFalse(config.getBoolean("aiBridgeEnabled"));assertEquals("",config.getString("aiBridgeToken"));
    }
    @Test public void nestedAssetImportPersistsParentRowsAndMkdirDependenciesAfterReopen()throws Exception {
        JSONObject imported=vault.importStream("assets/nested/referencia.pdf",new ByteArrayInputStream(new byte[]{1,2,3}),100);
        assertTrue(vault.files.target("assets/nested/referencia.pdf").isFile());vault.close();vault=new SyncVault(context,profile);
        assertEquals(3,vault.snapshot().getJSONArray("entries").length());JSONArray ops=vault.preparePending(100);assertEquals(3,ops.length());
        JSONObject root=ops.getJSONObject(0),nested=ops.getJSONObject(1),asset=ops.getJSONObject(2);
        assertEquals("mkdir",root.getString("kind"));assertEquals("assets",root.getJSONObject("after").getString("path"));assertTrue(root.isNull("baseRevision"));
        assertEquals("mkdir",nested.getString("kind"));assertEquals("assets/nested",nested.getJSONObject("after").getString("path"));assertEquals(root.getString("opId"),nested.getJSONArray("dependsOn").getString(0));
        assertEquals("put",asset.getString("kind"));assertEquals("assets/nested/referencia.pdf",asset.getJSONObject("after").getString("path"));assertEquals(2,asset.getJSONArray("dependsOn").length());assertEquals(root.getString("opId"),asset.getJSONArray("dependsOn").getString(0));assertEquals(nested.getString("opId"),asset.getJSONArray("dependsOn").getString(1));
        vault.files.require(imported.getString("blobHash"),3);vault.close();vault=new SyncVault(context,profile);assertEquals(ops.toString(),vault.preparePending(100).toString());
    }
    @Test public void nativeDownloadAllowsEditsAndResumesDurableOffsetAfterReopen()throws Exception {
        write("initial");JSONObject prepared=vault.preparePending(100).getJSONObject(0);
        File source=File.createTempFile("sync-source-",".bin",context.getCacheDir());long total=2097152;
        try(RandomAccessFile file=new RandomAccessFile(source,"rw")){file.setLength(total);file.getFD().sync();}
        String hash=SyncFileJournal.hash(source);JSONObject blob=SyncVault.obj("blobHash",hash,"byteLength",total);
        java.util.concurrent.CountDownLatch started=new java.util.concurrent.CountDownLatch(1),release=new java.util.concurrent.CountDownLatch(1);
        java.util.concurrent.atomic.AtomicReference<Throwable> failure=new java.util.concurrent.atomic.AtomicReference<>();
        java.util.concurrent.ExecutorService executor=java.util.concurrent.Executors.newSingleThreadExecutor();
        try(java.net.ServerSocket server=new java.net.ServerSocket(0,1,java.net.InetAddress.getByName("127.0.0.1"))) {
            server.setSoTimeout(10000);Thread worker=new Thread(() -> {
                try {
                    for(int chunk=0;chunk<2;chunk++)try(java.net.Socket socket=server.accept()) {
                        socket.setSoTimeout(10000);BufferedReader reader=new BufferedReader(new InputStreamReader(socket.getInputStream(),"US-ASCII"));String line;
                        while((line=reader.readLine())!=null&&!line.isEmpty()){}
                        if(chunk==0){started.countDown();if(!release.await(10,java.util.concurrent.TimeUnit.SECONDS))throw new IOException("edit blocked by transfer");}
                        long start=(long)chunk*1048576;OutputStream out=socket.getOutputStream();
                        out.write(("HTTP/1.1 206 Partial Content\r\nContent-Type: application/octet-stream\r\nContent-Length: 1048576\r\nContent-Range: bytes "+start+"-"+(start+1048575)+"/2097152\r\nConnection: close\r\n\r\n").getBytes("US-ASCII"));
                        byte[] zeros=new byte[65536];for(int i=0;i<16;i++)out.write(zeros);
                    }
                }catch(Throwable error){failure.set(error);}
            });worker.setDaemon(true);worker.start();
            RemoteConnection connection=new RemoteConnection("http://100.64.0.1:3000",url -> (java.net.HttpURLConnection)new java.net.URL("http://127.0.0.1:"+server.getLocalPort()+url.getFile()).openConnection(java.net.Proxy.NO_PROXY));
            try {
                final SyncVault active=vault;
                java.util.concurrent.Future<JSONObject> transfer=executor.submit(() -> active.transfer(connection,blob,0,total,false));
                assertTrue(started.await(10,java.util.concurrent.TimeUnit.SECONDS));write("edited during network");release.countDown();
                assertEquals(1048576,transfer.get(10,java.util.concurrent.TimeUnit.SECONDS).getLong("verifiedBytes"));
                vault.close();vault=new SyncVault(context,profile);
                assertEquals(1048576,vault.transferProgress().getJSONObject(0).getLong("verifiedBytes"));
                // Shared engine always starts a fresh attempt at zero; native storage negotiates progress.
                assertEquals(1048576,vault.transfer(connection,blob,0,total,false).getLong("verifiedBytes"));
                assertTrue(vault.transfer(connection,blob,1048576,total,false).getBoolean("complete"));
                vault.files.require(hash,total);
                assertEquals("edited during network",vault.request("/api/note?path=A.md","GET",null).getJSONObject("data").getString("content"));
                assertEquals(prepared.toString(),vault.preparePending(100).getJSONObject(0).toString());
                worker.join(10000);assertFalse(worker.isAlive());if(failure.get()!=null)throw new AssertionError(failure.get());
            }finally{release.countDown();connection.close();}
        }finally{executor.shutdownNow();}
    }
    @Test public void uploadRetryRevalidatesCompletedReceiptAfterRemoteStorageLoss()throws Exception {
        long total=2097152;File source=File.createTempFile("upload-retry-",".bin",context.getCacheDir());try(RandomAccessFile file=new RandomAccessFile(source,"rw")){file.setLength(total);}
        JSONObject blob;try(InputStream input=new FileInputStream(source)){blob=vault.files.store(input,total);}String hash=blob.getString("blobHash");
        java.util.concurrent.atomic.AtomicReference<Throwable> failure=new java.util.concurrent.atomic.AtomicReference<>();
        try(java.net.ServerSocket server=new java.net.ServerSocket(0,1,java.net.InetAddress.getByName("127.0.0.1"))) {
            server.setSoTimeout(10000);Thread worker=new Thread(() -> {
                try {
                    long[] offsets={0,0,1048576,0,1048576},acks={1048576,1048576,2097152,1048576,2097152};
                    for(int request=0;request<offsets.length;request++)try(java.net.Socket socket=server.accept()) {
                        socket.setSoTimeout(10000);InputStream in=socket.getInputStream();ByteArrayOutputStream header=new ByteArrayOutputStream();int ch;
                        while((ch=in.read())!=-1){header.write(ch);if(header.size()>8192)throw new IOException("headers too long");if(header.toString("US-ASCII").endsWith("\r\n\r\n"))break;}
                        assertTrue(header.toString("US-ASCII").contains("?offset="+offsets[request]+" HTTP/1.1"));
                        byte[] buffer=new byte[65536];long remaining=1048576;while(remaining>0){int n=in.read(buffer,0,(int)Math.min(remaining,buffer.length));if(n<0)throw new EOFException();remaining-=n;}
                        byte[] response=SyncVault.obj("blobHash",hash,"verifiedBytes",acks[request],"complete",acks[request]==total).toString().getBytes("UTF-8");
                        OutputStream out=socket.getOutputStream();out.write(("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: "+response.length+"\r\nConnection: close\r\n\r\n").getBytes("US-ASCII"));out.write(response);
                    }
                }catch(Throwable error){failure.set(error);}
            });worker.setDaemon(true);worker.start();
            RemoteConnection remote=new RemoteConnection(profile.getString("origin"),url -> (java.net.HttpURLConnection)new java.net.URL("http://127.0.0.1:"+server.getLocalPort()+url.getFile()).openConnection(java.net.Proxy.NO_PROXY));
            try {
                assertEquals(1048576,vault.transfer(remote,blob,0,total,true).getLong("verifiedBytes"));vault.close();vault=new SyncVault(context,profile);
                assertEquals(1048576,vault.transfer(remote,blob,0,total,true).getLong("verifiedBytes"));assertTrue(vault.transfer(remote,blob,1048576,total,true).getBoolean("complete"));
                vault.close();vault=new SyncVault(context,profile);
                JSONObject reset=vault.transfer(remote,blob,0,total,true);assertFalse(reset.getBoolean("complete"));assertEquals(1048576,reset.getLong("verifiedBytes"));
                assertTrue(vault.transfer(remote,blob,1048576,total,true).getBoolean("complete"));worker.join(12000);assertFalse(worker.isAlive());if(failure.get()!=null)throw new AssertionError(failure.get());
            }finally{remote.close();}
        }
    }
}
