import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { createHostService } from '../local/sync/host-service.mjs';
import { createReplicaService } from '../local/sync/replica-service.mjs';
import { createSyncHandler } from '../local/sync/routes.mjs';
import { createNativeSyncTransport } from '../local/sync/transport.mjs';

const directory = await mkdtemp(join(tmpdir(), 'pm-sync-engine-'));
after(() => rm(directory, { recursive: true, force: true }));
let createSyncEngine;
if (existsSync('src/features/sync/engine.ts')) {
  await build({ entryPoints: ['src/features/sync/engine.ts'], outfile: join(directory, 'engine.mjs'), bundle: true, format: 'esm', platform: 'node' });
  ({ createSyncEngine } = await import(pathToFileURL(join(directory, 'engine.mjs')).href));
}
const clone = structuredClone;
const version = (text, revision = text) => ({ entryId: 'entry', kind: 'note', path: 'a.md', revision, blobHash: text.repeat(64).slice(0, 64), byteLength: 1, deleted: false });
function clock() {
  let now = 0, tasks = [];
  return {
    now: () => now, random: () => 0.5,
    schedule(fn, delay) { const item = { fn, at: now + delay }; tasks.push(item); return () => { tasks = tasks.filter(t => t !== item); }; },
    get delays() { return tasks.map(t => t.at - now); },
    async advance(ms) { now += ms; const due = tasks.filter(t => t.at <= now); tasks = tasks.filter(t => t.at > now); for (const t of due) t.fn(); await settle(); },
  };
}
async function settle() { for (let i = 0; i < 150; i++) await Promise.resolve(); }
function fixture(options = {}) {
  assert.equal(typeof createSyncEngine, 'function', 'shared engine must exist');
  const time = clock(), calls = [], acknowledgments = [], batches = [], sent = [];
  const state = {
    profile: { vaultId: 'vault', serverId: 'server', replicaId: 'replica', origin: 'http://fixture.test', offlineEnabled: true, mode: options.mode ?? 'manual' },
    cursor: options.initial ? null : 'epoch:0', epoch: options.initial ? null : 'epoch', initialCopy: null, preparedOperations: [], conflicts: [], entries: [],
    status: { phase: 'offline', localSaved: true, pendingCount: 0, conflictCount: 0, snapshotComplete: !options.initial, lastSuccessfulSync: null, errorCode: null },
  };
  let sequence = 0, head = 0, hostVersion = null, changes = [], failedApply = false;
  function edit(v) {
    const entry = state.entries[0]; state.entries = [{ base: entry?.base ?? null, local: v, localHead: String(++head) }];
    state.status.pendingCount = !entry?.base && v.deleted && !state.preparedOperations.length ? 0 : 1;
  }
  const replica = {
    open: async () => clone(state.status), request: async () => ({ status: 200, data: {} }), resolve: async () => {},
    snapshot: async () => clone(state),
    configure: async config => { Object.assign(state.profile, config); return clone(state.status); },
    preparePending: async () => {
      calls.push('prepare');
      if (state.preparedOperations.length) return clone(state.preparedOperations);
      if (!state.status.pendingCount || state.conflicts.length) return [];
      const e = state.entries[0], op = { vaultId: 'vault', replicaId: 'replica', opId: `op-${++sequence}`, entryId: 'entry', kind: e.local.deleted ? 'delete' : 'put', baseRevision: e.base?.revision ?? null, after: e.local.deleted ? null : { path: e.local.path, kind: 'note', blobHash: e.local.blobHash, byteLength: 1 }, dependsOn: [] };
      state.preparedOperations = [op]; return clone([op]);
    },
    persistIncoming: async batch => {
      calls.push('persist'); await options.beforePersist?.(batch, state, edit);
      for (const item of batch.items) {
        const id = (item.decision.remote ?? item.decision.local ?? item.decision.base)?.entryId;
        assert.equal(item.expectedLocalHead, state.entries.find(e => e.local?.entryId === id)?.localHead ?? '');
      }
      batches.push(clone(batch));
      for (const { decision: d } of batch.items) {
        if (d.action === 'conflict') { state.conflicts.push(d); state.status.conflictCount++; }
        if (d.action === 'pull' || d.action === 'converged') {
          if (state.preparedOperations.some(op => op.entryId === d.remote.entryId)) throw new Error('prepared-operation-pending');
          state.entries = [{ base: d.remote, local: d.remote, localHead: String(++head) }]; state.status.pendingCount = 0;
        }
      }
      if (batch.initialCopy) {
        state.initialCopy = batch.initialCopy; state.status.snapshotComplete = batch.initialCopy.pageCursor === null;
        if (state.status.snapshotComplete) state.cursor = batch.initialCopy.atCursor;
      } else state.cursor = batch.nextCursor;
      if (batch.epoch) state.epoch = batch.epoch;
    },
    confirm: async result => {
      calls.push('confirm'); acknowledgments.push(clone(result));
      if (result.status === 'blocked') return;
      const op = state.preparedOperations.find(p => p.opId === result.opId);
      if (!op) return;
      if (result.status === 'conflict') { state.conflicts.push(result.conflict); state.status.conflictCount++; }
      else {
        const e = state.entries[0]; e.base = result.confirmed;
        if ((op.after?.blobHash ?? null) === e.local.blobHash && (op.after?.path ?? e.local.path) === e.local.path) { e.local = result.confirmed; state.status.pendingCount = 0; }
      }
      state.preparedOperations = state.preparedOperations.filter(p => p.opId !== result.opId);
    },
    completeCycle: async input => {
      calls.push('complete'); await options.beforeComplete?.(state, edit);
      if (input.expectedCursor !== state.cursor || input.expectedEpoch !== state.epoch || state.status.pendingCount || state.status.conflictCount || !state.status.snapshotComplete) throw new Error('stale-cycle');
      state.status.lastSuccessfulSync = new Date(time.now()).toISOString(); state.status.phase = 'idle'; return clone(state.status);
    },
  };
  const remote = {
    handshake: async () => { calls.push('hello'); if (options.offline) throw new Error('network-offline'); return { protocol: 1, vaultId: options.vaultId ?? 'vault', serverId: 'server', epoch: options.epoch ?? 'epoch', chunkBytes: 1048576, maxFileBytes: 40 * 1048576 }; },
    snapshot: async (token, cursor) => { calls.push('snapshot'); return options.snapshot ? options.snapshot(token, cursor) : { snapshotToken: 'token', atCursor: `${options.epoch ?? 'epoch'}:0`, entries: hostVersion ? [hostVersion] : [], pageCursor: null }; },
    changes: async cursor => { calls.push('changes'); const tip = `${options.epoch ?? 'epoch'}:${changes.length}`; return options.changes ? options.changes(cursor) : { fromCursor: cursor, nextCursor: changes.length ? tip : cursor, entries: cursor === tip ? [] : clone(changes) }; },
    apply: async operations => {
      calls.push('apply'); sent.push(clone(operations));
      const results = operations.map(op => {
        hostVersion = op.after ? { ...version('a'), ...op.after, revision: `host-${op.opId}` } : { ...hostVersion, blobHash: null, byteLength: 0, deleted: true, revision: `host-${op.opId}` };
        if (!changes.some(v => v.revision === hostVersion.revision)) changes.push(hostVersion);
        return { opId: op.opId, status: 'applied', confirmed: hostVersion };
      });
      await options.duringApply?.(operations, state, edit);
      if (options.loseResponse && !failedApply) { failedApply = true; throw new Error('response-lost'); }
      return results;
    },
    downloadBlob: async blob => { calls.push('download'); await options.duringDownload?.(state, edit); return { blobHash: blob.blobHash, verifiedBytes: blob.byteLength, complete: true }; },
    uploadBlob: async blob => { calls.push('upload'); return { blobHash: blob.blobHash, verifiedBytes: blob.byteLength, complete: true }; },
  };
  const engine = createSyncEngine({ replica, remote, clock: time }); let status;
  engine.onStatus(s => { status = s; });
  return { engine, state, time, calls, batches, sent, acknowledgments, edit, options, replica, remote, get status() { return status; } };
}

