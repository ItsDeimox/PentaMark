package com.pentagory.pentamark;

import java.text.Normalizer;
import java.util.Locale;
import org.json.JSONObject;

/** Shared comparison policy only. Filesystem checks belong to SyncFileJournal. */
public final class SyncPaths {
    private SyncPaths() {}
    public static JSONObject validate(String input) throws Exception {
        if (input == null) return bad("invalid-path");
        String path = Normalizer.normalize(input.replace('\\', '/'), Normalizer.Form.NFC);
        for (String part : path.split("/", -1)) {
            if (part.isEmpty() || part.equals(".") || part.equals("..") || part.endsWith(".") || part.endsWith(" ")
                || part.matches("(?s).*[<>:\"|?*\\x00-\\x1f].*")) return bad("invalid-path");
            String stem = part.split("\\.", 2)[0].replaceAll(" +$", "").toUpperCase(Locale.ROOT);
            if (stem.matches("CON|PRN|AUX|NUL|COM[1-9¹²³]|LPT[1-9¹²³]")) return bad("reserved-name");
        }
        return new JSONObject().put("ok", true).put("path", path).put("pathKey", key(path));
    }
    public static String key(String path) {
        return Normalizer.normalize(Normalizer.normalize(path, Normalizer.Form.NFC).toLowerCase(Locale.ROOT)
            .toUpperCase(Locale.ROOT).toLowerCase(Locale.ROOT), Normalizer.Form.NFC);
    }
    public static String path(String value) throws Exception {
        JSONObject result = validate(value);
        if (!result.getBoolean("ok")) throw new java.io.IOException(result.getString("code"));
        String path = result.getString("path");
        // Internal host/private material is never part of an offline replica.
        for (String part : path.split("/")) if (part.equalsIgnoreCase(".history") || part.equalsIgnoreCase(".trash")
            || part.equalsIgnoreCase(".git")) throw new java.io.IOException("reserved-name");
        return path;
    }
    private static JSONObject bad(String code) throws Exception { return new JSONObject().put("ok", false).put("code", code); }
}
