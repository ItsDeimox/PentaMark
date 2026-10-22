import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { randomUUID, createHash } from 'node:crypto';
import { createHostService } from '../local/sync/host-service.mjs';
import { createSyncHandler } from '../local/sync/routes.mjs';
import { createObjectStore } from '../local/sync/objects.mjs';

const moduleUrl = new URL('../local/sync/transport.mjs', import.meta.url);
const implementation = existsSync(moduleUrl) ? await import(moduleUrl) : {};
const CHUNK = 1048576;
async function fixture(t, intercept) {
  assert.equal(typeof implementation.createNativeSyncTransport, 'function', 'native bounded RemotePort is required');
  const root = await mkdtemp(join(tmpdir(), 'pm-client-transport-'));
  const host = await createHostService({ dataRoot: join(root, 'data'), vaultRoot: join(root, 'vault'), maxFileBytes: 40 * CHUNK });
  const handler = await createSyncHandler({ host, maxFileBytes: 40 * CHUNK, permission: () => 'admin', authorizeOperation: async () => true });
  const requests = [];
  const server = createServer(async (req, res) => {
    requests.push({ method: req.method, url: req.url, headers: req.headers });
    if (await intercept?.(req, res, host)) return;
    if (!await handler(req, res)) { res.writeHead(404); res.end(); }
  });
  server.on('clientError', (_error, socket) => socket.destroy());
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await host.close(); await rm(root, { recursive: true, force: true }); });
  const objects = await createObjectStore(join(root, 'replica/objects'));
  const profile = { vaultId: host.vaultId, serverId: host.serverId, replicaId: randomUUID(), origin: `http://127.0.0.1:${server.address().port}`, mode: 'manual', offlineEnabled: true };
  const options = { profile, objects, stagingRoot: join(root, 'replica/staging') };
  const remote = await implementation.createNativeSyncTransport(options);
  return { root, host, objects, profile, options, remote, requests };
}
async function* content(size) {
  const block = Buffer.alloc(65536, 71);
  while (size > 0) { const n = Math.min(size, block.length); yield block.subarray(0, n); size -= n; }
}
async function transfer(remote, direction, ref) {
  let offset = 0;
  for (;;) {
    const progress = await remote[direction](ref, offset);
    assert.equal(progress.blobHash, ref.blobHash);
    assert.ok(progress.verifiedBytes > offset || ref.byteLength === 0);
    if (progress.complete) { assert.equal(progress.verifiedBytes, ref.byteLength); return; }
    assert.equal(progress.verifiedBytes % CHUNK, 0);
    offset = progress.verifiedBytes;
  }
}

test('real host: 33 MiB native upload/download, bounded ranges, object apply envelope and snapshotToken', async t => {
  const f = await fixture(t); await f.remote.handshake(f.profile);
  const ref = await f.objects.put(content(33 * CHUNK + 10));
  await transfer(f.remote, 'uploadBlob', ref); await f.host.objects.verify(ref);
  // Lost final response: replay of segment zero must accept already verified total.
  assert.deepEqual(await f.remote.uploadBlob(ref, 0), { blobHash: ref.blobHash, verifiedBytes: ref.byteLength, complete: true });
  const op = { vaultId: f.profile.vaultId, replicaId: f.profile.replicaId, opId: randomUUID(), entryId: randomUUID(), kind: 'put', baseRevision: null, after: { path: 'large.bin', kind: 'asset', ...ref }, dependsOn: [] };
  const [result] = await f.remote.apply([op]); assert.equal(result.status, 'applied');
  const first = await f.remote.snapshot();
  assert.equal(first.entries[0].blobHash, ref.blobHash);
  await f.remote.snapshot(first.snapshotToken, '0');
  assert.ok(f.requests.some(r => r.url.includes('snapshotToken=')));
  assert.deepEqual((await f.remote.changes(first.atCursor, 100)).entries, []);
  const downloadObjects = await createObjectStore(join(f.root, 'other/objects'));
  const other = await implementation.createNativeSyncTransport({ ...f.options, objects: downloadObjects, stagingRoot: join(f.root, 'other/staging') });
  await other.handshake(f.profile); await transfer(other, 'downloadBlob', ref); await downloadObjects.verify(ref);
  for (const req of f.requests.filter(r => r.method === 'PUT')) {
    assert.ok(Number(req.headers['content-length']) <= CHUNK);
    assert.match(req.headers['content-range'], /^bytes \d+-\d+\/34603018$/);
  }
  for (const req of f.requests.filter(r => r.url.includes('/blobs/') && r.method === 'GET')) {
    const [, start, end] = /^bytes=(\d+)-(\d+)$/.exec(req.headers.range);
    assert.ok(Number(end) - Number(start) + 1 <= CHUNK);
  }
});

