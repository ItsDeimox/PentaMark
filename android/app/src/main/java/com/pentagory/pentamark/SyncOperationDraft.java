package com.pentagory.pentamark;
import org.json.JSONObject;
/** Expands a local edit into a host-valid conditional step; does not reconcile remote state. */
final class SyncOperationDraft {
    static JSONObject version(JSONObject base,JSONObject local)throws Exception {
        JSONObject prepared=new JSONObject(local.toString());
        if(base!=null && !base.getBoolean("deleted") && !local.getBoolean("deleted") && !base.getString("path").equals(local.getString("path")))
            prepared.put("blobHash",base.get("blobHash")).put("byteLength",base.get("byteLength"));
        return prepared;
    }
}