test('manual boot/resume/reconnect/local change never exchange content after initial copy', async () => {
  const f = fixture(); f.edit(version('a')); await f.engine.start(); await f.engine.resume(); await f.engine.reconnect();
  f.engine.localChanged(); await f.time.advance(7 * 86400000);
  assert.ok(f.calls.every(c => c === 'hello')); assert.equal(f.state.status.pendingCount, 1);
  await f.engine.synchronizeNow(); assert.equal(f.state.status.pendingCount, 0); assert.ok(f.state.status.lastSuccessfulSync);
  f.engine.stop();
});

test('initial manifest intermediate pages do not advance cursor; final page followed by catchup', async () => {
  let f;
  f = fixture({ initial: true, snapshot: (_token, cursor) => {
    if (cursor) { assert.equal(f.state.cursor, null); return { snapshotToken: 's', atCursor: 'epoch:8', entries: [], pageCursor: null }; }
    return { snapshotToken: 's', atCursor: 'epoch:8', entries: [version('a')], pageCursor: 'next' };
  } });
  await f.engine.start();
  assert.equal(f.batches[0].initialCopy.pageCursor, 'next'); assert.equal(f.state.cursor, 'epoch:8');
  assert.ok(f.calls.indexOf('changes') > f.calls.lastIndexOf('snapshot')); assert.ok(f.state.status.lastSuccessfulSync); f.engine.stop();
});

