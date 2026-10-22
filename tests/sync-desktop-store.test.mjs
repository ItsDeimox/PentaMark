import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import { DatabaseSync } from 'node:sqlite';
import { spawnSync } from 'node:child_process';
import { Writable } from 'node:stream';

const require = createRequire(import.meta.url);
const implementation = await import('../local/sync/replica-service.mjs').catch(() => ({}));
const profile = () => ({ vaultId: randomUUID(), serverId: randomUUID(), replicaId: randomUUID(), origin: 'http://host.test:3417', offlineEnabled: true, mode: 'manual' });
async function fixture(t, options = {}) {
  assert.equal(typeof implementation.createReplicaService, 'function', 'durable replica factory must exist');
  const userData = await mkdtemp(join(tmpdir(), 'pentamark-replica-'));
  const p = profile(); let service;
  const open = async (extra = {}) => { service = await implementation.createReplicaService({ userData, profile: p, ...extra }); return service; };
  t.after(async () => { await service?.close(); await rm(userData, { recursive: true, force: true }); });
  return { p, userData, open, service: await open(options) };
}
const save = (s, content, path = 'a.md') => s.request(`/api/note?path=${encodeURIComponent(path)}`, 'PUT', { content });
const entry = async (s, id = undefined) => (await s.snapshot()).entries.find(e => !id || e.local?.entryId === id);
async function remote(s, text, path = 'a.md', entryId = randomUUID()) {
  return { entryId, kind: 'note', path, revision: randomUUID(), ...await s.objects.put(text), deleted: false };
}
const pull = (v, head = '') => ({ expectedLocalHead: head, decision: { action: 'pull', reason: 'remote', base: null, local: null, remote: v } });

test('offline save survives restart in isolated userData with immutable history', async t => {
  const f = await fixture(t); const s = f.service;
  assert.equal((await save(s, 'A')).status, 200);
  const a = await entry(s); await save(s, 'B');
  assert.equal(await readFile(s.objects.path(a.local.blobHash), 'utf8'), 'A');
  assert.equal(await readFile(join(s.workingRoot, 'a.md'), 'utf8'), 'B');
  await s.close(); const reopened = await f.open();
  assert.equal((await reopened.request('/api/note?path=a.md', 'GET')).data.content, 'B');
  assert.equal((await reopened.snapshot()).status.snapshotComplete, false);
  assert.equal((await reopened.snapshot()).status.pendingCount, 1);
});

test('prepared A is immutable across restart and ACK A cannot clear edited B', async t => {
  const f = await fixture(t); let s = f.service;
  await save(s, 'A'); const [a] = await s.preparePending(100);
  await save(s, 'B'); assert.deepEqual(await s.preparePending(100), [a]);
  await s.close(); s = await f.open(); assert.deepEqual(await s.preparePending(100), [a]);
  const confirmed = { ...(await entry(s)).local, ...a.after, revision: 'host-A' };
  await s.confirm({ opId: a.opId, status: 'applied', confirmed });
  await s.confirm({ opId: a.opId, status: 'already-applied', confirmed });
  assert.equal((await s.request('/api/note?path=a.md', 'GET')).data.content, 'B');
  const [b] = await s.preparePending(100);
  assert.notEqual(b.opId, a.opId); assert.equal(b.baseRevision, 'host-A');
  assert.notEqual(b.after.blobHash, a.after.blobHash);
});

test('stale incoming head rejects the whole batch and cursor without applying earlier item', async t => {
  const { service: s } = await fixture(t);
  await save(s, 'A'); const a = await entry(s); await save(s, 'B');
  const first = await remote(s, 'first', 'first.md'); const changed = await remote(s, 'remote', 'a.md', a.local.entryId);
  await assert.rejects(s.persistIncoming({ nextCursor: 'epoch:5', items: [pull(first), pull(changed, a.localHead)] }), /stale-local-head/);
  assert.equal((await s.snapshot()).cursor, null);
  assert.equal((await s.request('/api/note?path=first.md', 'GET')).status, 404);
  assert.equal((await s.request('/api/note?path=a.md', 'GET')).data.content, 'B');
});

test('initial manifest progress persists without confirmed cursor until final page', async t => {
  const f = await fixture(t); let s = f.service;
  await s.persistIncoming({ nextCursor: 'e:9', epoch: 'e', initialCopy: { snapshotToken: 'token', atCursor: 'e:9', pageCursor: 'page2' }, items: [pull(await remote(s, 'A'))] });
  await s.close(); s = await f.open();
  const partial = await s.snapshot(); assert.equal(partial.cursor, null); assert.equal(partial.initialCopy.pageCursor, 'page2'); assert.equal(partial.status.snapshotComplete, false);
  await s.persistIncoming({ nextCursor: 'e:9', epoch: 'e', initialCopy: { snapshotToken: 'token', atCursor: 'e:9', pageCursor: null }, items: [] });
  const done = await s.snapshot(); assert.equal(done.cursor, 'e:9'); assert.equal(done.status.snapshotComplete, true); assert.equal(done.status.lastSuccessfulSync, null);
});

