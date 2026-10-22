import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';

const CHUNK = 1048576;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const remote = client => ({ 'x-forwarded-for': '100.100.10.20', 'x-pentamark-client': client });
async function fixture(t, { custom = false, desktop = false } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'pm-server-sync-'));
  const data = join(root, 'data'); await mkdir(data);
  await writeFile(join(data, 'pentamark.config.json'), JSON.stringify({ openBrowser: false, maxUploadMB: 40,
    lockEditedNotes: true, cleanupUnusedAssets: false, aiBridgeEnabled: true, aiBridgeToken: 'fixture-secret-token',
    userPermissions: { reader: 'viewer', writer: 'editor', owner: 'admin', locker: 'editor' } }));
  // A child isolates all module globals and environment from other workers/tests.
  const child = spawn(process.execPath, ['--input-type=module', '--eval', `
    import { createServer } from 'node:http';
    import * as app from ${JSON.stringify(new URL('../local/server.mjs', import.meta.url).href)};
    await app.initializeVaultHost();
    const server = createServer(app.requestHandler);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    process.send({type:'fixture:ready', port:server.address().port});
    process.on('message', async message => {
      if (message.type === 'fixture:close-host') { await app.closeVaultHost(); process.send({type:'fixture:host-closed'}); }
      if (message.type === 'fixture:stop') {
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
        await app.closeVaultHost(); process.disconnect();
      }
    });
  `], { env: { ...process.env, PENTAMARK_DATA_DIR: data, PENTAMARK_VAULT_DIR: custom ? join(root, 'custom') : '',
    PENTAMARK_DESKTOP: desktop ? '1' : '0', PENTAMARK_USER_DATA_DIR: join(root, 'profile'), PENTAMARK_NO_BROWSER: '1' },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'], windowsHide: true });
  let output = ''; child.stdout.on('data', b => { output += b; }); child.stderr.on('data', b => { output += b; });
  const ended = new Promise(resolve => child.once('exit', resolve));
  function message(predicate, send) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => finish(new Error('fixture timeout: ' + output)), 10000);
      const listener = value => { if (predicate(value)) finish(null, value); };
      const exit = code => finish(new Error(`fixture exited ${code}: ${output}`));
      function finish(error, value) { clearTimeout(timer); child.off('message', listener); child.off('exit', exit); error ? reject(error) : resolve(value); }
      child.on('message', listener); child.once('exit', exit); if (send) child.send(send);
    });
  }
  t.after(async () => {
    if (child.connected) child.send({ type: 'fixture:stop' });
    const timeout = setTimeout(() => child.kill(), 10000);
    await ended; clearTimeout(timeout);
    await rm(root, { recursive: true, force: true });
  });
  const ready = await message(m => m.type === 'fixture:ready');
  const base = `http://127.0.0.1:${ready.port}`;
  const request = async (path, body, headers = {}, method = body === undefined ? 'GET' : 'POST') => {
    const response = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, data: await response.json() };
  };
  const config = changes => request('/api/config', { lockEditedNotes: true, aiBridgeEnabled: true, ...changes }, {}, 'PUT');
  const apply = async (op, client = 'owner') => (await request('/api/sync/v1/apply', { operations: [op] }, remote(client))).data.results?.[0];
  const hello = await request('/api/sync/v1/hello');
  return { root, base, request, config, apply, hello, path: name => custom ? name : 'notes/' + name,
    closeHost: () => message(m => m.type === 'fixture:host-closed', { type: 'fixture:close-host' }),
    ipc: async (replicaId, method, payload) => {
      const requestId = randomUUID();
      return message(m => m.type === 'pentamark:sync:result' && m.requestId === requestId,
        { type: 'pentamark:sync:command', command: { requestId, replicaId, method, payload } });
    } };
}
async function put(f, path, content = 'original', before = null) {
  const bytes = Buffer.from(content), digest = hash(bytes);
  const uploaded = await fetch(`${f.base}/api/sync/v1/blobs/${digest}?offset=0`, {
    method: 'PUT', headers: { ...remote('owner'), 'Content-Range': `bytes 0-${bytes.length - 1}/${bytes.length}` }, body: bytes });
  assert.equal(uploaded.status, 200);
  return { vaultId: f.hello.data.vaultId, replicaId: randomUUID(), opId: randomUUID(), entryId: before?.entryId ?? randomUUID(),
    kind: 'put', baseRevision: before?.revision ?? null, after: { path, kind: 'note', blobHash: digest, byteLength: bytes.length }, dependsOn: [] };
}

