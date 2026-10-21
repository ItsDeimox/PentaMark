package com.pentagory.pentamark;

import android.content.ClipData;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URI;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import org.json.JSONObject;

/**
 * Poll-only native updater. PluginCall options are ignored by every method.
 * check/download/install resolve immediately with the accepted status; getStatus observes completion.
 * check: checking -> available/current/error. download: downloading -> ready/error (progress 0..100).
 * install: installing (includes re-verification) -> ready if permission is needed, error on failure,
 * or installing while Android shows its confirmation screen. Returning from that screen yields ready.
 * permissionRequired is live on every status. openPermissionSettings resolves after launching Settings;
 * returning never auto-installs. Process recreation forgets verification and requires a fresh download.
 */
@CapacitorPlugin(name = "AppUpdate")
public final class AppUpdatePlugin extends Plugin {
    private static final long CHECK_TIMEOUT_NANOS = TimeUnit.SECONDS.toNanos(45);
    private static final long DOWNLOAD_TIMEOUT_NANOS = TimeUnit.MINUTES.toNanos(10);
    private static final int MAX_REDIRECTS = 5;
    private final Object lock = new Object();
    // One queue slot covers the instant between clearing busy and the previous worker returning.
    // The lock/busy gate prevents callers from enqueuing additional work.
    private final ThreadPoolExecutor worker = new ThreadPoolExecutor(1, 1, 0, TimeUnit.SECONDS, new ArrayBlockingQueue<>(1));
    private volatile HttpURLConnection activeConnection;
    private String phase = "idle";
    private String currentVersion = "unknown";
    private String error;
    private Integer progress;
    private AppUpdatePolicy.Release release;
    private File verifiedFile;
    private boolean busy;
    private boolean handedOff;
    private boolean destroyed;

    @Override public void load() {
        try { currentVersion = installedPackage().versionName; }
        catch (Exception failure) { synchronized (lock) { failLocked(failure); } }
    }

    private static int signingFlags() {
        return Build.VERSION.SDK_INT >= 28 ? PackageManager.GET_SIGNING_CERTIFICATES : PackageManager.GET_SIGNATURES;
    }

    private PackageInfo installedPackage() throws PackageManager.NameNotFoundException {
        if (!AppUpdatePolicy.PACKAGE_NAME.equals(getContext().getPackageName())) throw new IllegalStateException("Unexpected installed package");
        return getContext().getPackageManager().getPackageInfo(AppUpdatePolicy.PACKAGE_NAME, signingFlags());
    }

    private static long versionCode(PackageInfo info) {
        return Build.VERSION.SDK_INT >= 28 ? info.getLongVersionCode() : info.versionCode;
    }

    private static String[] signerDigests(PackageInfo info) {
        Signature[] signatures;
        if (Build.VERSION.SDK_INT >= 28) {
            // Use current APK signers, not history: a historical pin must not authorize a new key.
            signatures = info.signingInfo == null ? null : info.signingInfo.getApkContentsSigners();
        } else { signatures = info.signatures; }
        if (signatures == null) return new String[0];
        String[] result = new String[signatures.length];
        for (int i = 0; i < signatures.length; i++) {
            result[i] = AppUpdatePolicy.hex(AppUpdatePolicy.sha256().digest(signatures[i].toByteArray()));
        }
        return result;
    }

    private boolean permissionRequired() {
        if (Build.VERSION.SDK_INT < 26) return false;
        try { return !getContext().getPackageManager().canRequestPackageInstalls(); }
        catch (RuntimeException failure) { return true; }
    }

    private JSObject statusLocked() {
        JSObject result = new JSObject().put("phase", phase).put("currentVersion", currentVersion == null ? "unknown" : currentVersion)
            .put("permissionRequired", permissionRequired());
        if (release != null) result.put("version", release.version);
        if (progress != null) result.put("progress", progress);
        if (error != null) result.put("error", error);
        return result;
    }

    @PluginMethod public void getStatus(PluginCall call) {
        synchronized (lock) { call.resolve(statusLocked()); }
    }

    private interface Operation { void run() throws Exception; }

