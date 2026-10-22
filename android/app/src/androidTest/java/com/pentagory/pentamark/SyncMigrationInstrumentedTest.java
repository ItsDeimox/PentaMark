package com.pentagory.pentamark;

import android.content.Context;
import androidx.test.core.app.ApplicationProvider;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import org.json.*;
import org.junit.*;
import org.junit.runner.RunWith;
import java.io.*;
import java.net.*;
import java.util.UUID;
import static org.junit.Assert.*;

@RunWith(AndroidJUnit4.class)
public class SyncMigrationInstrumentedTest {
    Context context; SyncVault vault; JSONObject profile;
    @Before public void setup()throws Exception {
        context=ApplicationProvider.getApplicationContext();
        profile=SyncVault.obj("vaultId",UUID.randomUUID().toString(),"serverId",UUID.randomUUID().toString(),"replicaId",UUID.randomUUID().toString(),"origin","http://100.64.0.1:3000","offlineEnabled",true,"mode","manual");
        vault=new SyncVault(context,profile);
    }
    @After public void close(){if(vault!=null)vault.close();}
    JSONObject draft(String content)throws Exception {
        return SyncVault.obj("migrationId","aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","vaultId",profile.getString("vaultId"),"serverId",profile.getString("serverId"),"origin",profile.getString("origin"),"path","Legacy.md","content",content,"legacyRevision","old-hash");
    }
    RemoteConnection.VerifiedHello hello(String origin,String serverId)throws Exception {
        JSONObject response=SyncVault.obj("protocol",1,"vaultId",profile.getString("vaultId"),"serverId",serverId,"epoch","epoch-one","maxFileBytes",104857600,"chunkBytes",1048576);
        return SyncDiscoveryTestServer.discover(origin,response);
    }
    void verify()throws Exception{vault.verifyAssociation(hello(profile.getString("origin"),profile.getString("serverId")));}
    @Test public void unverifiedAssociationAndWrongIdentityNeverReceiveReceipt()throws Exception {
        try{vault.importDraft(draft("keep"));fail();}catch(IOException e){assertEquals("handshake-required",e.getMessage());}
        verify();JSONObject wrong=draft("keep").put("serverId",UUID.randomUUID().toString());
        try{vault.importDraft(wrong);fail();}catch(IOException e){assertEquals("replica-identity-mismatch",e.getMessage());}
        assertEquals(0,vault.snapshot().getJSONArray("entries").length());
    }
    @Test public void unknownBaseIsDurableConflictAndExactRetryIsIdempotent()throws Exception {
        verify();JSONObject input=draft("# Exact\r\nOlá 🌍\n"),receipt=vault.importDraft(input);
        assertTrue(receipt.getBoolean("durable"));assertEquals(input.getString("migrationId"),receipt.getString("migrationId"));
        vault.close();vault=new SyncVault(context,profile);
        assertEquals(receipt.toString(),vault.importDraft(input).toString());
        assertEquals(1,vault.snapshot().getJSONArray("entries").length());
        assertEquals(1,vault.snapshot().getJSONArray("conflicts").length());
        assertEquals("unknown-legacy-base",vault.snapshot().getJSONArray("conflicts").getJSONObject(0).getString("reason"));
        assertEquals(0,vault.preparePending(100).length());
        assertEquals(input.getString("content"),vault.request("/api/note?path=Legacy.md","GET",null).getJSONObject("data").getString("content"));
        for(String field:new String[]{"content","legacyRevision","path"}) {
            JSONObject changed=new JSONObject(input.toString()).put(field,"different");
            try{vault.importDraft(changed);fail(field);}catch(IOException e){assertEquals("migration-id-conflict",e.getMessage());}
        }
    }
    @Test public void importPreservesAnExistingLocalEditAndPreparedOperation()throws Exception {
        verify();vault.request("/api/note","POST",SyncVault.obj("path","Legacy.md","content","current local"));
        String prepared=vault.preparePending(100).toString();vault.importDraft(draft("legacy content"));
        assertEquals("current local",vault.request("/api/note?path=Legacy.md","GET",null).getJSONObject("data").getString("content"));
        assertEquals(prepared,vault.preparePending(100).toString());
        JSONObject conflict=vault.snapshot().getJSONArray("conflicts").getJSONObject(0);
        assertEquals("legacy content",vault.readVersion(conflict.getJSONObject("local")).getString("content"));
    }
    @Test public void explicitRebindVerifiesSameIdsAndPersistsWithoutChangingQueue()throws Exception {
        verify();vault.request("/api/note","POST",SyncVault.obj("path","A.md","content","pending"));String queue=vault.preparePending(100).toString();
        String next="http://100.64.0.2:3000";
        try{vault.rebind(hello(next,UUID.randomUUID().toString()));fail();}catch(IOException e){assertEquals("replica-identity-mismatch",e.getMessage());}
        assertEquals(profile.getString("origin"),vault.snapshot().getJSONObject("profile").getString("origin"));
        vault.rebind(hello(next,profile.getString("serverId")));profile.put("origin",next);
        vault.close();vault=new SyncVault(context,profile);assertEquals(queue,vault.preparePending(100).toString());
        assertEquals(next,vault.snapshot().getJSONObject("profile").getString("origin"));
        try{vault.importDraft(draft("old").put("origin","http://100.64.0.1:3000"));fail();}catch(IOException e){assertEquals("replica-identity-mismatch",e.getMessage());}
    }
    @Test public void provenNativeBaseOnlyCreatesAConditionalOperation()throws Exception {
        verify();vault.request("/api/note","POST",SyncVault.obj("path","Legacy.md","content","base"));
        JSONObject operation=vault.preparePending(100).getJSONObject(0), local=vault.snapshot().getJSONArray("entries").getJSONObject(0).getJSONObject("local");
        vault.confirm(SyncVault.obj("opId",operation.getString("opId"),"status","applied","confirmed",local.put("revision","verified-native-revision")));
        vault.importDraft(draft("draft").put("legacyRevision","verified-native-revision"));
        assertEquals(0,vault.snapshot().getJSONArray("conflicts").length());
        assertEquals("verified-native-revision",vault.preparePending(100).getJSONObject(0).getString("baseRevision"));
    }
    @Test public void migrationReceiptRecoversWithIntentAfterMaterializationBeforeCommit()throws Exception {
        verify();JSONObject input=draft("recoverable");vault.importDraft(input);
        JSONObject after=vault.database.all("entries").getJSONObject(0),receipt=vault.database.get("vaults","migration:"+input.getString("migrationId"));
        JSONObject before=SyncVault.obj("entryId",after.getString("entryId"),"base",null,"local",null,"localHead","","dirty",false,"approved",false);
        JSONObject plan=SyncVault.obj("id","migration-crash","rows",new JSONArray().put(SyncVault.obj("before",before,"after",after)),"conflicts",vault.database.all("conflicts"),
            "removeConflicts",new JSONArray(),"removePending",new JSONArray(),"applied",new JSONArray(),"meta",vault.database.get("vaults","meta"),"migrationReceipt",receipt);
        vault.database.transaction(() -> {
            vault.database.remove("vaults","migration:"+input.getString("migrationId"));vault.database.remove("entries",after.getString("entryId"));
            vault.database.getWritableDatabase().delete("conflicts",null,null);vault.database.put("file_intents","migration-crash",plan);
        });
        assertNull(vault.database.get("vaults","migration:"+input.getString("migrationId")));
        vault.close();vault=new SyncVault(context,profile);assertTrue(vault.importDraft(input).getBoolean("durable"));
        assertEquals(1,vault.snapshot().getJSONArray("entries").length());assertEquals(1,vault.snapshot().getJSONArray("conflicts").length());assertEquals(0,vault.database.count("file_intents"));
        assertEquals("recoverable",vault.request("/api/note?path=Legacy.md","GET",null).getJSONObject("data").getString("content"));
    }
}
