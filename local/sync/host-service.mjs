import { randomUUID, createHash } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { mkdir, readdir } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { openDatabase, transaction, acquireWriter } from './database.mjs';
import { createObjectStore } from './objects.mjs';
import { publicPath, safeNativePath } from './paths.mjs';
import { scanVault } from './scan.mjs';
import { applyFileIntent, verifyFileIntent, directoryIdentity } from './file-journal.mjs';

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

export async function createHostService({ dataRoot, vaultRoot, maxFileBytes = 2 * 1024 * 1024 * 1024, getMaxFileBytes = () => maxFileBytes, interrupt = async () => {} }) {
  const currentLimit = () => {
    const value = typeof getMaxFileBytes === 'function' ? getMaxFileBytes() : NaN;
    if (!Number.isSafeInteger(value) || value < 1) throw new Error('invalid-file-limit');
    return value;
  };
  currentLimit();
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
  const context = new AsyncLocalStorage();
  const serial = work => {
    if (context.getStore()) return Promise.reject(new Error('nested-host-operation'));
    const next = queue.then(() => context.run(true, work)); queue = next.catch(() => {}); return next;
  };
  const entries = () => db.prepare('SELECT version FROM entries').all().map(parse);
  const head = id => parse(db.prepare('SELECT version FROM entries WHERE entry_id=?').get(id));
  const history = id => db.prepare('SELECT version FROM versions WHERE entry_id=? ORDER BY rowid').all(id).map(parse);
  const pendingIntents = () => db.prepare('SELECT intent FROM file_intents ORDER BY rowid').all().map(row => JSON.parse(row.intent));
  const plans = () => db.prepare('SELECT plan FROM folder_plans ORDER BY rowid').all().map(row => JSON.parse(row.plan));
  const savePlan = plan => db.prepare('INSERT OR REPLACE INTO folder_plans VALUES (?,?)').run(plan.planId, JSON.stringify(plan));
  const ownership = revision => {
    const row = db.prepare('SELECT identity FROM directory_ownership WHERE revision=?').get(revision);
    return row ? JSON.parse(row.identity) : null;
  };
  const nativeRecord = entry => db.prepare('SELECT native_path,identity FROM native_entries WHERE entry_id=?').get(entry.entryId);
  const nativeFor = entry => nativeRecord(entry)?.native_path ?? entry.path;
  const scanDiagnostics = () => db.prepare('SELECT diagnostic FROM scan_diagnostics').all().map(row => JSON.parse(row.diagnostic));
  const destinationCollision = path => {
    const key = publicPath(path).pathKey;
    return scanDiagnostics().find(d => d.code === 'path-collision' && (key === d.pathKey || key.startsWith(d.pathKey + '/')));
  };
  const nativeDestination = path => {
    if (destinationCollision(path)) throw new Error('path-collision');
    const parents = entries().filter(e => !e.deleted && e.kind === 'directory' && path.startsWith(e.path + '/')).sort((a,b) => b.path.length - a.path.length);
    return parents.length ? nativeFor(parents[0]) + path.slice(parents[0].path.length) : path;
  };
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
      for (const observed of found) {
        const { nativePath, nativeIdentity, ...file } = observed;
        const old = previous.find(e => !e.deleted && nativeFor(e) === nativePath);
        const entryId = old?.entryId ?? randomUUID();
        if (!old || old.kind !== file.kind || old.blobHash !== file.blobHash || old.byteLength !== file.byteLength
          || (nativeRecord(old)?.identity && nativeRecord(old).identity !== JSON.stringify(nativeIdentity)))
          record({ ...file, entryId, revision: randomUUID(), deleted: false });
        db.prepare('INSERT OR REPLACE INTO native_entries VALUES (?,?,?)').run(entryId, nativePath, nativeIdentity ? JSON.stringify(nativeIdentity) : null);
      }
      for (const old of previous) if (!old.deleted && !found.some(f => f.nativePath === nativeFor(old))
        && !found.diagnostics.some(d => !d.path || nativeFor(old) === d.path || nativeFor(old).startsWith(d.path + '/')))
        record({ ...old, revision: randomUUID(), blobHash: null, byteLength: 0, deleted: true });
      db.exec('DELETE FROM scan_diagnostics');
      for (const diagnostic of found.diagnostics)
        db.prepare('INSERT INTO scan_diagnostics VALUES (?,?)').run(randomUUID(), JSON.stringify(diagnostic));
      const grouped = new Map();
      for (const entry of entries().filter(e => !e.deleted)) {
        const key = publicPath(entry.path).pathKey;
        grouped.set(key, [...(grouped.get(key) ?? []), entry]);
      }
      for (const [pathKey, group] of grouped) if (group.length > 1) {
        const conflictId = `scan:${createHash('sha256').update(group.map(e => e.revision).sort().join(':')).digest('hex')}`;
        const value = { conflictId, entryId: group[0].entryId, base: null, local: group[0], remote: group[1], reason: 'path-collision' };
        db.prepare('INSERT OR IGNORE INTO conflicts VALUES (?,?)').run(conflictId, JSON.stringify(value));
        db.prepare('INSERT INTO scan_diagnostics VALUES (?,?)').run(conflictId, JSON.stringify({ code: 'path-collision', path: group[0].path,
          pathKey, conflictId, entryIds: group.map(e => e.entryId), nativePaths: group.map(nativeFor) }));
      }
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
  async function checkPrecondition(operation, precondition) {
    if (!precondition) return;
    try {
      const verdict = await precondition({ operation: structuredClone(operation), current: head(operation.entryId) });
      if (verdict === false || typeof verdict === 'string' || verdict?.errorCode || verdict?.allowed === false)
        throw new Error(typeof verdict === 'string' ? verdict : verdict?.errorCode || 'precondition-denied');
    } catch (error) { error.preconditionDenied = true; throw error; }
  }
  async function finish(intent, precondition) {
    await applyFileIntent({ vaultRoot, objects, intent, interrupt, beforeTransition: async () => {
      try {
        if (intent.desired.byteLength > currentLimit()) throw new Error('file-too-large');
        await checkPrecondition(intent.operation, precondition);
        if (intent.requiresAuthorization) {
          intent.authorized = true;
          db.prepare('UPDATE file_intents SET intent=? WHERE intent_id=?').run(JSON.stringify(intent), intent.intentId);
        }
      } catch (error) { error.preconditionDenied = true; throw error; }
    } });
    await interrupt('before-commit');
    await verifyFileIntent({ vaultRoot, intent });
    const owned = intent.desired.kind === 'directory' && !intent.desired.deleted
      ? await directoryIdentity(await safeNativePath(vaultRoot, intent.desiredNativePath ?? intent.desired.path)) : null;
    const result = { opId: intent.operation.opId, status: 'applied', confirmed: intent.desired };
    transaction(db, () => {
      if (intent.scaffold) record({ ...intent.scaffold, revision: randomUUID(), deleted: true });
      record(intent.desired); remember(intent.operation, result);
      db.prepare('INSERT OR REPLACE INTO native_entries VALUES (?,?,?)').run(intent.desired.entryId,
        intent.desiredNativePath ?? intent.desired.path, owned ? JSON.stringify(owned) : null);
      if (owned) db.prepare('INSERT INTO directory_ownership VALUES (?,?)').run(intent.desired.revision, JSON.stringify(owned));
      db.prepare('DELETE FROM file_intents WHERE intent_id=?').run(intent.intentId);
    });
    return result;
  }
  async function recoverFiles() {
    for (const intent of pendingIntents()) {
      if (intent.requiresAuthorization && !intent.authorized) {
        db.prepare('DELETE FROM file_intents WHERE intent_id=?').run(intent.intentId);
        continue; // No filesystem transition was authorized; retry must supply a fresh callback.
      }
      try { await finish(intent); }
      catch (error) {
        if (error.preconditionDenied && error.message === 'file-too-large') {
          // The cap is checked before the first file transition. Keep both
          // objects, but require a fresh retry instead of blocking vault startup.
          db.prepare('DELETE FROM file_intents WHERE intent_id=?').run(intent.intentId);
          continue;
        }
        if (!['external-change', 'EEXIST', 'ENOTEMPTY'].includes(error.code || error.message)) throw error;
        await scan();
        conflict(intent.operation, head(intent.operation.entryId), error.code || error.message, intent.intentId);
      }
    }
  }
  async function recoverInternal() {
    await recoverFiles();
    for (const plan of plans()) if (['pending', 'blocked'].includes(plan.status)) await resumePlan(plan);
  }
  async function applyInternal(input, { precondition } = {}) {
    let op;
    try { op = validate(input, identity.vaultId); }
    catch (e) { return { opId: input?.opId ?? '', status: 'blocked', errorCode: e.message }; }
    try {
      if (precondition !== undefined && typeof precondition !== 'function') throw new Error('invalid-precondition');
      await recoverFiles();
      const prior = db.prepare('SELECT operation,result FROM applied_ops WHERE replica_id=? AND op_id=?').get(op.replicaId, op.opId);
      if (prior) {
        if (prior.operation !== JSON.stringify(op)) return { opId: op.opId, status: 'blocked', errorCode: 'op-id-reused' };
        const result = JSON.parse(prior.result);
        return result.status === 'applied' ? { ...result, status: 'already-applied' } : result;
      }
      // Replay is unconditional, but every new operation must pass policy before
      // scan/dependency/conflict handling can persist new durable state.
      await checkPrecondition(op, precondition);
      if (op.after?.byteLength > currentLimit()) throw new Error('file-too-large');
      if (op.after?.blobHash) await objects.verify(op.after);
      await interrupt('after-object');
      for (const dependency of op.dependsOn) {
        const row = db.prepare('SELECT result FROM applied_ops WHERE replica_id=? AND op_id=?').get(op.replicaId, dependency);
        if (!row || JSON.parse(row.result).status !== 'applied') return { opId: op.opId, status: 'blocked', errorCode: 'dependency-not-applied' };
      }
      await scan(); // All real files are captured before checking the conditional revision.
      const current = head(op.entryId);
      const relevantPaths = [current && nativeFor(current), op.after?.path].filter(Boolean);
      const diagnostic = scanDiagnostics().find(d => d.code !== 'path-collision' && relevantPaths.some(p => !d.path || p === d.path || p.startsWith(d.path + '/')));
      if (diagnostic) throw Object.assign(new Error(diagnostic.code), { code: diagnostic.code });
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
        if (destinationCollision(desired.path)) return conflict(op, current, 'path-collision');
        const collision = entries().find(e => !e.deleted && e.entryId !== op.entryId && publicPath(e.path).pathKey === publicPath(desired.path).pathKey);
        if (collision) return conflict(op, collision, 'path-collision');
      }
      if (current?.kind === 'directory' && ['move', 'rmdir'].includes(op.kind)
        && (await readdir(await safeNativePath(vaultRoot, nativeFor(current)))).length) return conflict(op, current, 'directory-not-empty');
      const desiredNativePath = current && (desired.deleted || op.kind === 'put') ? nativeFor(current) : nativeDestination(desired.path);
      await safeNativePath(vaultRoot, desiredNativePath);
      const intent = { intentId: randomUUID(), operation: op, before: current, desired, beforeNativePath: current ? nativeFor(current) : null,
        desiredNativePath, requiresAuthorization: Boolean(precondition), authorized: false };
      if (current?.kind === 'directory' && !current.deleted) intent.directorySource = await directoryIdentity(await safeNativePath(vaultRoot, nativeFor(current)));
      db.prepare('INSERT INTO file_intents VALUES (?,?)').run(intent.intentId, JSON.stringify(intent));
      await interrupt('after-intent');
      return await finish(intent, precondition);
    } catch (error) {
      if (error.message.startsWith('interrupted:')) throw error;
      if (error.preconditionDenied) {
        for (const pending of pendingIntents()) if (pending.operation.replicaId === op.replicaId && pending.operation.opId === op.opId)
          db.prepare('DELETE FROM file_intents WHERE intent_id=?').run(pending.intentId);
      }
      return { opId: op.opId, status: 'blocked', errorCode: error.code || error.message };
    }
  }
  function requireApplied(result) {
    if (!['applied', 'already-applied'].includes(result.status)) {
      const error = new Error(`Conflict: ${result.conflict?.reason || result.errorCode}`);
      error.statusCode = result.status === 'conflict' ? 409 : 503; error.result = result; throw error;
    }
    return result;
  }
  async function resumePlan(plan) {
    if (plan.status === 'conflict' || plan.status === 'completed') return plan.result;
    while (plan.next < plan.steps.length) {
      const step = plan.steps[plan.next], op = step.operation;
      let result;
      try {
        const prior = db.prepare('SELECT result FROM applied_ops WHERE replica_id=? AND op_id=?').get(op.replicaId, op.opId);
        if (prior) result = JSON.parse(prior.result);
        else if (!step.scaffoldId) result = await applyInternal(op);
        else {
          await scan();
          const current = head(op.entryId), scaffold = head(step.scaffoldId);
          const originalOwnership = scaffold && ownership(scaffold.revision);
          if (current?.revision !== op.baseRevision || !scaffold || scaffold.deleted || !originalOwnership
            || JSON.stringify(await directoryIdentity(await safeNativePath(vaultRoot, nativeFor(scaffold)))) !== JSON.stringify(originalOwnership)
            || (await readdir(await safeNativePath(vaultRoot, nativeFor(current)))).length) {
            result = conflict(op, current, 'directory-not-empty-or-changed');
          } else {
            const intent = { intentId: randomUUID(), operation: op, before: current,
              desired: { ...op.after, entryId: op.entryId, revision: randomUUID(), deleted: false },
              scaffold, directorySource: step.directorySource, scaffoldIdentity: originalOwnership,
              beforeNativePath: nativeFor(current), desiredNativePath: nativeFor(scaffold) };
            db.prepare('INSERT INTO file_intents VALUES (?,?)').run(intent.intentId, JSON.stringify(intent));
            await interrupt('after-intent');
            result = await finish(intent);
          }
        }
      } catch (error) {
        if (error.message.startsWith('interrupted:')) throw error;
        result = { opId: op.opId, status: 'blocked', errorCode: error.code || error.message };
      }
      if (!['applied', 'already-applied'].includes(result.status)) {
        plan.status = result.status; plan.result = result; savePlan(plan); return result;
      }
      plan.next++; plan.result = result; plan.status = 'pending'; savePlan(plan);
      await interrupt('after-plan-step');
    }
    plan.status = 'completed'; savePlan(plan); return plan.result;
  }
  async function mutate({ kind, path, newPath, content, blob, expectedRevision, createOnly = false }) {
    const requestedNativePath = path.replace(/\\/g, '/');
    path = publicPath(path).path;
    if (newPath) newPath = publicPath(newPath).path;
    await recoverInternal(); await scan();
    const destination = kind === 'move' ? newPath : ['put', 'mkdir'].includes(kind) ? path : null;
    if (destination && destinationCollision(destination))
      throw Object.assign(new Error('Conflict: path-collision'), { statusCode: 409 });
    const previousPlan = plans().find(p => p.kind === kind && p.path === path && p.newPath === (newPath ?? null)
      && (p.status !== 'completed' || !entries().some(e => !e.deleted && e.path === path)));
    if (previousPlan) return requireApplied(await resumePlan(previousPlan));
    const initial = entries().filter(e => !e.deleted);
    const current = initial.find(e => nativeFor(e) === requestedNativePath) ?? initial.find(e => e.path === path);
    const replicaId = identity.serverId;
    const operation = (action, before, after) => ({ vaultId: identity.vaultId, replicaId, opId: randomUUID(),
      entryId: before?.entryId ?? randomUUID(), kind: action, baseRevision: before?.revision ?? null, after, dependsOn: [] });
    const run = async op => requireApplied(await applyInternal(op));
    const pathKey = publicPath(path).pathKey;
    const ambiguous = scanDiagnostics().find(d => d.code === 'path-collision'
      && (d.pathKey === pathKey || pathKey.startsWith(d.pathKey + '/') || current?.kind === 'directory' && d.pathKey.startsWith(pathKey + '/')));
    if (ambiguous) throw Object.assign(new Error('Conflict: path-collision'), { statusCode: 409 });
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
    const plan = { planId: randomUUID(), kind, path, newPath: newPath ?? null, status: 'pending', next: 0, steps: [] };
    const add = (op, extra = {}) => {
      if (plan.steps.length) op.dependsOn = [plan.steps.at(-1).operation.opId];
      plan.steps.push({ operation: validate(op, identity.vaultId), ...extra });
      return op;
    };
    if (kind === 'move') {
      const segments = newPath.split('/'); segments.pop(); let parent = '';
      for (const segment of segments) {
        parent = parent ? `${parent}/${segment}` : segment;
        if (!initial.some(e => e.path === parent)) add(operation('mkdir', null, { path: parent, kind: 'directory', blobHash: null, byteLength: 0 }));
      }
      scaffolds.set(newPath, add(operation('mkdir', null, { path: newPath, kind: 'directory', blobHash: null, byteLength: 0 })).entryId);
      for (const child of children.filter(e => e.kind === 'directory').sort((a,b) => a.path.length - b.path.length)) {
        const target = newPath + child.path.slice(path.length);
        scaffolds.set(target, add(operation('mkdir', null, { path: target, kind: 'directory', blobHash: null, byteLength: 0 })).entryId);
      }
    }
    for (const child of children.filter(e => e.kind !== 'directory'))
      add(operation(kind, child, kind === 'move' ? { ...child, path: newPath + child.path.slice(path.length) } : null));
    for (const directory of [...children.filter(e => e.kind === 'directory'), current].sort((a,b) => b.path.length - a.path.length)) {
      if (kind !== 'move') { add(operation('rmdir', directory, null)); continue; }
      const target = newPath + directory.path.slice(path.length);
      add(operation('move', directory, { ...directory, path: target }), { scaffoldId: scaffolds.get(target),
        directorySource: await directoryIdentity(await safeNativePath(vaultRoot, nativeFor(directory))) });
    }
    savePlan(plan); // Entire immutable child set, bases and dependencies precede any child mutation.
    await interrupt('after-plan');
    return requireApplied(await resumePlan(plan));
  }
  const service = { ...identity, epoch, root, objects, history, pendingIntents, scanDiagnostics,
    pendingPlans: () => plans().filter(p => p.status !== 'completed'),
    hello: async () => ({ protocol: 1, ...identity, epoch, maxFileBytes: currentLimit(), chunkBytes: 1048576 }),
    read: callback => serial(async () => { await recoverInternal(); return callback(); }),
    mutate: input => serial(() => mutate(input)),
    apply: (op, options) => serial(async () => { await recoverInternal(); return applyInternal(op, options); }),
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
