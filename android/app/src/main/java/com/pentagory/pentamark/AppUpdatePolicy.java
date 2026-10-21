package com.pentagory.pentamark;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.URI;
import java.net.URISyntaxException;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Locale;
import java.util.function.IntConsumer;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/** Fail-closed update policy. No Android dependencies, renderer input, or credentials. */
public final class AppUpdatePolicy {
    static final String PACKAGE_NAME = "com.pentagory.pentamark";
    static final String RELEASE_URL = "https://api.github.com/repos/ItsDeimox/PentaMark/releases/latest";
    static final String RELEASE_SIGNER = "9b84d7427864bbbf18207b1e68675b73143c345a427d070b212b50a4a1b1ac68";
    static final long MAX_APK_BYTES = 256L * 1024 * 1024;
    static final int MAX_METADATA_BYTES = 1024 * 1024;

    private AppUpdatePolicy() { }

    static final class Release {
        final String version;
        final String url;
        final String sha256;
        final long size;

        private Release(String version, String url, String sha256, long size) {
            this.version = version; this.url = url; this.sha256 = sha256; this.size = size;
        }
    }

    private static int[] versionParts(String version) {
        if (version == null || version.length() > 32
                || !version.matches("(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)")) {
            throw new IllegalArgumentException("A stable major.minor.patch version is required");
        }
        String[] parts = version.split("\\.");
        try { return new int[]{Integer.parseInt(parts[0]), Integer.parseInt(parts[1]), Integer.parseInt(parts[2])}; }
        catch (NumberFormatException error) { throw new IllegalArgumentException("Version component is too large", error); }
    }

    static int compareVersions(String candidate, String installed) {
        int[] next = versionParts(candidate), previous = versionParts(installed);
        for (int i = 0; i < 3; i++) {
            int result = Integer.compare(next[i], previous[i]);
            if (result != 0) return result;
        }
        return 0;
    }

    /** null means current. APK versionCode is independently checked after download. */
    static Release selectRelease(JSONObject json, String installedVersion) {
        try {
            if (!Boolean.FALSE.equals(json.get("draft")) || !Boolean.FALSE.equals(json.get("prerelease"))) {
                throw new IllegalArgumentException("Only published stable releases are supported");
            }
            String tag = json.getString("tag_name");
            String version = tag.startsWith("v") ? tag.substring(1) : tag;
            if (compareVersions(version, installedVersion) <= 0) return null;
            String filename = "PentaMark-" + version + "-Android.apk";
            JSONArray assets = json.getJSONArray("assets");
            JSONObject selected = null;
            for (int i = 0; i < assets.length(); i++) {
                JSONObject asset = assets.getJSONObject(i);
                if (filename.equals(asset.optString("name"))) {
                    if (selected != null) throw new IllegalArgumentException("Duplicate Android release asset");
                    selected = asset;
                }
            }
            if (selected == null) throw new IllegalArgumentException("The exact Android release APK is missing");
            if (!"uploaded".equals(selected.getString("state"))) throw new IllegalArgumentException("APK upload is incomplete");
            Object rawSize = selected.get("size");
            if (!(rawSize instanceof Integer) && !(rawSize instanceof Long)) throw new IllegalArgumentException("Invalid APK size");
            long size = ((Number)rawSize).longValue();
            if (size <= 0 || size > MAX_APK_BYTES) throw new IllegalArgumentException("APK size exceeds the update limit");
            String digest = selected.getString("digest");
            if (!digest.matches("sha256:[0-9a-fA-F]{64}")) throw new IllegalArgumentException("GitHub SHA256 release digest is required");
            String url = selected.getString("browser_download_url");
            validateAssetUrl(url);
            String expected = "https://github.com/ItsDeimox/PentaMark/releases/download/" + tag + "/" + filename;
            if (!expected.equals(url)) throw new IllegalArgumentException("APK URL does not match the fixed repository and release");
            return new Release(version, url, digest.substring(7).toLowerCase(Locale.ROOT), size);
        } catch (JSONException error) { throw new IllegalArgumentException("Incomplete GitHub release metadata", error); }
    }