test('durable download resumes after transport recreation and ignores unacknowledged short tail', async t => {
  const f = await fixture(t); const ref = await f.host.objects.put(content(2 * CHUNK + 7));
  await f.remote.handshake(f.profile);
  assert.equal((await f.remote.downloadBlob(ref, 0)).verifiedBytes, CHUNK);
  const stage = join(f.options.stagingRoot, `${ref.blobHash}-${ref.byteLength}.part`);
  await writeFile(stage, Buffer.alloc(17), { flag: 'a' });
  const restarted = await implementation.createNativeSyncTransport(f.options); await restarted.handshake(f.profile);
  assert.equal((await restarted.downloadBlob(ref, 0)).verifiedBytes, 2 * CHUNK);
  assert.equal(f.requests.at(-1).headers.range, 'bytes=1048576-2097151');
  assert.equal((await restarted.downloadBlob(ref, 2 * CHUNK)).complete, true);
  await f.objects.verify(ref);
});

test('empty objects transfer with bytes */0 and final SHA-256 verification', async t => {
  const f = await fixture(t); await f.remote.handshake(f.profile);
  const ref = await f.objects.put(''); await transfer(f.remote, 'uploadBlob', ref);
  assert.equal(f.requests.at(-1).headers['content-range'], 'bytes */0');
  const objects = await createObjectStore(join(f.root, 'empty/objects'));
  const remote = await implementation.createNativeSyncTransport({ ...f.options, objects, stagingRoot: join(f.root, 'empty/staging') });
  await remote.handshake(f.profile); await transfer(remote, 'downloadBlob', ref); await objects.verify(ref);
});

test('refuses content before handshake, wrong identity, oversized blobs and unaligned offsets', async t => {
  const f = await fixture(t); const ref = await f.objects.put('abc');
  await assert.rejects(f.remote.uploadBlob(ref, 0), /handshake-required/);
  await assert.rejects(f.remote.handshake({ ...f.profile, vaultId: randomUUID() }), /identity-mismatch/);
  assert.equal(f.requests.length, 0);
  await f.remote.handshake(f.profile);
  await assert.rejects(f.remote.downloadBlob({ ...ref, byteLength: 41 * CHUNK }, 0), /file-too-large/);
  await assert.rejects(f.remote.uploadBlob(ref, 1), /invalid-offset/);
  assert.equal(f.requests.length, 1);
});

test('malformed upload forward progress is rejected even when response is HTTP 200', async t => {
  let progress;
  const f = await fixture(t, async (req, res) => {
    if (req.method !== 'PUT') return false;
    for await (const _chunk of req) { /* consume actual streaming request */ }
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(progress)); return true;
  });
  await f.remote.handshake(f.profile); const ref = await f.objects.put(content(3 * CHUNK));
  for (const [verifiedBytes, complete] of [[CHUNK + 1, false], [4 * CHUNK, true], [CHUNK, true], [0, false], [3 * CHUNK, false]]) {
    progress = { blobHash: ref.blobHash, verifiedBytes, complete };
    await assert.rejects(f.remote.uploadBlob(ref, 0), /invalid-progress/);
  }
  progress = { blobHash: ref.blobHash, verifiedBytes: 2 * CHUNK, complete: false };
  assert.deepEqual(await f.remote.uploadBlob(ref, 0), progress);
});

test('hash mismatch cannot publish downloaded object or corrupt existing working data', async t => {
  const f = await fixture(t, (req, res) => {
    if (!req.url.includes('/blobs/')) return false;
    res.writeHead(206, { 'Content-Range': 'bytes 0-2/3', 'Content-Length': '3' }); res.end('bad'); return true;
  });
  await f.remote.handshake(f.profile);
  const ref = { blobHash: createHash('sha256').update('abc').digest('hex'), byteLength: 3 };
  await assert.rejects(f.remote.downloadBlob(ref, 0), /hash-mismatch/);
  await assert.rejects(stat(f.objects.path(ref.blobHash)), { code: 'ENOENT' });
});

test('rejects redirected requests and bounds JSON responses', async t => {
  let redirect = true;
  const f = await fixture(t, (req, res) => {
    if (!req.url.endsWith('/snapshot')) return false;
    if (redirect) { res.writeHead(302, { Location: '/api/sync/v1/hello' }); res.end(); }
    else { res.writeHead(200, { 'Content-Length': String(CHUNK + 1) }); res.end(' '.repeat(CHUNK + 1)); }
    return true;
  });
  await f.remote.handshake(f.profile);
  await assert.rejects(f.remote.snapshot()); assert.equal(f.requests.length, 2);
  redirect = false; await assert.rejects(f.remote.snapshot(), /body-too-large/);
});

