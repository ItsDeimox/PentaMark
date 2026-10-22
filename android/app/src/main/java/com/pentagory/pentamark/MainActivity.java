package com.pentagory.pentamark;

import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import java.io.ByteArrayInputStream;
import java.util.Collections;
import androidx.activity.OnBackPressedCallback;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(LocalVaultPlugin.class);
        registerPlugin(RemoteVaultPlugin.class);
        registerPlugin(SyncVaultPlugin.class);
        registerPlugin(AppUpdatePlugin.class);
        registerPlugin(VaultInvitationPlugin.class);
        super.onCreate(savedInstanceState);
        if (bridge == null) return;
        // Native transport is the only network path; bundled assets still use Capacitor interception.
        bridge.getWebView().getSettings().setBlockNetworkLoads(true);
        // Keep Capacitor's local server and built-in SystemBars/IME inset handling.
        bridge.setWebViewClient(new BridgeWebViewClient(bridge) {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri url = request.getUrl();
                Uri local = Uri.parse(bridge.getLocalUrl());
                if (!local.getScheme().equals(url.getScheme()) || !local.getAuthority().equals(url.getAuthority())) {
                    return denied();
                }
                if (url.getPath() != null && (url.getPath().startsWith("/_pm_remote") || url.getPath().startsWith("/_pm_sync"))) {
                    try {
                        String destination = null;
                        String range = null;
                        for (java.util.Map.Entry<String,String> header : request.getRequestHeaders().entrySet()) {
                            if (header.getKey().equalsIgnoreCase("Sec-Fetch-Dest")) destination = header.getValue();
                            if (header.getKey().equalsIgnoreCase("Range")) range = header.getValue();
                        }
                        boolean replica = url.getPath().startsWith("/_pm_sync");
                        String path = RemoteConnection.mediaPath(bridge.getLocalUrl(), url.toString(), request.getMethod(), request.isForMainFrame(), destination,
                            replica ? "/_pm_sync/file" : "/_pm_remote/file");
                        RemoteConnection.Media media = replica
                            ? ((SyncVaultPlugin)bridge.getPlugin("SyncVault").getInstance()).openMedia(path, range)
                            : ((RemoteVaultPlugin)bridge.getPlugin("RemoteVault").getInstance()).openMedia(path, range);
                        return new WebResourceResponse(media.mime, null, media.status,
                            media.status == 206 ? "Partial Content" : "OK", media.headers, media.stream);
                    } catch (Exception ignored) { return denied(); }
                }
                return super.shouldInterceptRequest(view, request);
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return handleNavigation(request.getUrl(), request.isForMainFrame());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                return handleNavigation(Uri.parse(url), true);
            }
        });
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                // A UI handler must synchronously preventDefault() when it closes a panel.
                // No extra JavaScript interface or exit plugin is needed.
                bridge.getWebView().evaluateJavascript(
                    "document.dispatchEvent(new CustomEvent('pentamark:back',{cancelable:true}))",
                    unhandled -> {
                        if ("true".equals(unhandled) && !isFinishing() && !isDestroyed()) {
                            moveTaskToBack(true);
                        }
                    }
                );
            }
        });
    }

    private boolean handleNavigation(Uri url, boolean mainFrame) {
        Uri local = Uri.parse(bridge.getLocalUrl());
        if (local.getScheme().equals(url.getScheme()) && local.getAuthority().equals(url.getAuthority())) {
            // Attachments may be embedded as media, but must not become privileged documents.
            String path = url.getPath();
            if (path != null && (path.startsWith("/_capacitor_file_") || path.startsWith("/_capacitor_content_")
                    || path.startsWith("/_pm_remote") || path.startsWith("/_pm_sync"))) {
                return true;
            }
            return false;
        }
        String scheme = url.getScheme();
        // External documents never load inside the privileged WebView. Reject file,
        // content, intent, javascript and other arbitrary application schemes.
        if (mainFrame && ("https".equalsIgnoreCase(scheme) || "http".equalsIgnoreCase(scheme)
                || "mailto".equalsIgnoreCase(scheme) || "tel".equalsIgnoreCase(scheme))) {
            try {
                Intent intent = new Intent(Intent.ACTION_VIEW, url);
                intent.addCategory(Intent.CATEGORY_BROWSABLE);
                startActivity(intent);
            } catch (ActivityNotFoundException | SecurityException ignored) {
                // Missing external handlers must not crash the editor or expose the bridge.
            }
        }
        return true;
    }

    private static WebResourceResponse denied() {
        return new WebResourceResponse("text/plain", "UTF-8", 403, "Forbidden",
            Collections.singletonMap("Cache-Control", "no-store"), new ByteArrayInputStream(new byte[0]));
    }

    @Override
    public void onPause() {
        if (bridge != null) {
            bridge.getWebView().evaluateJavascript(
                "document.dispatchEvent(new CustomEvent('pentamark:pause'))", null);
        }
        super.onPause();
    }
}