    /** Exact hosts only; validate again before opening each redirect destination. */
    static URI validateAssetUrl(String value) {
        try {
            if (value == null || value.length() > 16384) throw new IllegalArgumentException("Invalid asset URL");
            URI uri = new URI(value);
            String host = uri.getHost();
            if (!"https".equalsIgnoreCase(uri.getScheme()) || host == null
                    || uri.getRawUserInfo() != null || uri.getRawFragment() != null
                    || (uri.getPort() != -1 && uri.getPort() != 443)) {
                throw new IllegalArgumentException("Updates require a trusted HTTPS URL");
            }
            host = host.toLowerCase(Locale.ROOT);
            if (!host.equals("github.com") && !host.equals("objects.githubusercontent.com")
                    && !host.equals("release-assets.githubusercontent.com") && !host.equals("github-releases.githubusercontent.com")) {
                throw new IllegalArgumentException("Untrusted update asset host");
            }
            return uri;
        } catch (URISyntaxException error) { throw new IllegalArgumentException("Malformed asset URL", error); }
    }

    static void validateInstalledSigners(String[] signers) {
        if (signers == null || signers.length != 1 || !RELEASE_SIGNER.equals(signers[0])) {
            throw new IllegalArgumentException("Installed app is not signed by the pinned release signer; debug builds cannot install release updates");
        }
    }

    /** Exact current signer equality is deliberately conservative about certificate rotation. */
    static void validateArchive(String packageName, long installedCode, long archiveCode,
            String archiveVersion, String releaseVersion, String[] installedSigners, String[] archiveSigners) {
        if (!PACKAGE_NAME.equals(packageName)) throw new IllegalArgumentException("APK package name does not match PentaMark");
        if (installedCode < 0 || archiveCode <= installedCode) throw new IllegalArgumentException("APK versionCode must be strictly newer");
        versionParts(releaseVersion);
        if (!releaseVersion.equals(archiveVersion)) throw new IllegalArgumentException("APK versionName does not match the release");
        validateInstalledSigners(installedSigners);
        if (archiveSigners == null || archiveSigners.length != 1 || !RELEASE_SIGNER.equals(archiveSigners[0])) {
            throw new IllegalArgumentException("APK signer is incompatible with the installed app or pinned release signer");
        }
    }

    static MessageDigest sha256() {
        try { return MessageDigest.getInstance("SHA-256"); }
        catch (NoSuchAlgorithmException impossible) { throw new IllegalStateException("SHA256 unavailable", impossible); }
    }

    static String hex(byte[] bytes) {
        StringBuilder result = new StringBuilder(bytes.length * 2);
        for (byte value : bytes) {
            result.append(Character.forDigit((value >>> 4) & 15, 16));
            result.append(Character.forDigit(value & 15, 16));
        }
        return result.toString();
    }

    static void checkDeadline(long deadlineNanos) throws IOException {
        if (Thread.currentThread().isInterrupted() || System.nanoTime() >= deadlineNanos) throw new IOException("Update operation timed out or was cancelled");
    }

    /** Streams with a hard byte cap, exact final size and digest; 100 is emitted only after verification. */
    static void copyVerified(InputStream input, OutputStream output, long expectedSize,
            String expectedHash, long deadlineNanos, IntConsumer progress) throws IOException {
        if (expectedSize <= 0 || expectedSize > MAX_APK_BYTES || expectedHash == null
                || !expectedHash.matches("[0-9a-f]{64}")) throw new IOException("Invalid download verification metadata");
        MessageDigest digest = sha256();
        byte[] buffer = new byte[64 * 1024];
        long count = 0;
        int previousProgress = -1;
        while (true) {
            checkDeadline(deadlineNanos);
            int read = input.read(buffer);
            checkDeadline(deadlineNanos);
            if (read == -1) break;
            count += read;
            if (count > expectedSize) throw new IOException("APK exceeds its declared size");
            digest.update(buffer, 0, read);
            if (output != null) output.write(buffer, 0, read);
            int percent = (int)Math.min(99, count * 100 / expectedSize);
            if (percent != previousProgress) { progress.accept(percent); previousProgress = percent; }
        }
        if (count != expectedSize) throw new IOException("APK download is truncated");
        if (!hex(digest.digest()).equals(expectedHash)) throw new IOException("APK SHA256 checksum mismatch");
        progress.accept(100);
    }
}