    /** Accept at most one operation; repeated clicks/polls cannot queue downloads or installers. */
    private void startLocked(PluginCall call, String nextPhase, Operation operation) {
        if (busy || handedOff || destroyed) { call.resolve(statusLocked()); return; }
        phase = nextPhase; error = null; busy = true;
        try {
            worker.execute(() -> {
                try { operation.run(); }
                catch (Exception failure) {
                    synchronized (lock) {
                        if (!destroyed) { discardVerifiedLocked(); failLocked(failure); }
                    }
                } finally {
                    synchronized (lock) { busy = false; }
                }
            });
        } catch (RejectedExecutionException failure) { busy = false; failLocked(new IOException("Updater is unavailable; try again")); }
        call.resolve(statusLocked());
    }

    @PluginMethod public void check(PluginCall call) {
        synchronized (lock) {
            if (busy || handedOff || destroyed) { call.resolve(statusLocked()); return; }
            discardVerifiedLocked(); release = null; progress = null;
            startLocked(call, "checking", () -> {
                PackageInfo installed = installedPackage();
                AppUpdatePolicy.validateInstalledSigners(signerDigests(installed));
                long deadline = System.nanoTime() + CHECK_TIMEOUT_NANOS;
                HttpURLConnection connection = openConnection(AppUpdatePolicy.RELEASE_URL, true, deadline);
                try {
                    activeConnection = connection;
                    AppUpdatePolicy.checkDeadline(deadline);
                    long declared = contentLength(connection);
                    if (declared > AppUpdatePolicy.MAX_METADATA_BYTES) throw new IOException("Release metadata is too large");
                    String type = connection.getContentType();
                    if (type == null || !type.split(";", 2)[0].trim().equalsIgnoreCase("application/json")) {
                        throw new IOException("GitHub did not return JSON release metadata");
                    }
                    ByteArrayOutputStream bytes = new ByteArrayOutputStream();
                    try (InputStream input = connection.getInputStream()) {
                        byte[] buffer = new byte[8192];
                        while (true) {
                            AppUpdatePolicy.checkDeadline(deadline);
                            int count = input.read(buffer);
                            AppUpdatePolicy.checkDeadline(deadline);
                            if (count == -1) break;
                            if (bytes.size() + count > AppUpdatePolicy.MAX_METADATA_BYTES) throw new IOException("Release metadata is too large");
                            bytes.write(buffer, 0, count);
                        }
                    }
                    if (declared >= 0 && declared != bytes.size()) throw new IOException("Release metadata is truncated");
                    AppUpdatePolicy.Release selected = AppUpdatePolicy.selectRelease(
                        new JSONObject(new String(bytes.toByteArray(), StandardCharsets.UTF_8)), installed.versionName);
                    synchronized (lock) {
                        if (!destroyed) { currentVersion = installed.versionName; release = selected; phase = selected == null ? "current" : "available"; }
                    }
                } finally { connection.disconnect(); activeConnection = null; }
            });
        }
    }

    @PluginMethod public void download(PluginCall call) {
        synchronized (lock) {
            if (busy || handedOff || destroyed) { call.resolve(statusLocked()); return; }
            if (release == null) { failLocked(new IOException("Check for an available release before downloading")); call.resolve(statusLocked()); return; }
            AppUpdatePolicy.Release selected = release;
            discardVerifiedLocked(); progress = 0;
            startLocked(call, "downloading", () -> downloadRelease(selected));
        }
    }

    private void downloadRelease(AppUpdatePolicy.Release selected) throws Exception {
        AppUpdatePolicy.validateInstalledSigners(signerDigests(installedPackage()));
        long deadline = System.nanoTime() + DOWNLOAD_TIMEOUT_NANOS;
        File directory = new File(getContext().getCacheDir(), "app-updates");
        if (!directory.isDirectory() && !directory.mkdirs()) throw new IOException("Cannot create private update cache");
        File temporary = File.createTempFile("update-", ".part", directory);
        File complete = new File(directory, temporary.getName().replace(".part", ".apk"));
        boolean retained = false;
        try {
            HttpURLConnection connection = openConnection(selected.url, false, deadline);
            try {
                activeConnection = connection;
                AppUpdatePolicy.checkDeadline(deadline);
                long declared = contentLength(connection);
                if (declared >= 0 && declared != selected.size) throw new IOException("APK Content-Length does not match the release size");
                try (InputStream input = connection.getInputStream(); FileOutputStream output = new FileOutputStream(temporary)) {
                    AppUpdatePolicy.copyVerified(input, output, selected.size, selected.sha256, deadline, percent -> {
                        synchronized (lock) { if (!destroyed) progress = Math.min(99, percent); }
                    });
                    output.getFD().sync();
                }
            } finally { connection.disconnect(); activeConnection = null; }
            AppUpdatePolicy.checkDeadline(deadline);
            if (!temporary.renameTo(complete)) throw new IOException("Cannot finalize verified update");
            if (!complete.setReadOnly()) throw new IOException("Cannot protect verified update cache");
            // Some Android parsers require an .apk suffix. This private file is still untrusted
            // until PM validates it; it is never published as ready before all checks succeed.
            verifyArchive(complete, selected);
            AppUpdatePolicy.checkDeadline(deadline);
            synchronized (lock) {
                if (destroyed) throw new IOException("Updater was closed");
                verifiedFile = complete; retained = true; progress = 100; phase = "ready";
            }
        } finally {
            temporary.delete();
            if (!retained) complete.delete();
        }
    }

