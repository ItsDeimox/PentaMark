package com.pentagory.pentamark;

import java.io.*;
import java.net.*;
import java.util.concurrent.atomic.AtomicReference;
import org.json.JSONObject;
import static org.junit.Assert.*;

/** Actual HTTP at an ephemeral loopback socket; shared by JVM and device tests. */
final class SyncDiscoveryTestServer {
    static RemoteConnection.VerifiedHello discover(String origin,JSONObject hello)throws Exception {
        AtomicReference<Throwable> failure=new AtomicReference<>();
        try(ServerSocket server=new ServerSocket(0,1,InetAddress.getByName("127.0.0.1"))) {
            server.setSoTimeout(10000);
            Thread worker=new Thread(() -> {
                try(Socket socket=server.accept()) {
                    socket.setSoTimeout(10000);BufferedReader in=new BufferedReader(new InputStreamReader(socket.getInputStream(),"US-ASCII"));
                    assertEquals("GET /api/sync/v1/hello HTTP/1.1",in.readLine());String line;while((line=in.readLine())!=null&&!line.isEmpty()){}
                    byte[] body=hello.toString().getBytes("UTF-8");OutputStream out=socket.getOutputStream();
                    out.write(("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: "+body.length+"\r\nConnection: close\r\n\r\n").getBytes("US-ASCII"));out.write(body);
                }catch(Throwable e){failure.set(e);}
            });worker.setDaemon(true);worker.start();
            RemoteConnection connection=new RemoteConnection(origin,url -> (HttpURLConnection)new URL("http://127.0.0.1:"+server.getLocalPort()+url.getFile()).openConnection(Proxy.NO_PROXY));
            try{return connection.discover();}finally{connection.close();worker.join(12000);if(failure.get()!=null)throw new AssertionError(failure.get());}
        }
    }
}
