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
    private PluginCall importOwner;
    private SyncVault exporting;
    private JSONObject exportBlob;
    private SyncVault exportingReplica;
    private final java.util.Set<RemoteConnection> probes=new java.util.HashSet<>();
    private RemoteConnection.VerifiedHello discovery;
    private long bindingGeneration;
    private final ThreadLocal<Long> executingGeneration=new ThreadLocal<>();
    private static JSObject js(JSONObject object) throws Exception { return new JSObject(object.toString()); }
    interface Task { JSONObject run(SyncVault target) throws Exception; }
    private void run(PluginCall call, Task task) {
        try {
            final SyncVault target;final long generation;
            synchronized(lock) { target=vault; if(target==null || opening)throw new IOException("replica-not-open");generation=bindingGeneration; }
            work.execute(() -> { try {
                synchronized(lock){if(target!=vault || generation!=bindingGeneration || opening)throw new IOException("replica-changed");}
                executingGeneration.set(generation);
                call.resolve(js(task.run(target)));
            } catch(Exception e){call.reject(e.getMessage(),e.getMessage(),e);}finally{executingGeneration.remove();} });
        } catch(Exception e){call.reject(e.getMessage(),e.getMessage(),e);}
    }
    @PluginMethod public void open(PluginCall call) {
        boolean claimed=false;long claim=-1;
        try {
            final JSONObject profile = new JSONObject(call.getObject("profile").toString());
            synchronized(lock) { if(opening || paused)throw new IOException("replica-busy"); opening=true; claimed=true;claim=++bindingGeneration;cancelProbes(); if(remote!=null)remote.close(); remote=null; }
            final long generation=claim;
            work.execute(() -> {
                try {
                    synchronized(lock) {
                        if(paused || generation!=bindingGeneration)throw new IOException("replica-changed");
                        if(vault!=null) { vault.close(); vault=null; }
                        SyncVault next=new SyncVault(getContext(),profile);
                        try {
                            if(discovery!=null && discovery.origin.equals(profile.getString("origin")))next.verifyAssociation(discovery);
                            vault=next;call.resolve(js(vault.status()));
                        }catch(Exception e){next.close();throw e;}
                    }
                } catch(Exception e){call.reject(e.getMessage(),e.getMessage(),e);}
                finally{synchronized(lock){if(generation==bindingGeneration)opening=false;}}
            });
        } catch(Exception e){if(claimed)synchronized(lock){if(claim==bindingGeneration)opening=false;}call.reject(e.getMessage(),e.getMessage(),e);}
    }
    @PluginMethod public void configure(PluginCall c){run(c,v -> v.configure(c.getObject("config")));}
    @PluginMethod public void snapshot(PluginCall c){run(c,SyncVault::snapshot);}
    @PluginMethod public void completeCycle(PluginCall c){run(c,v -> v.completeCycle(c.getObject("input")));}
    @PluginMethod public void request(PluginCall c){run(c,v -> {
        Object raw=c.getData().opt("body"); JSONObject body=raw instanceof JSONObject?(JSONObject)raw:raw instanceof String?new JSONObject((String)raw):null;
        return v.request(c.getString("url"),c.getString("method","GET"),body);
    });}
    @PluginMethod public void preparePending(PluginCall c){run(c,v -> SyncVault.obj("operations",v.preparePending(c.getInt("limit",100))));}
    @PluginMethod public void persistIncoming(PluginCall c){run(c,v -> {v.persistIncoming(c.getObject("batch"));return new JSONObject();});}
    @PluginMethod public void confirm(PluginCall c){run(c,v -> {v.confirm(c.getObject("result"));return new JSONObject();});}
    @PluginMethod public void resolve(PluginCall c){run(c,v -> {v.resolve(c.getObject("input"));return new JSONObject();});}
    @PluginMethod public void transferProgress(PluginCall c){run(c,v -> SyncVault.obj("transfers",v.transferProgress()));}
    @PluginMethod public void history(PluginCall c){run(c,v -> SyncVault.obj("versions",v.history(c.getString("entryId"))));}
    @PluginMethod public void readVersion(PluginCall c){run(c,v -> v.readVersion(c.getObject("version")));}
    @PluginMethod public void importDraft(PluginCall c){run(c,v -> v.importDraft(c.getObject("input")));}

    /** No profile, replica writes, or caller-selected endpoint: this always requests only hello. */
    @PluginMethod public void discover(PluginCall c) {
        RemoteConnection candidate=null;
        try {
            candidate=new RemoteConnection(c.getString("origin"));final RemoteConnection target=candidate;final long generation;
            synchronized(lock){if(paused || opening)throw new IOException("replica-paused");generation=bindingGeneration;probes.add(target);}
            work.execute(() -> {
                try {
                    RemoteConnection.VerifiedHello proof=target.discover();
                    synchronized(lock){if(paused || generation!=bindingGeneration)throw new IOException("replica-changed");discovery=proof;}
                    c.resolve(js(proof.data()));
                }catch(Exception e){c.reject(e.getMessage(),e.getMessage(),e);}
                finally{synchronized(lock){probes.remove(target);}target.close();}
            });
        }catch(Exception e){if(candidate!=null){synchronized(lock){probes.remove(candidate);}candidate.close();}c.reject(e.getMessage(),e.getMessage(),e);}
    }

    /** The user explicitly requests a new validated origin; identical host identities are mandatory. */
    @PluginMethod public void rebind(PluginCall c){run(c,v -> {
        RemoteConnection candidate=new RemoteConnection(c.getString("origin"));long generation;
        synchronized(lock){
            if(paused || opening || v!=vault || !currentCall()){candidate.close();throw new IOException("replica-paused");}
            opening=true;generation=++bindingGeneration;cancelProbes();probes.add(candidate);
            if(remote!=null)remote.close();remote=null;maximum=0;
        }
        boolean adopted=false;
        try {
            RemoteConnection.VerifiedHello proof=candidate.discover();JSONObject profile;
            synchronized(lock){
                if(paused || generation!=bindingGeneration || v!=vault)throw new IOException("replica-changed");
                profile=v.rebind(proof);remote=candidate;maximum=proof.maximum;discovery=proof;adopted=true;
            }
            return SyncVault.obj("profile",profile,"hello",proof.data());
        } finally {
            synchronized(lock){probes.remove(candidate);if(generation==bindingGeneration)opening=false;}
            if(!adopted)candidate.close();
        }
    });}

    @PluginMethod public void handshake(PluginCall c){run(c,v -> {
        JSONObject profile=v.snapshot().getJSONObject("profile");
        RemoteConnection candidate=new RemoteConnection(profile.getString("origin"));
        try {
            synchronized(lock){if(paused || opening || v!=vault || !currentCall())throw new IOException("replica-paused");if(remote!=null)remote.close();remote=candidate;maximum=0;}
            RemoteConnection.VerifiedHello proof=candidate.discover();
            synchronized(lock){if(paused || opening || v!=vault || candidate!=remote)throw new IOException("replica-paused");v.verifyAssociation(proof);maximum=proof.maximum;}
            return proof.data();
        } catch(Exception e){candidate.close();synchronized(lock){if(remote==candidate){remote=null;maximum=0;}}throw e;}
    });}
    private RemoteConnection connection(SyncVault target) throws Exception {
        synchronized(lock){if(paused || opening || target!=vault || remote==null || maximum<=0 || !currentCall())throw new IOException("handshake-required");return remote;}
    }
    private boolean currentCall(){Long generation=executingGeneration.get();return generation!=null && generation==bindingGeneration;}
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
        JSONArray prepared=v.snapshot().getJSONArray("preparedOperations");
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
            synchronized(lock){if(importOwner!=null || importing!=null || vault==null || opening)throw new IOException("replica-busy");importPath=SyncPaths.path(c.getString("path"));importing=vault;importOwner=c;}
            Intent intent=new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("*/*");
            getActivity().runOnUiThread(() -> {try{startActivityForResult(c,intent,"importResult");}catch(Exception e){releaseImport(c);c.reject(e.getMessage(),e);}});
        }catch(Exception e){releaseImport(c);c.reject(e.getMessage(),e);}
    }
    private void releaseImport(PluginCall owner){synchronized(lock){if(importOwner==owner){importing=null;importPath=null;importOwner=null;}}}
    @ActivityCallback private void importResult(PluginCall c,ActivityResult result) {
        if(c==null)return;
        final SyncVault target;final String path;
        synchronized(lock){if(importOwner!=c){c.reject("replica-changed");return;}target=importing;path=importPath;releaseImport(c);}
        if(result.getResultCode()!=Activity.RESULT_OK || result.getData()==null || result.getData().getData()==null){c.resolve(new JSObject().put("cancelled",true));return;}
        Uri uri=result.getData().getData();
        try {work.execute(() -> {
            try(InputStream in=getContext().getContentResolver().openInputStream(uri)) {
                if(in==null || target==null)throw new IOException("document-unavailable");
                c.resolve(js(target.importStream(path,in,SyncVault.MAX_SAFE)));
            }catch(Exception e){c.reject(e.getMessage(),e);}
        });}catch(Exception e){c.reject(e.getMessage(),e);}
    }
    @PluginMethod public void exportVersion(PluginCall c) {
        try {
            synchronized(lock){if(exporting!=null || vault==null)throw new IOException("replica-busy");exportBlob=new JSONObject(c.getObject("blob").toString());exporting=vault;}
            Intent intent=new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("application/octet-stream").putExtra(Intent.EXTRA_TITLE,"PentaMark-version");
            getActivity().runOnUiThread(() -> startActivityForResult(c,intent,"exportResult"));
        }catch(Exception e){synchronized(lock){exporting=null;}c.reject(e.getMessage(),e);}
    }
    @ActivityCallback private void exportResult(PluginCall c,ActivityResult result) {
        final SyncVault target;final JSONObject blob;synchronized(lock){target=exporting;blob=exportBlob;exporting=null;exportBlob=null;}
        if(c==null)return;if(result.getResultCode()!=Activity.RESULT_OK || result.getData()==null){c.resolve(new JSObject().put("cancelled",true));return;}
        Uri uri=result.getData().getData();
        try{work.execute(() -> {
            try {
                try(OutputStream out=getContext().getContentResolver().openOutputStream(uri,"wt")) {
                    if(out==null || target==null)throw new IOException("document-unavailable");target.exportBlob(blob,out);
                }
                c.resolve(new JSObject().put("cancelled",false));
            }catch(Exception e){c.reject(e.getMessage(),e);}
        });}catch(Exception e){c.reject(e.getMessage(),e);}
    }
    @PluginMethod public void exportReplica(PluginCall c) {
        boolean claimed=false;
        try {
            synchronized(lock){if(exportingReplica!=null || vault==null || opening)throw new IOException("replica-busy");exportingReplica=vault;claimed=true;}
            Intent intent=new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("application/zip").putExtra(Intent.EXTRA_TITLE,"PentaMark-replica.zip");
            getActivity().runOnUiThread(() -> {try{startActivityForResult(c,intent,"exportReplicaResult");}catch(Exception e){synchronized(lock){exportingReplica=null;}c.reject(e.getMessage(),e);}});
        }catch(Exception e){if(claimed)synchronized(lock){exportingReplica=null;}c.reject(e.getMessage(),e);}
    }
    @ActivityCallback private void exportReplicaResult(PluginCall c,ActivityResult result) {
        final SyncVault target;synchronized(lock){target=exportingReplica;exportingReplica=null;}
        if(c==null)return;
        if(result.getResultCode()!=Activity.RESULT_OK || result.getData()==null || result.getData().getData()==null){c.resolve(new JSObject().put("cancelled",true));return;}
        Uri uri=result.getData().getData();
        try{work.execute(() -> {
            try {
                if(target==null)throw new IOException("replica-changed");
                try(OutputStream out=getContext().getContentResolver().openOutputStream(uri,"wt")) {
                    if(out==null)throw new IOException("document-unavailable");target.exportReplica(out);
                }
                // Provider close/ZIP finalization must succeed before notifying the UI.
                c.resolve(new JSObject().put("cancelled",false).put("exported",true).put("format","pentamark-replica-backup").put("formatVersion",1));
            }catch(Exception e){c.reject(e.getMessage(),e);}
        });}catch(Exception e){c.reject(e.getMessage(),e);}
    }
    RemoteConnection.Media openMedia(String path,String range)throws Exception {SyncVault target;synchronized(lock){target=vault;}if(target==null)throw new IOException("replica-not-open");return target.openMedia(path,range);}
    private void cancelProbes(){for(RemoteConnection probe:probes)probe.close();probes.clear();}
    @Override protected void handleOnPause(){synchronized(lock){paused=true;bindingGeneration++;opening=false;cancelProbes();if(remote!=null)remote.close();remote=null;maximum=0;}super.handleOnPause();}
    @Override protected void handleOnResume(){synchronized(lock){paused=false;}super.handleOnResume();}
    @Override protected void handleOnDestroy(){synchronized(lock){paused=true;bindingGeneration++;opening=false;cancelProbes();discovery=null;if(remote!=null)remote.close();remote=null;if(vault!=null)vault.close();vault=null;}work.shutdown();super.handleOnDestroy();}
}
