package com.pentagory.pentamark;

import static org.junit.Assert.*;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.SystemClock;
import android.provider.Settings;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.File;
import java.io.FileOutputStream;
import java.lang.reflect.Field;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.json.JSONObject;
import org.json.JSONTokener;
import org.json.JSONArray;
import org.junit.Test;
import org.junit.runner.RunWith;

/** Offline only. Constructs installer intents but NEVER starts an APK installation. */
@RunWith(AndroidJUnit4.class)
public class AppUpdatePluginTest {
    private Object evaluate(ActivityScenario<MainActivity> scenario, String script) throws Exception {
        CountDownLatch done = new CountDownLatch(1);
        AtomicReference<String> result = new AtomicReference<>();
        scenario.onActivity(activity -> activity.getBridge().getWebView().evaluateJavascript(script,
            value -> { result.set(value); done.countDown(); }));
        assertTrue(done.await(10, TimeUnit.SECONDS));
        return new JSONTokener(result.get()).nextValue();
    }

    private JSONObject call(ActivityScenario<MainActivity> scenario, String method) throws Exception {
        evaluate(scenario, "window.__updateResult=null; Capacitor.nativePromise('AppUpdate','" + method
            + "',{url:'https://evil.test/evil.apk',version:'99.0.0',path:'/sdcard/evil.apk'})"
            + ".then(x=>window.__updateResult=x).catch(e=>window.__updateResult={rejected:String(e)});true");
        long until = SystemClock.elapsedRealtime() + 10000;
        while (SystemClock.elapsedRealtime() < until) {
            Object value = evaluate(scenario, "window.__updateResult ? JSON.stringify(window.__updateResult) : null");
            if (value instanceof String) {
                JSONObject status = new JSONObject((String)value);
                assertFalse(status.toString(), status.has("rejected"));
                return status;
            }
            SystemClock.sleep(50);
        }
        throw new AssertionError("No updater status returned");
    }

    private void awaitBridge(ActivityScenario<MainActivity> scenario) throws Exception {
        long until = SystemClock.elapsedRealtime() + 30000;
        while (!Boolean.TRUE.equals(evaluate(scenario, "typeof window.Capacitor?.nativePromise === 'function'"))) {
            assertTrue("Bridge did not load", SystemClock.elapsedRealtime() < until);
            SystemClock.sleep(100);
        }
    }

    private JSONObject awaitPhase(ActivityScenario<MainActivity> scenario, String transientPhase) throws Exception {
        long until = SystemClock.elapsedRealtime() + 10000;
        JSONObject status;
        do {
            status = call(scenario, "getStatus");
            if (!transientPhase.equals(status.getString("phase"))) return status;
            SystemClock.sleep(50);
        } while (SystemClock.elapsedRealtime() < until);
        throw new AssertionError("Updater remained in " + transientPhase);
    }

    @Test public void bridgeReportsPermissionAndRefusesInstallOrDownloadWithoutVerifiedReleaseOffline() throws Exception {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            awaitBridge(scenario);
            Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
            JSONObject status = call(scenario, "getStatus");
            assertEquals("idle", status.getString("phase"));
            assertFalse(status.getString("currentVersion").isEmpty());
            boolean expectedPermission = Build.VERSION.SDK_INT >= 26 && !context.getPackageManager().canRequestPackageInstalls();
            assertEquals(expectedPermission, status.getBoolean("permissionRequired"));
            status = call(scenario, "install");
            assertEquals("error", status.getString("phase"));
            assertTrue(status.getString("error").contains("verified"));
            status = call(scenario, "download");
            assertEquals("error", status.getString("phase"));
            scenario.onActivity(activity -> assertTrue(activity.getBridge().getWebView().getSettings().getBlockNetworkLoads()));
            // CI uses a debug key: checking must fail locally before any network access.
            if ((context.getApplicationInfo().flags & android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0) {
                call(scenario, "check");
                status = awaitPhase(scenario, "checking");
                assertEquals("error", status.getString("phase"));
                assertTrue(status.getString("error").contains("signer"));
            }
        }
    }

