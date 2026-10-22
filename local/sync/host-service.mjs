import { randomUUID } from 'node:crypto';
import { mkdir, readdir } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { openDatabase, transaction, acquireWriter } from './database.mjs';
import { createObjectStore } from './objects.mjs';
import { publicPath, safePath } from './paths.mjs';
import { scanVault } from './scan.mjs';
import { applyFileIntent } from './file-journal.mjs';

const parse = row => row ? JSON.parse(row.version) : null;
const text = value => typeof value === 'string' && value.length > 0 && value.length <= 512;
function validate(operation, vaultId) {
  if (!operation || !['vaultId', 'replicaId', 'opId', 'entryId'].every(k => text(operation[k]))) throw new Error('invalid-operation');
  if (operation.vaultId !== vaultId) throw new Error('wrong-vault');
  if (!['put', 'move', 'delete', 'mkdir', 'rmdir'].includes(operation.kind)
    || !(operation.baseRevision === null || text(operation.baseRevision))
    || !Array.isArray(operation.dependsOn) || !operation.dependsOn.every(text)
    || operation.dependsOn.includes(operation.opId)) throw new Error('invalid-operation');
  const a = operation.after;
  if (['delete', 'rmdir'].includes(operation.kind)) {
    if (a !== null || operation.baseRevision === null) throw new Error('invalid-operation');
  } else {
    if (!a || !['note', 'asset', 'directory'].includes(a.kind)
      || !Number.isSafeInteger(a.byteLength) || a.byteLength < 0) throw new Error('invalid-operation');
    if (publicPath(a.path).path !== a.path) throw new Error('noncanonical-path');
    if (a.kind === 'directory' ? a.blobHash !== null || a.byteLength !== 0 : !/^[a-f0-9]{64}$/.test(a.blobHash)) throw new Error('invalid-blob');
    if (operation.kind === 'mkdir' && (a.kind !== 'directory' || operation.baseRevision !== null)
      || operation.kind === 'put' && a.kind === 'directory'
      || operation.kind === 'move' && operation.baseRevision === null) throw new Error('invalid-operation');
  }
  // Canonical wire fields make replay independent of JSON key ordering; no mutable extras.
  return { vaultId: operation.vaultId, replicaId: operation.replicaId, opId: operation.opId, entryId: operation.entryId,
    kind: operation.kind, baseRevision: operation.baseRevision,
    after: a === null ? null : { path: a.path, kind: a.kind, blobHash: a.blobHash, byteLength: a.byteLength }, dependsOn: [...operation.dependsOn] };
}

