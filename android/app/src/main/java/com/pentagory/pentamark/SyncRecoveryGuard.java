package com.pentagory.pentamark;
import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteException;
import java.io.*;
import org.json.JSONObject;

/** SQLite inspects ONLY an isolated complete DB/sidecar copy. Caller holds writer gate. */
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
    static void check(Context context,File root)throws Exception {
        File database=new File(root,"replica.db");
        for(String name:new String[]{"replica.db","replica.db-wal","replica.db-shm","replica.db-journal"})
            if(SyncVault.androidFiles().isLink(new File(root,name)))throw new IOException("unsafe-path");
        if(!database.exists()) {
            for(String suffix:new String[]{"-wal","-shm","-journal"})if(new File(root,"replica.db"+suffix).exists())throw new IOException("unsupported-schema");
            return;
        }
        File cache=context.getCacheDir().getCanonicalFile();
        File isolated=File.createTempFile("sync-schema-inspection-","",cache);
        if(!isolated.delete() || !isolated.mkdir())throw new IOException("storage-unavailable");
        try {
            SyncRecoveryArchive.copyDatabaseFiles(root,isolated,f -> SyncVault.androidFiles().isLink(f));
            File copy=new File(isolated,"replica.db");
            if(copy.length()<100)throw new IOException("unsupported-schema");
            // READONLY itself can reconstruct SHM. Only disposable copied files are exposed to SQLite.
            // Explicit no-op handler prevents default corruption deletion even on this isolated copy.
            try(SQLiteDatabase db=SQLiteDatabase.openDatabase(copy.getAbsolutePath(),null,
                SQLiteDatabase.OPEN_READONLY|SQLiteDatabase.NO_LOCALIZED_COLLATORS,ignored -> {});
                Cursor c=db.rawQuery("PRAGMA user_version",null)) {
                if(!c.moveToFirst() || c.getInt(0)!=1)throw new IOException("unsupported-schema");
                try(Cursor integrity=db.rawQuery("PRAGMA quick_check(1)",null)) {
                    if(!integrity.moveToFirst() || !"ok".equals(integrity.getString(0)))throw new IOException("unsupported-schema");
                }
            }catch(SQLiteException malformed){throw new IOException("unsupported-schema",malformed);}
        } finally {
            // Only this exact newly-created cache directory; never recurse/follow links or touch originals.
            File[] copies=isolated.listFiles();if(copies!=null)for(File file:copies)file.delete();
            isolated.delete();
        }
    }
}