test('queued transfer captures immutable blob reference at invocation', async t => {
  const f = await fixture(t); await f.remote.handshake(f.profile);
  const ref = await f.objects.put('queued'), original = { ...ref };
  const work = f.remote.uploadBlob(ref, 0);
  ref.blobHash = '0'.repeat(64); ref.byteLength = 99;
  assert.deepEqual(await work, { blobHash: original.blobHash, verifiedBytes: 6, complete: true });
  await f.host.objects.verify(original);
});

test('truncated HTTP body rolls staging back and permits a clean retry', async t => {
  let interrupt = true;
  const f = await fixture(t, (req, res) => {
    if (!interrupt || !req.url.includes('/blobs/')) return false;
    res.writeHead(206, { 'Content-Range': 'bytes 0-1048575/1048579', 'Content-Length': String(CHUNK) });
    res.write(Buffer.alloc(65536, 71), () => res.destroy()); return true;
  });
  const ref = await f.host.objects.put(content(CHUNK + 3)); await f.remote.handshake(f.profile);
  await assert.rejects(f.remote.downloadBlob(ref, 0));
  const stage = join(f.options.stagingRoot, `${ref.blobHash}-${ref.byteLength}.part`);
  assert.equal((await stat(stage)).size, 0);
  await assert.rejects(stat(f.objects.path(ref.blobHash)), { code: 'ENOENT' });
  interrupt = false; await transfer(f.remote, 'downloadBlob', ref); await f.objects.verify(ref);
});

test('discovery validates Tailscale origin before any network call', async () => {
  assert.equal(typeof implementation.discoverNativeSyncOrigin, 'function');
  let calls = 0; const fetchImpl = () => { calls++; throw new Error('network-must-not-run'); };
  for (const origin of ['http://127.0.0.1', 'http://192.168.1.1', 'http://example.com', 'http://node.ts.net', 'https://node.ts.net.evil.test', 'http://100.63.0.1', 'http://100.128.0.1', 'http://100.64.0.1/', 'http://100.64.0.1/path', 'http://user@100.64.0.1', 'http://100.64.0.1?x', 'http://100.64.0.1:0', 'http://100.064.0.1']) {
    await assert.rejects(implementation.discoverNativeSyncOrigin(origin, { fetchImpl }), /invalid-origin/);
  }
  assert.equal(calls, 0);
});

test('discovery uses only fixed hello and validates response identity/protocol shape', async t => {
  assert.equal(typeof implementation.discoverNativeSyncOrigin, 'function');
  let reply = null;
  const f = await fixture(t, (req, res) => {
    if (!reply || !req.url.endsWith('/hello')) return false;
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(reply)); return true;
  });
  const seen = [];
  const fetchImpl = (url, init) => { seen.push(url); return fetch(f.profile.origin + new URL(url).pathname, init); };
  const hello = await implementation.discoverNativeSyncOrigin('http://100.64.0.1:3417', { fetchImpl });
  assert.equal(hello.vaultId, f.host.vaultId); assert.deepEqual(seen, ['http://100.64.0.1:3417/api/sync/v1/hello']);
  await implementation.discoverNativeSyncOrigin('https://computer.tailnet.ts.net', { fetchImpl });
  for (const patch of [{ vaultId: 'not-a-uuid' }, { serverId: '' }, { epoch: '' }, { protocol: 2 }, { chunkBytes: 2097152 }, { maxFileBytes: -1 }]) {
    reply = { ...hello, ...patch };
    await assert.rejects(implementation.discoverNativeSyncOrigin('http://100.64.0.1:3417', { fetchImpl }), /incompatible-protocol/);
  }
});

test('discovery rejects real HTTP redirects and oversized JSON responses', async t => {
  assert.equal(typeof implementation.discoverNativeSyncOrigin, 'function');
  let redirect = true;
  const f = await fixture(t, (_req, res) => {
    if (redirect) { res.writeHead(302, { Location: '/elsewhere' }); res.end(); }
    else { res.writeHead(200, { 'Content-Length': String(CHUNK + 1) }); res.end(' '.repeat(CHUNK + 1)); }
    return true;
  });
  const fetchImpl = (url, init) => fetch(f.profile.origin + new URL(url).pathname, init);
  await assert.rejects(implementation.discoverNativeSyncOrigin('http://100.64.0.1:3417', { fetchImpl }));
  assert.equal(f.requests.length, 1);
  redirect = false; await assert.rejects(implementation.discoverNativeSyncOrigin('http://100.64.0.1:3417', { fetchImpl }), /body-too-large/);
});
