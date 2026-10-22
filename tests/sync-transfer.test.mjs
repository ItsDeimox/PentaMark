import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, appendFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { createHostService } from '../local/sync/host-service.mjs';
import { createTransfers } from '../local/sync/transfer.mjs';

const CHUNK = 1048576;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const url = new URL('../local/sync/routes.mjs', import.meta.url);
const implementation = existsSync(url) ? await import(url) : {};
async function fixture(t) {
  assert.equal(typeof implementation.createSyncHandler, 'function', 'streaming HTTP handler is required');
  const root = await mkdtemp(join(tmpdir(), 'pm-transfer-'));
  const host = await createHostService({ dataRoot: join(root, 'data'), vaultRoot: join(root, 'vault') });
  const options = { host, maxFileBytes: 40 * CHUNK, permission: req => req.headers['x-test-role'] || 'admin', authorizeOperation: async () => true };
  let handler = await implementation.createSyncHandler(options);
  const server = createServer(async (req, res) => { if (!await handler(req, res)) { res.writeHead(404); res.end(); } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await host.close(); await rm(root, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}/api/sync/v1/blobs/`;
  const upload = (digest, offset, total, bytes, headers = {}) => fetch(`${base}${digest}?offset=${offset}`, {
    method: 'PUT', headers: { 'x-sync-byte-length': String(total), ...headers }, body: bytes });
  return { host, base, upload, restart: async () => { handler = await implementation.createSyncHandler(options); } };
}

test('segments resume after handler recreation and exact duplicates are accepted; only complete verified blobs become public', async t => {
  const f = await fixture(t);
  const first = Buffer.alloc(CHUNK, 7), last = Buffer.from('tail');
  const digest = createHash('sha256').update(first).update(last).digest('hex');
  assert.deepEqual(await (await f.upload(digest, 0, CHUNK + 4, first)).json(), { blobHash: digest, verifiedBytes: CHUNK, complete: false });
  assert.equal((await fetch(f.base + digest)).status, 404);
  await f.restart();
  assert.equal((await f.upload(digest, 0, CHUNK + 4, first)).status, 200);
  assert.equal((await f.upload(digest, 0, CHUNK + 4, Buffer.alloc(CHUNK, 8))).status, 409);
  assert.equal((await f.upload(digest, CHUNK + 1, CHUNK + 4, last)).status, 409);
  assert.equal((await f.upload(digest, CHUNK, CHUNK + 4, last)).status, 200);
  assert.equal((await f.upload(digest, CHUNK, CHUNK + 4, last)).status, 200);
  const range = await fetch(f.base + digest, { headers: { Range: `bytes=${CHUNK}-${CHUNK + 3}` } });
  assert.equal(range.status, 206);
  assert.equal(range.headers.get('content-range'), `bytes ${CHUNK}-${CHUNK + 3}/${CHUNK + 4}`);
  assert.equal(await range.text(), 'tail');
  assert.equal((await fetch(f.base + digest, { headers: { Range: 'bytes=9999999-' } })).status, 416);
});

test('invalid lengths, hashes, offsets, oversized chunks and denied writes never publish a blob', async t => {
  const f = await fixture(t);
  const digest = hash('expected');
  for (const [offset, total, bytes, status] of [[0, 8, Buffer.from('wrong!!!'), 422], [0, 8, Buffer.from('tiny'), 400],
    [-1, 8, Buffer.from('expected'), 400], [0, 40 * CHUNK + 1, Buffer.from('x'), 413],
    [0, CHUNK + 1, Buffer.alloc(CHUNK + 1), 413]]) {
    assert.equal((await f.upload(digest, offset, total, bytes)).status, status);
    assert.equal((await fetch(f.base + digest)).status, 404);
  }
  assert.equal((await f.upload(digest, 0, 8, Buffer.from('expected'), { 'x-test-role': 'viewer' })).status, 403);
  assert.equal((await f.upload(digest, 0, 8, Buffer.from('expected'))).status, 200);
  assert.equal((await f.upload(digest, 0, 8, Buffer.from('wrong!!!'))).status, 409);
  assert.equal(await (await fetch(f.base + digest)).text(), 'expected');
});

test('actual file above 32MiB uploads in 1MiB chunks and downloads with bounded streaming', async t => {
  const f = await fixture(t);
  const chunk = Buffer.alloc(CHUNK, 23), tail = Buffer.from('above32MiB');
  const expected = createHash('sha256');
  for (let i = 0; i < 33; i++) expected.update(chunk);
  const digest = expected.update(tail).digest('hex'), total = 33 * CHUNK + tail.length;
  for (let i = 0; i < 33; i++) assert.equal((await f.upload(digest, i * CHUNK, total, chunk)).status, 200);
  const done = await (await f.upload(digest, 33 * CHUNK, total, tail)).json();
  assert.deepEqual(done, { blobHash: digest, verifiedBytes: total, complete: true });
  const response = await fetch(f.base + digest);
  const actual = createHash('sha256'); let length = 0;
  for await (const bytes of response.body) { actual.update(bytes); length += bytes.length; }
  assert.equal(length, total);
  assert.equal(actual.digest('hex'), digest);
  await f.host.objects.verify({ blobHash: digest, byteLength: total });
});

test('resume discards an interrupted partial segment and publishes only the complete final hash', async t => {
  const f = await fixture(t);
  const chunk = Buffer.alloc(CHUNK, 5), tail = Buffer.from('final tail');
  const digest = createHash('sha256').update(chunk).update(tail).digest('hex');
  const total = CHUNK + tail.length;
  assert.equal((await f.upload(digest, 0, total, chunk)).status, 200);
  await appendFile(join(f.host.root, 'transfers', `${digest}-${total}.part`), tail.subarray(0, 3));
  await f.restart();
  const response = await f.upload(digest, CHUNK, total, tail);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).complete, true);
  await f.host.objects.verify({ blobHash: digest, byteLength: total });
});

test('empty objects and suffix ranges preserve exact immutable bytes', async t => {
  const f = await fixture(t);
  const empty = hash('');
  assert.equal((await f.upload(empty, 0, 0, Buffer.alloc(0))).status, 200);
  assert.equal(await (await fetch(f.base + empty)).text(), '');
  assert.equal((await fetch(f.base + empty, { headers: { Range: 'bytes=0-' } })).status, 416);
  const digest = hash('abcdef');
  await f.upload(digest, 0, 6, Buffer.from('abcdef'));
  const suffix = await fetch(f.base + digest, { headers: { Range: 'bytes=-3' } });
  assert.equal(suffix.status, 206);
  assert.equal(await suffix.text(), 'def');
});

test('Android Content-Range upload framing validates offset, length and total', async t => {
  const f = await fixture(t), digest = hash('abcdef');
  const send = range => fetch(f.base + digest + '?offset=0', { method: 'PUT', headers: { 'Content-Range': range }, body: 'abcdef' });
  assert.equal((await send('bytes 1-6/6')).status, 400);
  assert.equal((await send('bytes 0-4/6')).status, 400);
  const valid = await send('bytes 0-5/6');
  assert.equal(valid.status, 200);
  assert.equal((await valid.json()).verifiedBytes, 6);
  const empty = await fetch(f.base + hash('') + '?offset=0', { method: 'PUT', headers: { 'Content-Range': 'bytes */0' }, body: '' });
  assert.equal(empty.status, 200);
});

test('upload admission rejects excess concurrency before consuming bodies and releases slots on failure', async t => {
  const f = await fixture(t);
  const upload = await createTransfers({ host: f.host, maxFileBytes: () => CHUNK, maxConcurrentUploads: 1 });
  const entered = Promise.withResolvers(), release = Promise.withResolvers();
  const bytes = Buffer.alloc(CHUNK, 9), digest = hash(bytes);
  const first = { headers: { 'x-sync-byte-length': String(CHUNK) }, async *[Symbol.asyncIterator]() {
    entered.resolve(); await release.promise; yield bytes;
  } };
  const pending = upload(first, digest, '0');
  await entered.promise;
  let consumed = false;
  const excess = { headers: first.headers, async *[Symbol.asyncIterator]() { consumed = true; yield bytes; } };
  try {
    await assert.rejects(upload(excess, digest, '0'), error => error.statusCode === 429 && error.errorCode === 'transfer-capacity');
    assert.equal(consumed, false, 'capacity rejection must happen before allocating a segment body');
  } finally { release.resolve(); await pending; }
  const bad = { headers: { 'x-sync-byte-length': '3' }, async *[Symbol.asyncIterator]() { yield Buffer.from('bad'); } };
  await assert.rejects(upload(bad, hash('yes'), '0'), error => error.statusCode === 422);
  assert.equal((await upload(excess, digest, '0')).complete, true);
});
