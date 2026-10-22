package com.pentagory.pentamark;

import org.junit.Test;
import org.json.JSONObject;
import java.io.*;
import java.net.*;
import java.nio.file.Files;
import static org.junit.Assert.*;

public class SyncTransportTest {
    @Test public void replayedUploadAcceptsAlignedServerForwardProgress()throws Exception {
        assertEquals(2097152,uploadAcknowledgement(2097152,false,null));
        assertEquals(3145745,uploadAcknowledgement(3145745,true,null));
    }
    @Test public void replayedUploadRejectsUnalignedOversizedAndFalseCompletion()throws Exception {
        for(Object[] test:new Object[][]{{1048577L,false,null},{4194304L,true,null},{2097152L,true,null},{3145745L,false,null},{2097152L,false,"b".repeat(64)}}) {
            try{uploadAcknowledgement((long)test[0],(boolean)test[1],(String)test[2]);fail("unsafe progress accepted");}catch(IOException expected){assertEquals("invalid-transfer-progress",expected.getMessage());}
        }
    }
    private long uploadAcknowledgement(long acknowledged,boolean complete,String overrideHash)throws Exception {
        File object=Files.createTempFile("sync-retry-", ".blob").toFile();long total=3145745;
        try(RandomAccessFile f=new RandomAccessFile(object,"rw")){f.setLength(total);}
        String hash=SyncFileJournal.hash(object);
        java.util.concurrent.atomic.AtomicReference<Throwable> failure=new java.util.concurrent.atomic.AtomicReference<>();
        try(ServerSocket server=new ServerSocket(0,1,InetAddress.getByName("127.0.0.1"))) {
            server.setSoTimeout(10000);Thread worker=new Thread(() -> {
                try(Socket socket=server.accept()) {
                    socket.setSoTimeout(10000);InputStream in=socket.getInputStream();ByteArrayOutputStream header=new ByteArrayOutputStream();int ch;
                    while((ch=in.read())!=-1){header.write(ch);if(header.size()>8192)throw new IOException("headers too long");if(header.toString("US-ASCII").endsWith("\r\n\r\n"))break;}
                    String headers=header.toString("US-ASCII").toLowerCase(java.util.Locale.ROOT);
                    assertTrue(headers.contains("content-range: bytes 0-1048575/3145745"));assertTrue(headers.contains("content-length: 1048576"));
                    byte[] bytes=new byte[65536];long remaining=1048576;while(remaining>0){int n=in.read(bytes,0,(int)Math.min(bytes.length,remaining));if(n<0)throw new EOFException();remaining-=n;}
                    byte[] response=new JSONObject().put("blobHash",overrideHash==null?hash:overrideHash).put("verifiedBytes",acknowledged).put("complete",complete).toString().getBytes("UTF-8");
                    OutputStream out=socket.getOutputStream();out.write(("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: "+response.length+"\r\nConnection: close\r\n\r\n").getBytes("US-ASCII"));out.write(response);
                }catch(Throwable error){failure.set(error);}
            });worker.setDaemon(true);worker.start();
            RemoteConnection connection=new RemoteConnection("http://100.64.0.1:3000",url -> (HttpURLConnection)new URL("http://127.0.0.1:"+server.getLocalPort()+url.getFile()).openConnection(Proxy.NO_PROXY));
            try{return connection.uploadChunk(hash,total,0,object);}
            finally{connection.close();worker.join(12000);if(failure.get()!=null)throw new AssertionError(failure.get());}
        }
    }
    @Test public void downloadOver32MiBUsesBoundedChunksAndResumesFromDisk()throws Exception {
        SyncFileJournal journal=SyncVaultTest.journal(Files.createTempDirectory("sync-wire-large-").toFile());
        File source=Files.createTempFile("sync-source-", ".bin").toFile();long total=33L*1048576+17;
        try(RandomAccessFile f=new RandomAccessFile(source,"rw")){f.setLength(total);f.getFD().sync();}
        String hash=SyncFileJournal.hash(source);File partial=journal.partial(hash);
        java.util.concurrent.atomic.AtomicReference<Throwable> failure=new java.util.concurrent.atomic.AtomicReference<>();
        try(ServerSocket server=new ServerSocket(0,1,InetAddress.getByName("127.0.0.1"))) {
            server.setSoTimeout(10000);
            Thread worker=new Thread(() -> {
                try {
                    for(int chunk=0;chunk<34;chunk++)try(Socket socket=server.accept()) {
                        BufferedReader reader=new BufferedReader(new InputStreamReader(socket.getInputStream(),"US-ASCII"));
                        String line,range=null;while((line=reader.readLine())!=null&&!line.isEmpty())if(line.toLowerCase(java.util.Locale.ROOT).startsWith("range:"))range=line.substring(6).trim();
                        long start=(long)chunk*1048576,end=Math.min(total-1,start+1048575),length=end-start+1;
                        assertEquals("bytes="+start+"-"+end,range);
                        OutputStream out=socket.getOutputStream();out.write(("HTTP/1.1 206 Partial Content\r\nContent-Type: application/octet-stream\r\nContent-Length: "+length+"\r\nContent-Range: bytes "+start+"-"+end+"/"+total+"\r\nConnection: close\r\n\r\n").getBytes("US-ASCII"));
                        byte[] zeros=new byte[65536];for(long left=length;left>0;){int n=(int)Math.min(left,zeros.length);out.write(zeros,0,n);left-=n;}
                    }
                }catch(Throwable e){failure.set(e);}
            });worker.setDaemon(true);worker.start();
            RemoteConnection connection=null;
            try {
                long offset=0;int segments=0;
                while(offset<total) {
                    if(connection==null)connection=new RemoteConnection("http://100.64.0.1:3000",url -> (HttpURLConnection)new URL("http://127.0.0.1:"+server.getLocalPort()+url.getFile()).openConnection(Proxy.NO_PROXY));
                    long next=connection.downloadChunk(hash,total,offset,partial);assertTrue(next-offset<=1048576);offset=next;segments++;
                    if(segments==12){connection.close();connection=null;assertEquals(offset,partial.length());}
                }
                assertEquals(34,segments);journal.publish(partial,hash,total);journal.require(hash,total);
            }finally{if(connection!=null)connection.close();}
            worker.join(10000);assertFalse(worker.isAlive());if(failure.get()!=null)throw new AssertionError(failure.get());
        }
    }
    @Test public void syncAllowlistRejectsOtherOriginsAndUnknownRoutes() throws Exception {
        RemoteConnection.validateSyncRequest("/api/sync/v1/hello", "GET");
        for (String route : new String[]{"https://example.com/api/sync/v1/hello", "//example.com/api/sync/v1/hello", "/api/sync/v1/../hello", "/api/sync/v1/hello?url=evil", "/api/sync/v1/blobs/abc"}) {
            try { RemoteConnection.validateSyncRequest(route, "GET"); fail(route); } catch (IllegalArgumentException expected) {}
        }
    }
    @Test public void resumedDownloadRequiresExactContentRangeAndPreservesPrefix() throws Exception {
        File dest = Files.createTempFile("sync-transfer-", ".part").toFile(); Files.write(dest.toPath(), new byte[]{1,2});
        try (ServerSocket server = new ServerSocket(0, 1, InetAddress.getLoopbackAddress())) {
            Thread worker = new Thread(() -> {
                try (Socket socket = server.accept()) {
                    BufferedReader reader = new BufferedReader(new InputStreamReader(socket.getInputStream(), "US-ASCII"));
                    String line; while ((line=reader.readLine())!=null && !line.isEmpty()) {}
                    socket.getOutputStream().write("HTTP/1.1 206 Partial Content\r\nContent-Type: application/octet-stream\r\nContent-Length: 2\r\nContent-Range: bytes 0-1/4\r\nConnection: close\r\n\r\nxx".getBytes("US-ASCII"));
                } catch (IOException e) { throw new RuntimeException(e); }
            }); worker.start();
            RemoteConnection connection = new RemoteConnection("http://100.64.0.1:3000", url -> (HttpURLConnection)new URL("http://127.0.0.1:"+server.getLocalPort()+url.getFile()).openConnection(Proxy.NO_PROXY));
            try { connection.downloadChunk("a".repeat(64), 4, 2, dest); fail("bad range accepted"); }
            catch (IOException expected) { assertEquals("invalid-range", expected.getMessage()); }
            finally { connection.close(); }
            worker.join(3000); assertArrayEquals(new byte[]{1,2}, Files.readAllBytes(dest.toPath()));
        }
    }
}