test('automatic retries with capped fake-clock backoff after seven offline days and resumes', async () => {
  const f = fixture({ mode: 'automatic', offline: true }); f.edit(version('a')); await f.engine.start();
  for (const delay of [1000, 2000, 4000, 8000, 16000, 30000, 30000]) { assert.deepEqual(f.time.delays, [delay]); await f.time.advance(delay); }
  f.engine.stop(); await f.time.advance(7 * 86400000); f.options.offline = false;
  await f.engine.start(); assert.equal(f.state.status.pendingCount, 0); assert.ok(f.state.status.lastSuccessfulSync); f.engine.stop();
});

test('automatic local-change debounce waits one second and click joins active cycle', async () => {
  let release, entered; const ready = new Promise(resolve => { entered = resolve; });
  const f = fixture({ mode: 'automatic', duringApply: async () => { entered(); await new Promise(resolve => { release = resolve; }); } });
  await f.engine.start(); f.calls.length = 0; f.edit(version('a')); f.engine.localChanged();
  await f.time.advance(999); assert.equal(f.sent.length, 0); await f.time.advance(1); await ready;
  const click = f.engine.synchronizeNow(); release(); await click;
  assert.equal(f.sent.length, 1); f.engine.stop();
});

test('lost ACK replays same prepared op after engine restart before receiving its committed change', async () => {
  const f = fixture({ loseResponse: true }); f.edit(version('a')); await f.engine.synchronizeNow();
  assert.equal(f.state.preparedOperations.length, 1); assert.equal(f.state.status.lastSuccessfulSync, null);
  f.engine.stop(); const restarted = createSyncEngine({ replica: f.replica, remote: f.remote, clock: f.time });
  await restarted.synchronizeNow(); assert.deepEqual(f.sent[1], f.sent[0]);
  assert.equal(f.state.status.pendingCount, 0); assert.ok(f.state.status.lastSuccessfulSync); restarted.stop();
});

test('ACK A never clears edited B; mode change during apply stops subsequent content', async () => {
  let f; f = fixture({ mode: 'automatic', duringApply: async () => { f.edit(version('b')); await f.engine.setMode('manual'); } });
  f.edit(version('a')); await f.engine.start();
  assert.equal(f.state.entries[0].local.blobHash, 'b'.repeat(64)); assert.equal(f.state.status.pendingCount, 1);
  assert.equal(f.acknowledgments.length, 1); assert.equal(f.sent.length, 1); assert.equal(f.state.status.lastSuccessfulSync, null);
  await f.time.advance(100000); assert.equal(f.sent.length, 1); f.engine.stop();
});

