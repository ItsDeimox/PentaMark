import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { createHostService } from '../local/sync/host-service.mjs';

const url = new URL('../local/sync/routes.mjs', import.meta.url);
const implementation = existsSync(url) ? await import(url) : {};
async function fixture(t, options = {}) {
  assert.equal(typeof implementation.createSyncHandler, 'function', 'versioned HTTP handler is required');
  const root = await mkdtemp(join(tmpdir(), 'pm-protocol-'));
  const host = await createHostService({ dataRoot: join(root, 'data'), vaultRoot: join(root, 'vault'), ...options.hostOptions });
  const handler = await implementation.createSyncHandler({ host, maxFileBytes: 40 * 1048576,
    permission: req => req.headers['x-test-role'] || 'admin', authorizeOperation: async () => true, ...options });
  const server = createServer(async (req, res) => { if (!await handler(req, res)) { res.writeHead(404); res.end(); } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await host.close(); await rm(root, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}/api/sync/v1`;
  async function request(path, body, headers = {}, method = body === undefined ? 'GET' : 'POST') {
    const response = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const data = await response.json();
    return { status: response.status, data: data.results ?? data };
  }
  return { host, root, base, request };
}
async function operation(f, path = 'a.md', text = 'old', before = null) {
  return { vaultId: f.host.vaultId, replicaId: randomUUID(), opId: randomUUID(), entryId: before?.entryId ?? randomUUID(),
    kind: 'put', baseRevision: before?.revision ?? null, after: { path, kind: 'note', ...await f.host.objects.put(text) }, dependsOn: [] };
}

test('hello identifies host and refuses incompatible version or identity', async t => {
  const f = await fixture(t);
  assert.deepEqual((await f.request('/hello')).data, { protocol: 1, vaultId: f.host.vaultId, serverId: f.host.serverId,
    epoch: f.host.epoch, maxFileBytes: 40 * 1048576, chunkBytes: 1048576 });
  assert.equal((await f.request('/hello', undefined, { 'x-sync-protocol': '2' })).status, 409);
  assert.equal((await f.request('/hello', undefined, { 'x-sync-vault-id': randomUUID() })).status, 409);
  assert.equal((await f.request('/hello', undefined, { 'x-sync-server-id': randomUUID() })).status, 409);
});

test('snapshot pagination pins manifest and immutable blobs while later changes remain visible', async t => {
  const f = await fixture(t);
  const a = await f.host.apply(await operation(f));
  await f.host.apply(await operation(f, 'b.md', 'second'));
  const first = (await f.request('/snapshot', { limit: 1 }, { 'x-test-role': 'viewer' })).data;
  assert.equal(first.entries.length, 1);
  const changed = await f.host.apply(await operation(f, 'a.md', 'new', a.confirmed));
  await f.host.apply(await operation(f, 'c.md', 'third'));
  const path = `/snapshot?token=${first.snapshotToken}&cursor=${first.pageCursor}`;
  const next = (await f.request(path)).data;
  assert.deepEqual((await f.request(`/snapshot?snapshotToken=${first.snapshotToken}&cursor=${first.pageCursor}`)).data, next);
  assert.equal(next.atCursor, first.atCursor);
  assert.equal(next.pageCursor, null);
  assert.deepEqual((await f.request(path)).data, next);
  assert.deepEqual([...first.entries, ...next.entries].map(e => e.path).sort(), ['a.md', 'b.md']);
  assert.equal(await (await fetch(f.base + '/blobs/' + a.confirmed.blobHash)).text(), 'old');
  const changes = (await f.request(`/changes?cursor=${first.atCursor}`)).data;
  assert.equal(changes.entries.length, 2);
  assert.equal(changes.entries[0].revision, changed.confirmed.revision);
  assert.equal((await f.request(`/changes?cursor=${randomUUID()}:0`)).status, 409);
  assert.equal((await f.request(`/snapshot?token=${randomUUID()}&cursor=1`)).status, 410);
});

test('apply enforces semantic permissions and locks before writes, including delete in POST', async t => {
  const f = await fixture(t, { authorizeOperation: async (_req, op, current) => op.after?.path !== 'locked.md' && current?.path !== 'locked.md' });
  const op = await operation(f);
  assert.equal((await f.request('/apply', { operations: [op] }, { 'x-test-role': 'viewer' })).data[0].status, 'blocked');
  const applied = (await f.request('/apply', { operations: [op] }, { 'x-test-role': 'editor' })).data[0];
  assert.equal(applied.status, 'applied');
  assert.equal(await readFile(join(f.root, 'vault/a.md'), 'utf8'), 'old');
  const deletion = { ...op, opId: randomUUID(), kind: 'delete', after: null, baseRevision: applied.confirmed.revision };
  assert.equal((await f.request('/apply', { operations: [deletion] }, { 'x-test-role': 'editor' })).data[0].errorCode, 'permission-denied');
  const locked = await operation(f, 'locked.md');
  assert.equal((await f.request('/apply', { operations: [locked] })).data[0].errorCode, 'locked');
  await f.host.apply(locked);
  const head = (await f.host.openSnapshot()).entries.find(e => e.path === 'locked.md');
  assert.equal((await f.request('/apply', { operations: [{ ...locked, opId: randomUUID(), kind: 'move', baseRevision: head.revision, after: { ...locked.after, path: 'free.md' } }] })).data[0].errorCode, 'locked');
  const dir = { ...op, opId: randomUUID(), entryId: randomUUID(), kind: 'mkdir', after: { path: 'folder', kind: 'directory', blobHash: null, byteLength: 0 } };
  const made = (await f.request('/apply', { operations: [dir] })).data[0];
  assert.equal((await f.request('/apply', { operations: [{ ...dir, opId: randomUUID(), kind: 'rmdir', after: null, baseRevision: made.confirmed.revision }] }, { 'x-test-role': 'editor' })).data[0].status, 'blocked');
});

test('apply validates UUID, size, hash, path and dependency fields with explicit per-op results', async t => {
  const f = await fixture(t);
  const op = await operation(f);
  const invalid = [null, { ...op, opId: 'bad' }, { ...op, replicaId: 'bad' }, { ...op, entryId: 'bad' },
    { ...op, vaultId: randomUUID() }, { ...op, dependsOn: ['bad'] }, { ...op, dependsOn: [op.opId] },
    { ...op, after: { ...op.after, byteLength: -1 } }, { ...op, after: { ...op.after, byteLength: 40 * 1048576 + 1 } },
    { ...op, after: { ...op.after, blobHash: 'bad' } }, { ...op, after: { ...op.after, path: '../escape.md' } },
    { ...op, after: { ...op.after, path: '.private/a.md' } }, { ...op, dependsOn: [randomUUID()] }];
  const response = await f.request('/apply', { operations: invalid });
  assert.equal(response.status, 200);
  assert.equal(response.data.length, invalid.length);
  assert.ok(response.data.every(r => r.status === 'blocked' && r.errorCode));
  assert.equal((await f.host.openSnapshot()).entries.length, 0);
  assert.equal((await f.request('/apply', { operations: Array(101).fill(op) })).status, 413);
});

test('apply acknowledges committed versions, replays idempotently and never treats null base as overwrite', async t => {
  const f = await fixture(t);
  const op = await operation(f);
  const first = (await f.request('/apply', { operations: [op] })).data[0];
  assert.equal(first.status, 'applied');
  const envelope = await (await fetch(f.base + '/apply', { method: 'POST', body: JSON.stringify({ operations: [op] }) })).json();
  assert.ok(Array.isArray(envelope.results), 'native JSON transport requires an object envelope');
  assert.equal((await f.request('/apply', { operations: [op] })).data[0].status, 'already-applied');
  const collision = (await f.request('/apply', { operations: [await operation(f, 'a.md', 'collision')] })).data[0];
  assert.equal(collision.status, 'conflict');
  assert.equal(await readFile(join(f.root, 'vault/a.md'), 'utf8'), 'old');
  const dependent = { ...await operation(f, 'b.md'), replicaId: op.replicaId, dependsOn: [op.opId] };
  assert.equal((await f.request('/apply', { operations: [dependent] })).data[0].status, 'applied');
  await writeFile(join(f.root, 'vault/a.md'), 'external');
  assert.ok((await f.request('/changes?cursor=' + (await f.host.readChanges(null)).nextCursor)).data.entries.some(e => e.path === 'a.md'));
});

test('an interrupted commit cannot produce an applied HTTP acknowledgement', async t => {
  let armed = false;
  const f = await fixture(t, { hostOptions: { interrupt: async point => { if (armed && point === 'before-commit') throw new Error('interrupted:before-commit'); } } });
  const op = await operation(f);
  armed = true;
  const response = await f.request('/apply', { operations: [op] });
  assert.equal(response.status, 503);
  assert.equal(response.data.errorCode, 'host-unavailable');
  armed = false;
  assert.equal((await f.request('/apply', { operations: [op] })).data[0].status, 'already-applied');
});

test('snapshot expiration is explicit and oversized or malformed JSON cannot mutate', async t => {
  let time = 0;
  const f = await fixture(t, { snapshotTtlMs: 10, now: () => time });
  const first = (await f.request('/snapshot', {})).data;
  time = 11;
  assert.equal((await f.request(`/snapshot?token=${first.snapshotToken}&cursor=0`)).status, 410);
  assert.equal((await f.request('/snapshot', null)).status, 400);
  assert.equal((await f.request('/apply', { operations: [], padding: 'x'.repeat(1048576) })).status, 413);
  assert.equal((await fetch(f.base + '/apply', { method: 'POST', body: '{' })).status, 400);
  assert.equal((await f.host.openSnapshot()).entries.length, 0);
});

test('live configuration reductions constrain hello, apply and uploads; advertisement never exceeds host capacity', async t => {
  let maximum = 10;
  const f = await fixture(t, { maxFileBytes: () => maximum, hostOptions: { maxFileBytes: 8 } });
  assert.equal((await f.request('/hello')).data.maxFileBytes, 8);
  const op = await operation(f, 'a.md', 'four');
  maximum = 3;
  assert.equal((await f.request('/hello')).data.maxFileBytes, 3);
  assert.equal((await f.request('/apply', { operations: [op] })).data[0].errorCode, 'file-too-large');
  const upload = await fetch(f.base + '/blobs/' + op.after.blobHash + '?offset=0', {
    method: 'PUT', headers: { 'x-sync-byte-length': '4' }, body: 'four' });
  assert.equal(upload.status, 413);
  assert.equal((await f.host.openSnapshot()).entries.length, 0);
});

for (const policy of ['permission', 'lock', 'limit']) test(`queued apply rechecks ${policy} at the host mutation boundary`, async t => {
  let role = 'admin', unlocked = true, maximum = 10, armed = false;
  const f = await fixture(t, { permission: () => role, authorizeOperation: () => unlocked, maxFileBytes: () => maximum,
    hostOptions: { interrupt: async point => {
      if (armed && point === 'after-intent') {
        armed = false;
        if (policy === 'permission') role = 'viewer';
        if (policy === 'lock') unlocked = false;
        if (policy === 'limit') maximum = 1;
      }
    } } });
  const op = await operation(f);
  armed = true;
  const denied = (await f.request('/apply', { operations: [op] })).data[0];
  assert.equal(denied.status, 'blocked');
  assert.equal(denied.errorCode, policy === 'permission' ? 'permission-denied' : policy === 'lock' ? 'locked' : 'file-too-large');
  assert.equal(existsSync(join(f.root, 'vault/a.md')), false);
  role = 'admin'; unlocked = true; maximum = 10;
  assert.equal((await f.request('/apply', { operations: [op] })).data[0].status, 'applied');
});

for (const policy of ['permission', 'lock', 'limit']) test(`lost ACK replay survives changed ${policy} without another mutation`, async t => {
  let role = 'admin', unlocked = true, maximum = 10;
  const f = await fixture(t, { permission: () => role, authorizeOperation: () => unlocked,
    maxFileBytes: () => maximum, hostOptions: { getMaxFileBytes: () => maximum } });
  const op = await operation(f);
  // Commit succeeds, but the client has not persisted the ACK and retries later.
  const first = (await f.request('/apply', { operations: [op] })).data[0];
  assert.equal(first.status, 'applied');
  if (policy === 'permission') role = 'viewer';
  if (policy === 'lock') unlocked = false;
  if (policy === 'limit') maximum = 1;
  const replay = (await f.request('/apply', { operations: [op] })).data[0];
  assert.equal(replay.status, 'already-applied');
  assert.deepEqual(replay.confirmed, first.confirmed);
  assert.equal(f.host.history(op.entryId).length, 1);
});

for (const kind of ['delete', 'rmdir']) test(`queued ${kind} rechecks admin downgrade to editor`, async t => {
  let role = 'admin', armed = false;
  const f = await fixture(t, { permission: () => role, hostOptions: { interrupt: async point => {
    if (armed && point === 'after-intent') { armed = false; role = 'editor'; }
  } } });
  const create = await operation(f);
  if (kind === 'rmdir') { create.kind = 'mkdir'; create.after = { path: 'folder', kind: 'directory', blobHash: null, byteLength: 0 }; }
  const initial = (await f.request('/apply', { operations: [create] })).data[0];
  const op = { ...create, opId: randomUUID(), kind, after: null, baseRevision: initial.confirmed.revision };
  armed = true;
  const denied = (await f.request('/apply', { operations: [op] })).data[0];
  assert.equal(denied.errorCode, 'permission-denied');
  assert.equal(existsSync(join(f.root, 'vault', create.after.path)), true);
  role = 'admin';
  assert.equal((await f.request('/apply', { operations: [op] })).data[0].status, 'applied');
});

test('raised host and route limits take effect without losing existing snapshot tokens', async t => {
  let maximum = 2;
  const f = await fixture(t, { maxFileBytes: () => maximum, hostOptions: { getMaxFileBytes: () => maximum } });
  const snapshot = (await f.request('/snapshot', {})).data;
  maximum = 8;
  assert.equal((await f.request('/hello')).data.maxFileBytes, 8);
  const op = await operation(f, 'raised.md', 'four');
  assert.equal((await f.request('/apply', { operations: [op] })).data[0].status, 'applied');
  assert.equal((await fetch(f.base + '/blobs/' + op.after.blobHash + '?offset=0', {
    method: 'PUT', headers: { 'x-sync-byte-length': '4' }, body: 'four' })).status, 200);
  assert.equal((await f.request(`/snapshot?snapshotToken=${snapshot.snapshotToken}&cursor=0`)).status, 200);
});

test('snapshot slots are reserved before awaiting the host and released on failure', async t => {
  const f = await fixture(t, { maxSnapshots: 1 });
  const original = f.host.openSnapshot;
  const entered = Promise.withResolvers(), release = Promise.withResolvers();
  let calls = 0;
  f.host.openSnapshot = async () => {
    if (++calls === 1) { entered.resolve(); await release.promise; throw new Error('snapshot-fixture-failure'); }
    release.resolve();
    return original();
  };
  const first = f.request('/snapshot', {});
  await entered.promise;
  let second;
  try { second = await f.request('/snapshot', {}); }
  finally { release.resolve(); }
  assert.equal((await first).status, 503);
  assert.equal(second.status, 429);
  f.host.openSnapshot = original;
  assert.equal((await f.request('/snapshot', {})).status, 200);
});
