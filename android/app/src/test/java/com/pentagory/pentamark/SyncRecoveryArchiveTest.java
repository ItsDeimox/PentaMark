package com.pentagory.pentamark;
import org.junit.Test;
import org.json.JSONObject;
import java.io.*;
import java.nio.file.Files;
import java.util.Map;
import static org.junit.Assert.*;

public class SyncRecoveryArchiveTest {
    @Test public void rawFutureFilesAndSidecarsExportWithoutInterpretationOrMutation()throws Exception {
        File root=Files.createTempDirectory("recovery-").toFile();
        Files.write(new File(root,"replica.db").toPath(),new byte[]{0,99,12});
        Files.write(new File(root,"replica.db-wal").toPath(),new byte[]{42});
        assertTrue(new File(root,"objects").mkdir());Files.write(new File(root,"objects/future-object").toPath(),new byte[]{13});
        ByteArrayOutputStream out=new ByteArrayOutputStream();
        SyncRecoveryArchive.write(root,new JSONObject().put("vaultId","test"),out,f -> Files.isSymbolicLink(f.toPath()));
        Map<String,byte[]> zip=SyncReplicaArchiveTest.unzip(out.toByteArray());
        assertArrayEquals(new byte[]{0,99,12},zip.get("replica/replica.db"));assertArrayEquals(new byte[]{42},zip.get("replica/replica.db-wal"));
        assertArrayEquals(new byte[]{13},zip.get("replica/objects/future-object"));
        assertTrue(new String(zip.get("recovery.json"),"UTF-8").contains("requiresCompatibleApp"));
        assertArrayEquals(new byte[]{0,99,12},Files.readAllBytes(new File(root,"replica.db").toPath()));assertEquals(3,root.list().length);
    }
    @Test public void missingRootAndLinkedFilesRejectWithoutCreatingAnything()throws Exception {
        File parent=Files.createTempDirectory("recovery-missing-").toFile(),root=new File(parent,"missing");
        try{SyncRecoveryArchive.write(root,new JSONObject(),new ByteArrayOutputStream(),f -> false);fail();}catch(IOException expected){}
        assertFalse(root.exists());assertTrue(root.mkdir());File source=new File(root,"replica.db");Files.write(source.toPath(),new byte[]{1});
        try{SyncRecoveryArchive.write(root,new JSONObject(),new ByteArrayOutputStream(),f -> f.equals(source));fail();}catch(IOException expected){assertEquals("unsafe-path",expected.getMessage());}
    }
    @Test public void changingSourceAndBrokenDestinationFail()throws Exception {
        File root=Files.createTempDirectory("recovery-change-").toFile(),source=new File(root,"replica.db");Files.write(source.toPath(),new byte[]{1});
        OutputStream mutating=new ByteArrayOutputStream(){boolean changed;@Override public synchronized void write(byte[] b,int off,int len){super.write(b,off,len);if(!changed){changed=true;try{Files.write(source.toPath(),new byte[]{2});}catch(IOException e){throw new RuntimeException(e);}}}};
        try{SyncRecoveryArchive.write(root,new JSONObject(),mutating,f -> false);fail();}catch(IOException expected){assertEquals("export-source-changed",expected.getMessage());}
        try{SyncRecoveryArchive.write(root,new JSONObject(),new OutputStream(){public void write(int b)throws IOException{throw new IOException("full");}},f -> false);fail();}catch(IOException expected){assertEquals("full",expected.getMessage());}
    }
}