    private void verifyArchive(File file, AppUpdatePolicy.Release selected) throws Exception {
        PackageInfo installed = installedPackage();
        if (AppUpdatePolicy.compareVersions(selected.version, installed.versionName) <= 0) throw new IOException("Installed version is already current");
        PackageInfo archive = getContext().getPackageManager().getPackageArchiveInfo(file.getAbsolutePath(), signingFlags());
        if (archive == null) throw new IOException("Downloaded file is not a signed Android APK");
        AppUpdatePolicy.validateArchive(archive.packageName, versionCode(installed), versionCode(archive),
            archive.versionName, selected.version, signerDigests(installed), signerDigests(archive));
    }

    @PluginMethod public void install(PluginCall call) {
        synchronized (lock) {
            if (busy || handedOff || destroyed) { call.resolve(statusLocked()); return; }
            if (verifiedFile == null || release == null) {
                failLocked(new IOException("Download a verified APK before installing")); call.resolve(statusLocked()); return;
            }
            File apk = verifiedFile;
            AppUpdatePolicy.Release selected = release;
            startLocked(call, "installing", () -> {
                // Rehash the complete file and reread package/version/certificates on EVERY attempt,
                // including after returning from unknown-source settings.
                long deadline = System.nanoTime() + DOWNLOAD_TIMEOUT_NANOS;
                requireUpdaterFile(getContext(), apk);
                try (InputStream input = new FileInputStream(apk)) {
                    AppUpdatePolicy.copyVerified(input, null, selected.size, selected.sha256, deadline, ignored -> { });
                }
                verifyArchive(apk, selected);
                Intent intent = installerIntent(getContext(), apk);
                if (permissionRequired()) {
                    synchronized (lock) { if (!destroyed) phase = "ready"; }
                    return;
                }
                // The Android installer presents its own explicit user confirmation. No silent API.
                CountDownLatch dispatched = new CountDownLatch(1);
                getActivity().runOnUiThread(() -> {
                    try {
                        synchronized (lock) {
                            if (destroyed || verifiedFile != apk) return;
                            if (permissionRequired()) { phase = "ready"; return; }
                            try {
                                getActivity().startActivity(intent);
                                handedOff = true; phase = "installing";
                            } catch (RuntimeException failure) { failLocked(new IOException("Android package installer is unavailable", failure)); }
                        }
                    } finally { dispatched.countDown(); }
                });
                // Keep the operation busy until the UI dispatch finishes, avoiding stale queued intents.
                if (!dispatched.await(10, TimeUnit.SECONDS)) throw new IOException("Android installer handoff timed out");
            });
        }
    }

