package com.pentagory.pentamark;
import android.content.*;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.net.Uri;
import androidx.activity.result.ActivityResult;
import androidx.test.core.app.*;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import com.getcapacitor.*;
import org.json.*;
import org.junit.Test;
import org.junit.runner.RunWith;
import java.io.*;
import java.lang.reflect.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicReference;
import java.util.zip.*;
import static org.junit.Assert.*;

@RunWith(AndroidJUnit4.class)
public class SyncRecoveryInstrumentedTest {
    static class Call extends PluginCall {
        final CountDownLatch done=new CountDownLatch(1);volatile String error;volatile JSObject result;
        Call(String id,String method,JSONObject profile)throws Exception{super(null,"SyncVault",id,method,new JSObject().put("profile",profile));}
        @Override public void resolve(JSObject value){result=value;done.countDown();}
        @Override public void reject(String message,String code,Exception e){error=code;done.countDown();}
        @Override public void reject(String message,Exception e){error=message;done.countDown();}
        @Override public void reject(String message){error=message;done.countDown();}
        void await()throws Exception{assertTrue(done.await(15,TimeUnit.SECONDS));}
    }
    static Field field(String name)throws Exception{Field f=SyncVaultPlugin.class.getDeclaredField(name);f.setAccessible(true);return f;}
    static JSONObject profile()throws Exception{return SyncVault.obj("vaultId",SyncVault.id(),"serverId",SyncVault.id(),"replicaId",SyncVault.id(),"origin","http://100.64.0.1:35491","offlineEnabled",true,"mode","manual");}
    static java.util.Map<String,String> image(File root)throws Exception {
        java.util.Map<String,String> result=new java.util.TreeMap<>();image(root,"",result);return result;
    }
    private static void image(File root,String prefix,java.util.Map<String,String> result)throws Exception {
        File[] files=root.listFiles();assertNotNull(files);
        for(File file:files)if(file.isDirectory()){result.put(prefix+file.getName()+"/","directory");image(file,prefix+file.getName()+"/",result);}
        else result.put(prefix+file.getName(),file.length()+":"+SyncFileJournal.hash(file));
    }
    @Test public void malformedOriginalPreservesEntireInventoryAndAuthorizesOnlyOpaqueRecovery()throws Exception {
        Context context=ApplicationProvider.getApplicationContext();JSONObject profile=profile();File root=SyncRecoveryGuard.root(context,profile);assertTrue(root.mkdirs());
        for(String name:new String[]{"replica.db","replica.db-wal","replica.db-shm","replica.db-journal","future-object"})
            try(FileOutputStream out=new FileOutputStream(new File(root,name))){out.write(new byte[256]);}
        java.util.Map<String,String> before=image(root);
        try{SyncRecoveryGuard.check(context,root);fail("malformed schema accepted");}catch(IOException e){assertEquals("unsupported-schema",e.getMessage());}
        assertEquals(before,image(root));
        try(ActivityScenario<MainActivity> activity=ActivityScenario.launch(MainActivity.class)) {
            AtomicReference<SyncVaultPlugin> ref=new AtomicReference<>();activity.onActivity(a -> ref.set((SyncVaultPlugin)a.getBridge().getPlugin("SyncVault").getInstance()));
            Call call=new Call("malformed","open",profile);ref.get().open(call);call.await();assertEquals("unsupported-schema",call.error);
            assertEquals(SyncRecoveryGuard.profile(profile).toString(),((JSONObject)field("failedSchemaProfile").get(ref.get())).toString());
            assertNull(field("vault").get(ref.get()));assertEquals(before,image(root));
        }
        ByteArrayOutputStream output=new ByteArrayOutputStream();SyncRecoveryArchive.write(root,profile,output,f -> SyncVault.androidFiles().isLink(f));
        assertEquals(before,image(root));assertTrue(output.size()>0);
    }
    static File future(Context context,JSONObject profile)throws Exception {
        File root=SyncRecoveryGuard.root(context,profile);assertTrue(root.mkdirs());
        try(SQLiteDatabase db=SQLiteDatabase.openOrCreateDatabase(new File(root,"replica.db"),null)) {
            try(Cursor mode=db.rawQuery("PRAGMA journal_mode=DELETE",null)){assertTrue(mode.moveToFirst());assertEquals("delete",mode.getString(0));}
            db.execSQL("CREATE TABLE future_only (value TEXT)");db.execSQL("INSERT INTO future_only VALUES ('keep me')");db.execSQL("PRAGMA user_version=99");
        }
        return root;
    }
    @Test public void readOnlyGuardRejectsFutureSchemaWithoutChangingDatabaseBytesOrMode()throws Exception {
        Context context=ApplicationProvider.getApplicationContext();File root=future(context,profile()),dbFile=new File(root,"replica.db");String before=SyncFileJournal.hash(dbFile);long length=dbFile.length();
        try{SyncRecoveryGuard.check(context,root);fail("future schema accepted");}catch(IOException e){assertEquals("unsupported-schema",e.getMessage());}
        assertEquals(before,SyncFileJournal.hash(dbFile));assertEquals(length,dbFile.length());
        try(SQLiteDatabase db=SQLiteDatabase.openDatabase(dbFile.getAbsolutePath(),null,SQLiteDatabase.OPEN_READONLY|SQLiteDatabase.NO_LOCALIZED_COLLATORS);
            Cursor mode=db.rawQuery("PRAGMA journal_mode",null);Cursor version=db.rawQuery("PRAGMA user_version",null)) {
            assertTrue(mode.moveToFirst());assertEquals("delete",mode.getString(0));assertTrue(version.moveToFirst());assertEquals(99,version.getInt(0));
        }
        ByteArrayOutputStream out=new ByteArrayOutputStream();SyncRecoveryArchive.write(root,profile(),out,f -> SyncVault.androidFiles().isLink(f));
        assertEquals(before,SyncFileJournal.hash(dbFile));
        File link=new File(root,"escape");android.system.Os.symlink(context.getCacheDir().getAbsolutePath(),link.getAbsolutePath());
        try{SyncRecoveryArchive.write(root,profile(),new ByteArrayOutputStream(),f -> SyncVault.androidFiles().isLink(f));fail("symlink exported");}catch(IOException e){assertEquals("unsafe-path",e.getMessage());}
    }
    @Test public void failedProfileProofOwnsPickerAndRawExportLeavesFutureDatabaseUnchanged()throws Exception {
        Context context=ApplicationProvider.getApplicationContext();JSONObject profile=profile();File root=future(context,profile);String before=SyncFileJournal.hash(new File(root,"replica.db"));
        try(ActivityScenario<MainActivity> activity=ActivityScenario.launch(MainActivity.class)) {
            AtomicReference<SyncVaultPlugin> ref=new AtomicReference<>();activity.onActivity(a -> ref.set((SyncVaultPlugin)a.getBridge().getPlugin("SyncVault").getInstance()));SyncVaultPlugin plugin=ref.get();
            Call unauthorized=new Call("unauthorized","exportRecovery",profile);plugin.exportRecovery(unauthorized);unauthorized.await();assertEquals("recovery-not-authorized",unauthorized.error);
            Call open=new Call("open","open",profile);plugin.open(open);open.await();assertEquals("unsupported-schema",open.error);
            // Wait for the actual tracked task to return, not just its callback.
            long deadline=android.os.SystemClock.elapsedRealtime()+5000;
            Object lock=field("lock").get(null);
            while(true){synchronized(lock){if(field("activeTasks").getInt(null)==0)break;}if(android.os.SystemClock.elapsedRealtime()>deadline)fail("open task did not drain");Thread.yield();}
            assertNull(field("vault").get(plugin));assertEquals(before,SyncFileJournal.hash(new File(root,"replica.db")));
            Call other=new Call("other","exportRecovery",profile());plugin.exportRecovery(other);other.await();assertEquals("recovery-not-authorized",other.error);
            CountDownLatch entered=new CountDownLatch(1),release=new CountDownLatch(1),finished=new CountDownLatch(1);
            Method submit=SyncVaultPlugin.class.getDeclaredMethod("submit",Runnable.class);submit.setAccessible(true);
            submit.invoke(plugin,(Runnable)() -> {entered.countDown();try{release.await(5,TimeUnit.SECONDS);}catch(InterruptedException e){Thread.currentThread().interrupt();}finally{finished.countDown();}});
            assertTrue(entered.await(5,TimeUnit.SECONDS));
            try{Call busy=new Call("active","exportRecovery",profile);plugin.exportRecovery(busy);busy.await();assertEquals("replica-busy",busy.error);assertNull(field("recoveryOwner").get(plugin));}
            finally{release.countDown();}assertTrue(finished.await(5,TimeUnit.SECONDS));
            deadline=android.os.SystemClock.elapsedRealtime()+5000;
            while(true){synchronized(lock){if(field("activeTasks").getInt(null)==0)break;}if(android.os.SystemClock.elapsedRealtime()>deadline)fail("task did not drain");Thread.yield();}
            // Seed the already displayed picker state to test the real native result path without provider UI.
            Call owner=new Call("owner","exportRecovery",profile);
            synchronized(lock){field("recoveryPlugin").set(null,plugin);field("recoveryOwner").set(plugin,owner);field("recoveryRoot").set(plugin,root);field("recoveryProfile").set(plugin,SyncRecoveryGuard.profile(profile));}
            Call second=new Call("second","exportRecovery",profile);plugin.exportRecovery(second);second.await();assertEquals("replica-busy",second.error);assertSame(owner,field("recoveryOwner").get(plugin));
            Call blockedOpen=new Call("blocked","open",profile);plugin.open(blockedOpen);blockedOpen.await();assertEquals("replica-busy",blockedOpen.error);
            Method callback=SyncVaultPlugin.class.getDeclaredMethod("recoveryResult",PluginCall.class,ActivityResult.class);callback.setAccessible(true);
            File output=File.createTempFile("opaque-recovery-",".zip",context.getCacheDir());
            callback.invoke(plugin,owner,new ActivityResult(android.app.Activity.RESULT_OK,new Intent().setData(Uri.fromFile(output))));owner.await();assertNull(owner.error);assertTrue(owner.result.getBoolean("exported"));assertTrue(owner.result.getBoolean("requiresCompatibleApp"));
            boolean found=false;try(ZipFile zip=new ZipFile(output)){found=zip.getEntry("replica/replica.db")!=null;assertNotNull(zip.getEntry("recovery.json"));}assertTrue(found);
            assertEquals(before,SyncFileJournal.hash(new File(root,"replica.db")));assertNull(field("recoveryOwner").get(plugin));assertNull(field("recoveryPlugin").get(null));
            Call cancel=new Call("cancel","exportRecovery",profile);
            synchronized(lock){field("recoveryPlugin").set(null,plugin);field("recoveryOwner").set(plugin,cancel);field("recoveryRoot").set(plugin,root);field("recoveryProfile").set(plugin,profile);}
            callback.invoke(plugin,cancel,new ActivityResult(android.app.Activity.RESULT_CANCELED,null));cancel.await();assertTrue(cancel.result.getBoolean("cancelled"));assertFalse(cancel.result.has("exported"));assertNull(field("recoveryPlugin").get(null));
        }
    }
}
