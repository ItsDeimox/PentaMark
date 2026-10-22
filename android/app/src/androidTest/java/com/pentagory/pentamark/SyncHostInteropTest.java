package com.pentagory.pentamark;

import android.content.Context;
import androidx.test.core.app.ApplicationProvider;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.json.*;
import org.junit.*;
import org.junit.runner.RunWith;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import static org.junit.Assert.*;

/** Real Node host/shared PC engine + real Android SQLite and native streaming.
 * Run separately with -e class ...SyncHostInteropTest -e pmHostPort 35491.
 * No reconciliation implementation: the only incoming decision is the literal seed pull.
 * Breaks caught: lost offline bytes, unconditional overwrite, incompatible folder operations,
 * missing mkdir ancestors/dependencies, and move incorrectly carrying edited content.
 */
@RunWith(AndroidJUnit4.class)
public class SyncHostInteropTest {
    private static final String ORIGIN="http://100.64.0.1:35491";
    private static final String LOOPBACK="http://127.0.0.1:35491";
    private SyncVault vault;
    private RemoteConnection remote;
    private JSONObject profile;
    private Context context;
    private long maximum;

    @Before public void setup()throws Exception {
        String port=InstrumentationRegistry.getArguments().getString("pmHostPort");
        if(port==null)Assume.assumeTrue("Legacy local run: pmHostPort absent",false);
        assertEquals("Only the agreed adb-reverse fixture port is allowed","35491",port);
        context=ApplicationProvider.getApplicationContext();
        remote=new RemoteConnection(ORIGIN,url -> {
            if(!"http".equals(url.getProtocol()) || !"100.64.0.1".equals(url.getHost()) || url.getPort()!=35491
                || url.getUserInfo()!=null || url.getRef()!=null)throw new IOException("unexpected-interop-origin");
            return connection(LOOPBACK+url.getFile());
        });
        RemoteConnection.VerifiedHello proof=remote.discover();JSONObject hello=proof.data();maximum=proof.maximum;
        JSONObject state=control(null);
        assertEquals(hello.getString("vaultId"),state.getJSONObject("hello").getString("vaultId"));
        assertEquals(hello.getString("serverId"),state.getJSONObject("pcSnapshot").getJSONObject("profile").getString("serverId"));
        profile=SyncVault.obj("vaultId",hello.getString("vaultId"),"serverId",hello.getString("serverId"),
            "replicaId",UUID.randomUUID().toString(),"origin",ORIGIN,"offlineEnabled",true,"mode","manual");
        vault=new SyncVault(context,profile);vault.verifyAssociation(proof);
    }
    @After public void close(){if(vault!=null)vault.close();if(remote!=null)remote.close();}

    @Test(timeout=180000) public void realHostOfflineConflictPushAndNestedFolderRename()throws Exception {
        JSONObject hello=remote.discover().data();
        JSONObject page=sync("/api/sync/v1/snapshot","POST",new JSONObject());
        assertTrue("Seed must fit one snapshot page",page.isNull("pageCursor"));
        JSONArray entries=page.getJSONArray("entries");assertEquals(1,entries.length());
        JSONObject seed=entries.getJSONObject(0);assertEquals("Shared.md",seed.getString("path"));
        transfer(seed,false);
        JSONObject pull=SyncVault.obj("action","pull","reason","interop-seed","base",null,"local",null,"remote",seed);
        vault.persistIncoming(SyncVault.obj("nextCursor",page.getString("atCursor"),"epoch",hello.getString("epoch"),
            "initialCopy",SyncVault.obj("snapshotToken",page.getString("snapshotToken"),"atCursor",page.getString("atCursor"),"pageCursor",null),
            "items",new JSONArray().put(SyncVault.obj("expectedLocalHead","","decision",pull))));
        assertEquals("PC base",read("Shared.md"));

        control(SyncVault.obj("action","offline"));
        assertEquals(503,remote.syncRequest("/api/sync/v1/hello","GET",null).getInt("status"));
        write("Shared.md","Android offline edit");
        control(SyncVault.obj("action","edit","path","Shared.md","content","PC offline edit"));
        JSONArray pending=vault.preparePending(100);assertEquals(1,pending.length());
        JSONObject stale=pending.getJSONObject(0);assertEquals(seed.getString("revision"),stale.getString("baseRevision"));
        reopen();assertEquals(pending.toString(),vault.preparePending(100).toString());
        assertEquals("Android offline edit",read("Shared.md"));
        control(SyncVault.obj("action","restart"));
        assertEquals("PC offline edit",control(SyncVault.obj("action","read","path","Shared.md")).getString("content"));
        control(SyncVault.obj("action","online"));control(SyncVault.obj("action","sync"));
        transfer(stale.getJSONObject("after"),true);
        JSONObject rejected=apply(pending).getJSONObject(0);assertEquals("conflict",rejected.getString("status"));
        JSONObject conflict=rejected.getJSONObject("conflict");
        transfer(conflict.getJSONObject("remote"),false);
        vault.confirm(rejected);reopen();
        assertEquals(1,vault.snapshot().getJSONArray("conflicts").length());
        assertEquals("Android offline edit",read("Shared.md"));
        assertEquals("PC offline edit",vault.readVersion(conflict.getJSONObject("remote")).getString("content"));
        assertEquals("PC base",vault.readVersion(seed).getString("content"));
        assertEquals("PC offline edit",control(SyncVault.obj("action","read","path","Shared.md")).getString("content"));

        write("Android-only.md","Android → PC exact\nline two");pushApproved();
        control(SyncVault.obj("action","sync"));
        assertEquals("Android → PC exact\nline two",control(SyncVault.obj("action","read","path","Android-only.md")).getString("content"));

        vault.request("/api/folder","POST",SyncVault.obj("path","Notes"));write("Notes/A.md","folder base");pushApproved();
        String childId=local("Notes/A.md").getString("entryId");
        write("Notes/A.md","edited child survives nested rename");
        vault.request("/api/folder?path=Notes","PATCH",SyncVault.obj("newPath","Archive/Notes"));reopen();
        assertEquals(childId,local("Archive/Notes/A.md").getString("entryId"));
        JSONArray folderOps=vault.preparePending(100);assertEquals(4,folderOps.length());
        assertEquals("Archive",folderOps.getJSONObject(0).getJSONObject("after").getString("path"));
        assertEquals("mkdir",folderOps.getJSONObject(0).getString("kind"));
        assertEquals("move",folderOps.getJSONObject(2).getString("kind"));
        assertEquals("rmdir",folderOps.getJSONObject(3).getString("kind"));
        // First batch mkdir/mkdir/move/rmdir; next batch conditional put of edited bytes.
        pushApproved();control(SyncVault.obj("action","sync"));
        assertEquals("edited child survives nested rename",control(SyncVault.obj("action","read","path","Archive/Notes/A.md")).getString("content"));
        reopen();assertEquals("edited child survives nested rename",read("Archive/Notes/A.md"));
        assertFalse(vault.files.target("Notes").exists());
        assertEquals("Android offline edit",read("Shared.md"));assertEquals(1,vault.snapshot().getJSONArray("conflicts").length());
    }

