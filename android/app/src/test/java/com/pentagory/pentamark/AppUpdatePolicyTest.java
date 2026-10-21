package com.pentagory.pentamark;

import static org.junit.Assert.*;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.lang.reflect.InvocationTargetException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

public class AppUpdatePolicyTest {
    private static final String PIN = "9b84d7427864bbbf18207b1e68675b73143c345a427d070b212b50a4a1b1ac68";
    private static final String ABC = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
    private static final String URL = "https://github.com/ItsDeimox/PentaMark/releases/download/v2.14.0/PentaMark-2.14.0-Android.apk";

    // Reflection permits a meaningful assertion failure before the policy exists.
    private Object invoke(String method, Class<?>[] types, Object... args) throws Exception {
        Class<?> policy;
        try { policy = Class.forName("com.pentagory.pentamark.AppUpdatePolicy"); }
        catch (ClassNotFoundException e) { throw new AssertionError("Native update validation is missing", e); }
        try { return policy.getDeclaredMethod(method, types).invoke(null, args); }
        catch (InvocationTargetException e) { throw (Exception)e.getCause(); }
    }

    private JSONObject release() throws Exception {
        return new JSONObject().put("tag_name", "v2.14.0").put("draft", false).put("prerelease", false)
            .put("assets", new JSONArray().put(new JSONObject().put("name", "PentaMark-2.14.0-Android.apk")
                .put("state", "uploaded").put("size", 3).put("digest", "sha256:" + ABC)
                .put("browser_download_url", URL)));
    }

    private Object select(JSONObject release, String installed) throws Exception {
        return invoke("selectRelease", new Class<?>[]{JSONObject.class, String.class}, release, installed);
    }

    private void invalidRelease(JSONObject value) throws Exception {
        try { select(value, "2.13.18"); fail("Unsafe release accepted: " + value); }
        catch (IllegalArgumentException expected) { }
    }

    @Test public void comparesNumericStableVersionsWithoutOverflowOrPrereleases() throws Exception {
        Class<?>[] types = {String.class, String.class};
        assertEquals(1, invoke("compareVersions", types, "2.14.0", "2.13.99"));
        assertEquals(-1, invoke("compareVersions", types, "2.9.100", "2.10.0"));
        assertEquals(0, invoke("compareVersions", types, "2.13.18", "2.13.18"));
        for (String version : new String[]{"2.14.0-beta", "2.14.0+meta", "02.14.0", "2.14", "2.14.0/../x", "2147483648.0.0", " 2.14.0"}) {
            try { invoke("compareVersions", types, version, "2.13.18"); fail("Invalid version accepted"); }
            catch (IllegalArgumentException expected) { }
        }
    }

    @Test public void selectsOnlyTheExactStableApkAndSkipsCurrentOrOlderReleases() throws Exception {
        Object found = select(release(), "2.13.18");
        assertEquals("2.14.0", found.getClass().getDeclaredField("version").get(found));
        assertEquals(URL, found.getClass().getDeclaredField("url").get(found));
        assertNull(select(release(), "2.14.0"));
        assertNull(select(release(), "3.0.0"));
        invalidRelease(release().put("draft", true));
        invalidRelease(release().put("prerelease", true));
        invalidRelease(release().put("tag_name", "v2.14.0-rc1"));
        JSONObject missingFlag = release(); missingFlag.remove("prerelease"); invalidRelease(missingFlag);
        for (String name : new String[]{"PentaMark-v2.14.0-Android.apk", "PentaMark-2.14.0-Android.apk.exe", "../PentaMark-2.14.0-Android.apk", "PentaMark-2.14.0-debug.apk"}) {
            JSONObject value = release(); value.getJSONArray("assets").getJSONObject(0).put("name", name); invalidRelease(value);
        }
        JSONObject duplicate = release(); duplicate.getJSONArray("assets").put(duplicate.getJSONArray("assets").getJSONObject(0));
        invalidRelease(duplicate);
    }

    @Test public void requiresSha256ExactRepositoryUrlUploadedStateAndBoundedIntegerSize() throws Exception {
        for (Object digest : new Object[]{JSONObject.NULL, "", ABC, "sha1:" + ABC, "sha256:abc", "sha256:" + ABC + "0"}) {
            JSONObject value = release(); value.getJSONArray("assets").getJSONObject(0).put("digest", digest); invalidRelease(value);
        }
        for (Object size : new Object[]{0, -1, 268435457L, 3.5, "3", JSONObject.NULL}) {
            JSONObject value = release(); value.getJSONArray("assets").getJSONObject(0).put("size", size); invalidRelease(value);
        }
        for (String url : new String[]{URL.replace("ItsDeimox", "attacker"), URL + "?url=evil", URL.replace("v2.14.0/", "v2.13.0/"), URL.replace("https:", "http:")}) {
            JSONObject value = release(); value.getJSONArray("assets").getJSONObject(0).put("browser_download_url", url); invalidRelease(value);
        }
        JSONObject value = release(); value.getJSONArray("assets").getJSONObject(0).put("state", "new"); invalidRelease(value);
    }

