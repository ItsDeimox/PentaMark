package com.pentagory.pentamark;
import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import java.io.*;
import org.json.JSONObject;

/** Read-only preflight BEFORE SQLiteOpenHelper configures any writable connection. */
final class SyncRecoveryGuard {
    static JSONObject profile(JSONObject input)throws Exception {
        if(!(input.get("offlineEnabled") instanceof Boolean) || !java.util.Arrays.asList("manual","automatic").contains(input.getString("mode")))throw new IOException("invalid-config");
        return SyncVault.obj("vaultId",SyncVault.identifier(input.getString("vaultId")),
            "replicaId",SyncVault.identifier(input.getString("replicaId")),"serverId",SyncVault.identifier(input.getString("serverId")),
            "origin",RemoteConnection.validateOrigin(input.getString("origin")),"offlineEnabled",input.getBoolean("offlineEnabled"),"mode",input.getString("mode"));
    }
    static File root(Context context,JSONObject profile)throws Exception {
        File current=context.getFilesDir().getCanonicalFile();
        for(String part:new String[]{"sync","replicas",profile.getString("vaultId"),profile.getString("replicaId")}) {
            current=new File(current,part);
            if(SyncVault.androidFiles().isLink(current)||!current.getCanonicalFile().equals(current.getAbsoluteFile()))throw new IOException("unsafe-path");
        }
        return current;
    }
    static void check(File root)throws Exception {
        File database=new File(root,"replica.db");
        for(String name:new String[]{"replica.db","replica.db-wal","replica.db-shm","replica.db-journal"})
            if(SyncVault.androidFiles().isLink(new File(root,name)))throw new IOException("unsafe-path");
        if(!database.exists())return;
        // Do not invoke helper callbacks, journal-mode changes, migration or schema creation.
        try(SQLiteDatabase db=SQLiteDatabase.openDatabase(database.getAbsolutePath(),null,
            SQLiteDatabase.OPEN_READONLY|SQLiteDatabase.NO_LOCALIZED_COLLATORS);
            Cursor c=db.rawQuery("PRAGMA user_version",null)) {
            if(!c.moveToFirst())throw new IOException("unsupported-schema");
            int version=c.getInt(0);if(version!=0 && version!=1)throw new IOException("unsupported-schema");
        }
    }
}
