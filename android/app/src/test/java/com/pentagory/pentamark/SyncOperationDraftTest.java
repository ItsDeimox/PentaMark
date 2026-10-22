package com.pentagory.pentamark;
import org.json.*;
import org.junit.Test;
import static org.junit.Assert.*;
public class SyncOperationDraftTest {
    @Test public void editedRenameFirstMovesOnlyConfirmedBytesWithoutMutatingLocal()throws Exception {
        JSONObject base=new JSONObject().put("entryId","one").put("kind","note").put("path","A.md").put("blobHash","old").put("byteLength",3).put("deleted",false);
        JSONObject local=new JSONObject(base.toString()).put("path","B.md").put("blobHash","new").put("byteLength",5);
        JSONObject prepared=SyncOperationDraft.version(base,local);
        assertEquals("B.md",prepared.getString("path"));assertEquals("old",prepared.getString("blobHash"));assertEquals(3,prepared.getLong("byteLength"));assertEquals("new",local.getString("blobHash"));
        JSONObject confirmed=new JSONObject(prepared.toString());assertEquals(local.toString(),SyncOperationDraft.version(confirmed,local).toString());
    }
}