test('stale local head retries the decision with edited local content and preserves conflict', async () => {
  let stale = true;
  const f = fixture({ initial: true, snapshot: () => ({ snapshotToken: 's', atCursor: 'epoch:1', entries: [version('c')], pageCursor: null }),
    beforePersist: (_batch, _state, edit) => { if (stale) { stale = false; edit(version('b')); throw new Error('stale-local-head'); } } });
  await f.engine.start(); assert.equal(f.batches[0].items[0].decision.action, 'conflict');
  assert.equal(f.batches[0].items[0].decision.local.blobHash, 'b'.repeat(64)); assert.equal(f.state.cursor, 'epoch:1');
  assert.equal(f.state.status.lastSuccessfulSync, null); f.engine.stop();
});

test('received page not persisted leaves cursor unchanged and manual mode schedules no retry', async () => {
  const f = fixture({ changes: cursor => ({ fromCursor: cursor, nextCursor: 'epoch:2', entries: [version('c')] }), beforePersist: () => { throw new Error('disk-full'); } });
  await f.engine.synchronizeNow(); assert.equal(f.state.cursor, 'epoch:0'); assert.equal(f.state.status.lastSuccessfulSync, null);
  assert.deepEqual(f.time.delays, []); assert.equal(f.status.errorCode, 'disk-full'); f.engine.stop();
});

test('wrong vault at same IP blocks before any content request or operation preparation', async () => {
  const f = fixture({ mode: 'automatic', vaultId: 'other' }); f.edit(version('a')); await f.engine.start();
  assert.deepEqual(f.calls, ['hello']); assert.equal(f.status.phase, 'blocked'); assert.equal(f.state.status.pendingCount, 1);
  assert.deepEqual(f.time.delays, []); f.engine.stop();
});

test('epoch change requests new manifest and preserves divergent local edit as conflict', async () => {
  const f = fixture({ epoch: 'new', snapshot: () => ({ snapshotToken: 's', atCursor: 'new:3', entries: [version('c')], pageCursor: null }) });
  f.state.entries = [{ base: version('a'), local: version('b'), localHead: 'head' }]; f.state.status.pendingCount = 1;
  await f.engine.synchronizeNow(); assert.equal(f.batches[0].initialCopy.atCursor, 'new:3'); assert.equal(f.batches[0].items[0].decision.action, 'conflict');
  assert.equal(f.state.entries[0].local.blobHash, 'b'.repeat(64)); assert.equal(f.sent.length, 0); f.engine.stop();
});

test('completion race cannot publish success for a new local edit', async () => {
  const f = fixture({ beforeComplete: (_state, edit) => edit(version('b')) });
  await f.engine.synchronizeNow(); assert.equal(f.state.status.lastSuccessfulSync, null); assert.notEqual(f.status.phase, 'idle'); f.engine.stop();
});

test('new epoch manifest omission preserves old base and local edit as missing-version conflict', async () => {
  const f = fixture({ epoch: 'new' });
  f.state.entries = [{ base: version('a'), local: version('b'), localHead: 'head' }]; f.state.status.pendingCount = 1;
  await f.engine.synchronizeNow();
  assert.equal(f.sent.length, 0); assert.equal(f.batches[0].items[0].decision.reason, 'missing-version');
  assert.equal(f.batches[0].items[0].decision.remote, null); assert.equal(f.state.entries[0].local.blobHash, 'b'.repeat(64)); f.engine.stop();
});

test('stop followed immediately by restart resumes a cancelled startup cycle', async () => {
  const f = fixture({ mode: 'automatic' }); f.edit(version('a'));
  const first = f.engine.start(); f.engine.stop(); const second = f.engine.start();
  await Promise.all([first, second]); assert.equal(f.state.status.pendingCount, 0); assert.ok(f.state.status.lastSuccessfulSync); f.engine.stop();
});

