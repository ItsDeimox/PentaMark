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
