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