for (const custom of [false, true]) test(`real server permissions, locks and durable replay (${custom ? 'custom' : 'default'} vault)`, async t => {
  const f = await fixture(t, { custom });
  assert.equal(f.hello.status, 200, 'sync handler must be mounted in requestHandler');
  assert.equal(f.hello.data.protocol, 1);
  assert.equal((await f.request('/api/sync/v1/snapshot', {}, remote('reader'))).status, 200);
  assert.equal((await f.request('/api/config', {}, remote('writer'), 'PUT')).status, 403);
  assert.equal((await f.request('/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/list' }, { Authorization: 'Bearer wrong' })).status, 401);
  assert.equal((await f.request('/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/list' }, {
    Authorization: 'Bearer fixture-secret-token', Accept: 'application/json, text/event-stream', 'Content-Type': 'application/json' })).status, 200);
  const op = await put(f, f.path('a.md'));
  assert.equal((await f.apply(op, 'reader')).errorCode, 'permission-denied');
  const first = await f.apply(op, 'writer'); assert.equal(first.status, 'applied');
  const sseAbort = new AbortController();
  const sse = await fetch(f.base + '/api/events?clientId=locker', { headers: remote('locker'), signal: sseAbort.signal });
  t.after(() => sseAbort.abort());
  assert.equal(sse.status, 200);
  assert.equal((await f.request('/api/presence', { clientId: 'locker', path: 'a.md', editing: true }, remote('locker'))).status, 200);
  const update = await put(f, op.after.path, 'new', first.confirmed);
  assert.equal((await f.apply(update)).errorCode, 'locked');
  // Lost ACK retries survive both a new lock and a role downgrade.
  await f.request('/api/permission', { clientId: 'writer', permission: 'viewer' }, {}, 'PUT');
  const replay = await f.apply(op, 'writer');
  assert.equal(replay.status, 'already-applied'); assert.deepEqual(replay.confirmed, first.confirmed);
  const deletion = { ...op, opId: randomUUID(), kind: 'delete', baseRevision: first.confirmed.revision, after: null };
  assert.equal((await f.apply(deletion, 'locker')).errorCode, 'permission-denied');
  const move = { ...op, opId: randomUUID(), kind: 'move', baseRevision: first.confirmed.revision, after: { ...op.after, path: f.path('b.md') } };
  assert.equal((await f.apply(move)).errorCode, 'locked');
  await f.request('/api/presence', { clientId: 'locker', path: 'destination.md', editing: true }, remote('locker'));
  assert.equal((await f.apply(await put(f, f.path('destination.md')))).errorCode, 'locked');
  const dir = { ...op, opId: randomUUID(), entryId: randomUUID(), kind: 'mkdir', after: { path: f.path('folder'), kind: 'directory', blobHash: null, byteLength: 0 } };
  const made = await f.apply(dir); assert.equal(made.status, 'applied');
  const remove = { ...dir, opId: randomUUID(), kind: 'rmdir', baseRevision: made.confirmed.revision, after: null };
  assert.equal((await f.apply(remove, 'locker')).errorCode, 'permission-denied');
  await f.request('/api/presence', { clientId: 'locker', path: 'folder/future.md', editing: true }, remote('locker'));
  assert.equal((await f.apply(remove)).errorCode, 'locked');
  assert.equal((await f.request('/api/sync/v1/changes?cursor=' + randomUUID() + ':0')).status, 409);
  const snapshot = (await f.request('/api/sync/v1/snapshot', {})).data;
  assert.ok(snapshot.entries.some(e => e.entryId === op.entryId && e.revision === first.confirmed.revision));
  await f.request('/api/presence', { clientId: 'locker', path: '', editing: false }, remote('locker'));
  assert.equal((await f.apply(update)).status, 'applied');
  const reader = sse.body.getReader();
  const deadline = setTimeout(() => sseAbort.abort(), 5000);
  let events = '';
  try {
    while (!events.includes('"source":"sync"')) {
      const { value, done } = await reader.read(); if (done) break;
      events += Buffer.from(value).toString('utf8');
    }
    assert.ok(events.includes('"source":"sync"'));
    assert.ok(events.includes(update.after.blobHash.slice(0, 20)), 'legacy listeners receive content revision, not sync revision');
  } finally { clearTimeout(deadline); reader.releaseLock(); }
  sseAbort.abort();
  await f.closeHost();
  assert.equal((await f.request('/api/sync/v1/hello')).status, 503);
});