    @Test public void installRehashesAReadyFileAndRefusesTamperingBeforeAnyInstallerLaunch() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        File directory = new File(context.getCacheDir(), "app-updates");
        assertTrue(directory.isDirectory() || directory.mkdirs());
        File apk = File.createTempFile("tamper-test-", ".apk", directory);
        // This simulates a file changed AFTER a download was marked verified. The public install
        // method must hash it again; neither signature checks nor permission may bypass that hash.
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            awaitBridge(scenario);
            JSONObject metadata = new JSONObject().put("tag_name", "v99.0.0").put("draft", false).put("prerelease", false)
                .put("assets", new JSONArray().put(new JSONObject().put("name", "PentaMark-99.0.0-Android.apk")
                    .put("state", "uploaded").put("size", 3)
                    .put("digest", "sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")
                    .put("browser_download_url", "https://github.com/ItsDeimox/PentaMark/releases/download/v99.0.0/PentaMark-99.0.0-Android.apk")));
            AppUpdatePolicy.Release release = AppUpdatePolicy.selectRelease(metadata, "2.13.19");
            try (FileOutputStream output = new FileOutputStream(apk)) { output.write(new byte[]{120, 121, 122}); }
            scenario.onActivity(activity -> {
                try {
                    AppUpdatePlugin plugin = (AppUpdatePlugin)activity.getBridge().getPlugin("AppUpdate").getInstance();
                    for (Object[] entry : new Object[][]{{"release", release}, {"verifiedFile", apk}, {"phase", "ready"}}) {
                        Field field = AppUpdatePlugin.class.getDeclaredField((String)entry[0]);
                        field.setAccessible(true); field.set(plugin, entry[1]);
                    }
                } catch (Exception failure) { throw new AssertionError(failure); }
            });
            assertEquals("installing", call(scenario, "install").getString("phase"));
            JSONObject status = awaitPhase(scenario, "installing");
            assertEquals("error", status.getString("phase"));
            assertTrue(status.getString("error").contains("checksum"));
            assertFalse("Tampered cache file must be discarded", apk.exists());
            scenario.onActivity(activity -> assertFalse(activity.isFinishing()));
        } finally { apk.delete(); }
    }

    @Test public void installerIntentUsesOnlyUpdaterCacheContentUriAndTemporaryReadGrant() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        File directory = new File(context.getCacheDir(), "app-updates");
        assertTrue(directory.isDirectory() || directory.mkdirs());
        File apk = File.createTempFile("handoff-test-", ".apk", directory);
        File outside = File.createTempFile("outside-update-", ".apk", context.getCacheDir());
        try {
            try (FileOutputStream output = new FileOutputStream(apk)) { output.write(new byte[]{1, 2, 3}); }
            Intent intent = AppUpdatePlugin.installerIntent(context, apk);
            assertEquals(Intent.ACTION_VIEW, intent.getAction());
            assertEquals("application/vnd.android.package-archive", intent.getType());
            assertEquals("content", intent.getData().getScheme());
            assertEquals(context.getPackageName() + ".fileprovider", intent.getData().getAuthority());
            assertTrue((intent.getFlags() & Intent.FLAG_GRANT_READ_URI_PERMISSION) != 0);
            assertEquals(0, intent.getFlags() & Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
            assertEquals(intent.getData(), intent.getClipData().getItemAt(0).getUri());
            try (java.io.InputStream input = context.getContentResolver().openInputStream(intent.getData())) { assertEquals(1, input.read()); }
            try { AppUpdatePlugin.installerIntent(context, outside); fail("Non-updater file was shared"); }
            catch (java.io.IOException expected) { }
        } finally { assertTrue(apk.delete()); assertTrue(outside.delete()); }
    }

    @Test public void settingsIntentTargetsOnlyThisAppsUnknownSourcePermission() {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        Intent intent = AppUpdatePlugin.permissionSettingsIntent(context);
        assertEquals(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, intent.getAction());
        assertEquals(Uri.parse("package:com.pentagory.pentamark"), intent.getData());
    }
}
