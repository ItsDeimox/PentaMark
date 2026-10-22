package com.pentagory.pentamark;

import android.content.Context;
import android.content.SharedPreferences;
import androidx.test.core.app.ApplicationProvider;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.json.*;
import org.junit.Test;
import org.junit.runner.RunWith;
import java.util.UUID;
import static org.junit.Assert.*;

/** Run ONLY as two separate instrumentation invocations with target force-stop between.
 * No network, Activity, mocked database, skips, or production preferences.
 * Catches loss of offline working bytes, immutable pending ops or retained history
 * across a genuine process boundary. The controller proves the intervening force-stop.
 */
@RunWith(AndroidJUnit4.class)
public class SyncProcessRestartTest {
    private static final String PROCESS_TOKEN=UUID.randomUUID().toString();
    private static final String FIRST="prepared offline version\nα";
    private static final String LATEST="newer offline edit\nβ";
    // Deliberately no close in seed: retain the connection until external process death.
    private static SyncVault seededVault;

    private SharedPreferences evidence() {
        return InstrumentationRegistry.getInstrumentation().getContext()
            .getSharedPreferences("sync-process-restart-test-only",Context.MODE_PRIVATE);
    }

    @Test(timeout=30000) public void seedOfflinePending()throws Exception {
        SharedPreferences prefs=evidence();
        assertTrue("Clear stale test receipt before seeding",prefs.edit().clear().commit());
        Context context=ApplicationProvider.getApplicationContext();
        JSONObject profile=SyncVault.obj("vaultId",UUID.randomUUID().toString(),"serverId",UUID.randomUUID().toString(),
            "replicaId",UUID.randomUUID().toString(),"origin","http://100.64.0.1:35491","offlineEnabled",true,"mode","manual");
        seededVault=new SyncVault(context,profile);
        write(seededVault,FIRST);
        JSONObject first=seededVault.snapshot().getJSONArray("entries").getJSONObject(0).getJSONObject("local");
        JSONArray prepared=seededVault.preparePending(100);assertEquals(1,prepared.length());
        assertEquals("put",prepared.getJSONObject(0).getString("kind"));
        assertTrue(prepared.getJSONObject(0).isNull("baseRevision"));
        write(seededVault,LATEST);
        assertEquals(LATEST,read(seededVault));
        assertEquals(FIRST,seededVault.readVersion(first).getString("content"));
        assertEquals(prepared.toString(),seededVault.snapshot().getJSONArray("preparedOperations").toString());
        JSONArray history=seededVault.history(first.getString("entryId"));assertEquals(2,history.length());
        JSONObject snapshot=seededVault.snapshot();
        assertTrue("Seed receipt must be synchronously durable",prefs.edit()
            .putString("profile",profile.toString()).putString("processToken",PROCESS_TOKEN)
            .putString("prepared",prepared.toString()).putString("first",first.toString())
            .putString("history",history.toString()).putString("entries",snapshot.getJSONArray("entries").toString())
            .putBoolean("ready",true).commit());
    }

    @Test(timeout=30000) public void verifyOfflinePending()throws Exception {
        SharedPreferences prefs=evidence();
        assertTrue("Run seedOfflinePending first, without clearing app/test data",prefs.getBoolean("ready",false));
        String previousProcess=prefs.getString("processToken",null);assertNotNull(previousProcess);
        assertNotEquals("Verification must run in a NEW instrumentation process",previousProcess,PROCESS_TOKEN);
        assertNull("No in-memory vault may survive the restart",seededVault);
        JSONObject profile=new JSONObject(prefs.getString("profile",""));
        Context context=ApplicationProvider.getApplicationContext();
        try(SyncVault vault=new SyncVault(context,profile)) {
            JSONObject snapshot=vault.snapshot(),first=new JSONObject(prefs.getString("first",""));
            assertEquals(LATEST,read(vault));
            assertEquals(prefs.getString("entries",null),snapshot.getJSONArray("entries").toString());
            assertEquals(prefs.getString("prepared",null),snapshot.getJSONArray("preparedOperations").toString());
            assertEquals(prefs.getString("prepared",null),vault.preparePending(100).toString());
            assertEquals(prefs.getString("history",null),vault.history(first.getString("entryId")).toString());
            assertEquals(FIRST,vault.readVersion(first).getString("content"));
            JSONObject latest=snapshot.getJSONArray("entries").getJSONObject(0).getJSONObject("local");
            assertEquals(LATEST,vault.readVersion(latest).getString("content"));
            assertNotEquals(first.getString("blobHash"),latest.getString("blobHash"));
            vault.files.require(first.getString("blobHash"),first.getLong("byteLength"));
            vault.files.require(latest.getString("blobHash"),latest.getLong("byteLength"));
            assertEquals(1,vault.status().getInt("pendingCount"));
            assertEquals(0,vault.status().getInt("conflictCount"));
            assertTrue(vault.status().isNull("lastSuccessfulSync"));
            assertEquals(0,vault.database.count("file_intents"));
        }
        assertTrue("Consume test receipt only after all assertions",prefs.edit().putBoolean("ready",false).commit());
    }
    private static void write(SyncVault vault,String content)throws Exception {
        assertEquals(200,vault.request("/api/note","PUT",SyncVault.obj("path","Restart.md","content",content)).getInt("status"));
    }
    private static String read(SyncVault vault)throws Exception {
        return vault.request("/api/note?path=Restart.md","GET",null).getJSONObject("data").getString("content");
    }
}