test('real server streams over 32MiB and live limits preserve lost-ACK replay', async t => {
  const f = await fixture(t); assert.equal(f.hello.status, 200);
  const chunk = Buffer.alloc(CHUNK, 31), tail = Buffer.from('end'), total = 33 * CHUNK + tail.length;
  const sha = createHash('sha256'); for (let i = 0; i < 33; i++) sha.update(chunk);
  const digest = sha.update(tail).digest('hex');
  for (let offset = 0; offset < total; offset += CHUNK) {
    const bytes = offset < 33 * CHUNK ? chunk : tail;
    const response = await fetch(`${f.base}/api/sync/v1/blobs/${digest}?offset=${offset}`, {
      method: 'PUT', headers: { ...remote('writer'), 'Content-Range': `bytes ${offset}-${offset + bytes.length - 1}/${total}` }, body: bytes });
    assert.equal(response.status, 200);
  }
  const op = { vaultId: f.hello.data.vaultId, replicaId: randomUUID(), opId: randomUUID(), entryId: randomUUID(), kind: 'put',
    baseRevision: null, after: { path: 'assets/large.bin', kind: 'asset', blobHash: digest, byteLength: total }, dependsOn: [] };
  const first = await f.apply(op); assert.equal(first.status, 'applied');
  const actual = createHash('sha256'); let received = 0;
  for await (const bytes of (await fetch(f.base + '/api/sync/v1/blobs/' + digest)).body) { actual.update(bytes); received += bytes.length; }
  assert.equal(received, total); assert.equal(actual.digest('hex'), digest);
  await f.config({ maxUploadMB: 1 });
  assert.equal((await f.request('/api/sync/v1/hello')).data.maxFileBytes, CHUNK);
  assert.equal((await f.apply(op)).status, 'already-applied');
  assert.equal((await f.apply({ ...op, opId: randomUUID(), entryId: randomUUID(), after: { ...op.after, path: 'assets/denied.bin' } })).errorCode, 'file-too-large');
  const tooLarge = await fetch(`${f.base}/api/sync/v1/blobs/${digest}?offset=0`, { method: 'PUT', headers: { 'x-sync-byte-length': String(total) }, body: chunk });
  assert.equal(tooLarge.status, 413);
  await f.config({ maxUploadMB: 40 });
  assert.equal((await f.request('/api/sync/v1/hello')).data.maxFileBytes, 40 * CHUNK);
  assert.equal((await f.apply({ ...op, opId: randomUUID(), entryId: randomUUID(), after: { ...op.after, path: 'assets/allowed.bin' } })).status, 'applied');
});

test('desktop server installs private IPC before ready and serves capability media before public routing', async t => {
  const f = await fixture(t, { desktop: true });
  const replicaId = randomUUID();
  const profile = { replicaId, vaultId: randomUUID(), serverId: randomUUID(), origin: f.base, offlineEnabled: true, mode: 'manual' };
  assert.equal((await f.ipc(replicaId, 'open', profile)).ok, true, 'IPC listener must be installed before ready');
  const created = await f.ipc(replicaId, 'request', { url: '/api/note', method: 'POST', body: { path: 'private.md', content: 'replica only' } });
  assert.equal(created.ok, true);
  const snapshot = await f.ipc(replicaId, 'snapshot', {});
  const entryId = snapshot.value.entries.find(e => e.local?.path === 'private.md').local.entryId;
  const media = await f.ipc(replicaId, 'mediaUrl', { entryId });
  const response = await fetch(f.base + media.value.url);
  assert.equal(response.status, 200); assert.equal(await response.text(), 'replica only');
  assert.equal(response.headers.get('content-disposition'), 'attachment');
  const denied = await fetch(f.base + media.value.url.replace(/\/[a-f0-9]{64}\//, '/' + '0'.repeat(64) + '/'));
  assert.equal(denied.status, 403);
  assert.equal((await f.request('/api/sync/v1/snapshot', {})).data.entries.some(e => e.path.endsWith('private.md')), false);
  await f.closeHost();
  assert.equal((await fetch(f.base + media.value.url)).status, 503);
});