for (const boundary of ['after-object', 'after-intent', 'after-rename', 'before-commit']) {
  test(`recovers real SQLite/files after interruption at ${boundary}`, async t => {
    const f = await fixture(t); await save(f.service, 'old'); await f.service.close();
    let armed = true;
    const s = await f.open({ interrupt: async point => { if (armed && point === boundary) { armed = false; throw new Error('interrupted'); } } });
    await assert.rejects(save(s, 'new'), /interrupted/); await s.close();
    const recovered = await f.open(); const expected = boundary === 'after-object' ? 'old' : 'new';
    assert.equal((await recovered.request('/api/note?path=a.md', 'GET')).data.content, expected);
    assert.equal(await readFile(join(recovered.workingRoot, 'a.md'), 'utf8'), expected);
    assert.equal((await recovered.preparePending(10)).length, 1);
  });
}

test('profile identity and returned snapshots cannot silently retarget stored replica', async t => {
  const { service: s, p } = await fixture(t);
  const snapshot = await s.snapshot(); snapshot.profile.origin = 'http://evil.test';
  assert.equal((await s.snapshot()).profile.origin, p.origin);
  await assert.rejects(s.open({ ...p, serverId: randomUUID() }), /identity/);
  await assert.rejects(s.open({ ...p, origin: 'http://evil.test' }), /identity/);
});

test('local editor API rejects traversal, private files and arbitrary URLs', async t => {
  const { service: s } = await fixture(t);
  for (const url of ['http://evil.test/api/note?path=a.md', '/api/note?path=..%2Fx', '/api/note?path=C%3A%5Cx', '/api/note?path=.history%2Fx', '/api/note?path=CON.md']) {
    await assert.rejects(s.request(url, 'PUT', { content: 'bad' }), /invalid|private|reserved/);
  }
});

test('stale conflict resolution retains typed merge and all conflict objects', async t => {
  const { service: s } = await fixture(t); await save(s, 'local'); const a = await entry(s);
  const r = await remote(s, 'remote', 'a.md', a.local.entryId);
  await s.persistIncoming({ nextCursor: 'e:1', initialCopy: { snapshotToken: 'first', atCursor: 'e:1', pageCursor: null }, items: [{ expectedLocalHead: a.localHead, decision: { action: 'conflict', reason: 'both-changed', base: null, local: a.local, remote: r } }] });
  const [conflict] = (await s.snapshot()).conflicts;
  await save(s, 'newer');
  await assert.rejects(s.resolve({ conflictId: conflict.conflictId, expectedRemoteRevision: r.revision, expectedLocalHead: a.localHead, choice: 'merged', mergedContent: 'typed merge' }), /stale/);
  assert.equal((await s.snapshot()).conflicts.length, 1);
  assert.equal((await s.request('/api/note?path=a.md', 'GET')).data.content, 'newer');
  const merged = await s.objects.put('typed merge');
  assert.ok(s.retainedResolutions().some(item => item.blobHash === merged.blobHash));
  assert.equal(await readFile(s.objects.path(r.blobHash), 'utf8'), 'remote');
});

test('closed IPC rejects remote frame, unknown command, wrong replica and malformed payload', async () => {
  const ipc = await import('../desktop/sync-ipc.cjs').catch(() => ({}));
  assert.equal(typeof ipc.createSyncBridge, 'function', 'closed sync bridge must exist');
  const child = new EventEmitter(); child.connected = true;
  child.send = message => queueMicrotask(() => child.emit('message', { type: 'pentamark:sync:result', requestId: message.command.requestId, replicaId: message.command.replicaId, ok: true, value: {} }));
  const bridge = ipc.createSyncBridge({ getChild: () => child, trustedFrame: event => event.local === true });
  const p = profile(); const command = { requestId: randomUUID(), replicaId: p.replicaId, method: 'open', payload: p };
  await assert.rejects(bridge.invoke({ local: false }, command), /untrusted/);
  await assert.rejects(bridge.invoke({ local: true }, { ...command, method: 'eval' }), /invalid/);
  await assert.rejects(bridge.invoke({ local: true }, { ...command, replicaId: randomUUID() }), /replica/);
  await assert.rejects(bridge.invoke({ local: true }, { ...command, method: 'request', payload: { url: 'file:///C:/secret', method: 'GET' } }), /invalid/);
  assert.equal((await bridge.invoke({ local: true }, command)).requestId, command.requestId);
  bridge.close();
});

