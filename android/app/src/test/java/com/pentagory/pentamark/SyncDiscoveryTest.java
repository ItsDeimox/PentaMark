package com.pentagory.pentamark;

import org.json.JSONObject;
import org.junit.Test;
import static org.junit.Assert.*;

public class SyncDiscoveryTest {
    JSONObject hello()throws Exception {
        return new JSONObject().put("protocol",1).put("vaultId","11111111-1111-1111-1111-111111111111").put("serverId","22222222-2222-2222-2222-222222222222")
            .put("epoch","e").put("maxFileBytes",104857600).put("chunkBytes",1048576);
    }
    @Test public void discoveryBeforeProfileReturnsBoundImmutableProof()throws Exception {
        RemoteConnection.VerifiedHello proof=SyncDiscoveryTestServer.discover("http://100.64.0.1:3000",hello());
        assertEquals("http://100.64.0.1:3000",proof.origin);assertEquals(104857600,proof.maximum);
        JSONObject edited=proof.data();edited.put("vaultId","changed");assertEquals(hello().getString("vaultId"),proof.data().getString("vaultId"));
    }
    @Test public void discoveryRejectsInvalidProtocolIdentityAndLimits()throws Exception {
        for(Object[] pair:new Object[][]{{"protocol",2},{"chunkBytes",1024},{"vaultId","not-a-uuid"},{"serverId",""},{"epoch",""},{"maxFileBytes",-1},{"maxFileBytes",1.5},{"protocol","1"}}) {
            try{SyncDiscoveryTestServer.discover("http://100.64.0.1:3000",hello().put((String)pair[0],pair[1]));fail(pair[0].toString());}
            catch(java.io.IOException expected){assertEquals("incompatible-host",expected.getMessage());}
        }
    }
}
