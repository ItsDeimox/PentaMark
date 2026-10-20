package com.pentagory.pentamark;

import static org.junit.Assert.*;

import android.os.SystemClock;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.json.JSONObject;
import org.json.JSONTokener;
import org.junit.After;
import org.junit.Test;
import org.junit.runner.RunWith;

/** Exercises the actual Capacitor promise transport in the packaged, offline WebView. */
@RunWith(AndroidJUnit4.class)
public class OfflineWebViewTest {
    private ActivityScenario<MainActivity> scenario;

    @After public void closeActivity() {
        if (scenario != null) {
            // Capture the app before ActivityScenario closes it, including on test failure.
            try {
                android.app.Instrumentation instrumentation = androidx.test.platform.app.InstrumentationRegistry.getInstrumentation();
                android.graphics.Bitmap screenshot = instrumentation.getUiAutomation().takeScreenshot();
                if (screenshot != null) {
                    try (java.io.FileOutputStream output = new java.io.FileOutputStream(
                            new java.io.File(instrumentation.getTargetContext().getFilesDir(), "instrumentation.png"))) {
                        screenshot.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, output);
                    } finally { screenshot.recycle(); }
                }
            } catch (Exception error) {
                android.util.Log.w("OfflineWebViewTest", "Screenshot unavailable", error);
            }
            scenario.close();
        }
    }

    private void launchOffline() throws Exception {
        scenario = ActivityScenario.launch(MainActivity.class);
        scenario.onActivity(activity -> {
            // Local WebViewAssetServer interception still works; HTTP network loads do not.
            activity.getBridge().getWebView().getSettings().setBlockNetworkLoads(true);
            activity.getBridge().getWebView().reload();
        });
        awaitTrue("typeof window.Capacitor?.nativePromise === 'function'");
        awaitTrue("!!document.querySelector('.cm-editor') && document.body.innerText.includes('PentaMark')");
    }

    private Object evaluate(String expression) throws Exception {
        CountDownLatch done = new CountDownLatch(1);
        AtomicReference<String> result = new AtomicReference<>();
        scenario.onActivity(activity -> activity.getBridge().getWebView().evaluateJavascript(
            expression, value -> { result.set(value); done.countDown(); }));
        assertTrue("WebView callback timed out: " + expression, done.await(10, TimeUnit.SECONDS));
        return new JSONTokener(result.get() == null ? "null" : result.get()).nextValue();
    }

    private void awaitTrue(String expression) throws Exception {
        long deadline = SystemClock.elapsedRealtime() + 30000;
        while (SystemClock.elapsedRealtime() < deadline) {
            if (Boolean.TRUE.equals(evaluate(expression))) return;
            SystemClock.sleep(100);
        }
        fail("Timed out: " + expression + "\nPage: " + evaluate("document.body.innerText.slice(0,3000)"));
    }

    private JSONObject promise(String expression) throws Exception {
        evaluate("window.__instrumentationResult=null; Promise.resolve(" + expression + ")"
            + ".then(value=>window.__instrumentationResult={value})"
            + ".catch(error=>window.__instrumentationResult={error:String(error)}); true");
        awaitTrue("window.__instrumentationResult !== null");
        JSONObject result = new JSONObject((String)evaluate("JSON.stringify(window.__instrumentationResult)"));
        assertFalse("Rejected native promise: " + result, result.has("error"));
        return result.getJSONObject("value");
    }

    private JSONObject request(String url, String method, JSONObject body) throws Exception {
        JSONObject options = new JSONObject().put("url", url).put("method", method);
        if (body != null) options.put("body", body.toString());
        return promise("Capacitor.nativePromise('LocalVault','request'," + options + ")");
    }

    @Test public void unicodeNoteAndLocalMediaSurviveActivityRelaunchOffline() throws Exception {
        launchOffline();
        String path = "Instrumentação-" + System.currentTimeMillis() + "-日本語.md";
        String content = "# Persistência offline\n\nOlá, ação, 日本語 e 🚀.\n";
        JSONObject created = request("/api/note", "POST",
            new JSONObject().put("path", path).put("content", "# Inicial"));
        assertEquals(created.toString(), 201, created.getInt("status"));
        String query = "/api/note?path=" + java.net.URLEncoder.encode(path, "UTF-8");
        JSONObject saved = request(query, "PUT", new JSONObject().put("content", content)
            .put("baseRevision", created.getJSONObject("data").getString("revision")));
        assertEquals(saved.toString(), 200, saved.getInt("status"));

        String svg = "<svg xmlns='http://www.w3.org/2000/svg' width='12' height='12'><rect width='12' height='12' fill='cyan'/></svg>";
        JSONObject uploadOptions = new JSONObject().put("url", "/api/upload?name=offline-" + System.currentTimeMillis() + ".svg")
            .put("method", "POST").put("base64", Base64.getEncoder().encodeToString(svg.getBytes(StandardCharsets.UTF_8)));
        JSONObject upload = promise("Capacitor.nativePromise('LocalVault','request'," + uploadOptions + ")");
        assertEquals(upload.toString(), 201, upload.getInt("status"));
        String assetPath = "assets/" + upload.getJSONObject("data").getString("name");

        // Explicitly destroy and launch a new Activity/bridge, without clearing app data.
        scenario.close();
        scenario = null;
        launchOffline();
        JSONObject loaded = request(query, "GET", null);
        assertEquals(200, loaded.getInt("status"));
        assertEquals(content, loaded.getJSONObject("data").getString("content"));
        String paths = request("/api/state", "GET", null).getJSONObject("data").getJSONArray("assetPaths").toString();
        assertTrue(paths, paths.contains(path));
        assertTrue(paths, paths.contains(assetPath));

        String noteSelector = "Array.from(document.querySelectorAll('.pm-note-item')).find(e=>e.title.startsWith("
            + JSONObject.quote(path + " —") + "))";
        awaitTrue("!!(" + noteSelector + ")");
        evaluate("(" + noteSelector + ").click(); true");
        awaitTrue("Array.from(document.querySelectorAll('.cm-editor')).some(e=>e.getBoundingClientRect().height>0"
            + " && e.textContent.includes('Olá, ação, 日本語 e 🚀.'))");

        JSONObject info = promise("Capacitor.nativePromise('LocalVault','info',{})");
        String file = "file://" + info.getString("root") + "/" + assetPath;
        JSONObject media = promise("new Promise((resolve,reject)=>{const img=new Image();"
            + "img.onload=()=>resolve({width:img.naturalWidth,url:img.src});img.onerror=()=>reject('local image failed');"
            + "img.src=Capacitor.convertFileSrc(" + JSONObject.quote(file) + ");document.body.appendChild(img)})");
        assertEquals(12, media.getInt("width"));
        assertTrue(media.getString("url"), media.getString("url").startsWith("https://localhost/"));
        scenario.onActivity(activity -> assertTrue(activity.getBridge().getWebView().getSettings().getBlockNetworkLoads()));
    }

    @Test public void backCanBeConsumedByUiAndPauseReachesDocument() throws Exception {
        launchOffline();
        evaluate("window.__backSeen=false; window.__pauseSeen=false;"
            + "document.addEventListener('pentamark:back',e=>{window.__backSeen=true;e.preventDefault()});"
            + "document.addEventListener('pentamark:pause',()=>window.__pauseSeen=true);true");
        scenario.onActivity(activity -> activity.getOnBackPressedDispatcher().onBackPressed());
        awaitTrue("window.__backSeen === true");
        scenario.onActivity(activity -> assertFalse(activity.isFinishing()));
        scenario.moveToState(androidx.lifecycle.Lifecycle.State.STARTED);
        scenario.moveToState(androidx.lifecycle.Lifecycle.State.RESUMED);
        awaitTrue("window.__pauseSeen === true");
    }
}
