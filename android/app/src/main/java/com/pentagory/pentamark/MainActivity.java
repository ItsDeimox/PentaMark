package com.pentagory.pentamark;

import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import androidx.activity.OnBackPressedCallback;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(LocalVaultPlugin.class);
        super.onCreate(savedInstanceState);
        if (bridge == null) return;
        // Keep Capacitor's local server and built-in SystemBars/IME inset handling.
        bridge.setWebViewClient(new BridgeWebViewClient(bridge) {
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
            if (path != null && (path.startsWith("/_capacitor_file_") || path.startsWith("/_capacitor_content_"))) {
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

    @Override
    public void onPause() {
        if (bridge != null) {
            bridge.getWebView().evaluateJavascript(
                "document.dispatchEvent(new CustomEvent('pentamark:pause'))", null);
        }
        super.onPause();
    }
}
