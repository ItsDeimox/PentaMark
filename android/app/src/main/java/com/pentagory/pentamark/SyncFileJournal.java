package com.pentagory.pentamark;

import java.io.*;
import java.security.MessageDigest;
import java.util.UUID;
import org.json.JSONObject;

/** Immutable objects and idempotent file-intent materialization. No Android or NIO API-26 dependency. */
public final class SyncFileJournal {
    /** Stable dependency order: vacate children/names before their parents/replacements. Reject cycles before intent. */
    static org.json.JSONArray orderChanges(org.json.JSONArray changes)throws Exception {
        int count=changes.length();boolean[][] before=new boolean[count][count];boolean[] emitted=new boolean[count];
        for(int i=0;i<count;i++)for(int j=0;j<count;j++)if(i!=j) {
            JSONObject a=changes.getJSONObject(i),b=changes.getJSONObject(j);
            JSONObject old=a.getJSONObject("before").optJSONObject("local"),next=a.getJSONObject("after").optJSONObject("local");
            JSONObject otherOld=b.getJSONObject("before").optJSONObject("local"),otherNext=b.getJSONObject("after").optJSONObject("local");
            if(vacates(old,next)) {
                String key=SyncPaths.key(old.getString("path"));
                if(old.getString("kind").equals("directory") && vacates(otherOld,otherNext) && SyncPaths.key(otherOld.getString("path")).startsWith(key+"/"))before[j][i]=true;
                if(live(otherNext) && key.equals(SyncPaths.key(otherNext.getString("path"))))before[i][j]=true;
            }
            // A moved directory is materialized after its children (which create destination parents).
            if(!live(old) && live(next) && next.getString("kind").equals("directory") && live(otherNext)
                && SyncPaths.key(otherNext.getString("path")).startsWith(SyncPaths.key(next.getString("path"))+"/"))before[i][j]=true;
        }
        org.json.JSONArray result=new org.json.JSONArray();
        while(result.length()<count) {
            int selected=-1;
            for(int i=0;i<count;i++)if(!emitted[i]){boolean ready=true;for(int j=0;j<count;j++)if(before[j][i]&&!emitted[j])ready=false;if(ready){selected=i;break;}}
            if(selected<0)throw new IOException("cyclic-file-plan");emitted[selected]=true;result.put(changes.getJSONObject(selected));
        }
        return result;
    }
    private static boolean vacates(JSONObject old,JSONObject next)throws Exception {
        return live(old) && (!live(next)||!old.getString("path").equals(next.getString("path")));
    }
    public interface DurableFiles {
        void rename(File from, File to) throws IOException;
        void syncDirectory(File directory) throws IOException;
        boolean isLink(File file) throws IOException;
    }
    public final File working, objects, staging;
    private final DurableFiles fs;
    public SyncFileJournal(File root, DurableFiles fs) throws IOException {
        this.fs = fs;
        // Android's trusted private-files ancestor may have a platform path alias.
        // Reject a linked replica root, then anchor child containment to its real path.
        mkdir(root); root = root.getCanonicalFile();
        working = new File(root, "working"); objects = new File(root, "objects"); staging = new File(root, "staging");
        mkdir(working); mkdir(objects); mkdir(staging);
    }
    private void mkdir(File dir) throws IOException {
        if (fs.isLink(dir)) throw new IOException("unsafe-path");
        if (!dir.isDirectory()) {
            File parent = dir.getParentFile(); if (parent != null && !parent.isDirectory()) mkdir(parent);
            if (!dir.mkdir() && !dir.isDirectory()) throw new IOException("storage-unavailable");
            if (parent != null) fs.syncDirectory(parent);
        }
    }
    public static String hash(File file) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        try (InputStream in = new FileInputStream(file)) { byte[] b = new byte[65536]; int n; while ((n = in.read(b)) != -1) digest.update(b, 0, n); }
        StringBuilder result = new StringBuilder(); for (byte b : digest.digest()) result.append(String.format(java.util.Locale.ROOT, "%02x", b & 255));
        return result.toString();
    }
    public File object(String hash) throws IOException {
        if (hash == null || !hash.matches("[0-9a-f]{64}")) throw new IOException("invalid-blob");
        File file = new File(objects, hash); if (fs.isLink(file)) throw new IOException("unsafe-path"); return file;
    }
    public File partial(String hash) throws IOException {
        object(hash); File file = new File(staging, hash + ".part");
        if (fs.isLink(file)) throw new IOException("unsafe-path"); return file;
    }
    public JSONObject store(InputStream input, long maximum) throws Exception {
        File temp = new File(staging, UUID.randomUUID() + ".tmp"); long count = 0;
        try (FileOutputStream out = new FileOutputStream(temp)) {
            byte[] b = new byte[65536]; int n;
            while ((n = input.read(b)) != -1) { count += n; if (count > maximum) throw new IOException("file-too-large"); out.write(b, 0, n); }
            out.getFD().sync();
        }
        String hash = hash(temp); publish(temp, hash, count);
        return new JSONObject().put("blobHash", hash).put("byteLength", count);
    }
    public void publish(File temp, String hash, long length) throws Exception {
        if (temp.length() != length || !hash(temp).equals(hash)) throw new IOException("invalid-blob");
        File dest = object(hash);
        if (dest.exists()) { require(hash, length); if (!temp.equals(dest) && !temp.delete()) throw new IOException("storage-unavailable"); }
        else { fs.rename(temp, dest); fs.syncDirectory(objects); }
        fs.syncDirectory(staging);
    }
    public void require(String hash, long length) throws Exception {
        File file = object(hash);
        if (!file.isFile() || file.length() != length || !hash(file).equals(hash)) throw new IOException("blob-unavailable");
    }
    /** Native validation is intentionally stricter than the shared Unicode comparison key. */
    public File target(String path) throws Exception {
        return target(path, null);
    }
    private File target(String path, String previousPath) throws Exception {
        path = SyncPaths.path(path); File current = working;
        for (String segment : path.split("/")) {
            File next = new File(current, segment);
            if (fs.isLink(next) || !next.getCanonicalFile().equals(next.getAbsoluteFile())) throw new IOException("unsafe-path");
            File[] siblings = current.listFiles();
            if (siblings != null) for (File sibling : siblings)
                if (!sibling.getName().equals(segment) && SyncPaths.key(sibling.getName()).equals(SyncPaths.key(segment))
                    && (previousPath == null || !sibling.equals(new File(working,previousPath)))) throw new IOException("path-collision");
            current = next;
        }
        return current;
    }
    static boolean live(JSONObject v) throws Exception { return v != null && !v.getBoolean("deleted"); }
    boolean matches(File file, JSONObject v) throws Exception {
        return live(v) && (v.getString("kind").equals("directory") ? file.isDirectory()
            : file.isFile() && file.length() == v.getLong("byteLength") && hash(file).equals(v.getString("blobHash")));
    }
    public void validateChange(JSONObject before, JSONObject after) throws Exception {
        if (live(before)) {
            File old = target(before.getString("path"), live(after) ? after.getString("path") : null);
            if (old.exists() && !matches(old, before) && !(live(after) && before.getString("path").equals(after.getString("path")) && matches(old, after)))
                throw new IOException("working-copy-changed");
            if (before.getString("kind").equals("directory") && (!live(after) || !before.getString("path").equals(after.getString("path")))
                && old.exists() && old.list() != null && old.list().length > 0) throw new IOException("directory-not-empty");
        }
        if (live(after)) {
            File dest = target(after.getString("path"), live(before) ? before.getString("path") : null);
            if (dest.exists() && !(live(before) && before.getString("path").equals(after.getString("path"))) && !matches(dest, after)) throw new IOException("path-collision");
            if (!after.getString("kind").equals("directory")) require(after.getString("blobHash"), after.getLong("byteLength"));
        }
    }
    /** Called only after the intent is committed; safe to repeat after every crash boundary. */
    public void apply(JSONObject before, JSONObject after) throws Exception {
        validateChange(before, after);
        if (live(after)) {
            File dest = target(after.getString("path"), live(before) ? before.getString("path") : null); mkdir(dest.getParentFile());
            if (after.getString("kind").equals("directory")) mkdir(dest);
            else if (!matches(dest, after)) {
                File temp = new File(staging, UUID.randomUUID() + ".working");
                try (InputStream in = new FileInputStream(object(after.getString("blobHash"))); FileOutputStream out = new FileOutputStream(temp)) {
                    byte[] b = new byte[65536]; int n; while ((n = in.read(b)) != -1) out.write(b, 0, n); out.getFD().sync();
                }
                fs.rename(temp, dest); fs.syncDirectory(dest.getParentFile()); fs.syncDirectory(staging);
            }
        }
        if (live(before) && (!live(after) || !before.getString("path").equals(after.getString("path")))) {
            File old = target(before.getString("path"), live(after) ? after.getString("path") : null);
            // All prior bytes remain reachable in versions/objects; remove only the working name.
            if (old.exists() && !old.delete()) throw new IOException("directory-not-empty");
            fs.syncDirectory(old.getParentFile());
        }
    }
}