export async function createHostService({ dataRoot, vaultRoot, maxFileBytes = 2 * 1024 * 1024 * 1024, interrupt = async () => {} }) {
  if (!Number.isSafeInteger(maxFileBytes) || maxFileBytes < 1) throw new Error('invalid-file-limit');
  vaultRoot = resolve(vaultRoot);
  const privateRoot = resolve(dataRoot, 'sync');
  if (privateRoot === vaultRoot || privateRoot.startsWith(vaultRoot + sep)) throw new Error('private-store-inside-vault');
  await mkdir(privateRoot, { recursive: true });
  await mkdir(vaultRoot, { recursive: true });
  const registry = openDatabase(join(privateRoot, 'host-registry.sqlite'));
  registry.exec('CREATE TABLE IF NOT EXISTS host_paths (path TEXT PRIMARY KEY, vault_id TEXT NOT NULL); CREATE TABLE IF NOT EXISTS installation (server_id TEXT NOT NULL)');
  const identity = transaction(registry, () => {
    let serverId = registry.prepare('SELECT server_id FROM installation').get()?.server_id;
    if (!serverId) { serverId = randomUUID(); registry.prepare('INSERT INTO installation VALUES (?)').run(serverId); }
    let vaultId = registry.prepare('SELECT vault_id FROM host_paths WHERE path=?').get(vaultRoot)?.vault_id;
    if (!vaultId) { vaultId = randomUUID(); registry.prepare('INSERT INTO host_paths VALUES (?,?)').run(vaultRoot, vaultId); }
    return { vaultId, serverId };
  });
  registry.close();
  const root = join(privateRoot, 'hosts', identity.vaultId);
  await mkdir(root, { recursive: true });
  const releaseWriter = acquireWriter(join(root, 'writer.sqlite'));
  const db = openDatabase(join(root, 'store.sqlite'));
  db.prepare('INSERT OR IGNORE INTO vaults VALUES (?,?,?)').run(identity.vaultId, identity.serverId, randomUUID());
  const epoch = db.prepare('SELECT epoch FROM vaults').get().epoch;
  const objects = await createObjectStore(join(root, 'objects'));
  let queue = Promise.resolve();
  let closed = false;
  const serial = work => { const next = queue.then(work); queue = next.catch(() => {}); return next; };
  const entries = () => db.prepare('SELECT version FROM entries').all().map(parse);
  const head = id => parse(db.prepare('SELECT version FROM entries WHERE entry_id=?').get(id));
  const history = id => db.prepare('SELECT version FROM versions WHERE entry_id=? ORDER BY rowid').all(id).map(parse);
  const pendingIntents = () => db.prepare('SELECT intent FROM file_intents ORDER BY rowid').all().map(row => JSON.parse(row.intent));
  const cursor = () => `${epoch}:${db.prepare('SELECT CAST(COALESCE(MAX(sequence),0) AS TEXT) AS n FROM change_log').get().n}`;
  function record(version) {
    db.prepare('INSERT INTO versions VALUES (?,?,?)').run(version.revision, version.entryId, JSON.stringify(version));
    db.prepare('INSERT OR REPLACE INTO entries VALUES (?,?,?)').run(version.entryId, publicPath(version.path).pathKey, JSON.stringify(version));
    db.prepare('INSERT INTO change_log(version) VALUES (?)').run(JSON.stringify(version));
  }
  async function scan() {
    const found = await scanVault(vaultRoot, objects);
    const previous = entries();
    transaction(db, () => {
      for (const file of found) {
        const old = previous.find(e => !e.deleted && e.path === file.path);
        if (!old || old.kind !== file.kind || old.blobHash !== file.blobHash || old.byteLength !== file.byteLength)
          record({ ...file, entryId: old?.entryId ?? randomUUID(), revision: randomUUID(), deleted: false });
      }
      for (const old of previous) if (!old.deleted && !found.some(f => f.path === old.path))
        record({ ...old, revision: randomUUID(), blobHash: null, byteLength: 0, deleted: true });
    });
  }
  function remember(op, result) {
    db.prepare('INSERT INTO applied_ops VALUES (?,?,?,?)').run(op.replicaId, op.opId, JSON.stringify(op), JSON.stringify(result));
  }
  function conflict(op, current, reason, intentId) {
    const base = op.baseRevision === null ? null : parse(db.prepare('SELECT version FROM versions WHERE revision=? AND entry_id=?').get(op.baseRevision, op.entryId));
    const local = op.after ? { ...op.after, entryId: op.entryId, revision: `incoming:${op.opId}`, deleted: false }
      : base ? { ...base, revision: `incoming:${op.opId}`, deleted: true, blobHash: null, byteLength: 0 } : null;
    const value = { conflictId: randomUUID(), entryId: op.entryId, base, local, remote: current, reason };
    const result = { opId: op.opId, status: 'conflict', conflict: value };
    transaction(db, () => {
      db.prepare('INSERT INTO conflicts VALUES (?,?)').run(value.conflictId, JSON.stringify(value));
      remember(op, result);
      if (intentId) db.prepare('DELETE FROM file_intents WHERE intent_id=?').run(intentId);
    });
    return result;
  }
  async function finish(intent) {
    await applyFileIntent({ vaultRoot, objects, intent, interrupt });
    await interrupt('before-commit');
    const result = { opId: intent.operation.opId, status: 'applied', confirmed: intent.desired };
    transaction(db, () => {
      if (intent.scaffold) record({ ...intent.scaffold, revision: randomUUID(), deleted: true });
      record(intent.desired); remember(intent.operation, result);
      db.prepare('DELETE FROM file_intents WHERE intent_id=?').run(intent.intentId);
    });
    return result;
  }
  async function recoverInternal() {
    for (const intent of pendingIntents()) {
      try { await finish(intent); }
      catch (error) {
        if (!['external-change', 'EEXIST', 'ENOTEMPTY'].includes(error.code || error.message)) throw error;
        await scan();
        conflict(intent.operation, head(intent.operation.entryId), error.code || error.message, intent.intentId);
      }
    }
  }
  async function applyInternal(input) {
    let op;
    try { op = validate(input, identity.vaultId); }
    catch (e) { return { opId: input?.opId ?? '', status: 'blocked', errorCode: e.message }; }
    if (op.after?.byteLength > maxFileBytes) return { opId: op.opId, status: 'blocked', errorCode: 'file-too-large' };
    try {
      await recoverInternal();
      const prior = db.prepare('SELECT operation,result FROM applied_ops WHERE replica_id=? AND op_id=?').get(op.replicaId, op.opId);
      if (prior) {
        if (prior.operation !== JSON.stringify(op)) return { opId: op.opId, status: 'blocked', errorCode: 'op-id-reused' };
        const result = JSON.parse(prior.result);
        return result.status === 'applied' ? { ...result, status: 'already-applied' } : result;
      }
      if (op.after?.blobHash) await objects.verify(op.after);
      await interrupt('after-object');
      for (const dependency of op.dependsOn) {
        const row = db.prepare('SELECT result FROM applied_ops WHERE replica_id=? AND op_id=?').get(op.replicaId, dependency);
        if (!row || JSON.parse(row.result).status !== 'applied') return { opId: op.opId, status: 'blocked', errorCode: 'dependency-not-applied' };
      }
      await scan(); // All real files are captured before checking the conditional revision.
      const current = head(op.entryId);
      if (op.baseRevision !== (current?.revision ?? null)) return conflict(op, current, 'base-diverged');
      if (current?.deleted && op.kind !== 'put') return conflict(op, current, 'deleted-entry');
      if (current && op.after && (current.kind !== op.after.kind || op.kind === 'put' && current.path !== op.after.path))
        return conflict(op, current, 'invalid-state-transition');
      if (op.kind === 'move' && (op.after.blobHash !== current.blobHash || op.after.byteLength !== current.byteLength))
        return conflict(op, current, 'move-content-changed');
      if (op.kind === 'rmdir' && current?.kind !== 'directory' || op.kind === 'delete' && current?.kind === 'directory')
        return conflict(op, current, 'kind-mismatch');
      const desired = op.after ? { ...op.after, entryId: op.entryId, revision: randomUUID(), deleted: false }
        : { ...current, revision: randomUUID(), deleted: true, blobHash: null, byteLength: 0 };
      if (!desired.deleted) {
        const collision = entries().find(e => !e.deleted && e.entryId !== op.entryId && publicPath(e.path).pathKey === publicPath(desired.path).pathKey);
        if (collision) return conflict(op, collision, 'path-collision');
      }
      if (current?.kind === 'directory' && ['move', 'rmdir'].includes(op.kind)
        && (await readdir(await safePath(vaultRoot, current.path))).length) return conflict(op, current, 'directory-not-empty');
      await safePath(vaultRoot, desired.path);
      const intent = { intentId: randomUUID(), operation: op, before: current, desired };
      db.prepare('INSERT INTO file_intents VALUES (?,?)').run(intent.intentId, JSON.stringify(intent));
      await interrupt('after-intent');
      return await finish(intent);
    } catch (error) {
      if (error.message.startsWith('interrupted:')) throw error;
      return { opId: op.opId, status: 'blocked', errorCode: error.code || error.message };
    }
  }
  async function mutate({ kind, path, newPath, content, blob, expectedRevision, createOnly = false }) {
    path = publicPath(path).path;
    if (newPath) newPath = publicPath(newPath).path;
    await recoverInternal(); await scan();
    const initial = entries().filter(e => !e.deleted);
    const current = initial.find(e => e.path === path);
    const replicaId = identity.serverId;
    const operation = (action, before, after) => ({ vaultId: identity.vaultId, replicaId, opId: randomUUID(),
      entryId: before?.entryId ?? randomUUID(), kind: action, baseRevision: before?.revision ?? null, after, dependsOn: [] });
    const requireApplied = result => {
      if (!['applied', 'already-applied'].includes(result.status)) {
        const error = new Error(`Conflict: ${result.conflict?.reason || result.errorCode}`);
        error.statusCode = result.status === 'conflict' ? 409 : 503; error.result = result; throw error;
      }
      return result;
    };
    const run = async op => requireApplied(await applyInternal(op));
    async function parents(destination) {
      const parts = destination.split('/'); parts.pop();
      let parent = '';
      for (const part of parts) {
        parent = parent ? `${parent}/${part}` : part;
        if (!entries().some(e => !e.deleted && e.path === parent))
          await run(operation('mkdir', null, { path: parent, kind: 'directory', blobHash: null, byteLength: 0 }));
      }
    }
    if (kind === 'put') {
      const ref = blob ?? await objects.put(content);
      await objects.verify(ref);
      const after = { path, kind: path.toLowerCase().endsWith('.md') ? 'note' : 'asset', ...ref };
      const op = operation('put', createOnly ? null : current, after);
      if (createOnly && current || expectedRevision && expectedRevision !== current?.blobHash?.slice(0, 20)) {
        if (expectedRevision && current) op.baseRevision = history(current.entryId).find(e => e.blobHash?.slice(0,20) === expectedRevision)?.revision ?? null;
        requireApplied(conflict(op, current ?? null, 'legacy-base-diverged'));
      }
      if (current?.blobHash === ref.blobHash && current.byteLength === ref.byteLength)
        return { status: 'applied', confirmed: current, revision: ref.blobHash.slice(0,20), unchanged: true };
      await parents(path);
      const result = await run(op);
      return { ...result, revision: ref.blobHash.slice(0, 20) };
    }
    if (kind === 'mkdir') {
      await parents(path);
      return run(operation('mkdir', null, { path, kind: 'directory', blobHash: null, byteLength: 0 }));
    }
    if (!current) throw Object.assign(new Error('File not found'), { statusCode: 404 });
    if (kind === 'move' && (!newPath || newPath.startsWith(path + '/'))) throw new Error('invalid-destination');
    if (kind === 'move' && initial.some(e => publicPath(e.path).pathKey === publicPath(newPath).pathKey && e.entryId !== current.entryId))
      throw Object.assign(new Error('Conflict: destination exists'), { statusCode: 409 });
    if (current.kind !== 'directory') {
      if (kind === 'move') await parents(newPath);
      return run(operation(kind, current, kind === 'move' ? { ...current, path: newPath } : null));
    }
    // Capture the child set once. Each child keeps its original conditional base.
    // A later child never becomes an implicitly authorized recursive deletion.
    const children = initial.filter(e => e.path.startsWith(path + '/'));
    const scaffolds = new Map();
    if (kind === 'move') {
      await parents(newPath);
      scaffolds.set(newPath, (await run(operation('mkdir', null, { path: newPath, kind: 'directory', blobHash: null, byteLength: 0 }))).confirmed);
      for (const child of children.filter(e => e.kind === 'directory').sort((a,b) => a.path.length - b.path.length)) {
        const target = newPath + child.path.slice(path.length);
        scaffolds.set(target, (await run(operation('mkdir', null, { path: target, kind: 'directory', blobHash: null, byteLength: 0 }))).confirmed);
      }
    }
    for (const child of children.filter(e => e.kind !== 'directory'))
      await run(operation(kind, child, kind === 'move' ? { ...child, path: newPath + child.path.slice(path.length) } : null));
    for (const directory of [...children.filter(e => e.kind === 'directory'), current].sort((a,b) => b.path.length - a.path.length)) {
      if (kind !== 'move') { await run(operation('rmdir', directory, null)); continue; }
      // Only this local batch can adopt its own newly created scaffold. The wire
      // move API never gains permission to merge an arbitrary destination directory.
      const target = newPath + directory.path.slice(path.length);
      const scaffold = scaffolds.get(target);
      await scan();
      const op = operation('move', directory, { ...directory, path: target });
      if (head(directory.entryId)?.revision !== directory.revision || head(scaffold.entryId)?.revision !== scaffold.revision
        || (await readdir(await safePath(vaultRoot, directory.path))).length)
        requireApplied(conflict(op, head(directory.entryId), 'directory-not-empty-or-changed'));
      const intent = { intentId: randomUUID(), operation: validate(op, identity.vaultId), before: directory,
        desired: { ...directory, path: target, revision: randomUUID() }, scaffold };
      db.prepare('INSERT INTO file_intents VALUES (?,?)').run(intent.intentId, JSON.stringify(intent));
      await interrupt('after-intent');
      await finish(intent);
    }
    return { status: 'applied', confirmed: head(current.entryId) };
  }
  const service = { ...identity, epoch, root, objects, history, pendingIntents,
    hello: async () => ({ protocol: 1, ...identity, epoch, maxFileBytes, chunkBytes: 1048576 }),
    mutate: input => serial(() => mutate(input)),
    apply: op => serial(() => applyInternal(op)),
    recover: () => serial(recoverInternal),
    rescan: () => serial(async () => { await recoverInternal(); await scan(); }),
    openSnapshot: () => serial(async () => {
      await recoverInternal(); await scan();
      return { snapshotToken: randomUUID(), atCursor: cursor(), entries: entries(), pageCursor: null };
    }),
    readChanges: (fromCursor, limit = 100) => serial(async () => {
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 10000) throw new Error('invalid-limit');
      const value = fromCursor ?? `${epoch}:0`;
      const [providedEpoch, sequence, extra] = String(value).split(':');
      if (providedEpoch !== epoch || extra || !/^(0|[1-9][0-9]*)$/.test(sequence)
        || BigInt(sequence) > 9223372036854775807n || BigInt(sequence) > BigInt(cursor().split(':')[1])) throw new Error('invalid-cursor');
      const rows = db.prepare('SELECT CAST(sequence AS TEXT) AS n,version FROM change_log WHERE sequence>? ORDER BY sequence LIMIT ?').all(BigInt(sequence), limit);
      return { fromCursor: value, nextCursor: `${epoch}:${rows.at(-1)?.n ?? sequence}`, entries: rows.map(parse) };
    }),
    close: () => serial(() => { if (!closed) { db.close(); releaseWriter(); closed = true; } }),
  };
  try { await service.recover(); await service.rescan(); }
  catch (e) { db.close(); releaseWriter(); throw e; }
  return service;
}