test('partial desired staging is reverified and rebuilt from immutable object after crash', async t => {
  const f = await fixture(t); await save(f.service, 'old'); await f.service.close();
  const s = await f.open({ interrupt: async point => { if (point === 'after-intent') throw new Error('crash'); } });
  await assert.rejects(save(s, 'complete new bytes'), /crash/); await s.close();
  const db = new DatabaseSync(join(s.root, 'replica.sqlite'));
  const intent = JSON.parse(db.prepare('SELECT intent FROM file_intents').get().intent); db.close();
  const stage = join(s.workingRoot, '.pentamark-sync', intent.files[0].intentId);
  await mkdir(stage, { recursive: true }); await writeFile(join(stage, 'desired'), 'complete');
  const recovered = await f.open();
  assert.equal(await readFile(join(recovered.workingRoot, 'a.md'), 'utf8'), 'complete new bytes');
  const current = (await entry(recovered)).local;
  await recovered.objects.verify(current);
  assert.equal(current.byteLength, 18);
});

test('abrupt native process exit recovers committed intent and verified bytes', async t => {
  const f = await fixture(t); await save(f.service, 'old'); await f.service.close();
  const moduleUrl = new URL('../local/sync/replica-service.mjs', import.meta.url).href;
  const code = `import {createReplicaService} from ${JSON.stringify(moduleUrl)}; const s=await createReplicaService({userData:${JSON.stringify(f.userData)},profile:${JSON.stringify(f.p)},interrupt:async p=>{if(p==='after-rename')process.exit(73)}});await s.request('/api/note?path=a.md','PUT',{content:'after crash'});`;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8', windowsHide: true });
  assert.equal(child.status, 73, child.stderr);
  const recovered = await f.open(); assert.equal((await recovered.request('/api/note?path=a.md', 'GET')).data.content, 'after crash');
  await recovered.objects.verify((await entry(recovered)).local);
});