test('create edit rename delete before preparation never uploads a remote file', async () => {
  const f = fixture(); f.edit(version('a')); f.edit(version('b'));
  f.edit({ ...version('b'), path: 'renamed.md' }); f.edit({ ...version('b'), path: 'renamed.md', deleted: true, blobHash: null, byteLength: 0 });
  await f.engine.synchronizeNow(); assert.equal(f.sent.length, 0); assert.equal(f.calls.includes('upload'), false); f.engine.stop();
});

test('epoch recovery obtains full manifest before replaying prepared A and only then prepares edited B', async () => {
  const f = fixture({ epoch: 'new', snapshot: (_token, cursor) => ({ snapshotToken: 'new-token', atCursor: 'new:0', entries: cursor ? [] : [version('a', 'old-host-A')], pageCursor: cursor ? null : 'next' }) });
  f.edit(version('a')); const [prepared] = await f.replica.preparePending(100); f.edit(version('b')); f.calls.length = 0;
  await f.engine.synchronizeNow();
  assert.equal(f.sent.length, 2); assert.deepEqual(f.sent[0], [prepared]);
  assert.ok(f.calls.indexOf('apply') > f.calls.lastIndexOf('snapshot'));
  assert.equal(f.sent[1][0].baseRevision, `host-${prepared.opId}`);
  assert.equal(f.state.status.pendingCount, 0); assert.equal(f.state.status.conflictCount, 0); assert.ok(f.state.status.lastSuccessfulSync); f.engine.stop();
});

async function nativePair(t) {
  const root = await mkdtemp(join(tmpdir(), 'pm-engine-pair-'));
  const host = await createHostService({ dataRoot: join(root, 'host'), vaultRoot: join(root, 'vault') });
  const handler = await createSyncHandler({ host, maxFileBytes: 40 * 1048576, permission: () => 'admin', authorizeOperation: async () => true });
  const server = createServer(async (req, res) => { if (!await handler(req, res)) { res.writeHead(404); res.end(); } });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const profile = { vaultId: host.vaultId, serverId: host.serverId, replicaId: randomUUID(), origin: `http://127.0.0.1:${server.address().port}`, mode: 'manual', offlineEnabled: true };
  let replica = await createReplicaService({ userData: join(root, 'client'), profile });
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await replica.close(); await host.close(); await rm(root, { recursive: true, force: true }); });
  const transport = () => createNativeSyncTransport({ profile, objects: replica.objects, stagingRoot: join(replica.root, 'staging') });
  return { host, profile, get replica() { return replica; }, transport,
    async reopen() { await replica.close(); replica = await createReplicaService({ userData: join(root, 'client'), profile }); },
  };
}

test('real native pair: lost committed create ACK survives process-store reopen, then conditional delete', async t => {
  const f = await nativePair(t); let remote = await f.transport();
  let engine = createSyncEngine({ replica: f.replica, remote, clock: clock() }); let status;
  engine.onStatus(s => { status = s; }); await engine.synchronizeNow();
  assert.equal((await f.replica.snapshot()).status.snapshotComplete, true, JSON.stringify(status));
  await f.replica.request('/api/note?path=a.md', 'PUT', { content: 'A' });
  const realApply = remote.apply; let prepared;
  remote.apply = async operations => { prepared = clone(operations); await realApply(operations); throw new Error('lost-response'); };
  await engine.synchronizeNow(); assert.equal(status.errorCode, 'lost-response');
  assert.deepEqual((await f.replica.snapshot()).preparedOperations, prepared);
  await f.replica.request('/api/note?path=a.md', 'DELETE'); engine.stop(); await f.reopen();
  remote = await f.transport(); const sent = []; const apply = remote.apply;
  remote.apply = async ops => { sent.push(clone(ops)); return apply(ops); };
  engine = createSyncEngine({ replica: f.replica, remote, clock: clock() }); engine.onStatus(s => { status = s; });
  await engine.synchronizeNow();
  assert.equal(status.errorCode, null, JSON.stringify(status));
  assert.equal(status.phase, 'idle');
  assert.deepEqual(sent[0], prepared); assert.equal(sent[1][0].kind, 'delete'); assert.ok(sent[1][0].baseRevision);
  const snapshot = await f.replica.snapshot(); assert.equal(snapshot.status.pendingCount, 0); assert.ok(snapshot.status.lastSuccessfulSync);
  assert.equal((await f.host.openSnapshot()).entries.find(v => v.entryId === prepared[0].entryId).deleted, true);
  engine.stop();
});

