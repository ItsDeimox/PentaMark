package com.pentagory.pentamark;

import android.content.Context;
import androidx.test.core.app.*;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.json.*;
import java.io.*;
import java.util.UUID;
import static org.junit.Assert.*;

@RunWith(AndroidJUnit4.class)
public class SyncBridgeInstrumentedTest {
    @Test public void completionAndMigrationUseExactCapacitorEnvelopes()throws Exception {
        JSONObject profile=SyncVault.obj("vaultId",UUID.randomUUID().toString(),"replicaId",UUID.randomUUID().toString(),"serverId",UUID.randomUUID().toString(),"origin","http://100.64.0.1:3000","offlineEnabled",true,"mode","manual");
        JSONObject hello=SyncVault.obj("protocol",1,"vaultId",profile.getString("vaultId"),"serverId",profile.getString("serverId"),"epoch","e","maxFileBytes",104857600,"chunkBytes",1048576);
        Context context=ApplicationProvider.getApplicationContext();
        try(SyncVault seed=new SyncVault(context,profile)){seed.verifyAssociation(SyncDiscoveryTestServer.discover(profile.getString("origin"),hello));}
        try(ActivityScenario<MainActivity> activity=ActivityScenario.launch(MainActivity.class)) {
            await(activity,"typeof window.Capacitor?.nativePromise==='function'");call(activity,"open",SyncVault.obj("profile",profile));
            call(activity,"persistIncoming",SyncVault.obj("batch",SyncVault.obj("epoch","e","nextCursor","S","initialCopy",SyncVault.obj("snapshotToken","t","atCursor","S","pageCursor",null),"items",new JSONArray())));
            assertEquals("idle",call(activity,"completeCycle",SyncVault.obj("input",SyncVault.obj("expectedCursor","S","expectedEpoch","e"))).getString("phase"));
            JSONObject draft=SyncVault.obj("migrationId","bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","vaultId",profile.getString("vaultId"),"serverId",profile.getString("serverId"),"origin",profile.getString("origin"),"path","Legacy.md","content","retained","legacyRevision","legacy");
            JSONObject receipt=call(activity,"importDraft",SyncVault.obj("input",draft));assertTrue(receipt.getBoolean("durable"));assertEquals(draft.getString("migrationId"),receipt.getString("migrationId"));
            assertEquals(receipt.toString(),call(activity,"importDraft",SyncVault.obj("input",draft)).toString());
            JSONObject snapshot=call(activity,"snapshot",new JSONObject());assertEquals(0,snapshot.getJSONArray("preparedOperations").length());assertEquals(1,snapshot.getJSONArray("conflicts").length());assertNotEquals("idle",snapshot.getJSONObject("status").getString("phase"));
        }
    }
    private static Object evaluate(ActivityScenario<MainActivity> activity,String script)throws Exception {
        java.util.concurrent.CountDownLatch done=new java.util.concurrent.CountDownLatch(1);
        java.util.concurrent.atomic.AtomicReference<String> value=new java.util.concurrent.atomic.AtomicReference<>();
        activity.onActivity(a -> a.getBridge().getWebView().evaluateJavascript(script,result -> {value.set(result);done.countDown();}));
        assertTrue(done.await(10,java.util.concurrent.TimeUnit.SECONDS));return new JSONTokener(value.get()).nextValue();
    }
    private static void await(ActivityScenario<MainActivity> activity,String expression)throws Exception {
        long end=android.os.SystemClock.elapsedRealtime()+30000;
        while(android.os.SystemClock.elapsedRealtime()<end){if(Boolean.TRUE.equals(evaluate(activity,expression)))return;android.os.SystemClock.sleep(100);}fail("Timed out: "+expression);
    }
    private static JSONObject call(ActivityScenario<MainActivity> activity,String method,JSONObject options)throws Exception {
        evaluate(activity,"window.__syncTest=null;Capacitor.nativePromise('SyncVault',"+JSONObject.quote(method)+","+options+").then(v=>window.__syncTest={value:v}).catch(e=>window.__syncTest={error:String(e)});true");
        await(activity,"window.__syncTest!==null");JSONObject result=new JSONObject((String)evaluate(activity,"JSON.stringify(window.__syncTest)"));
        assertFalse(result.toString(),result.has("error"));return result.getJSONObject("value");
    }
    @Test public void realCapacitorDtoAndPreparedQueueSurviveActivityRecreation()throws Exception {
        JSONObject profile=SyncVault.obj("vaultId",UUID.randomUUID().toString(),"replicaId",UUID.randomUUID().toString(),"serverId","bridge-test","origin","http://100.64.0.1:3000","offlineEnabled",true,"mode","manual");
        try(ActivityScenario<MainActivity> activity=ActivityScenario.launch(MainActivity.class)) {
            await(activity,"typeof window.Capacitor?.nativePromise==='function'");
            call(activity,"open",SyncVault.obj("profile",profile));
            call(activity,"request",SyncVault.obj("url","/api/note","method","POST","body",SyncVault.obj("path","Bridge.md","content","durable 🌍")));
            JSONObject operation=call(activity,"preparePending",SyncVault.obj("limit",100)).getJSONArray("operations").getJSONObject(0);
            activity.recreate();await(activity,"typeof window.Capacitor?.nativePromise==='function'");
            call(activity,"open",SyncVault.obj("profile",profile));
            assertEquals(operation.toString(),call(activity,"preparePending",SyncVault.obj("limit",100)).getJSONArray("operations").getJSONObject(0).toString());
            JSONObject note=call(activity,"request",SyncVault.obj("url","/api/note?path=Bridge.md","method","GET"));assertEquals("durable 🌍",note.getJSONObject("data").getString("content"));
            assertEquals(1,call(activity,"snapshot",new JSONObject()).getJSONObject("status").getInt("pendingCount"));
        }
    }
    @Test public void activityRecreationKeepsNativePluginAndNetworkBlock() {
        try(ActivityScenario<MainActivity> activity=ActivityScenario.launch(MainActivity.class)) {
            activity.onActivity(a -> {assertNotNull(a.getBridge().getPlugin("SyncVault"));assertTrue(a.getBridge().getWebView().getSettings().getBlockNetworkLoads());});
            activity.recreate();
            activity.onActivity(a -> {assertNotNull(a.getBridge().getPlugin("SyncVault"));assertTrue(a.getBridge().getWebView().getSettings().getBlockNetworkLoads());});
        }
    }
    @Test public void passiveMediaRouteRejectsNavigationAndForeignOrigins() throws Exception {
        assertEquals("pic.png",RemoteConnection.mediaPath("https://localhost","https://localhost/_pm_sync/file?path=pic.png","GET",false,"image","/_pm_sync/file"));
        for(String url:new String[]{"https://evil.test/_pm_sync/file?path=pic.png","https://localhost/_pm_sync/file?path=../pic.png","https://localhost/_pm_sync/file?path=page.html"}) {
            try{RemoteConnection.mediaPath("https://localhost",url,"GET",false,"image","/_pm_sync/file");fail(url);}catch(IllegalArgumentException expected){}
        }
        try{RemoteConnection.mediaPath("https://localhost","https://localhost/_pm_sync/file?path=pic.png","GET",true,"document","/_pm_sync/file");fail();}catch(IllegalArgumentException expected){}
    }
    @Test public void sharedDecisionsApplyWithoutNativeReconciliation() throws Exception {
        Context context=ApplicationProvider.getApplicationContext();
        Context test=androidx.test.platform.app.InstrumentationRegistry.getInstrumentation().getContext();
        ByteArrayOutputStream out=new ByteArrayOutputStream();
        try(InputStream in=test.getAssets().open("sync/contract-cases.json")){byte[] b=new byte[4096];int n;while((n=in.read(b))!=-1)out.write(b,0,n);}
        JSONObject fixtures=new JSONObject(out.toString("UTF-8"));JSONArray cases=fixtures.getJSONArray("reconciliation");
        for(int i=0;i<cases.length();i++) {
            JSONObject c=cases.getJSONObject(i), profile=SyncVault.obj("vaultId",UUID.randomUUID().toString(),"replicaId",UUID.randomUUID().toString(),"serverId","fixtures","origin","http://100.64.0.1:3000","offlineEnabled",true,"mode","manual");
            try(SyncVault v=new SyncVault(context,profile)) {
                JSONObject base=fixtureVersion(v,fixtures,c,"base"), local=fixtureVersion(v,fixtures,c,"local"), remote=fixtureVersion(v,fixtures,c,"remote");
                JSONObject identity=local!=null?local:base!=null?base:remote;
                if(identity==null)continue;
                String id=identity.getString("entryId");
                JSONObject row=SyncVault.obj("entryId",id,"base",base,"local",local,"localHead","fixture-head","dirty",true,"approved",false);
                if(!c.getString("name").equals("invalid path"))v.files.apply(null,local);
                v.database.put("entries",id,row);
                JSONObject batch=SyncVault.obj("nextCursor","fixture-cursor","items",new JSONArray().put(SyncVault.obj("expectedLocalHead","fixture-head","decision",
                    SyncVault.obj("action",c.getString("action"),"reason",c.getString("reason"),"base",base,"local",local,"remote",remote))));
                v.persistIncoming(batch);
                JSONObject snap=v.snapshot();assertEquals(c.getString("name"),"fixture-cursor",snap.getString("cursor"));
                if(c.getString("action").equals("conflict"))assertEquals(c.getString("name"),c.getString("reason"),snap.getJSONArray("conflicts").getJSONObject(0).getString("reason"));
                if(c.getString("action").equals("pull")||c.getString("action").equals("converged"))assertEquals(remote.getString("revision"),snap.getJSONArray("entries").getJSONObject(0).getJSONObject("base").getString("revision"));
            }
        }
    }
    private JSONObject fixtureVersion(SyncVault vault,JSONObject fixtures,JSONObject c,String field)throws Exception {
        if(c.isNull(field))return null;JSONObject v=new JSONObject(fixtures.getJSONObject("versions").getJSONObject(c.getString(field)).toString());
        if(!v.isNull("blobHash")) {
            byte[] bytes=new byte[v.getInt("byteLength")];java.util.Arrays.fill(bytes,(byte)v.getString("blobHash").hashCode());
            JSONObject blob=vault.files.store(new ByteArrayInputStream(bytes),100);
            v.put("blobHash",blob.getString("blobHash"));
        }
        if(!v.getString("path").startsWith(".."))v.put("path",SyncPaths.path(v.getString("path")));
        return v;
    }
}