    @Test public void acceptsOnlyExactTrustedHttpsAssetHostsIncludingEveryRedirect() throws Exception {
        Class<?>[] types = {String.class};
        for (String url : new String[]{URL, "https://release-assets.githubusercontent.com/github-production-release-asset/1/a?sig=abc", "https://objects.githubusercontent.com/a", "https://github-releases.githubusercontent.com/a"}) {
            invoke("validateAssetUrl", types, url);
        }
        for (String url : new String[]{"http://github.com/a", "https://github.com.evil.test/a", "https://evilgithub.com/a", "https://api.github.com/a", "https://raw.githubusercontent.com/a", "https://user:pass@github.com/a", "https://github.com:444/a", "https://github.com/a#fragment", "file:///tmp/a.apk", "https://127.0.0.1/a", "https://github.com\\@evil.test/a", "https://github.com./a", "https://evil.test/?github.com"}) {
            try { invoke("validateAssetUrl", types, url); fail("Unsafe destination accepted: " + url); }
            catch (IllegalArgumentException expected) { }
        }
    }

    private void archive(String pkg, long code, String name, String[] installed, String[] candidate) throws Exception {
        invoke("validateArchive", new Class<?>[]{String.class, long.class, long.class, String.class, String.class, String[].class, String[].class},
            pkg, 21318L, code, name, "2.14.0", installed, candidate);
    }

    @Test public void rejectsWrongPackageDowngradeMismatchedVersionAndUnpinnedOrDebugSigners() throws Exception {
        archive("com.pentagory.pentamark", 21400, "2.14.0", new String[]{PIN}, new String[]{PIN});
        Object[][] bad = {
            {"com.other.app", 21400L, "2.14.0", new String[]{PIN}, new String[]{PIN}},
            {"com.pentagory.pentamark", 21318L, "2.14.0", new String[]{PIN}, new String[]{PIN}},
            {"com.pentagory.pentamark", 1L, "2.14.0", new String[]{PIN}, new String[]{PIN}},
            {"com.pentagory.pentamark", 21400L, "2.14.1", new String[]{PIN}, new String[]{PIN}},
            {"com.pentagory.pentamark", 21400L, "2.14.0", new String[]{ABC}, new String[]{PIN}},
            {"com.pentagory.pentamark", 21400L, "2.14.0", new String[]{PIN}, new String[]{ABC}},
            {"com.pentagory.pentamark", 21400L, "2.14.0", new String[]{PIN, ABC}, new String[]{PIN}},
            {"com.pentagory.pentamark", 21400L, "2.14.0", new String[]{PIN}, new String[]{PIN, ABC}},
            {"com.pentagory.pentamark", 21400L, "2.14.0", new String[0], new String[]{PIN}}
        };
        for (Object[] args : bad) {
            try { archive((String)args[0], (Long)args[1], (String)args[2], (String[])args[3], (String[])args[4]); fail("Unsafe archive accepted"); }
            catch (IllegalArgumentException expected) { }
        }
    }

    private void copy(byte[] bytes, long size, String hash, long deadline, ByteArrayOutputStream output, List<Integer> progress) throws Exception {
        invoke("copyVerified", new Class<?>[]{java.io.InputStream.class, java.io.OutputStream.class, long.class, String.class, long.class, java.util.function.IntConsumer.class},
            new ByteArrayInputStream(bytes), output, size, hash, deadline, (java.util.function.IntConsumer)progress::add);
    }

    @Test public void streamsAndVerifiesExactSizeDigestAndDeadlineBeforeReportingCompletion() throws Exception {
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        List<Integer> progress = new ArrayList<>();
        copy("abc".getBytes(StandardCharsets.UTF_8), 3, ABC, System.nanoTime() + 1000000000L, output, progress);
        assertEquals("abc", output.toString("UTF-8"));
        assertEquals(Integer.valueOf(100), progress.get(progress.size() - 1));
        for (Object[] bad : new Object[][]{{"ab", 3L, ABC, Long.MAX_VALUE}, {"abcd", 3L, ABC, Long.MAX_VALUE},
                {"xyz", 3L, ABC, Long.MAX_VALUE}, {"abc", 3L, PIN, Long.MAX_VALUE}, {"abc", 3L, ABC, System.nanoTime() - 1}}) {
            progress.clear();
            try { copy(((String)bad[0]).getBytes(StandardCharsets.UTF_8), (Long)bad[1], (String)bad[2], (Long)bad[3], new ByteArrayOutputStream(), progress); fail("Unverified bytes accepted"); }
            catch (IOException expected) { assertFalse(progress.contains(100)); }
        }
    }
}
