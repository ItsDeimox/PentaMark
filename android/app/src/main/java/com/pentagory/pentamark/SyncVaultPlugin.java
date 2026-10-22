package com.pentagory.pentamark;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.*;
import com.getcapacitor.annotation.*;
import org.json.*;
import java.io.*;
import java.util.concurrent.*;

/** JSON-only metadata bridge; content streams through native files and ContentResolver. */
@CapacitorPlugin(name = "SyncVault")
public final class SyncVaultPlugin extends Plugin {
    private final Object lock = new Object();
    private final ThreadPoolExecutor work = new ThreadPoolExecutor(2,2,0,TimeUnit.SECONDS,new ArrayBlockingQueue<>(32));
    private SyncVault vault;
    private RemoteConnection remote;
    private long maximum;
    private boolean paused;
    private boolean opening;
    private SyncVault importing;
    private String importPath;
    private static JSObject js(JSONObject object) throws Exception { return new JSObject(object.toString()); }
    interface Task { JSONObject run(SyncVault target) throws Exception; }
    private void run(PluginCall call, Task task) {
        try {
            final SyncVault target;
            synchronized(lock) { target=vault; if(target==null || opening)throw new IOException("replica-not-open"); }
            work.execute(() -> { try { call.resolve(js(task.run(target))); } catch(Exception e){call.reject(e.getMessage(),e.getMessage(),e);} });
        } catch(Exception e){call.reject(e.getMessage(),e.getMessage(),e);}
    }
    @PluginMethod public void open(PluginCall call) {
        boolean claimed=false;
        try {
            final JSONObject profile = new JSONObject(call.getObject("profile").toString());
            synchronized(lock) { if(opening)throw new IOException("replica-busy"); opening=true; claimed=true; if(remote!=null)remote.close(); remote=null; }
            work.execute(() -> {
                try {
                    synchronized(lock) {
                        if(vault!=null) { vault.close(); vault=null; }
                        vault=new SyncVault(getContext(),profile); call.resolve(js(vault.status()));
                    }
                } catch(Exception e){call.reject(e.getMessage(),e.getMessage(),e);}
                finally{synchronized(lock){opening=false;}}
            });
        } catch(Exception e){if(claimed)synchronized(lock){opening=false;}call.reject(e.getMessage(),e.getMessage(),e);}
    }
    @PluginMethod public void configure(PluginCall c){run(c,v -> v.configure(c.getObject("config")));}
    @PluginMethod public void snapshot(PluginCall c){run(c,SyncVault::snapshot);}
    @PluginMethod public void request(PluginCall c){run(c,v -> {
        Object raw=c.getData().opt("body"); JSONObject body=raw instanceof JSONObject?(JSONObject)raw:raw instanceof String?new JSONObject((String)raw):null;
        return v.request(c.getString("url"),c.getString("method","GET"),body);
    });}
    @PluginMethod public void preparePending(PluginCall c){run(c,v -> SyncVault.obj("operations",v.preparePending(c.getInt("limit",100))));}
    @PluginMethod public void persistIncoming(PluginCall c){run(c,v -> {v.persistIncoming(c.getObject("batch"));return new JSONObject();});}
    @PluginMethod public void confirm(PluginCall c){run(c,v -> {v.confirm(c.getObject("result"));return new JSONObject();});}
    @PluginMethod public void resolve(PluginCall c){run(c,v -> {v.resolve(c.getObject("input"));return new JSONObject();});}
    @PluginMethod public void transferProgress(PluginCall c){run(c,v -> SyncVault.obj("transfers",v.transferProgress()));}

