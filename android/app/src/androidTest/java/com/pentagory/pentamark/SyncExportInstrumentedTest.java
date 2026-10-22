package com.pentagory.pentamark;

import org.json.*;
import org.junit.*;
import org.junit.runner.RunWith;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.core.app.ApplicationProvider;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.zip.*;
import static org.junit.Assert.*;

@RunWith(AndroidJUnit4.class)
public class SyncExportInstrumentedTest {
    @Test public void exportReadsConsistentSQLiteMetadataAndRetainsPreparedAndHistoricalBytes()throws Exception {
        JSONObject profile=SyncVault.obj("vaultId",SyncVault.id(),"serverId",SyncVault.id(),"replicaId",SyncVault.id(),"origin","http://100.64.0.1:3000","offlineEnabled",true,"mode","manual");
        try(SyncVault vault=new SyncVault(ApplicationProvider.getApplicationContext(),profile)) {
            vault.request("/api/note","PUT",SyncVault.obj("path","A.md","content","first"));JSONArray prepared=vault.preparePending(100);
            vault.request("/api/note","PUT",SyncVault.obj("path","A.md","content","later"));String before=vault.snapshot().toString();
            ByteArrayOutputStream output=new ByteArrayOutputStream();vault.exportReplica(output);
            JSONObject manifest=null;int objects=0;boolean working=false;
            try(ZipInputStream zip=new ZipInputStream(new ByteArrayInputStream(output.toByteArray()))) {
                ZipEntry entry;byte[] buffer=new byte[4096];
                while((entry=zip.getNextEntry())!=null){ByteArrayOutputStream bytes=new ByteArrayOutputStream();int n;while((n=zip.read(buffer))!=-1)bytes.write(buffer,0,n);
                    assertFalse(entry.getName().endsWith(".db"));
                    if(entry.getName().equals("manifest.json"))manifest=new JSONObject(new String(bytes.toByteArray(),StandardCharsets.UTF_8));
                    if(entry.getName().startsWith("objects/"))objects++;
                    if(entry.getName().equals("working/A.md")){working=true;assertEquals("later",new String(bytes.toByteArray(),StandardCharsets.UTF_8));}
                }
            }
            assertNotNull(manifest);assertTrue(working);assertTrue(objects>=2);
            assertEquals(profile.toString(),manifest.getJSONObject("identity").toString());
            assertEquals(prepared.toString(),manifest.getJSONObject("snapshot").getJSONArray("preparedOperations").toString());
            assertTrue(manifest.getJSONObject("tables").getJSONArray("versions").length()>0);
            assertEquals(before,vault.snapshot().toString());
        }
    }
}
