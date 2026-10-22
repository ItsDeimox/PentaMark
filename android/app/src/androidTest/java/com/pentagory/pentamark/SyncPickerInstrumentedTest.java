package com.pentagory.pentamark;

import android.content.*;
import android.net.Uri;
import androidx.activity.result.ActivityResult;
import androidx.test.core.app.*;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import com.getcapacitor.*;
import org.junit.Test;
import org.junit.runner.RunWith;
import java.io.*;
import java.lang.reflect.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicReference;
import static org.junit.Assert.*;

@RunWith(AndroidJUnit4.class)
public class SyncPickerInstrumentedTest {
    static final class ResultCall extends PluginCall {
        final CountDownLatch done=new CountDownLatch(1);volatile JSObject result;volatile String error;
        ResultCall(String id,String path){super(null,"SyncVault",id,"importDocument",new JSObject().put("path",path));}
        @Override public void resolve(JSObject value){result=value;done.countDown();}
        @Override public void reject(String message,Exception failure){error=message;done.countDown();}
    }
    static Field field(String name)throws Exception{Field field=SyncVaultPlugin.class.getDeclaredField(name);field.setAccessible(true);return field;}
    @Test public void rejectedSecondPickerCannotStealFirstResultAndNativeImportStillCommits()throws Exception {
        Context context=ApplicationProvider.getApplicationContext();
        SyncVault vault=new SyncVault(context,SyncVault.obj("vaultId",SyncVault.id(),"serverId",SyncVault.id(),"replicaId",SyncVault.id(),"origin","http://100.64.0.1:3000","offlineEnabled",true,"mode","manual"));
        try(ActivityScenario<MainActivity> activity=ActivityScenario.launch(MainActivity.class)) {
            AtomicReference<SyncVaultPlugin> reference=new AtomicReference<>();activity.onActivity(a -> reference.set((SyncVaultPlugin)a.getBridge().getPlugin("SyncVault").getInstance()));SyncVaultPlugin plugin=reference.get();
            ResultCall first=new ResultCall("first","First.txt"),second=new ResultCall("second","Second.txt");
            // Model the first picker already displayed; exercise the actual rejection and Activity callback.
            field("vault").set(plugin,vault);field("importing").set(plugin,vault);field("importPath").set(plugin,"First.txt");field("importOwner").set(plugin,first);
            plugin.importDocument(second);assertEquals("replica-busy",second.error);assertSame(vault,field("importing").get(plugin));assertSame(first,field("importOwner").get(plugin));assertEquals("First.txt",field("importPath").get(plugin));
            File document=File.createTempFile("picker-test-",".txt",context.getCacheDir());try(FileOutputStream out=new FileOutputStream(document)){out.write("first bytes".getBytes("UTF-8"));}
            Method callback=SyncVaultPlugin.class.getDeclaredMethod("importResult",PluginCall.class,ActivityResult.class);callback.setAccessible(true);
            callback.invoke(plugin,first,new ActivityResult(android.app.Activity.RESULT_OK,new Intent().setData(Uri.fromFile(document))));
            assertTrue(first.done.await(15,TimeUnit.SECONDS));assertNull(first.error);assertNotNull(first.result);assertEquals("First.txt",first.result.getString("path"));
            assertTrue(vault.files.target("First.txt").isFile());assertFalse(vault.files.target("Second.txt").exists());assertEquals(1,vault.snapshot().getJSONArray("entries").length());assertNull(field("importing").get(plugin));
        }finally{vault.close();}
    }
}