    @PluginMethod public void handshake(PluginCall c){run(c,v -> {
        JSONObject profile=v.snapshot().getJSONObject("profile");
        RemoteConnection candidate=new RemoteConnection(profile.getString("origin"));
        try {
            synchronized(lock){if(paused || v!=vault)throw new IOException("replica-paused");if(remote!=null)remote.close();remote=candidate;maximum=0;}
            JSONObject response=candidate.syncRequest("/api/sync/v1/hello","GET",null), hello=response.getJSONObject("data");
            if(response.getInt("status")!=200 || hello.getInt("protocol")!=1 || hello.getInt("chunkBytes")!=RemoteConnection.SYNC_CHUNK_BYTES
                || !profile.getString("vaultId").equals(hello.getString("vaultId")) || !profile.getString("serverId").equals(hello.getString("serverId"))) throw new IOException("incompatible-host");
            long max=SyncVault.size(SyncVault.obj("byteLength",hello.get("maxFileBytes"))); hello.getString("epoch");
            synchronized(lock){if(paused || v!=vault || candidate!=remote)throw new IOException("replica-paused");maximum=max;}
            return hello;
        } catch(Exception e){candidate.close();synchronized(lock){if(remote==candidate){remote=null;maximum=0;}}throw e;}
    });}
    private RemoteConnection connection(SyncVault target) throws Exception {
        synchronized(lock){if(paused || target!=vault || remote==null || maximum<=0)throw new IOException("handshake-required");return remote;}
    }
    @PluginMethod public void remoteSnapshot(PluginCall c){run(c,v -> {
        String token=c.getString("snapshotToken"), cursor=c.getString("cursor");
        String route="/api/sync/v1/snapshot";
        if(token!=null)route+="?snapshotToken="+java.net.URLEncoder.encode(token,"UTF-8")+(cursor==null?"":"&cursor="+java.net.URLEncoder.encode(cursor,"UTF-8"));
        return data(connection(v).syncRequest(route,token==null?"POST":"GET",token==null?new JSONObject():null));
    });}
    @PluginMethod public void changes(PluginCall c){run(c,v -> data(connection(v).syncRequest("/api/sync/v1/changes?cursor="+java.net.URLEncoder.encode(c.getString("cursor"),"UTF-8")+"&limit="+Math.min(100,Math.max(1,c.getInt("limit",100))),"GET",null)));}
    @PluginMethod public void apply(PluginCall c){run(c,v -> {
        JSONArray operations=c.getArray("operations");if(operations==null || operations.length()>100)throw new IOException("invalid-limit");
        // Only byte-for-byte durable prepared operations may be transmitted.
        JSONArray prepared=v.preparePending(100);
        for(int i=0;i<operations.length();i++) {boolean found=false;for(int j=0;j<prepared.length();j++)if(operations.getJSONObject(i).toString().equals(prepared.getJSONObject(j).toString()))found=true;if(!found)throw new IOException("operation-not-prepared");}
        return data(connection(v).syncRequest("/api/sync/v1/apply","POST",SyncVault.obj("operations",operations)));
    });}
    private static JSONObject data(JSONObject response) throws Exception {if(response.getInt("status")!=200)throw new IOException("sync-http-"+response.getInt("status"));return response.getJSONObject("data");}
    private void transfer(PluginCall c,boolean upload){run(c,v -> {
        RemoteConnection target=connection(v);long max; synchronized(lock){max=maximum;}
        JSONObject result=v.transfer(target,c.getObject("blob"),c.getData().getLong("offset"),max,upload);
        notifyListeners("transferProgress",js(result));return result;
    });}
    @PluginMethod public void downloadBlob(PluginCall c){transfer(c,false);}
    @PluginMethod public void uploadBlob(PluginCall c){transfer(c,true);}

    @PluginMethod public void importDocument(PluginCall c) {
        try {
            synchronized(lock){if(importing!=null || vault==null)throw new IOException("replica-busy");importPath=SyncPaths.path(c.getString("path"));importing=vault;}
            Intent intent=new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("*/*");
            getActivity().runOnUiThread(() -> startActivityForResult(c,intent,"importResult"));
        }catch(Exception e){synchronized(lock){importing=null;}c.reject(e.getMessage(),e);}
    }
    @ActivityCallback private void importResult(PluginCall c,ActivityResult result) {
        final SyncVault target;final String path;synchronized(lock){target=importing;path=importPath;importing=null;}
        if(c==null)return;
        if(result.getResultCode()!=Activity.RESULT_OK || result.getData()==null){c.resolve(new JSObject().put("cancelled",true));return;}
        Uri uri=result.getData().getData();
        try {work.execute(() -> {
            try(InputStream in=getContext().getContentResolver().openInputStream(uri)) {
                if(in==null || target==null)throw new IOException("document-unavailable");
                c.resolve(js(target.importStream(path,in,SyncVault.MAX_SAFE)));
            }catch(Exception e){c.reject(e.getMessage(),e);}
        });}catch(Exception e){c.reject(e.getMessage(),e);}
    }
    RemoteConnection.Media openMedia(String path,String range)throws Exception {SyncVault target;synchronized(lock){target=vault;}if(target==null)throw new IOException("replica-not-open");return target.openMedia(path,range);}
    @Override protected void handleOnPause(){synchronized(lock){paused=true;if(remote!=null)remote.close();remote=null;maximum=0;}super.handleOnPause();}
    @Override protected void handleOnResume(){synchronized(lock){paused=false;}super.handleOnResume();}
    @Override protected void handleOnDestroy(){synchronized(lock){paused=true;if(remote!=null)remote.close();remote=null;if(vault!=null)vault.close();vault=null;}work.shutdown();super.handleOnDestroy();}
}