test('real native pair: unprepared offline create-edit-rename-delete produces no host entry', async t => {
  const f = await nativePair(t); const engine = createSyncEngine({ replica: f.replica, remote: await f.transport(), clock: clock() });
  await engine.synchronizeNow();
  await f.replica.request('/api/note?path=a.md', 'PUT', { content: 'A' });
  await f.replica.request('/api/note?path=a.md', 'PUT', { content: 'B' });
  await f.replica.request('/api/note?path=a.md', 'PATCH', { newPath: 'renamed.md' });
  await f.replica.request('/api/note?path=renamed.md', 'DELETE');
  await engine.synchronizeNow();
  assert.deepEqual((await f.host.openSnapshot()).entries, []);
  assert.equal((await f.replica.snapshot()).status.pendingCount, 0); engine.stop();
});

test('real native pair: distinct identities at the same path become preserved name conflict', async t => {
  const f = await nativePair(t);
  await f.replica.request('/api/note?path=a.md', 'PUT', { content: 'local' });
  const ref = await f.host.objects.put('remote');
  await f.host.apply({ vaultId: f.profile.vaultId, replicaId: randomUUID(), opId: randomUUID(), entryId: randomUUID(), kind: 'put', baseRevision: null, after: { path: 'a.md', kind: 'note', ...ref }, dependsOn: [] });
  const engine = createSyncEngine({ replica: f.replica, remote: await f.transport(), clock: clock() });
  await engine.synchronizeNow(); const snapshot = await f.replica.snapshot();
  assert.equal(snapshot.conflicts.length, 1); assert.equal(snapshot.conflicts[0].reason, 'path-collision');
  assert.equal((await f.replica.request('/api/note?path=a.md', 'GET')).data.content, 'local');
  assert.equal(snapshot.status.lastSuccessfulSync, null); assert.equal(snapshot.status.snapshotComplete, true); engine.stop();
});

test('real native pair: remote edit then revert advances revision without losing later local edits', async t => {
  const f = await nativePair(t);
  const engine = createSyncEngine({ replica: f.replica, remote: await f.transport(), clock: clock() }); let status;
  engine.onStatus(s => { status = s; }); await engine.synchronizeNow();
  await f.replica.request('/api/note?path=a.md', 'PUT', { content: 'A' }); await engine.synchronizeNow();
  const entry = (await f.host.openSnapshot()).entries[0];
  const op = (base, ref) => ({ vaultId: f.profile.vaultId, replicaId: randomUUID(), opId: randomUUID(), entryId: entry.entryId, kind: 'put', baseRevision: base, after: { path: 'a.md', kind: 'note', ...ref }, dependsOn: [] });
  const changed = await f.host.apply(op(entry.revision, await f.host.objects.put('B')));
  const reverted = await f.host.apply(op(changed.confirmed.revision, await f.host.objects.put('A')));
  await engine.synchronizeNow();
  assert.equal(status.errorCode, null, JSON.stringify(status));
  assert.equal((await f.replica.snapshot()).entries[0].base.revision, reverted.confirmed.revision);
  await f.replica.request('/api/note?path=a.md', 'PUT', { content: 'C' }); await engine.synchronizeNow();
  assert.equal(status.errorCode, null); assert.equal((await f.replica.snapshot()).status.pendingCount, 0);
  engine.stop();
});
