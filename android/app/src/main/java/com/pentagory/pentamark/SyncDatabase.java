package com.pentagory.pentamark;

import android.content.Context;
import android.content.ContentValues;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;
import org.json.*;
import java.io.File;

/** API 24 SQL; JSON columns hold the exact shared DTO, never file bytes. */
public final class SyncDatabase extends SQLiteOpenHelper {
    public SyncDatabase(Context context, File file) {
        super(context, file.getAbsolutePath(), null, 1);
        if (android.os.Build.VERSION.SDK_INT >= 28) Api28.configure(this);
    }
    private static final class Api28 {
        static void configure(SyncDatabase helper) {
            helper.setOpenParams(new SQLiteDatabase.OpenParams.Builder()
                .addOpenFlags(SQLiteDatabase.ENABLE_WRITE_AHEAD_LOGGING)
                .setSynchronousMode("FULL").build());
        }
    }
    @Override public void onConfigure(SQLiteDatabase db) {
        db.setForeignKeyConstraintsEnabled(true);
        if (android.os.Build.VERSION.SDK_INT < 28) {
            // No public synchronous pool configuration before API28. Keep the
            // framework's single connection, but enable SQLite WAL on that connection.
            // SyncVault serializes accesses; do not enable a NORMAL reader pool here.
            try(Cursor c=db.rawQuery("PRAGMA journal_mode=WAL",null)) {
                if(!c.moveToFirst() || !"wal".equalsIgnoreCase(c.getString(0)))throw new IllegalStateException("wal-unavailable");
            }
            db.execSQL("PRAGMA synchronous=FULL");
        }
    }
    @Override public void onOpen(SQLiteDatabase db) {
        try(Cursor c=db.rawQuery("PRAGMA synchronous",null)) {
            if(!c.moveToFirst() || c.getInt(0)!=2)throw new IllegalStateException("full-sync-unavailable");
        }
    }
    @Override public void onCreate(SQLiteDatabase db) {
        db.execSQL("CREATE TABLE vaults (id TEXT PRIMARY KEY, value TEXT NOT NULL)");
        db.execSQL("CREATE TABLE entries (id TEXT PRIMARY KEY, value TEXT NOT NULL)");
        db.execSQL("CREATE TABLE versions (id TEXT PRIMARY KEY, value TEXT NOT NULL)");
        db.execSQL("CREATE TABLE pending_ops (id TEXT PRIMARY KEY, entry_id TEXT NOT NULL UNIQUE REFERENCES entries(id), value TEXT NOT NULL)");
        db.execSQL("CREATE TABLE applied_ops (id TEXT PRIMARY KEY, value TEXT NOT NULL)");
        db.execSQL("CREATE TABLE conflicts (id TEXT PRIMARY KEY, value TEXT NOT NULL)");
        db.execSQL("CREATE TABLE file_intents (id TEXT PRIMARY KEY, value TEXT NOT NULL)");
        db.execSQL("CREATE TABLE transfer_progress (id TEXT PRIMARY KEY, value TEXT NOT NULL)");
    }
    @Override public void onUpgrade(SQLiteDatabase db, int oldVersion, int newVersion) { throw new IllegalStateException("unsupported-schema"); }
    @Override public void onDowngrade(SQLiteDatabase db, int oldVersion, int newVersion) { throw new IllegalStateException("unsupported-schema"); }
    String pragma(String name) { try (Cursor c = getReadableDatabase().rawQuery("PRAGMA " + name, null)) { c.moveToFirst(); return c.getString(0); } }
    int count(String table) { try (Cursor c = getReadableDatabase().rawQuery("SELECT COUNT(*) FROM " + table, null)) { c.moveToFirst(); return c.getInt(0); } }
    JSONObject get(String table, String id) throws Exception {
        try (Cursor c = getReadableDatabase().query(table, new String[]{"value"}, "id=?", new String[]{id}, null, null, null)) {
            return c.moveToFirst() ? new JSONObject(c.getString(0)) : null;
        }
    }
    JSONArray all(String table) throws Exception {
        JSONArray result = new JSONArray();
        try (Cursor c = getReadableDatabase().query(table, new String[]{"value"}, null, null, null, null, "rowid")) {
            while (c.moveToNext()) result.put(new JSONObject(c.getString(0)));
        } return result;
    }
    void put(String table, String id, JSONObject value) {
        ContentValues values = new ContentValues(); values.put("id", id); values.put("value", value.toString());
        if (table.equals("pending_ops")) values.put("entry_id", value.optJSONObject("operation").optString("entryId"));
        SQLiteDatabase db = getWritableDatabase();
        if (db.update(table, values, "id=?", new String[]{id}) == 0) db.insertOrThrow(table, null, values);
    }
    void remove(String table, String id) { getWritableDatabase().delete(table, "id=?", new String[]{id}); }
    JSONObject exportTables()throws Exception {
        JSONObject result=new JSONObject();
        for(String table:new String[]{"vaults","entries","versions","pending_ops","applied_ops","conflicts"}) {
            JSONArray rows=new JSONArray();
            try(Cursor cursor=getReadableDatabase().query(table,new String[]{"id","value"},null,null,null,null,"rowid")) {
                while(cursor.moveToNext())rows.put(new JSONObject().put("id",cursor.getString(0)).put("value",new JSONObject(cursor.getString(1))));
            }
            result.put(table,rows);
        }
        return result;
    }
    interface Work { void run() throws Exception; }
    void transaction(Work work) throws Exception {
        SQLiteDatabase db = getWritableDatabase(); db.beginTransaction();
        try { work.run(); db.setTransactionSuccessful(); } finally { db.endTransaction(); }
    }
}