test('native media requires loopback and current session capability and returns verified bytes', async t => {
  const { installReplicaIpc } = await import('../local/sync/replica-ipc.mjs');
  const f = await fixture(t); await f.service.close();
  const channel = new EventEmitter(); channel.send = () => {};
  const ipc = installReplicaIpc({ channel, userData: f.userData }); t.after(() => ipc.close());
  await ipc.dispatch({ requestId: randomUUID(), replicaId: f.p.replicaId, method: 'open', payload: f.p });
  const s = ipc.getReplica(f.p.replicaId); await save(s, 'verified-media'); const a = await entry(s);
  const url = ipc.mediaPath(f.p.replicaId, a.local.entryId);
  async function serve(address, requestUrl = url) {
    const chunks = []; const res = new Writable({ write(chunk, _encoding, callback) { chunks.push(chunk); callback(); } });
    res.writeHead = (status, headers) => { res.status = status; res.headers = headers; };
    await ipc.handleMedia({ url: requestUrl, method: 'GET', socket: { remoteAddress: address } }, res);
    return { status: res.status, body: Buffer.concat(chunks).toString(), headers: res.headers };
  }
  assert.equal((await serve('192.168.1.12')).status, 403);
  assert.equal((await serve('127.0.0.1', url.replace(/\/([a-f0-9]{64})\//, '/' + '0'.repeat(64) + '/'))).status, 403);
  assert.equal((await serve('127.0.0.1', url + '/../secret')).status, 403);
  const ok = await serve('127.0.0.1'); assert.equal(ok.status, 200); assert.equal(ok.body, 'verified-media'); assert.equal(ok.headers['Cache-Control'], 'no-store');
  await ipc.close();
});

test('unsupported local requests cannot create malformed entries', async t => {
  const { service: s } = await fixture(t);
  await assert.rejects(s.request('/api/asset?path=x.bin', 'POST', { path: 'x.bin' }), /native-import/);
  await assert.rejects(s.persistIncoming({ nextCursor: 'e:1', initialCopy: { snapshotToken: 's', atCursor: 'e:1', pageCursor: null }, items: [{ ...pull(await remote(s, 'bytes')), decision: { ...pull(await remote(s, 'other')).decision, action: 'none' } }] }), /unrepresented/);
  assert.equal((await s.snapshot()).cursor, null);
});

test('native note API creates parent folders and prepares dependencies in order', async t => {
  const { service: s } = await fixture(t);
  assert.equal((await save(s, 'nested', 'folder/note.md')).status, 200);
  const ops = await s.preparePending(10);
  assert.equal(ops.length, 2); assert.equal(ops[0].kind, 'mkdir'); assert.equal(ops[1].kind, 'put');
  assert.deepEqual(ops[1].dependsOn, [ops[0].opId]);
});

test('conflict resolution archives old conflict and preserves remote bytes when choosing local', async t => {
  const { service: s } = await fixture(t); await save(s, 'local'); const a = await entry(s);
  const r = await remote(s, 'remote', 'a.md', a.local.entryId);
  await s.persistIncoming({ nextCursor: 'e:1', initialCopy: { snapshotToken: 's', atCursor: 'e:1', pageCursor: null }, items: [{ expectedLocalHead: a.localHead, decision: { action: 'conflict', reason: 'both', base: null, local: a.local, remote: r } }] });
  const [c] = (await s.snapshot()).conflicts;
  await s.resolve({ conflictId: c.conflictId, expectedRemoteRevision: r.revision, expectedLocalHead: a.localHead, choice: 'local' });
  assert.equal((await s.snapshot()).conflicts.length, 0);
  assert.equal((await s.preparePending(1))[0].baseRevision, r.revision);
  const db = new DatabaseSync(join(s.root, 'replica.sqlite'));
  assert.equal(db.prepare('SELECT count(*) AS n FROM conflicts').get().n, 1); db.close();
  assert.equal(await readFile(s.objects.path(r.blobHash), 'utf8'), 'remote');
});

test('editor state, config and presence have the actual consumed API shapes', async t => {
  const { service: s } = await fixture(t);
  const asset = { ...await remote(s, 'image', 'picture.png'), kind: 'asset' };
  await s.persistIncoming({ nextCursor: 'e:1', initialCopy: { snapshotToken: 's', atCursor: 'e:1', pageCursor: null }, items: [pull(asset)] });
  await save(s, 'body', 'folder/note.md');
  const { data: state } = await s.request('/api/state', 'GET');
  assert.equal(state.locks.find(lock => lock.path === 'folder/note.md'), undefined);
  assert.deepEqual(state.notes[0], { path: 'folder/note.md', title: 'note', modified: 0, size: 4 });
  assert.deepEqual(state.assets[0], { path: 'picture.png', title: 'picture.png', extension: 'png', kind: 'image', modified: 0, size: 5 });
  assert.deepEqual(state.folders, ['folder']);
  for (const key of ['connections', 'urls', 'locks']) assert.ok(Array.isArray(state[key]));
  const { data: config } = await s.request('/api/config', 'GET');
  for (const key of ['port', 'maxUploadMB']) assert.equal(typeof config[key], 'number');
  for (const key of ['openBrowser', 'lockEditedNotes', 'cleanupUnusedAssets', 'aiBridgeEnabled', 'isHost']) assert.equal(typeof config[key], 'boolean');
  assert.equal(config.aiBridgeToken, '');
  const before = await s.snapshot();
  assert.deepEqual(await s.request('/api/presence', 'POST', { clientId: 'client', name: 'Device', avatar: '', color: '#123456', path: '', cursor: 0, selectionEnd: 0, mode: 'edit', editing: false }), { status: 200, data: { ok: true, lock: null } });
  assert.deepEqual(await s.snapshot(), before);
});

async function acknowledgeAll(s) {
  for (const op of await s.preparePending(100)) {
    const local = (await s.snapshot()).entries.find(e => e.local.entryId === op.entryId).local;
    await s.confirm({ opId: op.opId, status: 'applied', confirmed: { ...local, revision: randomUUID() } });
  }
}

test('known-child folder rename is durable and preserves file IDs with ordered wire dependencies', async t => {
  const f = await fixture(t); const s = f.service;
  await save(s, 'one', 'old/sub/a.md'); await save(s, 'two', 'old/b.md'); await acknowledgeAll(s);
  const id = (await s.snapshot()).entries.find(e => e.local.path === 'old/sub/a.md').local.entryId;
  await s.request('/api/folder?path=old', 'PATCH', { newPath: 'new' });
  assert.equal(await readFile(join(s.workingRoot, 'new/sub/a.md'), 'utf8'), 'one');
  assert.equal((await s.snapshot()).entries.find(e => e.local.path === 'new/sub/a.md').local.entryId, id);
  const ops = await s.preparePending(100);
  const mkdir = ops.find(op => op.kind === 'mkdir' && op.after.path === 'new/sub');
  const move = ops.find(op => op.entryId === id); assert.ok(move.dependsOn.includes(mkdir.opId));
  const oldSub = (await s.snapshot()).entries.find(e => e.local.path === 'old/sub').local.entryId;
  const remove = ops.find(op => op.entryId === oldSub); assert.ok(remove.dependsOn.includes(move.opId));
  await s.close(); const reopened = await f.open(); assert.deepEqual(await reopened.preparePending(100), ops);
});

test('folder batch resumes after crash between children without expanding captured deletion set', async t => {
  const f = await fixture(t); await save(f.service, 'one', 'old/a.md'); await save(f.service, 'two', 'old/b.md'); await f.service.close();
  let once = true;
  const s = await f.open({ interrupt: async point => { if (once && point === 'after-rename') { once = false; throw new Error('batch-crash'); } } });
  await assert.rejects(s.request('/api/folder?path=old', 'DELETE'), /batch-crash/); await s.close();
  await writeFile(join(s.workingRoot, 'old/new.md'), 'unknown new child');
  const recovered = await f.open();
  assert.equal(await readFile(join(recovered.workingRoot, 'old/new.md'), 'utf8'), 'unknown new child');
  const snap = await recovered.snapshot();
  assert.ok(snap.conflicts.some(c => c.reason === 'folder-has-new-children'));
  assert.ok(snap.entries.some(e => e.local.path === 'old' && !e.local.deleted));
  assert.ok(snap.entries.some(e => e.local.path === 'old/new.md' && !e.local.deleted));
  assert.equal((await recovered.request('/api/note?path=old/a.md', 'GET')).status, 404);
});

test('nonempty folder rename recovers after an intermediate child publication', async t => {
  const f = await fixture(t); await save(f.service, 'a', 'old/a.md'); await save(f.service, 'b', 'old/b.md'); await f.service.close();
  let count = 0;
  const s = await f.open({ interrupt: async point => { if (point === 'after-rename' && ++count === 2) throw new Error('move-crash'); } });
  await assert.rejects(s.request('/api/folder?path=old', 'PATCH', { newPath: 'new' }), /move-crash/); await s.close();
  const recovered = await f.open();
  assert.equal(await readFile(join(recovered.workingRoot, 'new/a.md'), 'utf8'), 'a');
  assert.equal(await readFile(join(recovered.workingRoot, 'new/b.md'), 'utf8'), 'b');
  assert.equal((await recovered.request('/api/state', 'GET')).data.folders.includes('old'), false);
});

test('review: cross-entry path collision persists and keep-both resolves both identities', async t => {
  const { service: s } = await fixture(t); await save(s, 'local'); const a = await entry(s);
  const b = await remote(s, 'remote', 'a.md');
  await s.persistIncoming({ nextCursor: 'e:1', initialCopy: { snapshotToken: 's', atCursor: 'e:1', pageCursor: null }, items: [{ expectedLocalHead: a.localHead, decision: { action: 'conflict', reason: 'path-collision', base: null, local: a.local, remote: b } }] });
  const [c] = (await s.snapshot()).conflicts;
  await s.resolve({ conflictId: c.conflictId, expectedLocalHead: a.localHead, expectedRemoteRevision: b.revision, choice: 'keep-both' });
  const snap = await s.snapshot();
  assert.equal((await s.request('/api/note?path=a.md', 'GET')).data.content, 'remote');
  const kept = snap.entries.find(e => e.local.entryId === a.local.entryId);
  assert.notEqual(kept.local.path, 'a.md');
  assert.equal(await readFile(s.objects.path(kept.local.blobHash), 'utf8'), 'local');
  assert.equal(snap.entries.find(e => e.local.entryId === b.entryId).base.revision, b.revision);
});

test('review: incoming tombstone then different ID at same path cannot poison recovery', async t => {
  const f = await fixture(t); const s = f.service; const a = await remote(s, 'old');
  await s.persistIncoming({ nextCursor: 'e:1', initialCopy: { snapshotToken: 's', atCursor: 'e:1', pageCursor: null }, items: [pull(a)] });
  const head = (await entry(s)).localHead;
  const tombstone = { ...a, revision: randomUUID(), deleted: true, blobHash: null, byteLength: 0 };
  const b = await remote(s, 'replacement');
  await s.persistIncoming({ nextCursor: 'e:2', items: [pull(b), { expectedLocalHead: head, decision: { action: 'pull', reason: 'remote-delete', base: a, local: a, remote: tombstone } }] });
  await s.close(); const recovered = await f.open();
  assert.equal((await recovered.request('/api/note?path=a.md', 'GET')).data.content, 'replacement');
  assert.equal((await recovered.snapshot()).cursor, 'e:2');
});

test('review: typed merge for superseded conflict is retained before stale rejection', async t => {
  const { service: s } = await fixture(t); await save(s, 'local'); const a = await entry(s);
  const r = await remote(s, 'remote1', 'a.md', a.local.entryId);
  const conflictItem = remoteVersion => ({ expectedLocalHead: a.localHead, decision: { action: 'conflict', reason: 'both', base: null, local: a.local, remote: remoteVersion } });
  await s.persistIncoming({ nextCursor: 'e:1', initialCopy: { snapshotToken: 's', atCursor: 'e:1', pageCursor: null }, items: [conflictItem(r)] });
  const [old] = (await s.snapshot()).conflicts;
  await s.persistIncoming({ nextCursor: 'e:2', items: [conflictItem(await remote(s, 'remote2', 'a.md', a.local.entryId))] });
  await assert.rejects(s.resolve({ conflictId: old.conflictId, expectedLocalHead: a.localHead, expectedRemoteRevision: r.revision, choice: 'merged', mergedContent: 'typed against old' }), /stale/);
  const receipts = s.retainedResolutions(); assert.equal(receipts.length, 1);
  assert.equal(await readFile(s.objects.path(receipts[0].blobHash), 'utf8'), 'typed against old');
});

test('completeCycle checks all dirty/prepared state and snapshot never prepares fresh operations', async t => {
  const { service: s } = await fixture(t);
  await s.persistIncoming({ nextCursor: 'e:1', epoch: 'e', initialCopy: { snapshotToken: 's', atCursor: 'e:1', pageCursor: null }, items: [] });
  assert.equal(typeof s.completeCycle, 'function');
  const input = { expectedCursor: 'e:1', expectedEpoch: 'e' };
  await assert.rejects(s.completeCycle({ ...input, expectedEpoch: 'wrong' }), /stale-local-head/);
  const success = await s.completeCycle(input); assert.equal(success.phase, 'idle'); assert.ok(success.lastSuccessfulSync);
  await save(s, 'edit');
  const dirty = await s.snapshot(); assert.deepEqual(dirty.preparedOperations, []); assert.notEqual(dirty.status.phase, 'idle');
  assert.equal(dirty.status.lastSuccessfulSync, success.lastSuccessfulSync);
  await assert.rejects(s.completeCycle(input), /stale-local-head/);
  const prepared = await s.preparePending(10); assert.deepEqual((await s.snapshot()).preparedOperations, prepared);
  await assert.rejects(s.completeCycle(input), /stale-local-head/);
  await acknowledgeAll(s); assert.notEqual((await s.snapshot()).status.phase, 'idle');
  assert.equal((await s.completeCycle(input)).phase, 'idle');
  await s.configure({ offlineEnabled: false, mode: 'manual' }); await assert.rejects(s.completeCycle(input), /stale-local-head/);
});

test('native stream asset import and historic text reads retain bytes without accepting forged versions', async t => {
  const { service: s } = await fixture(t);
  assert.equal(typeof s.importStream, 'function');
  const asset = await s.importStream('assets/a.bin', (async function* () { yield Buffer.from([0, 255]); yield Buffer.from([1, 2]); })(), 4);
  assert.equal(asset.kind, 'asset'); assert.deepEqual(await readFile(join(s.workingRoot, 'assets/a.bin')), Buffer.from([0, 255, 1, 2]));
  await assert.rejects(s.importStream('too-big.bin', [Buffer.alloc(5)], 4), /file-too-large/);
  await save(s, 'old'); const old = (await entry(s, (await s.snapshot()).entries.find(e => e.local.path === 'a.md').local.entryId)).local;
  await save(s, 'new');
  assert.ok((await s.history(old.entryId)).some(v => v.revision === old.revision));
  assert.equal((await s.readVersion(old)).content, 'old');
  await assert.rejects(s.readVersion({ ...old, blobHash: asset.blobHash, byteLength: 4 }), /unknown-version/);
  await assert.rejects(s.readVersion(asset), /native-stream-required/);
});

test('discovery and verified rebind use native hooks and never mutate identity on mismatch', async t => {
  const { installReplicaIpc } = await import('../local/sync/replica-ipc.mjs');
  const f = await fixture(t); await f.service.close();
  const channel = new EventEmitter(); channel.send = () => {};
  let observed;
  const hello = { protocol: 1, vaultId: f.p.vaultId, serverId: f.p.serverId, epoch: 'e', maxFileBytes: 1000, chunkBytes: 1048576 };
  const ipc = installReplicaIpc({ channel, userData: f.userData, discoverOrigin: async origin => { observed = origin; return origin.includes('wrong') ? { ...hello, serverId: randomUUID() } : hello; } });
  t.after(() => ipc.close());
  const call = (method, payload) => ipc.dispatch({ requestId: randomUUID(), replicaId: f.p.replicaId, method, payload });
  assert.deepEqual(await call('discover', { origin: f.p.origin }), hello); assert.equal(observed, f.p.origin);
  await call('open', f.p); const s = ipc.getReplica(f.p.replicaId); await save(s, 'pending'); const [a] = await s.preparePending(10);
  await assert.rejects(call('rebind', { origin: 'http://wrong.test' }), /identity/);
  assert.equal((await s.snapshot()).profile.origin, f.p.origin);
  const rebound = await call('rebind', { origin: 'http://new.test' }); assert.equal(rebound.profile.origin, 'http://new.test');
  assert.deepEqual(await s.preparePending(10), [a]);
  await assert.rejects(call('discover', { origin: 'http://new.test/api/anything' }), /invalid/);
  const media = await call('mediaUrl', { entryId: a.entryId }); assert.match(media.url, /^\/__replica_media\//);
  const versions = await call('history', { entryId: a.entryId }); assert.ok(Array.isArray(versions.versions));
  assert.equal((await call('readVersion', { version: versions.versions[0] })).content, 'pending');
  await ipc.close();
});

test('picker-bound export/import stream exact bytes and reject renderer path injection', async t => {
  const { installReplicaIpc } = await import('../local/sync/replica-ipc.mjs');
  const { createSyncBridge } = require('../desktop/sync-ipc.cjs');
  const f = await fixture(t); await f.service.close();
  const outputRoot = await mkdtemp(join(tmpdir(), 'pentamark-export-')); t.after(() => rm(outputRoot, { recursive: true, force: true }));
  const importFile = join(outputRoot, 'input.bin'), exportFile = join(outputRoot, 'output.bin');
  await writeFile(importFile, Buffer.from([0, 7, 255, 3]));
  const channel = new EventEmitter(); channel.send = message => child.emit('message', message);
  const child = new EventEmitter(); child.connected = true; child.send = (message, callback) => { channel.emit('message', message); callback?.(); };
  const ipc = installReplicaIpc({ channel, userData: f.userData });
  let pickerCount = 0;
  const bridge = createSyncBridge({ getChild: () => child, trustedFrame: e => e.local, pickImportFile: async () => importFile, pickExportFile: async () => { pickerCount++; return exportFile; } });
  const call = (method, payload) => bridge.invoke({ local: true }, { requestId: randomUUID(), replicaId: f.p.replicaId, method, payload });
  try {
    await call('open', f.p);
    const imported = await call('importDocument', { path: 'a.bin' }); assert.equal(imported.ok, true);
    const blob = { blobHash: imported.value.blobHash, byteLength: imported.value.byteLength };
    await assert.rejects(call('exportVersion', { blob, path: 'C:/arbitrary' }), /invalid/); assert.equal(pickerCount, 0);
    await assert.rejects(bridge.invoke({ local: false }, { requestId: randomUUID(), replicaId: f.p.replicaId, method: 'exportVersion', payload: { blob } }), /untrusted/);
    assert.deepEqual((await call('exportVersion', { blob })).value, { cancelled: false });
    assert.deepEqual(await readFile(exportFile), Buffer.from([0, 7, 255, 3]));
    const service = ipc.getReplica(f.p.replicaId);
    assert.deepEqual(await readFile(join(service.workingRoot, 'a.bin')), Buffer.from([0, 7, 255, 3]));
    assert.equal((await service.snapshot()).status.pendingCount, 1);
  } finally { bridge.close(); await ipc.close(); }
});

test('remote apply slot only sends immutable prepared operations and returns results wrapper', async t => {
  const { installReplicaIpc } = await import('../local/sync/replica-ipc.mjs');
  const f = await fixture(t); await f.service.close(); const channel = new EventEmitter(); channel.send = () => {};
  let calls = 0;
  const ipc = installReplicaIpc({ channel, userData: f.userData, transportFactory: async options => {
    assert.equal(options.profile.replicaId, f.p.replicaId); assert.equal(options.objects.root, join(ipc.getReplica(f.p.replicaId).root, 'objects'));
    return { apply: async operations => { calls++; return operations.map(op => ({ opId: op.opId, status: 'blocked', errorCode: 'fixture' })); } };
  } });
  const call = (method, payload) => ipc.dispatch({ requestId: randomUUID(), replicaId: f.p.replicaId, method, payload });
  try {
    await call('open', f.p); const s = ipc.getReplica(f.p.replicaId); await save(s, 'A'); const [op] = await s.preparePending(10);
    await assert.rejects(call('apply', { operations: [{ ...op, baseRevision: 'forged' }] }), /not-prepared/); assert.equal(calls, 0);
    const response = await call('apply', { operations: [op] }); assert.equal(response.results[0].opId, op.opId); assert.equal(calls, 1);
  } finally { await ipc.close(); }
});

test('folder removal waits for prepared child A and its later move B', async t => {
  const { service: s } = await fixture(t);
  await s.request('/api/folder', 'POST', { path: 'old' }); await acknowledgeAll(s);
  await save(s, 'A', 'old/a.md'); const [a] = await s.preparePending(10);
  await s.request('/api/folder?path=old', 'PATCH', { newPath: 'new' });
  let pending = await s.preparePending(100);
  assert.equal(pending.some(op => op.kind === 'rmdir'), false);
  await s.confirm({ opId: a.opId, status: 'applied', confirmed: { ...(await s.snapshot()).entries.find(e => e.local.entryId === a.entryId).local, ...a.after, revision: 'host-A' } });
  pending = await s.preparePending(100);
  const move = pending.find(op => op.entryId === a.entryId); assert.equal(move.kind, 'move');
  assert.ok(pending.find(op => op.kind === 'rmdir').dependsOn.includes(move.opId));
});

test('preflight rejects a cyclic incoming move before persisting any intent', async t => {
  const { service: s } = await fixture(t); const a = await remote(s, 'A', 'a.md'), b = await remote(s, 'B', 'b.md');
  await s.persistIncoming({ nextCursor: 'e:1', initialCopy: { snapshotToken: 's', atCursor: 'e:1', pageCursor: null }, items: [pull(a), pull(b)] });
  const snapshot = await s.snapshot();
  const items = [a, b].map((v, i) => ({ expectedLocalHead: snapshot.entries.find(e => e.local.entryId === v.entryId).localHead, decision: { action: 'pull', reason: 'move', base: v, local: v, remote: { ...v, path: i ? 'a.md' : 'b.md', revision: randomUUID() } } }));
  await assert.rejects(s.persistIncoming({ nextCursor: 'e:2', items }), /cyclic-file-plan/);
  const db = new DatabaseSync(join(s.root, 'replica.sqlite')); assert.equal(db.prepare('SELECT count(*) AS n FROM file_intents').get().n, 0); db.close();
  assert.equal((await s.request('/api/note?path=a.md', 'GET')).data.content, 'A');
  assert.equal((await s.snapshot()).cursor, 'e:1');
});

test('configure cannot disable an incomplete or newly edited replica after a UI check', async t => {
  const { service: s } = await fixture(t);
  await assert.rejects(s.configure({ offlineEnabled: false, mode: 'manual' }), /replica-not-clean/);
  await s.persistIncoming({ nextCursor: 'e:1', epoch: 'e', initialCopy: { snapshotToken: 's', atCursor: 'e:1', pageCursor: null }, items: [] });
  assert.equal((await s.snapshot()).status.pendingCount, 0);
  await save(s, 'late edit');
  await assert.rejects(s.configure({ offlineEnabled: false, mode: 'manual' }), /replica-not-clean/);
  assert.equal((await s.snapshot()).profile.offlineEnabled, true);
  await s.preparePending(10);
  await assert.rejects(s.configure({ offlineEnabled: false, mode: 'manual' }), /replica-not-clean/);
});

test('directory export preserves working bytes, prepared operations and all historic objects without live SQLite copy', async t => {
  const { service: s } = await fixture(t); await save(s, 'first'); const [prepared] = await s.preparePending(10); await save(s, 'second');
  const before = await s.snapshot(); const destination = await mkdtemp(join(tmpdir(), 'pentamark-backup-'));
  t.after(() => rm(destination, { recursive: true, force: true }));
  assert.equal(typeof s.exportReplica, 'function');
  const result = await s.exportReplica(destination); assert.equal(result.cancelled, false); assert.equal(result.format, 'directory');
  const root = join(destination, result.directoryName);
  const manifest = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8'));
  assert.equal(manifest.format, 'pentamark-replica-directory-v1');
  assert.deepEqual(manifest.snapshot.preparedOperations, [prepared]);
  assert.deepEqual(manifest.snapshot.profile, before.profile);
  assert.equal(await readFile(join(root, 'working/a.md'), 'utf8'), 'second');
  assert.equal(await readFile(join(root, 'objects', prepared.after.blobHash), 'utf8'), 'first');
  assert.ok(manifest.versions.length >= 2);
  await assert.rejects(readFile(join(root, 'replica.sqlite')), /ENOENT/);
  assert.deepEqual(await s.snapshot(), before);
});

test('cancelled replica export does not report completion or dispatch an export', async () => {
  const { createSyncBridge } = require('../desktop/sync-ipc.cjs');
  const child = new EventEmitter(); child.connected = true; let sent = 0; child.send = () => { sent++; };
  let finish;
  const bridge = createSyncBridge({ getChild: () => child, trustedFrame: () => true, pickExportDirectory: () => new Promise(resolve => { finish = resolve; }) });
  const command = { requestId: randomUUID(), replicaId: randomUUID(), method: 'exportReplica', payload: {} };
  const pending = bridge.invoke({}, command);
  while (!finish) await new Promise(resolve => setImmediate(resolve));
  await assert.rejects(bridge.invoke({}, command), /duplicate-request-id/);
  finish(null); const response = await pending;
  assert.deepEqual(response.value, { cancelled: true }); assert.equal(sent, 0); bridge.close();
});

test('replica export cannot report complete when a referenced historical object is missing', async t => {
  const { service: s } = await fixture(t); await save(s, 'history'); const old = (await entry(s)).local; await save(s, 'current');
  await rm(s.objects.path(old.blobHash)); // Deliberately corrupt only this generated fixture.
  const destination = await mkdtemp(join(tmpdir(), 'pentamark-incomplete-export-')); t.after(() => rm(destination, { recursive: true, force: true }));
  await assert.rejects(s.exportReplica(destination), /ENOENT/);
});