    private void reopen()throws Exception{vault.close();vault=new SyncVault(context,profile);}
    private void write(String path,String content)throws Exception {
        assertEquals(200,vault.request("/api/note","PUT",SyncVault.obj("path",path,"content",content)).getInt("status"));
    }
    private String read(String path)throws Exception{return vault.request("/api/note?path="+URLEncoder.encode(path,"UTF-8"),"GET",null).getJSONObject("data").getString("content");}
    private JSONObject local(String path)throws Exception {
        JSONArray rows=vault.snapshot().getJSONArray("entries");
        for(int i=0;i<rows.length();i++){JSONObject v=rows.getJSONObject(i).optJSONObject("local");if(v!=null&&!v.getBoolean("deleted")&&path.equals(v.getString("path")))return v;}
        throw new AssertionError("Missing local path "+path);
    }
    private JSONObject sync(String path,String method,JSONObject body)throws Exception {
        JSONObject response=remote.syncRequest(path,method,body);assertEquals(response.toString(),200,response.getInt("status"));return response.getJSONObject("data");
    }
    private JSONArray apply(JSONArray operations)throws Exception {
        JSONArray results=sync("/api/sync/v1/apply","POST",SyncVault.obj("operations",operations)).getJSONArray("results");
        assertEquals(operations.length(),results.length());return results;
    }
    private void transfer(JSONObject version,boolean upload)throws Exception {
        if(version.isNull("blobHash"))return;
        long offset=0;
        for(int n=0;n<64;n++) {
            JSONObject progress=vault.transfer(remote,version,offset,maximum,upload);long next=progress.getLong("verifiedBytes");
            if(progress.getBoolean("complete")){assertEquals(version.getLong("byteLength"),next);return;}
            assertTrue("Transfer must make progress",next>offset);offset=next;
        }
        throw new AssertionError("Transfer exceeded bounded chunk count");
    }
    private void pushApproved()throws Exception {
        for(int round=0;round<4;round++) {
            JSONArray ops=vault.preparePending(100);if(ops.length()==0)return;
            for(int i=0;i<ops.length();i++){JSONObject after=ops.getJSONObject(i).optJSONObject("after");if(after!=null)transfer(after,true);}
            JSONArray results=apply(ops);
            for(int i=0;i<results.length();i++){JSONObject result=results.getJSONObject(i);assertEquals(result.toString(),"applied",result.getString("status"));vault.confirm(result);}
        }
        fail("Approved operations did not drain");
    }
    private static HttpURLConnection connection(String url)throws IOException {
        HttpURLConnection c=(HttpURLConnection)new URL(url).openConnection(Proxy.NO_PROXY);
        c.setConnectTimeout(5000);c.setReadTimeout(15000);c.setInstanceFollowRedirects(false);return c;
    }
    private JSONObject control(JSONObject body)throws Exception {
        HttpURLConnection c=connection(LOOPBACK+(body==null?"/__test/state":"/__test/pc"));
        try {
            if(body!=null){byte[] bytes=body.toString().getBytes(StandardCharsets.UTF_8);c.setRequestMethod("POST");c.setDoOutput(true);c.setRequestProperty("Content-Type","application/json");c.setFixedLengthStreamingMode(bytes.length);try(OutputStream out=c.getOutputStream()){out.write(bytes);}}
            assertEquals("Node fixture control failed",200,c.getResponseCode());
            try(InputStream in=c.getInputStream();ByteArrayOutputStream out=new ByteArrayOutputStream()) {
                byte[] bytes=new byte[8192];int n;while((n=in.read(bytes))!=-1){out.write(bytes,0,n);if(out.size()>1048576)throw new IOException("fixture-response-too-large");}
                return new JSONObject(out.toString("UTF-8"));
            }
        }finally{c.disconnect();}
    }
}
