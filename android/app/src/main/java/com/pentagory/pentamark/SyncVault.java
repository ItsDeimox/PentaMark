package com.pentagory.pentamark;

import android.content.Context;
import android.system.*;
import java.io.*;
import java.net.URI;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.*;
import org.json.*;

/** One private replica. All mutations (including recovery) serialize on this instance. */
public final class SyncVault implements AutoCloseable {
    final SyncDatabase database;
    final SyncFileJournal files;
    private JSONObject meta;
    private boolean closed;
    private final Object transfers = new Object();
    static final long MAX_TEXT = 8L * 1024 * 1024;
    static final long MAX_SAFE = 9007199254740991L;
    static String id() { return UUID.randomUUID().toString(); }
    static Object nullable(Object value) { return value == null ? JSONObject.NULL : value; }
    static JSONObject copy(JSONObject value) throws Exception { return value == null ? null : new JSONObject(value.toString()); }
    static JSONObject obj(Object... pairs) throws Exception {
        JSONObject value = new JSONObject(); for (int i=0; i<pairs.length; i+=2) value.put((String)pairs[i], nullable(pairs[i+1])); return value;
    }
    static String identifier(String value) throws IOException {
        if (value == null || !value.matches("[a-zA-Z0-9_-]{1,128}")) throw new IOException("invalid-identity"); return value;
    }
    static long size(JSONObject value) throws Exception {
        Object raw = value.get("byteLength");
        if (!(raw instanceof Number)) throw new IOException("invalid-length");
        double n = ((Number)raw).doubleValue();
        if (n < 0 || n > MAX_SAFE || n != Math.floor(n)) throw new IOException("invalid-length"); return (long)n;
    }
    static JSONObject version(JSONObject value) throws Exception {
        if (value == null) return null;
        JSONObject v = copy(value); identifier(v.getString("entryId"));
        if (v.getString("revision").isEmpty()) throw new IOException("invalid-revision");
        v.put("path", SyncPaths.path(v.getString("path")));
        if (!Arrays.asList("note", "asset", "directory").contains(v.getString("kind")) throw new IOException("invalid-kind");
        if (!(v.get("deleted") instanceof Boolean)) throw new IOException("invalid-deleted");
        long length = size(v);
        if (v.getBoolean("deleted") || v.getString("kind").equals("directory")) {
            if (!v.isNull("blobHash") || length != 0) throw new IOException("invalid-blob");
        } else if (!v.getString("blobHash").matches("[0-9a-f]{64}")) throw new IOException("invalid-blob");
        return v;
    }
    public SyncVault(Context context, JSONObject profile) throws Exception {
        profile = copy(profile);
        identifier(profile.getString("vaultId")); identifier(profile.getString("replicaId")); identifier(profile.getString("serverId"));
        RemoteConnection.validateOrigin(profile.getString("origin")); validateConfig(profile);
        File root = new File(context.getFilesDir(), "sync/replicas/" + profile.getString("vaultId") + "/" + profile.getString("replicaId"));
        files = new SyncFileJournal(root, androidFiles());
        database = new SyncDatabase(context, new File(root, "replica.db"));
        try {
            meta = database.get("vaults", "meta");
            if (meta == null) {
                meta = obj("profile", profile, "cursor", null, "epoch", null, "initialCopy", null, "snapshotComplete", false,
                    "lastSuccessfulSync", null, "errorCode", null);
                database.put("vaults", "meta", meta);
            } else {
                JSONObject saved = meta.getJSONObject("profile");
                if (!saved.getString("serverId").equals(profile.getString("serverId"))) throw new IOException("identity-mismatch");
                // A changed origin needs a verified native hello before it can be saved/bound.
                if (!saved.getString("origin").equals(profile.getString("origin"))) throw new IOException("origin-change-needs-handshake");
            }
            recover();
        } catch (Exception e) { database.close(); throw e; }
    }
    static SyncFileJournal.DurableFiles androidFiles() {
        return new SyncFileJournal.DurableFiles() {
            public void rename(File a, File b) throws IOException {
                try { Os.rename(a.getAbsolutePath(), b.getAbsolutePath()); } catch (ErrnoException e) { throw new IOException("storage-unavailable", e); }
            }
            public void syncDirectory(File dir) throws IOException {
                try {
                    FileDescriptor fd = Os.open(dir.getAbsolutePath(), OsConstants.O_RDONLY | OsConstants.O_DIRECTORY, 0);
                    try { Os.fsync(fd); } finally { Os.close(fd); }
                } catch (ErrnoException e) { throw new IOException("storage-unavailable", e); }
            }
            public boolean isLink(File file) throws IOException {
                try { return OsConstants.S_ISLNK(Os.lstat(file.getAbsolutePath()).st_mode); }
                catch (ErrnoException e) { if (e.errno == OsConstants.ENOENT || e.errno == OsConstants.ENOTDIR) return false; throw new IOException("unsafe-path", e); }
            }
        };
    }
    private static void validateConfig(JSONObject config) throws Exception {
        if (!(config.get("offlineEnabled") instanceof Boolean) || !Arrays.asList("automatic", "manual").contains(config.getString("mode"))) throw new IOException("invalid-config");
    }
    private void ready() throws Exception { if (closed) throw new IOException("replica-closed"); recover(); }
    public synchronized void close() { closed = true; database.close(); }
    public synchronized JSONObject configure(JSONObject config) throws Exception {
        ready(); validateConfig(config); JSONObject next = copy(meta), p = next.getJSONObject("profile");
        p.put("offlineEnabled", config.getBoolean("offlineEnabled")).put("mode", config.getString("mode"));
        database.put("vaults", "meta", next); meta = next; return status();
    }
    public synchronized JSONObject status() throws Exception {
        ready(); int dirty = 0;
        JSONArray entries = database.all("entries");
        for (int i=0; i<entries.length(); i++) if (entries.getJSONObject(i).getBoolean("dirty")) dirty++;
        int pending = Math.max(dirty, database.count("pending_ops")), conflicts = database.count("conflicts");
        String phase = !meta.isNull("errorCode") ? "blocked" : conflicts > 0 ? "conflicts" : !meta.getBoolean("snapshotComplete") ? "initial-copy"
            : pending > 0 && meta.getJSONObject("profile").getString("mode").equals("manual") ? "waiting-manual" : "offline";
        return obj("phase", phase, "localSaved", true, "pendingCount", pending, "conflictCount", conflicts,
            "snapshotComplete", meta.getBoolean("snapshotComplete"), "lastSuccessfulSync", meta.get("lastSuccessfulSync"), "errorCode", meta.get("errorCode"));
    }
    public synchronized JSONObject snapshot() throws Exception {
        ready(); JSONArray output = new JSONArray(), entries = database.all("entries");
        for (int i=0; i<entries.length(); i++) {
            JSONObject row = entries.getJSONObject(i); output.put(obj("base", row.get("base"), "local", row.get("local"), "localHead", row.get("localHead")));
        }
        return obj("profile", copy(meta.getJSONObject("profile")), "cursor", meta.get("cursor"), "entries", output,
            "status", status(), "epoch", meta.get("epoch"), "initialCopy", meta.get("initialCopy"), "conflicts", database.all("conflicts"));
    }
    private JSONObject empty(String entryId) throws Exception { return obj("entryId", entryId, "base", null, "local", null, "localHead", "", "dirty", false, "approved", false); }
    private void retain(JSONObject v) throws Exception { if (v != null) database.put("versions", id(), v); }
    private void require(JSONObject v) throws Exception {
        if (v != null && !v.getBoolean("deleted") && !v.getString("kind").equals("directory")) files.require(v.getString("blobHash"), size(v));
    }
    private JSONObject plan() throws Exception { return obj("id", id(), "rows", new JSONArray(), "conflicts", new JSONArray(), "removeConflicts", new JSONArray(), "removePending", new JSONArray(), "applied", new JSONArray(), "meta", copy(meta)); }
    private void rowChange(JSONObject plan, JSONObject before, JSONObject after) throws Exception {
        plan.getJSONArray("rows").put(obj("before", before, "after", after));
    }
    private void commit(JSONObject plan) throws Exception {
        // Validate ALL file transitions before making an intent visible. Cursor commits with metadata only after materialization.
        JSONArray rows = plan.getJSONArray("rows");
        Map<String,JSONObject> finalRows = new HashMap<>(); JSONArray existingRows=database.all("entries");
        for(int i=0;i<existingRows.length();i++) {JSONObject r=existingRows.getJSONObject(i);finalRows.put(r.getString("entryId"),r);}
        for(int i=0;i<rows.length();i++) {JSONObject r=rows.getJSONObject(i).getJSONObject("after");finalRows.put(r.getString("entryId"),r);}
        Map<String,String> owners=new HashMap<>();
        for(JSONObject r:finalRows.values()) {JSONObject v=r.optJSONObject("local");if(SyncFileJournal.live(v)) {
            String key=SyncPaths.key(v.getString("path")), owner=owners.put(key,r.getString("entryId"));
            if(owner!=null && !owner.equals(r.getString("entryId")))throw new IOException("path-collision");
        }}
        for (int i=0; i<rows.length(); i++) {
            JSONObject change = rows.getJSONObject(i); JSONObject before = change.getJSONObject("before"), after = change.getJSONObject("after");
            JSONObject old = before.optJSONObject("local"), next = after.optJSONObject("local");
            if (!Objects.equals(String.valueOf(old), String.valueOf(next))) {
                if (SyncFileJournal.live(next)) {
                    // Filesystem checks in validateChange allow the old spelling for a case-only rename.
                    File dest = new File(files.working,SyncPaths.path(next.getString("path")));
                    if (dest.exists() && !(SyncFileJournal.live(old) && old.getString("path").equals(next.getString("path"))) && !vacated(next.getString("path"),rows,i)) throw new IOException("path-collision");
                }
                try { files.validateChange(old, next); }
                catch(IOException error) {
                    if("path-collision".equals(error.getMessage()) && SyncFileJournal.live(next) && vacated(next.getString("path"),rows,i)) {require(next);continue;}
                    if(!"directory-not-empty".equals(error.getMessage()) || old==null || !old.getString("kind").equals("directory"))throw error;
                    validateKnownChildren(files.target(old.getString("path")),rows);
                }
            }
        }
        database.put("file_intents", plan.getString("id"), plan);
        finish(plan);
    }
    private boolean vacated(String path,JSONArray changes,int beforeIndex)throws Exception {
        for(int i=0;i<beforeIndex;i++) {
            JSONObject c=changes.getJSONObject(i),a=c.getJSONObject("before").optJSONObject("local"),b=c.getJSONObject("after").optJSONObject("local");
            if(SyncFileJournal.live(a)&&SyncPaths.key(a.getString("path")).equals(SyncPaths.key(path))
                &&(!SyncFileJournal.live(b)||!SyncPaths.key(b.getString("path")).equals(SyncPaths.key(path))))return true;
        }return false;
    }
    private void validateKnownChildren(File directory,JSONArray changes)throws Exception {
        File[] children=directory.listFiles();if(children==null)throw new IOException("storage-unavailable");
        for(File child:children) {
            String path=child.getAbsolutePath().substring(files.working.getAbsolutePath().length()+1).replace(File.separatorChar,'/');
            files.target(path);boolean planned=false;
            for(int i=0;i<changes.length();i++) {
                JSONObject change=changes.getJSONObject(i), before=change.getJSONObject("before").optJSONObject("local"), after=change.getJSONObject("after").optJSONObject("local");
                if(SyncFileJournal.live(before) && before.getString("path").equals(path) && (!SyncFileJournal.live(after)||!after.getString("path").equals(path))) {planned=true;break;}
            }
            if(!planned)throw new IOException("directory-not-empty");
            if(child.isDirectory())validateKnownChildren(child,changes);
        }
    }
    private void recover() throws Exception {
        JSONArray intents = database.all("file_intents");
        for (int i=0; i<intents.length(); i++) finish(intents.getJSONObject(i));
    }
    private void finish(JSONObject plan) throws Exception {
        JSONArray rows = plan.getJSONArray("rows");
        for (int i=0; i<rows.length(); i++) {
            JSONObject change = rows.getJSONObject(i), before = change.getJSONObject("before"), after = change.getJSONObject("after");
            if (!Objects.equals(String.valueOf(before.optJSONObject("local")), String.valueOf(after.optJSONObject("local")))) {
                JSONObject old=before.optJSONObject("local");
                // A later step may already have reused this name before a crash. Never remove its verified final bytes on replay.
                if(SyncFileJournal.live(old))for(int j=i+1;j<rows.length();j++) {
                    JSONObject replacement=rows.getJSONObject(j).getJSONObject("after").optJSONObject("local");
                    if(SyncFileJournal.live(replacement)&&SyncPaths.key(old.getString("path")).equals(SyncPaths.key(replacement.getString("path")))
                        && files.matches(files.target(replacement.getString("path")),replacement)){old=null;break;}
                }
                files.apply(old, after.optJSONObject("local"));
            }
        }
        database.transaction(() -> {
            for (int i=0; i<rows.length(); i++) {
                JSONObject change = rows.getJSONObject(i), before = change.getJSONObject("before"), after = change.getJSONObject("after");
                retain(before.optJSONObject("base")); retain(before.optJSONObject("local")); retain(after.optJSONObject("base")); retain(after.optJSONObject("local"));
                database.put("entries", after.getString("entryId"), after);
            }
            JSONArray cs = plan.getJSONArray("conflicts");
            for (int i=0; i<cs.length(); i++) {
                JSONObject c = cs.getJSONObject(i); retain(c.optJSONObject("base")); retain(c.optJSONObject("local")); retain(c.optJSONObject("remote"));
                database.put("conflicts", c.getString("conflictId"), c);
            }
            JSONArray remove = plan.getJSONArray("removeConflicts"); for (int i=0; i<remove.length(); i++) database.remove("conflicts", remove.getString(i));
            remove = plan.getJSONArray("removePending"); for (int i=0; i<remove.length(); i++) database.remove("pending_ops", remove.getString(i));
            JSONArray applied = plan.getJSONArray("applied"); for (int i=0; i<applied.length(); i++) database.put("applied_ops", applied.getJSONObject(i).getString("opId"), applied.getJSONObject(i));
            database.put("vaults", "meta", plan.getJSONObject("meta")); database.remove("file_intents", plan.getString("id"));
        });
        meta = copy(plan.getJSONObject("meta"));
    }
    private JSONObject pending(String entryId) throws Exception {
        JSONArray all = database.all("pending_ops"); for (int i=0; i<all.length(); i++) if (all.getJSONObject(i).getJSONObject("operation").getString("entryId").equals(entryId)) return all.getJSONObject(i); return null;
    }
    private boolean conflicted(String entryId) throws Exception {
        JSONArray all = database.all("conflicts"); for (int i=0; i<all.length(); i++) if (all.getJSONObject(i).getString("entryId").equals(entryId)) return true; return false;
    }
    public synchronized JSONArray preparePending(int limit) throws Exception {
        ready(); if (limit < 1 || limit > 100) throw new IOException("invalid-limit"); JSONArray result = new JSONArray();
        database.transaction(() -> {
            List<JSONObject> rows = orderedRows(database.all("entries"));
            for (int i=0; i<rows.size() && result.length()<limit; i++) {
                JSONObject row = rows.get(i), existing = pending(row.getString("entryId"));
                if (existing != null) { result.put(existing.getJSONObject("operation")); continue; }
                if (!row.getBoolean("dirty") || !row.getBoolean("approved") || conflicted(row.getString("entryId"))) continue;
                JSONObject local = row.optJSONObject("local"), base = row.optJSONObject("base"); if (local == null) continue;
                if (base == null && local.getBoolean("deleted")) { row.put("dirty", false); database.put("entries", row.getString("entryId"), row); continue; }
                require(local); JSONObject profile = meta.getJSONObject("profile");
                String kind = local.getBoolean("deleted") ? (local.getString("kind").equals("directory") ? "rmdir" : "delete")
                    : base != null && !local.getString("path").equals(base.getString("path"))
                    && Objects.equals(local.optString("blobHash"), base.optString("blobHash")) ? "move" : local.getString("kind").equals("directory") ? "mkdir" : "put";
                JSONArray dependencies=new JSONArray(); boolean wait=false;
                for(JSONObject other:rows) {
                    if(other==row)continue;JSONObject child=other.optJSONObject("local");if(child==null)continue;
                    String path=local.getString("path"), otherPath=child.getString("path");
                    boolean prerequisite=local.getBoolean("deleted") && otherPath.startsWith(path+"/")
                        || !local.getBoolean("deleted") && !child.getBoolean("deleted") && child.getString("kind").equals("directory") && path.startsWith(otherPath+"/");
                    if(prerequisite && other.getBoolean("dirty")) {JSONObject p=pending(other.getString("entryId"));if(p==null){wait=true;break;}dependencies.put(p.getJSONObject("operation").getString("opId"));}
                }
                if(wait)continue;
                JSONObject operation = obj("vaultId", profile.getString("vaultId"), "replicaId", profile.getString("replicaId"), "opId", id(), "entryId", row.getString("entryId"),
                    "kind", kind, "baseRevision", base == null ? null : base.getString("revision"), "after", local.getBoolean("deleted") ? null :
                        obj("path", local.getString("path"), "kind", local.getString("kind"), "blobHash", local.get("blobHash"), "byteLength", size(local)), "dependsOn", dependencies);
                database.put("pending_ops", operation.getString("opId"), obj("operation", operation, "localHead", row.getString("localHead"), "local", local));
                result.put(operation);
            }
        }); return result;
    }
    private static List<JSONObject> orderedRows(JSONArray input)throws Exception {
        List<JSONObject> result=new ArrayList<>();for(int i=0;i<input.length();i++)result.add(input.getJSONObject(i));
        result.sort((a,b)-> {
            JSONObject x=a.optJSONObject("local"),y=b.optJSONObject("local");if(x==null||y==null)return x==y?0:x==null?1:-1;
            boolean xd=x.optBoolean("deleted"),yd=y.optBoolean("deleted");if(xd!=yd)return xd?1:-1;
            int depthX=x.optString("path").split("/").length,depthY=y.optString("path").split("/").length;
            return xd?Integer.compare(depthY,depthX):Integer.compare(depthX,depthY);
        });return result;
    }
    public synchronized void persistIncoming(JSONObject batch) throws Exception {
        ready(); String cursor = batch.getString("nextCursor"); JSONArray items = batch.getJSONArray("items"); JSONObject plan = plan(); Set<String> seen = new HashSet<>();
        for (int i=0; i<items.length(); i++) {
            JSONObject item = items.getJSONObject(i), decision = item.getJSONObject("decision");
            JSONObject local = decision.optJSONObject("local"), remote = decision.optJSONObject("remote"), base = decision.optJSONObject("base");
            JSONObject identity = local != null ? local : base != null ? base : remote;
            if (identity == null) { if (!decision.getString("action").equals("none")) throw new IOException("invalid-decision"); continue; }
            String entryId = identifier(identity.getString("entryId")); JSONObject row = database.get("entries", entryId); if (row == null) row = empty(entryId);
            if (!row.getString("localHead").equals(item.getString("expectedLocalHead"))) throw new IOException("stale-local-head");
            if (!seen.add(entryId)) throw new IOException("duplicate-entry");
            // The engine owns reconciliation. These checks guard stale advisory inputs, not choose an action.
            if (!sameVersion(row.optJSONObject("base"), base) || !sameVersion(row.optJSONObject("local"), local)) throw new IOException("stale-local-head");
            String action = decision.getString("action"); JSONObject next = copy(row);
            if (remote != null) { remote = version(remote); require(remote); }
            if (action.equals("pull") || action.equals("converged")) {
                if (remote == null) throw new IOException("missing-version");
                if (!remote.getString("entryId").equals(entryId)) throw new IOException("identity-mismatch");
                if (pending(entryId) != null) throw new IOException("operation-in-flight");
                next.put("base", remote).put("local", remote).put("localHead", id()).put("dirty", false).put("approved", false);
            } else if (action.equals("push")) next.put("approved", true);
            else if (action.equals("conflict")) {
                require(row.optJSONObject("base")); require(row.optJSONObject("local"));
                String conflictId = entryId;
                plan.getJSONArray("conflicts").put(obj("conflictId", conflictId, "entryId", entryId, "base", base, "local", local, "remote", remote, "reason", decision.getString("reason")));
                next.put("approved", false);
            } else if (!action.equals("none")) throw new IOException("invalid-decision");
            rowChange(plan, row, next);
        }
        JSONObject nextMeta = plan.getJSONObject("meta");
        if (batch.has("epoch")) {
            String epoch = batch.getString("epoch");
            if (!nextMeta.isNull("epoch") && !nextMeta.getString("epoch").equals(epoch) && !batch.has("initialCopy")) throw new IOException("epoch-changed");
            nextMeta.put("epoch", epoch);
        }
        if (batch.has("initialCopy")) {
            JSONObject progress = batch.getJSONObject("initialCopy"); progress.getString("snapshotToken"); String at = progress.getString("atCursor");
            if (!progress.has("pageCursor")) throw new IOException("invalid-progress");
            nextMeta.put("initialCopy", copy(progress));
            if (progress.isNull("pageCursor")) { nextMeta.put("cursor", at).put("snapshotComplete", true).put("initialCopy", JSONObject.NULL); }
            else { progress.getString("pageCursor"); nextMeta.put("snapshotComplete", false); }
        } else nextMeta.put("cursor", cursor);
        commit(plan);
    }
    private static boolean sameVersion(JSONObject a, JSONObject b) throws Exception {
        if (a == null || b == null) return a == b;
        for (String field : new String[]{"entryId", "kind", "path", "revision", "blobHash", "byteLength", "deleted"}) if (!Objects.equals(a.get(field), b.get(field))) return false;
        return true;
    }
    public synchronized void confirm(JSONObject result) throws Exception {
        ready(); String opId = result.getString("opId"); if (database.get("applied_ops", opId) != null) return;
        JSONObject pending = database.get("pending_ops", opId); if (pending == null) throw new IOException("unknown-operation");
        JSONObject op = pending.getJSONObject("operation"), row = database.get("entries", op.getString("entryId")), next = copy(row), plan = plan();
        String status = result.getString("status");
        if (status.equals("blocked")) { JSONObject nextMeta = copy(meta).put("errorCode", result.optString("errorCode", "blocked")); database.put("vaults", "meta", nextMeta); meta = nextMeta; return; }
        if (status.equals("conflict")) {
            JSONObject conflict = result.getJSONObject("conflict");
            if (!conflict.getString("entryId").equals(op.getString("entryId"))) throw new IOException("identity-mismatch");
            require(version(conflict.optJSONObject("base"))); require(version(conflict.optJSONObject("local"))); require(version(conflict.optJSONObject("remote")));
            plan.getJSONArray("conflicts").put(conflict); next.put("approved", false);
        } else if (status.equals("applied") || status.equals("already-applied")) {
            JSONObject confirmed = version(result.getJSONObject("confirmed")); require(confirmed);
            JSONObject prepared = pending.getJSONObject("local");
            for (String field : new String[]{"entryId", "kind", "path", "blobHash", "byteLength", "deleted"}) if (!Objects.equals(confirmed.get(field), prepared.get(field))) throw new IOException("invalid-confirmation");
            next.put("base", confirmed);
            if (row.getString("localHead").equals(pending.getString("localHead"))) next.put("local", confirmed).put("dirty", false);
            // New edits still compare against the confirmed base, never mutate an in-flight op.
            next.put("approved", true);
        } else throw new IOException("invalid-result");
        plan.getJSONArray("removePending").put(opId); plan.getJSONArray("applied").put(result); rowChange(plan, row, next); commit(plan);
    }
    public synchronized void resolve(JSONObject input) throws Exception {
        ready(); JSONObject conflict = database.get("conflicts", input.getString("conflictId")); if (conflict == null) throw new IOException("unknown-conflict");
        JSONObject row = database.get("entries", conflict.getString("entryId")), remote = conflict.optJSONObject("remote"), merged = null;
        String choice = input.getString("choice");
        if (choice.equals("merged")) {
            if (row.optJSONObject("local") == null || !row.getJSONObject("local").getString("kind").equals("note")) throw new IOException("invalid-merge");
            merged = copy(row.getJSONObject("local")); byte[] bytes = input.getString("mergedContent").getBytes(StandardCharsets.UTF_8);
            JSONObject blob = files.store(new ByteArrayInputStream(bytes), MAX_TEXT);
            merged.put("blobHash", blob.getString("blobHash")).put("byteLength", blob.getLong("byteLength")).put("revision", id()).put("deleted", false);
            retain(merged); // Preserve user text even when the conditional resolution is rejected.
        }
        if (!row.getString("localHead").equals(input.getString("expectedLocalHead"))) throw new IOException("stale-local-head");
        Object expected = input.get("expectedRemoteRevision"), actual = remote == null ? JSONObject.NULL : remote.get("revision");
        if (!Objects.equals(expected, actual)) throw new IOException("stale-remote-revision");
        if (pending(row.getString("entryId")) != null) throw new IOException("operation-in-flight");
        if(remote!=null && !remote.getString("entryId").equals(row.getString("entryId"))) {
            resolveIdentityConflict(input,choice,row,remote);return;
        }
        JSONObject next = copy(row), plan = plan();
        if (choice.equals("local") || choice.equals("merged")) {
            if (row.optJSONObject("local") == null) throw new IOException("missing-version");
            next.put("base", nullable(remote)).put("local", choice.equals("merged") ? merged : row.get("local")).put("dirty", true).put("approved", true).put("localHead", id());
        } else if (choice.equals("remote") || choice.equals("keep-both")) {
            if (remote == null) throw new IOException("missing-version"); require(remote);
            JSONObject local = row.optJSONObject("local");
            if (SyncFileJournal.live(local) && !local.getString("kind").equals("directory")) {
                JSONObject duplicate = copy(local); String extraId = id();
                duplicate.put("entryId", extraId).put("path", local.getString("path") + ".conflict-" + extraId).put("revision", id());
                JSONObject extra = empty(extraId).put("local", duplicate).put("localHead", id()).put("dirty", true).put("approved", true);
                rowChange(plan, empty(extraId), extra);
            }
            next.put("base", remote).put("local", remote).put("localHead", id()).put("dirty", false).put("approved", false);
        } else throw new IOException("invalid-resolution");
        plan.getJSONArray("removeConflicts").put(input.getString("conflictId")); rowChange(plan, row, next); commit(plan);
    }
    private void resolveIdentityConflict(JSONObject input,String choice,JSONObject row,JSONObject remote)throws Exception {
        if(!choice.equals("keep-both")&&!choice.equals("remote"))throw new IOException("identity-conflict-needs-rename");
        JSONObject local=row.optJSONObject("local");if(!SyncFileJournal.live(local)||local.getString("kind").equals("directory"))throw new IOException("identity-conflict-needs-rename");
        require(remote);JSONObject other=database.get("entries",remote.getString("entryId"));if(other==null)other=empty(remote.getString("entryId"));
        if(other.getBoolean("dirty") || pending(other.getString("entryId"))!=null)throw new IOException("stale-local-head");
        JSONObject relocated=copy(local).put("path",local.getString("path")+".conflict-"+id()).put("revision",id());
        JSONObject next=copy(row).put("local",relocated).put("localHead",id()).put("dirty",true).put("approved",true);
        JSONObject received=copy(other).put("base",remote).put("local",remote).put("localHead",id()).put("dirty",false).put("approved",false);
        JSONObject plan=plan();rowChange(plan,row,next);rowChange(plan,other,received);plan.getJSONArray("removeConflicts").put(input.getString("conflictId"));commit(plan);
    }
    private JSONObject findPath(String path) throws Exception {
        JSONArray entries = database.all("entries"); String key = SyncPaths.key(path);
        for (int i=0; i<entries.length(); i++) { JSONObject row = entries.getJSONObject(i), local = row.optJSONObject("local");
            if (SyncFileJournal.live(local) && SyncPaths.key(local.getString("path")).equals(key)) return row; }
        return null;
    }
    public synchronized JSONObject request(String url, String method, JSONObject body) throws Exception {
        ready(); RemoteConnection.validateRequest(url, method); URI uri = new URI(url); String route = uri.getPath();
        if (route.equals("/api/state") && method.equals("GET")) {
            JSONArray entries = database.all("entries"), notes = new JSONArray(), assets=new JSONArray(), folders = new JSONArray(), paths=new JSONArray();
            for (int i=0; i<entries.length(); i++) { JSONObject v = entries.getJSONObject(i).optJSONObject("local"); if (SyncFileJournal.live(v)) {
                if (v.getString("kind").equals("directory")) folders.put(v.getString("path"));
                else {paths.put(v.getString("path"));(v.getString("kind").equals("note")?notes:assets).put(apiMetadata(v));}
            } }
            return obj("status", 200, "data", obj("app","PentaMark","protocolVersion",6,"notes", notes,"assets",assets, "folders", folders,"assetPaths",paths,
                "clients",1,"connections",new JSONArray(),"locks",new JSONArray(),"urls",new JSONArray(),"vaultName",meta.getJSONObject("profile").getString("vaultId"),"isHost",false));
        }
        if (!Arrays.asList("/api/note", "/api/asset", "/api/folder").contains(route)) throw new IOException("unsupported-offline-route");
        String path = null;
        if (uri.getRawQuery() != null) for (String part : uri.getRawQuery().split("&")) if (part.startsWith("path=")) path = URLDecoder.decode(part.substring(5), "UTF-8");
        if (path == null && body != null) path = body.optString("path", null);
        path = SyncPaths.path(path); JSONObject row = findPath(path), local = row == null ? null : row.optJSONObject("local");
        if (method.equals("GET")) {
            if (local == null) return obj("status", 404, "data", obj("error", "offline-unavailable"));
            if (!local.getString("kind").equals("note")) throw new IOException("native-stream-required"); require(local);
            if (size(local)>MAX_TEXT) throw new IOException("file-too-large");
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            try (InputStream in = new FileInputStream(files.object(local.getString("blobHash")))) { byte[] b = new byte[8192]; int n; while ((n=in.read(b))!=-1) out.write(b,0,n); }
            return obj("status", 200, "data", apiMetadata(local).put("revision",local.getString("revision")).put("content", new String(out.toByteArray(), StandardCharsets.UTF_8)));
        }
        if (method.equals("POST") && row != null) throw new IOException("path-collision");
        if (row == null && !(method.equals("POST") || method.equals("PUT"))) throw new IOException("offline-unavailable");
        if(local!=null && local.getString("kind").equals("directory") && (method.equals("DELETE")||method.equals("PATCH")))return changeFolder(row,method,body);
        if (body != null && body.has("baseRevision") && !body.isNull("baseRevision") && (local == null || !body.getString("baseRevision").equals(local.getString("revision")))) throw new IOException("stale-local-head");
        if (row == null) row = empty(id()); JSONObject next = copy(row), v = local == null ? obj("entryId", row.getString("entryId"), "kind", route.equals("/api/folder") ? "directory" : "note", "path", path, "blobHash", null, "byteLength", 0, "deleted", false) : copy(local);
        if (method.equals("DELETE")) v.put("deleted", true).put("blobHash", JSONObject.NULL).put("byteLength", 0);
        else if (method.equals("PATCH")) v.put("path", SyncPaths.path(body.getString("newPath")));
        else if ((method.equals("POST") || method.equals("PUT")) && route.equals("/api/note")) {
            JSONObject blob = files.store(new ByteArrayInputStream(body.optString("content", "").getBytes(StandardCharsets.UTF_8)), MAX_TEXT);
            v.put("blobHash", blob.getString("blobHash")).put("byteLength", blob.getLong("byteLength"));
        } else if (!(method.equals("POST") && route.equals("/api/folder"))) throw new IOException("unsupported-offline-route");
        v.put("revision", id()); version(v); next.put("local", v).put("localHead", id()).put("dirty", true).put("approved", !conflicted(row.getString("entryId")));
        JSONObject plan = plan(); rowChange(plan, row, next); commit(plan);
        return obj("status", method.equals("POST") ? 201 : 200, "data", obj("path", v.getString("path"), "revision", v.getString("revision"), "localSaved", true));
    }
    private JSONObject apiMetadata(JSONObject v)throws Exception {
        String path=v.getString("path"),name=path.substring(path.lastIndexOf('/')+1),extension=name.contains(".")?name.substring(name.lastIndexOf('.')+1).toLowerCase(Locale.ROOT):"";
        boolean note=v.getString("kind").equals("note");JSONObject result=obj("path",path,"title",note&&name.toLowerCase(Locale.ROOT).endsWith(".md")?name.substring(0,name.length()-3):name,"size",size(v),"modified",0);
        if(!note)result.put("extension",extension).put("kind",Arrays.asList("png","jpg","jpeg","gif","webp","avif","svg","bmp").contains(extension)?"image":Arrays.asList("mp3","wav","ogg","m4a","flac").contains(extension)?"audio":Arrays.asList("mp4","webm","mov","mkv").contains(extension)?"video":extension.equals("pdf")?"pdf":"file");
        return result;
    }
    private JSONObject changeFolder(JSONObject root,String method,JSONObject body)throws Exception {
        String old=root.getJSONObject("local").getString("path"), dest=method.equals("PATCH")?SyncPaths.path(body.getString("newPath")):null;
        if(dest!=null && (SyncPaths.key(dest).equals(SyncPaths.key(old))||SyncPaths.key(dest).startsWith(SyncPaths.key(old)+"/")))throw new IOException("invalid-folder-move");
        List<JSONObject> rows=orderedRows(database.all("entries"));Collections.reverse(rows);JSONObject plan=plan();
        for(JSONObject row:rows) {
            JSONObject local=row.optJSONObject("local");if(!SyncFileJournal.live(local))continue;String path=local.getString("path");
            if(!path.equals(old)&&!path.startsWith(old+"/"))continue;
            JSONObject next=copy(row), changed=copy(local).put("revision",id());
            if(dest==null)changed.put("deleted",true).put("blobHash",JSONObject.NULL).put("byteLength",0);
            else changed.put("path",dest+path.substring(old.length()));
            next.put("local",changed).put("localHead",id()).put("dirty",true).put("approved",!conflicted(row.getString("entryId")));
            rowChange(plan,row,next);
        }
        commit(plan);return obj("status",200,"data",obj("path",dest==null?old:dest,"localSaved",true));
    }
    /** ContentResolver supplies the stream; only identifiers/progress cross the JS bridge. */
    public synchronized JSONObject importStream(String path, InputStream input, long maximum) throws Exception {
        ready(); path = SyncPaths.path(path); if (findPath(path) != null) throw new IOException("path-collision");
        JSONObject blob = files.store(input, maximum), row = empty(id()), next = copy(row);
        JSONObject v = obj("entryId", row.getString("entryId"), "kind", "asset", "path", path, "revision", id(), "blobHash", blob.getString("blobHash"), "byteLength", blob.getLong("byteLength"), "deleted", false);
        next.put("local", v).put("localHead", id()).put("dirty", true).put("approved", true);
        JSONObject plan = plan(); rowChange(plan, row, next); commit(plan); return v;
    }
    public synchronized RemoteConnection.Media openMedia(String path, String range) throws Exception {
        ready(); String mime = RemoteConnection.mediaMime(path); JSONObject row = findPath(SyncPaths.path(path));
        if (row == null) throw new IOException("offline-unavailable"); JSONObject v = row.getJSONObject("local"); require(v);
        long total = size(v), start = 0, end = total-1;
        if (range != null) {
            if (!range.matches("bytes=[0-9]{1,15}-[0-9]{0,15}")) throw new IOException("invalid-range");
            String[] parts = range.substring(6).split("-", -1); start = Long.parseLong(parts[0]); if (!parts[1].isEmpty()) end = Math.min(end, Long.parseLong(parts[1]));
            if (start > end || start >= total) throw new IOException("invalid-range");
        }
        RandomAccessFile file = new RandomAccessFile(files.object(v.getString("blobHash")), "r"); file.seek(start); final long count = end-start+1;
        InputStream stream = new InputStream() {
            long remaining = count;
            public int read() throws IOException { byte[] one=new byte[1]; return read(one,0,1)<0 ? -1 : one[0]&255; }
            public int read(byte[] b,int off,int len) throws IOException { if(len==0)return 0; if(remaining==0)return -1; int n=file.read(b,off,(int)Math.min(len,remaining)); if(n<0)throw new EOFException(); remaining-=n; return n; }
            public void close() throws IOException { file.close(); }
        };
        Map<String,String> headers = new HashMap<>(); headers.put("Cache-Control","no-store"); headers.put("X-Content-Type-Options","nosniff"); headers.put("Content-Security-Policy","sandbox; default-src 'none'"); headers.put("Cross-Origin-Resource-Policy","same-origin"); headers.put("Accept-Ranges","bytes"); headers.put("Content-Length",Long.toString(count));
        if(range!=null)headers.put("Content-Range","bytes "+start+"-"+end+"/"+total);
        return new RemoteConnection.Media(range==null?200:206,mime,headers,stream);
    }

    public JSONObject transfer(RemoteConnection remote, JSONObject blob, long offset, long maximum, boolean upload) throws Exception {
        synchronized (transfers) {
            final String hash = blob.getString("blobHash"); final long total = size(blob); final File file;
            synchronized (this) {
                ready(); if (total > maximum || offset < 0 || offset > total) throw new IOException("invalid-transfer");
                file = upload ? files.object(hash) : files.partial(hash);
                if (upload) files.require(hash,total);
                else if (files.object(hash).isFile()) { files.require(hash,total); return obj("blobHash",hash,"verifiedBytes",total,"complete",true); }
                JSONObject progress = database.get("transfer_progress",(upload?"up:":"down:")+hash);
                if(upload && progress!=null && progress.getBoolean("complete"))return progress;
                long durable = progress == null ? 0 : progress.getLong("verifiedBytes");
                if (offset != durable) throw new IOException("invalid-offset");
                // Crash after file fsync but before progress commit: discard only unacknowledged staging suffix.
                if (!upload && file.length() > durable) try (RandomAccessFile part=new RandomAccessFile(file,"rw")) { part.setLength(durable); part.getFD().sync(); }
            }
            long next = upload ? remote.uploadChunk(hash,total,offset,file) : remote.downloadChunk(hash,total,offset,file);
            synchronized (this) {
                ready(); boolean complete = next==total;
                if (complete && !upload) files.publish(file,hash,total);
                JSONObject progress=obj("blobHash",hash,"verifiedBytes",next,"complete",complete);
                database.put("transfer_progress",(upload?"up:":"down:")+hash,progress); return progress;
            }
        }
    }
    public synchronized JSONArray transferProgress() throws Exception { ready(); return database.all("transfer_progress"); }
    public synchronized JSONArray history(String entryId)throws Exception {
        ready();identifier(entryId);JSONArray all=database.all("versions"),result=new JSONArray();Set<String> seen=new HashSet<>();
        for(int i=0;i<all.length();i++){JSONObject v=all.getJSONObject(i);if(v.getString("entryId").equals(entryId)&&seen.add(v.toString()))result.put(v);}
        return result;
    }
    public synchronized JSONObject readVersion(JSONObject requested)throws Exception {
        ready();JSONObject v=version(requested);if(v==null || !v.getString("kind").equals("note") || v.getBoolean("deleted") || size(v)>MAX_TEXT)throw new IOException("native-stream-required");
        JSONArray history=history(v.getString("entryId"));boolean found=false;
        for(int i=0;i<history.length();i++)if(sameVersion(history.getJSONObject(i),v))found=true;
        if(!found)throw new IOException("unknown-version");require(v);
        ByteArrayOutputStream out=new ByteArrayOutputStream();try(InputStream in=new FileInputStream(files.object(v.getString("blobHash")))){byte[] b=new byte[8192];int n;while((n=in.read(b))!=-1)out.write(b,0,n);}
        return obj("version",v,"content",out.toString("UTF-8"));
    }
    public void exportBlob(JSONObject blob,OutputStream output)throws Exception {
        final File object;synchronized(this){ready();long size=size(blob);files.require(blob.getString("blobHash"),size);object=files.object(blob.getString("blobHash"));}
        try(InputStream in=new FileInputStream(object)){byte[] b=new byte[65536];int n;while((n=in.read(b))!=-1)output.write(b,0,n);}
    }
}
