package com.pentagory.pentamark;

import org.json.*;
import org.junit.Test;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.*;
import java.util.zip.*;
import static org.junit.Assert.*;

public class SyncReplicaArchiveTest {
    @Test public void largeAssetStreamsIntoArchiveAndRoundTripsWithoutWholeFileBuffer()throws Exception {
        File root=Files.createTempDirectory("sync-export-large-").toFile();SyncFileJournal files=SyncVaultTest.journal(root);
        final long length=33L*1024*1024+17;
        InputStream generated=new InputStream(){long remaining=length;public int read(){return remaining-->0?55:-1;}public int read(byte[] b,int off,int len){if(remaining==0)return -1;int n=(int)Math.min(remaining,len);Arrays.fill(b,off,off+n,(byte)55);remaining-=n;return n;}};
        JSONObject version=SyncVaultTest.version(files.store(generated,length),"large.bin").put("kind","asset");files.apply(null,version);
        File archive=new File(root,"backup.zip");try(OutputStream output=new FileOutputStream(archive)){SyncReplicaArchive.write(files,new JSONObject().put("entry",version),output);}
        int copies=0;try(ZipInputStream zip=new ZipInputStream(new FileInputStream(archive))){ZipEntry entry;byte[] buffer=new byte[65536];while((entry=zip.getNextEntry())!=null){long count=0;int n;while((n=zip.read(buffer))!=-1)count+=n;if(!entry.getName().equals("manifest.json")){assertEquals(length,count);copies++;}}}
        assertEquals(2,copies);files.require(version.getString("blobHash"),length);
    }
    @Test public void archiveContainsWorkingHistoryAndManifestWithoutChangingOriginals()throws Exception {
        SyncFileJournal files=SyncVaultTest.journal(Files.createTempDirectory("sync-export-").toFile());
        JSONObject old=SyncVaultTest.version(files.store(new ByteArrayInputStream("old".getBytes(StandardCharsets.UTF_8)),100),"A.md");
        JSONObject current=SyncVaultTest.version(files.store(new ByteArrayInputStream("new".getBytes(StandardCharsets.UTF_8)),100),"A.md");
        files.apply(null,current);Files.write(files.target("Unknown.md").toPath(),"untracked".getBytes(StandardCharsets.UTF_8));
        JSONObject manifest=new JSONObject().put("entries",new JSONArray().put(current)).put("versions",new JSONArray().put(old));
        ByteArrayOutputStream out=new ByteArrayOutputStream();SyncReplicaArchive.write(files,manifest,out);
        Map<String,byte[]> contents=unzip(out.toByteArray());
        assertEquals("new",new String(contents.get("working/A.md"),StandardCharsets.UTF_8));
        assertEquals("untracked",new String(contents.get("working/Unknown.md"),StandardCharsets.UTF_8));
        assertEquals("old",new String(contents.get("objects/"+old.getString("blobHash")),StandardCharsets.UTF_8));
        JSONObject saved=new JSONObject(new String(contents.get("manifest.json"),StandardCharsets.UTF_8));
        assertEquals(manifest.getJSONArray("versions").toString(),saved.getJSONArray("versions").toString());
        assertFalse(contents.containsKey("replica.db"));assertEquals("new",new String(Files.readAllBytes(files.target("A.md").toPath()),StandardCharsets.UTF_8));
        files.require(old.getString("blobHash"),3);files.require(current.getString("blobHash"),3);
    }
    @Test public void missingReferencedObjectAndFailedDestinationDoNotReportSuccess()throws Exception {
        SyncFileJournal files=SyncVaultTest.journal(Files.createTempDirectory("sync-export-fail-").toFile());
        JSONObject blob=files.store(new ByteArrayInputStream(new byte[]{1}),100);
        OutputStream broken=new OutputStream(){public void write(int b)throws IOException{throw new IOException("full");}};
        try{SyncReplicaArchive.write(files,new JSONObject(),broken);fail("destination failure ignored");}catch(IOException expected){assertEquals("full",expected.getMessage());}
        files.require(blob.getString("blobHash"),1);
        JSONObject absent=new JSONObject(blob.toString()).put("blobHash","aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
        try{SyncReplicaArchive.write(files,new JSONObject().put("pending",absent),new ByteArrayOutputStream());fail("missing object ignored");}catch(IOException expected){assertEquals("blob-unavailable",expected.getMessage());}
    }
    static Map<String,byte[]> unzip(byte[] bytes)throws Exception {
        Map<String,byte[]> contents=new HashMap<>();try(ZipInputStream zip=new ZipInputStream(new ByteArrayInputStream(bytes))){ZipEntry entry;byte[] buffer=new byte[8192];while((entry=zip.getNextEntry())!=null){ByteArrayOutputStream out=new ByteArrayOutputStream();int n;while((n=zip.read(buffer))!=-1)out.write(buffer,0,n);contents.put(entry.getName(),out.toByteArray());}}return contents;
    }
}
