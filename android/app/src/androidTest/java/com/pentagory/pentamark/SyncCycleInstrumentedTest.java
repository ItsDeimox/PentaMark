package com.pentagory.pentamark;

import org.json.*;
import org.junit.*;
import org.junit.runner.RunWith;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.core.app.ApplicationProvider;
import android.content.Context;
import java.io.IOException;
import static org.junit.Assert.*;

/** Uses the real SQLite setup; no mocked transactions. */
@RunWith(AndroidJUnit4.class)
public class SyncCycleInstrumentedTest {
    Context context;SyncVault vault;JSONObject profile;
    @Before public void setup()throws Exception {
        context=ApplicationProvider.getApplicationContext();profile=SyncVault.obj("vaultId",java.util.UUID.randomUUID().toString(),"serverId",java.util.UUID.randomUUID().toString(),"replicaId",java.util.UUID.randomUUID().toString(),"origin","http://100.64.0.1:3000","offlineEnabled",true,"mode","manual");vault=new SyncVault(context,profile);
    }
    @After public void close(){if(vault!=null)vault.close();}
    void write(String content)throws Exception{vault.request("/api/note","PUT",SyncVault.obj("path","A.md","content",content));}
    JSONObject condition()throws Exception{return SyncVault.obj("expectedCursor","S","expectedEpoch","epoch");}
    void completeInitialCopy()throws Exception {
        vault.persistIncoming(SyncVault.obj("nextCursor","S","epoch","epoch","initialCopy",SyncVault.obj("snapshotToken","token","atCursor","S","pageCursor",null),"items",new JSONArray()));
    }
    void rejects(JSONObject input)throws Exception {
        try{vault.completeCycle(input);fail("invalid cycle completed");}catch(IOException e){assertEquals("stale-local-head",e.getMessage());}
    }
    @Test public void snapshotNeverPreparesFreshOperations()throws Exception {
        write("pending");assertEquals(0,vault.snapshot().getJSONArray("preparedOperations").length());assertEquals(0,vault.database.count("pending_ops"));
        JSONArray prepared=vault.preparePending(100);assertEquals(prepared.toString(),vault.snapshot().getJSONArray("preparedOperations").toString());
    }
    @Test public void completionRequiresEveryGuardAndLaterEditLeavesIdle()throws Exception {
        rejects(condition());completeInitialCopy();
        rejects(condition().put("expectedCursor","stale"));rejects(condition().put("expectedEpoch","stale"));
        vault.configure(SyncVault.obj("offlineEnabled",false,"mode","manual"));rejects(condition());
        vault.configure(SyncVault.obj("offlineEnabled",true,"mode","automatic"));
        JSONObject status=vault.completeCycle(condition());assertEquals("idle",status.getString("phase"));String timestamp=status.getString("lastSuccessfulSync");
        assertTrue(timestamp.matches("[0-9]{4}-[0-9]{2}-[0-9]{2}T.*Z"));
        vault.persistIncoming(SyncVault.obj("nextCursor","S","items",new JSONArray()));assertNotEquals("idle",vault.status().getString("phase"));assertEquals(timestamp,vault.status().getString("lastSuccessfulSync"));
        write("unprepared");rejects(condition());assertNotEquals("idle",vault.status().getString("phase"));assertEquals(timestamp,vault.status().getString("lastSuccessfulSync"));
        vault.preparePending(100);rejects(condition());
        vault.close();vault=new SyncVault(context,profile);assertEquals(timestamp,vault.status().getString("lastSuccessfulSync"));rejects(condition());
    }
    @Test public void preparedOperationsAlonePreventCompletion()throws Exception {
        completeInitialCopy();write("prepared");vault.preparePending(100);
        JSONObject row=vault.database.all("entries").getJSONObject(0);row.put("dirty",false);vault.database.put("entries",row.getString("entryId"),row);
        rejects(condition());assertTrue(vault.status().isNull("lastSuccessfulSync"));
    }
    @Test public void unapprovedDirtyEntriesAndConflictsPreventCompletion()throws Exception {
        completeInitialCopy();write("dirty");JSONObject row=vault.database.all("entries").getJSONObject(0);row.put("approved",false);vault.database.put("entries",row.getString("entryId"),row);
        rejects(condition());assertEquals(0,vault.preparePending(100).length());
        row.put("dirty",false);vault.database.put("entries",row.getString("entryId"),row);
        vault.database.put("conflicts","c",SyncVault.obj("conflictId","c","entryId",row.getString("entryId"),"base",null,"local",row.get("local"),"remote",null,"reason","test"));rejects(condition());
        assertTrue(vault.snapshot().getJSONObject("status").isNull("lastSuccessfulSync"));
    }
}