    static Intent permissionSettingsIntent(Context context) {
        return new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + context.getPackageName()));
    }

    @PluginMethod public void openPermissionSettings(PluginCall call) {
        if (Build.VERSION.SDK_INT < 26) { getStatus(call); return; }
        getActivity().runOnUiThread(() -> {
            synchronized (lock) {
                try { if (!destroyed) getActivity().startActivity(permissionSettingsIntent(getContext())); }
                catch (RuntimeException failure) { failLocked(new IOException("Unknown-source permission settings are unavailable", failure)); }
                call.resolve(statusLocked());
            }
        });
    }

    private static void requireUpdaterFile(Context context, File apk) throws IOException {
        File directory = new File(context.getCacheDir(), "app-updates").getCanonicalFile();
        if (!apk.isFile() || !directory.equals(apk.getCanonicalFile().getParentFile())) throw new IOException("Verified update file is missing or outside private update cache");
    }

    static Intent installerIntent(Context context, File apk) throws IOException {
        requireUpdaterFile(context, apk);
        Uri uri = FileProvider.getUriForFile(context, context.getPackageName() + ".fileprovider", apk);
        Intent intent = new Intent(Intent.ACTION_VIEW).setDataAndType(uri, "application/vnd.android.package-archive");
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        intent.setClipData(ClipData.newRawUri("PentaMark update", uri));
        return intent;
    }

    /** No automatic redirects, configured credentials, WebView fetches, or caller-provided URLs. */
    private static HttpURLConnection openConnection(String initial, boolean metadata, long deadline) throws IOException {
        String destination = initial;
        if (metadata && !AppUpdatePolicy.RELEASE_URL.equals(destination)) throw new IOException("Unexpected release endpoint");
        for (int redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
            AppUpdatePolicy.checkDeadline(deadline);
            if (!metadata) AppUpdatePolicy.validateAssetUrl(destination);
            HttpURLConnection connection = (HttpURLConnection)new URL(destination).openConnection();
            boolean keep = false;
            try {
                int remainingMs = (int)Math.min(Integer.MAX_VALUE, Math.max(1, TimeUnit.NANOSECONDS.toMillis(deadline - System.nanoTime())));
                connection.setConnectTimeout(Math.min(10000, remainingMs));
                connection.setReadTimeout(Math.min(15000, remainingMs));
                connection.setInstanceFollowRedirects(false);
                connection.setUseCaches(false);
                connection.setRequestProperty("User-Agent", "PentaMark-Android-Updater");
                connection.setRequestProperty("Accept", metadata ? "application/vnd.github+json" : "application/octet-stream");
                connection.setRequestProperty("Accept-Encoding", "identity");
                // Do not attach WebView/session cookies to public release requests.
                connection.setRequestProperty("Cookie", "");
                connection.setRequestProperty("Cookie2", "");
                if (metadata) connection.setRequestProperty("X-GitHub-Api-Version", "2022-11-28");
                int status = connection.getResponseCode();
                AppUpdatePolicy.checkDeadline(deadline);
                if (status == 301 || status == 302 || status == 303 || status == 307 || status == 308) {
                    if (metadata || redirects == MAX_REDIRECTS) throw new IOException("Unexpected or excessive release redirects");
                    String location = connection.getHeaderField("Location");
                    if (location == null) throw new IOException("Missing APK redirect destination");
                    URI next = AppUpdatePolicy.validateAssetUrl(destination).resolve(location);
                    destination = AppUpdatePolicy.validateAssetUrl(next.toString()).toString();
                    continue;
                }
                if (status != 200) throw new IOException("GitHub update request failed (HTTP " + status + ")");
                String encoding = connection.getContentEncoding();
                if (encoding != null && !encoding.equalsIgnoreCase("identity")) throw new IOException("Encoded update responses are unsupported");
                keep = true;
                return connection;
            } finally { if (!keep) connection.disconnect(); }
        }
        throw new IOException("Too many release redirects");
    }

    private static long contentLength(HttpURLConnection connection) throws IOException {
        String value = connection.getHeaderField("Content-Length");
        if (value == null) return -1;
        if (!value.matches("[0-9]{1,18}")) throw new IOException("Invalid update Content-Length");
        try { return Long.parseLong(value); }
        catch (NumberFormatException failure) { throw new IOException("Invalid update Content-Length", failure); }
    }

    private void discardVerifiedLocked() {
        if (verifiedFile != null) { verifiedFile.delete(); verifiedFile = null; }
    }

    private void failLocked(Exception failure) {
        phase = "error"; progress = null;
        error = failure.getMessage() == null ? "Update failed" : failure.getMessage();
        if (error.length() > 300) error = error.substring(0, 300);
    }

    @Override protected void handleOnResume() {
        synchronized (lock) {
            // Returning after cancelling the installer permits an explicit retry; never auto-install.
            if (handedOff) { handedOff = false; phase = verifiedFile == null ? "idle" : "ready"; }
        }
        super.handleOnResume();
    }

    @Override protected void handleOnDestroy() {
        synchronized (lock) { destroyed = true; }
        worker.shutdownNow();
        HttpURLConnection connection = activeConnection;
        if (connection != null) connection.disconnect();
        // Keep a handed-off APK readable while the system installer is using it. No vault operations.
        super.handleOnDestroy();
    }
}
