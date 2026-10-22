import { randomUUID } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import { join, basename, extname } from 'node:path';
import { openDatabase, transaction, acquireWriter } from './database.mjs';
import { createObjectStore } from './objects.mjs';
import { applyFileIntent, matches, verifyFileIntent, directoryIdentity } from './file-journal.mjs';
import { publicPath, safePath } from './paths.mjs';
import { check, profileValue, configValue, requestValue, batchValue, resultValue, resolutionValue } from './replica-validation.mjs';

const clone = value => structuredClone(value);
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const sameContent = (a, b) => (!a || a.deleted) && (!b || b.deleted) || a && b && ['path', 'kind', 'blobHash', 'byteLength', 'deleted'].every(key => a[key] === b[key]);

/** One native writer per replica. Every public read joins the mutation queue. */
export async function createReplicaService({ userData, profile, interrupt = async () => {} }) {
  profileValue(profile); profile = clone(profile);
  const root = join(userData, 'sync', 'replicas', profile.vaultId, profile.replicaId);
  const workingRoot = join(root, 'working');
  await mkdir(workingRoot, { recursive: true }); await mkdir(join(root, 'staging'), { recursive: true });
  const release = acquireWriter(join(root, 'writer.sqlite'));
  let db;
  try {
    db = openDatabase(join(root, 'replica.sqlite'));
    db.exec('CREATE TABLE IF NOT EXISTS replica_state (id INTEGER PRIMARY KEY, state TEXT NOT NULL); CREATE TABLE IF NOT EXISTS replica_resolutions (id TEXT PRIMARY KEY, value TEXT NOT NULL)');
    const existing = db.prepare('SELECT state FROM replica_state WHERE id=1').get();
    let state = existing ? JSON.parse(existing.state) : { schema: 1, profile, cursor: null, epoch: null, initialCopy: null, snapshotComplete: false, entries: {}, prepared: {}, acknowledgments: {}, conflicts: {}, lastSuccessfulSync: null, errorCode: null };
    check(state.schema === 1, 'unsupported-schema');
    identity(profile);
    const objects = await createObjectStore(join(root, 'objects'));
    let queue = Promise.resolve(), closed = false;
    function identity(p) { check(['vaultId', 'replicaId', 'serverId', 'origin'].every(k => state.profile[k] === p[k]), 'replica-identity-mismatch'); }
    function remember(v) {
      if (v) db.prepare('INSERT OR IGNORE INTO versions(revision,entry_id,version) VALUES(?,?,?)').run(v.revision, v.entryId, JSON.stringify(v));
    }
    function commit(next, intentId) {
      transaction(db, () => {
        for (const e of Object.values(next.entries)) { remember(e.base); remember(e.local); }
        for (const c of Object.values(next.conflicts)) {
          remember(c.base); remember(c.local); remember(c.remote);
          db.prepare('INSERT OR IGNORE INTO conflicts(conflict_id,conflict) VALUES(?,?)').run(c.conflictId, JSON.stringify(c));
        }
        db.prepare('INSERT OR REPLACE INTO replica_state(id,state) VALUES(1,?)').run(JSON.stringify(next));
        if (intentId) db.prepare('DELETE FROM file_intents WHERE intent_id=?').run(intentId);
      }); state = next;
    }
    async function recover() {
      for (const row of db.prepare('SELECT intent FROM file_intents ORDER BY rowid').all()) {
        const intent = JSON.parse(row.intent);
        for (const file of intent.files) await applyFileIntent({ vaultRoot: workingRoot, objects, intent: file, interrupt });
        await interrupt('before-commit');
        for (const file of intent.files) await verifyFileIntent({ vaultRoot: workingRoot, intent: file });
        commit(intent.next, intent.intentId);
      }
    }
    async function transition(next, files = []) {
      for (const file of files) {
        if (file.desired.blobHash) await objects.verify(file.desired);
        const prior = file.before;
        if (prior && !prior.deleted) check(await matches(await safePath(workingRoot, prior.path), prior), 'external-change');
        if (prior?.kind === 'directory' && !prior.deleted) file.directorySource = await directoryIdentity(await safePath(workingRoot, prior.path));
      }
      // Reject all name collisions before installing any portion of a batch.
      const keys = new Set();
      for (const e of Object.values(next.entries)) if (e.local && !e.local.deleted) {
        const key = publicPath(e.local.path).pathKey; check(!keys.has(key), 'path-collision'); keys.add(key);
      }
      if (!files.length) { commit(next); return; }
      const intentId = randomUUID();
      const intent = { intentId, next, files: files.map(f => ({ ...f, intentId: randomUUID() })) };
      db.prepare('INSERT INTO file_intents(intent_id,intent) VALUES(?,?)').run(intentId, JSON.stringify(intent));
      await interrupt('after-intent'); await recover();
    }
    await recover(); if (!existing) commit(state);
    function run(fn) {
      const result = queue.then(async () => { check(!closed, 'replica-closed'); await recover(); return fn(); });
      queue = result.catch(() => {}); return result;
    }
    function dirty(e) { return !sameContent(e.base, e.local); }
    function status() {
      const pendingCount = Object.values(state.entries).filter(e => dirty(e) || Object.values(state.prepared).some(p => p.operation.entryId === e.local?.entryId)).length;
      const conflictCount = Object.keys(state.conflicts).length;
      return { phase: state.errorCode ? 'blocked' : conflictCount ? 'conflicts' : !state.snapshotComplete ? 'initial-copy' : pendingCount && state.profile.mode === 'manual' ? 'waiting-manual' : 'offline', localSaved: true, pendingCount, conflictCount, snapshotComplete: state.snapshotComplete, lastSuccessfulSync: state.lastSuccessfulSync, errorCode: state.errorCode };
    }
    function snapshot() { return clone({ profile: state.profile, cursor: state.cursor, epoch: state.epoch, initialCopy: state.initialCopy, status: status(), conflicts: Object.values(state.conflicts), entries: Object.values(state.entries) }); }
    function localChange(next, before, desired, base = undefined) {
      const previous = next.entries[desired.entryId];
      next.entries[desired.entryId] = { base: base === undefined ? previous?.base ?? null : base, local: desired, localHead: randomUUID() };
      return { before, desired };
    }
    function parents(next, path, files) {
      const parts = path.split('/'); parts.pop();
      for (let i = 1; i <= parts.length; i++) {
        const parent = parts.slice(0, i).join('/'); const key = publicPath(parent).pathKey;
        const existing = Object.values(next.entries).find(e => e.local && !e.local.deleted && publicPath(e.local.path).pathKey === key);
        if (existing) { check(existing.local.kind === 'directory', 'path-collision'); continue; }
        const desired = { entryId: randomUUID(), kind: 'directory', path: parent, revision: randomUUID(), blobHash: null, byteLength: 0, deleted: false };
        files.push(localChange(next, null, desired));
      }
    }
    function find(path) { const key = publicPath(path).pathKey; return Object.values(state.entries).find(e => e.local && !e.local.deleted && publicPath(e.local.path).pathKey === key); }
    async function request(url, method, body) {
      const u = requestValue(url, method, body); const route = u.pathname;
      if (route === '/api/presence' && method === 'POST') return { status: 200, data: { ok: true, lock: null } };
      if (route === '/api/state' && method === 'GET') {
        const entries = Object.values(state.entries).map(e => e.local).filter(v => v && !v.deleted);
        const item = v => ({ path: v.path, title: basename(v.path, extname(v.path)), size: v.byteLength, modified: 0 });
        const asset = v => {
          const extension = extname(v.path).slice(1).toLowerCase();
          const kind = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'svg', 'bmp', 'ico'].includes(extension) ? 'image' : ['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac'].includes(extension) ? 'audio' : ['mp4', 'webm', 'mov', 'mkv'].includes(extension) ? 'video' : extension === 'pdf' ? 'pdf' : 'file';
          return { ...item(v), title: basename(v.path), extension, kind };
        };
        entries.sort((a, b) => a.path.localeCompare(b.path, 'pt-BR'));
        return { status: 200, data: { app: 'PentaMark', protocolVersion: 6, notes: entries.filter(v => v.kind === 'note').map(item), assets: entries.filter(v => v.kind === 'asset').map(asset), folders: entries.filter(v => v.kind === 'directory').map(v => v.path), clients: 1, connections: [], locks: [], urls: [], vaultName: 'Offline' } };
      }
      if (route === '/api/config' && method === 'GET') return { status: 200, data: { vaultName: 'Offline', port: 0, openBrowser: false, maxUploadMB: 32, isHost: false, lockEditedNotes: false, cleanupUnusedAssets: false, aiBridgeEnabled: false, aiBridgeToken: '', userPermissions: {} } };
      if (!['/api/note', '/api/folder', '/api/asset'].includes(route)) return { status: 405, data: { error: 'unsupported-local-request' } };
      const path = publicPath(method === 'POST' ? body?.path : u.searchParams.get('path')).path;
      const e = find(path), before = e?.local ?? null;
      if (method === 'GET') {
        if (!before || before.kind !== 'note') return { status: 404, data: { error: 'unavailable-offline' } };
        check(before.byteLength <= 32 * 1024 * 1024, 'note-too-large'); await objects.verify(before);
        return { status: 200, data: { path: before.path, title: basename(path, extname(path)), content: await readFile(objects.path(before.blobHash), 'utf8'), revision: before.blobHash.slice(0, 20), modified: 0, size: before.byteLength } };
      }
      if (method === 'POST' && before) return { status: 409, data: { error: 'path-exists' } };
      if (['PATCH', 'DELETE'].includes(method) && !before) return { status: 404, data: { error: 'unavailable-offline' } };
      const kind = route === '/api/note' ? 'note' : route === '/api/folder' ? 'directory' : 'asset';
      check(!before || before.kind === kind, 'kind-mismatch');
      check(method !== 'PUT' || kind === 'note', 'unsupported-local-request');
      check(method !== 'POST' || kind !== 'asset', 'native-import-required');
      const next = clone(state); let desired = { ...(before || { entryId: randomUUID(), kind, path }), revision: randomUUID(), deleted: method === 'DELETE' };
      if (method === 'PUT' || method === 'POST' && kind === 'note') {
        check(typeof body?.content === 'string', 'invalid-content'); const ref = await objects.put(body.content); await interrupt('after-object');
        if (body.baseRevision != null && body.baseRevision !== before?.blobHash?.slice(0, 20)) {
          remember({ ...desired, ...ref, deleted: false });
          return { status: 409, data: { error: 'stale-local-revision', currentRevision: before?.blobHash?.slice(0, 20) ?? null } };
        }
        desired = { ...desired, ...ref };
      }
      if (method === 'PATCH') desired.path = publicPath(body?.newPath).path;
      if (desired.deleted || kind === 'directory') { desired.blobHash = null; desired.byteLength = 0; }
      // Folder children require an explicit durable decomposition; fail closed for now.
      if (kind === 'directory' && ['PATCH', 'DELETE'].includes(method)) check(!Object.values(state.entries).some(x => x.local && !x.local.deleted && x.local.path.startsWith(path + '/')), 'folder-not-empty');
      const files = []; if (!desired.deleted) parents(next, desired.path, files);
      files.push(localChange(next, before, desired)); await transition(next, files);
      return { status: method === 'POST' ? 201 : 200, data: method === 'DELETE' ? { deleted: path } : { path: desired.path, ...(desired.blobHash ? { revision: desired.blobHash.slice(0, 20) } : {}) } };
    }
    async function persistIncoming(batch) {
      batchValue(batch);
      // No disk work or metadata writes until every expected head has passed.
      for (const { decision: d, expectedLocalHead } of batch.items) {
        const id = (d.remote || d.local || d.base).entryId;
        check((state.entries[id]?.localHead ?? '') === expectedLocalHead, 'stale-local-head');
        for (const v of [d.base, d.local, d.remote]) if (v?.blobHash) await objects.verify(v);
      }
      check(!batch.epoch || !state.epoch || batch.epoch === state.epoch || batch.initialCopy, 'new-manifest-required');
      const next = clone(state), files = [];
      for (const { decision: d } of batch.items) {
        const id = (d.remote || d.local || d.base).entryId; const e = next.entries[id];
        if (d.action === 'conflict') {
          const c = { conflictId: randomUUID(), entryId: id, base: e?.base ?? d.base, local: e?.local ?? d.local, remote: d.remote, reason: d.reason };
          next.conflicts[c.conflictId] = c;
          // A new remote observation supersedes the active decision, but the
          // archived conflict and all three version objects remain in SQLite.
          for (const [key, older] of Object.entries(next.conflicts)) if (key !== c.conflictId && older.entryId === id) delete next.conflicts[key];
        } else if (d.action === 'pull' || d.action === 'converged') {
          check(d.remote, 'missing-remote');
          check(!Object.values(state.prepared).some(p => p.operation.entryId === id), 'prepared-operation-pending');
          if (d.action === 'converged') check(sameContent(e?.local, d.remote), 'invalid-convergence');
          else check(!e || sameContent(e.base, e.local), 'local-changes-require-conflict');
          files.push(localChange(next, e?.local ?? null, d.remote, d.remote));
        } else {
          check(e && equal(e.base, d.remote), 'unrepresented-remote-change');
        }
      }
      if (batch.initialCopy) {
        const p = batch.initialCopy;
        if (state.initialCopy?.snapshotToken === p.snapshotToken) check(state.initialCopy.atCursor === p.atCursor, 'snapshot-mismatch');
        next.initialCopy = p; next.snapshotComplete = p.pageCursor === null;
        if (next.snapshotComplete) next.cursor = p.atCursor;
      } else { check(state.snapshotComplete, 'initial-copy-incomplete'); next.cursor = batch.nextCursor; }
      if (batch.epoch) next.epoch = batch.epoch;
      files.sort((a, b) => {
        const rank = f => f.desired.deleted ? f.desired.kind === 'directory' ? 3 : 2 : f.desired.kind === 'directory' ? 0 : 1;
        return rank(a) - rank(b) || (a.desired.deleted ? -1 : 1) * (a.desired.path.split('/').length - b.desired.path.split('/').length);
      });
      await transition(next, files);
    }
    async function preparePending(limit) {
      check(Number.isInteger(limit) && limit > 0 && limit <= 100, 'invalid-limit');
      const next = clone(state); const result = Object.values(next.prepared).map(p => p.operation).slice(0, limit);
      const ordered = Object.entries(next.entries).sort(([, a], [, b]) => a.local.path.split('/').length - b.local.path.split('/').length);
      for (const [id, e] of ordered) {
        if (result.length >= limit) break;
        if (!dirty(e) || Object.values(next.prepared).some(p => p.operation.entryId === id) || Object.values(next.conflicts).some(c => c.entryId === id)) continue;
        const v = e.local; if (v.blobHash) await objects.verify(v);
        const kind = v.deleted ? v.kind === 'directory' ? 'rmdir' : 'delete' : e.base && e.base.path !== v.path && e.base.blobHash === v.blobHash ? 'move' : v.kind === 'directory' ? 'mkdir' : 'put';
        const operation = { vaultId: profile.vaultId, replicaId: profile.replicaId, opId: randomUUID(), entryId: id, kind, baseRevision: e.base?.revision ?? null, after: v.deleted ? null : { path: v.path, kind: v.kind, blobHash: v.blobHash, byteLength: v.byteLength }, dependsOn: [] };
        if (!v.deleted) for (const p of Object.values(next.prepared)) {
          if (p.operation.after?.kind === 'directory' && v.path.startsWith(p.operation.after.path + '/')) operation.dependsOn.push(p.operation.opId);
        }
        next.prepared[operation.opId] = { operation, localHead: e.localHead, local: v }; result.push(operation);
      }
      commit(next); return clone(result);
    }
    async function confirm(result) {
      resultValue(result); const pending = state.prepared[result.opId];
      if (!pending) { check(state.acknowledgments[result.opId], 'unknown-operation'); return; }
      const next = clone(state), id = pending.operation.entryId, e = next.entries[id];
      if (result.status === 'blocked') { next.errorCode = result.errorCode || 'remote-blocked'; commit(next); return; }
      if (result.status === 'conflict') {
        check(result.conflict.entryId === id, 'wrong-entry');
        for (const v of [result.conflict.base, result.conflict.local, result.conflict.remote]) if (v?.blobHash) await objects.verify(v);
        next.conflicts[result.conflict.conflictId] = { ...result.conflict, local: e.local };
      } else {
        check(result.confirmed.entryId === id && sameContent(result.confirmed, pending.local), 'invalid-confirmation');
        e.base = result.confirmed;
        if (e.localHead === pending.localHead) e.local = result.confirmed;
      }
      next.acknowledgments[result.opId] = result; delete next.prepared[result.opId]; next.errorCode = null; commit(next);
    }
    async function resolve(input) {
      resolutionValue(input);
      const c = state.conflicts[input.conflictId]; check(c, 'unknown-conflict');
      let merged;
      if (input.choice === 'merged') {
        merged = await objects.put(input.mergedContent);
        db.prepare('INSERT INTO replica_resolutions(id,value) VALUES(?,?)').run(randomUUID(), JSON.stringify({ ...input, mergedContent: undefined, ...merged }));
      }
      const e = state.entries[c.entryId];
      check(e?.localHead === input.expectedLocalHead && (c.remote?.revision ?? null) === input.expectedRemoteRevision, 'stale-conflict-resolution');
      check(!Object.values(state.prepared).some(p => p.operation.entryId === c.entryId), 'prepared-operation-pending');
      const next = clone(state), files = [];
      let desired = clone(input.choice === 'remote' ? c.remote : e.local);
      check(desired, 'missing-resolution-version');
      if (input.choice === 'merged') { check(desired.kind === 'note', 'merge-not-text'); desired = { ...desired, ...merged, deleted: false }; }
      if (input.choice === 'keep-both') {
        check(!e.local.deleted, 'missing-local-version');
        const copy = { ...e.local, entryId: randomUUID(), revision: randomUUID(), path: `${e.local.path}.conflict-${randomUUID()}` };
        files.push(localChange(next, null, copy, null)); desired = c.remote;
        check(desired, 'missing-remote');
      }
      desired = { ...desired, revision: input.choice === 'remote' || input.choice === 'keep-both' ? desired.revision : randomUUID() };
      files.push(localChange(next, e.local, desired, c.remote)); delete next.conflicts[c.conflictId];
      await transition(next, files);
    }
    return {
      root, workingRoot, objects,
      open: p => run(() => { profileValue(p); identity(p); return status(); }),
      configure: config => run(() => { configValue(config); const next = clone(state); Object.assign(next.profile, config); commit(next); return status(); }),
      request: (...args) => run(() => request(...args)), snapshot: () => run(snapshot),
      preparePending: limit => run(() => preparePending(limit)), persistIncoming: batch => run(() => persistIncoming(clone(batch))),
      confirm: result => run(() => confirm(clone(result))), resolve: input => run(() => resolve(clone(input))),
      retainedResolutions: () => db.prepare('SELECT value FROM replica_resolutions').all().map(row => JSON.parse(row.value)),
      close: async () => { await queue; if (!closed) { closed = true; db.close(); release(); } },
    };
  } catch (error) { db?.close(); release(); throw error; }
}
