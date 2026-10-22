import { createReadStream } from 'node:fs';
import { mkdir, open, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { hashFile } from './objects.mjs';
import { CHUNK_BYTES } from './transfer.mjs';

const fail = (code, statusCode) => Object.assign(new Error(code), { errorCode: code, statusCode });
const check = (condition, code) => { if (!condition) throw fail(code); };
const integer = n => Number.isSafeInteger(n) && n >= 0;
function validateHello(value) {
  const uuid = v => typeof v === 'string' && /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(v);
  check(value?.protocol === 1 && uuid(value.vaultId) && uuid(value.serverId)
    && typeof value.epoch === 'string' && value.epoch.length > 0 && value.epoch.length <= 512
    && value.chunkBytes === CHUNK_BYTES && integer(value.maxFileBytes), 'incompatible-protocol');
  return { protocol: value.protocol, vaultId: value.vaultId, serverId: value.serverId, epoch: value.epoch,
    maxFileBytes: value.maxFileBytes, chunkBytes: value.chunkBytes };
}
/** Pre-profile discovery accepts only a canonical bare tailnet origin. The optional
 * native dependencies are never part of the renderer command payload. */
export async function discoverNativeSyncOrigin(origin, { headers = () => ({}), timeoutMs = 30000, fetchImpl = fetch } = {}) {
  check(typeof origin === 'string' && origin.length <= 300 && !/[\s\\]/.test(origin), 'invalid-origin');
  let url; try { url = new URL(origin); } catch { throw fail('invalid-origin'); }
  const parts = url.hostname.split('.');
  const ip = parts.length === 4 && parts.every(p => /^\d{1,3}$/.test(p) && String(Number(p)) === p && Number(p) <= 255)
    && parts[0] === '100' && Number(parts[1]) >= 64 && Number(parts[1]) <= 127;
  const dns = /^(?:[a-z\d](?:[a-z\d-]*[a-z\d])?\.)+ts\.net$/i.test(url.hostname);
  check(url.origin === origin && !url.username && !url.password && url.port !== '0'
    && (ip && ['http:', 'https:'].includes(url.protocol) || dns && url.protocol === 'https:'), 'invalid-origin');
  check(integer(timeoutMs) && timeoutMs > 0, 'invalid-timeout');
  const nativeHeaders = new Headers(await headers()); nativeHeaders.set('X-Sync-Protocol', '1');
  const response = await fetchImpl(`${origin}/api/sync/v1/hello`, { method: 'GET', headers: nativeHeaders,
    redirect: 'error', signal: AbortSignal.timeout(timeoutMs) });
  return validateHello(await json(response));
}
async function fileSize(path) {
  try { return (await stat(path)).size; } catch (e) { if (e.code === 'ENOENT') return 0; throw e; }
}
async function json(response) {
  const length = response.headers.get('content-length');
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > CHUNK_BYTES)) {
    await response.body?.cancel(); throw fail('body-too-large');
  }
  const chunks = []; let count = 0;
  for await (const chunk of response.body ?? []) {
    count += chunk.length;
    check(count <= CHUNK_BYTES, 'body-too-large'); chunks.push(chunk);
  }
  let value;
  try { value = JSON.parse(Buffer.concat(chunks, count).toString('utf8')); }
  catch { throw fail('invalid-json', response.status); }
  if (!response.ok) throw fail(typeof value?.errorCode === 'string' ? value.errorCode : 'remote-error', response.status);
  check(value && typeof value === 'object' && !Array.isArray(value), 'invalid-response');
  return value;
}

/** Native-only RemotePort. Construct once per opened replica, from trusted profile
 * and its existing object store. Never accept paths, origins or auth from a WebView.
 * Blobs stream through native staging; only control JSON is materialized in memory.
 */
export async function createNativeSyncTransport({ profile, objects, stagingRoot, headers = () => ({}), timeoutMs = 30000 }) {
  const bound = structuredClone(profile);
  const origin = new URL(bound.origin);
  check(['http:', 'https:'].includes(origin.protocol) && !origin.username && !origin.password && origin.origin === bound.origin, 'invalid-origin');
  check(integer(timeoutMs) && timeoutMs > 0, 'invalid-timeout');
  await mkdir(stagingRoot, { recursive: true });
  let hello = null, queue = Promise.resolve();
  const serialize = work => { const next = queue.then(work); queue = next.catch(() => {}); return next; };
  function sameIdentity(p) {
    return ['origin', 'vaultId', 'serverId', 'replicaId'].every(key => p?.[key] === bound[key]);
  }
  function ready() { check(hello !== null, 'handshake-required'); }
  async function request(path, options = {}) {
    const supplied = new Headers(await headers());
    // These headers and the URL cannot be overridden by native auth providers.
    supplied.set('X-Sync-Protocol', '1'); supplied.set('X-Sync-Vault-Id', bound.vaultId); supplied.set('X-Sync-Server-Id', bound.serverId);
    for (const [key, value] of Object.entries(options.headers ?? {})) supplied.set(key, value);
    return fetch(`${bound.origin}/api/sync/v1/${path}`, {
      ...options, headers: supplied, redirect: 'error', signal: AbortSignal.timeout(timeoutMs),
    });
  }
  async function control(path, body) {
    ready();
    let bytes;
    if (body !== undefined) { bytes = JSON.stringify(body); check(Buffer.byteLength(bytes) <= CHUNK_BYTES, 'body-too-large'); }
    return json(await request(path, bytes === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: bytes }));
  }
  function validateBlob(blob, offset) {
    ready();
    check(typeof blob?.blobHash === 'string' && /^[a-f0-9]{64}$/.test(blob.blobHash) && integer(blob.byteLength), 'invalid-blob');
    check(blob.byteLength <= hello.maxFileBytes, 'file-too-large');
    check(integer(offset) && offset <= blob.byteLength && offset % CHUNK_BYTES === 0, 'invalid-offset');
  }
  const progress = (blob, count) => ({ blobHash: blob.blobHash, verifiedBytes: count, complete: count === blob.byteLength });
  async function download(blob, requestedOffset) {
    validateBlob(blob, requestedOffset);
    try { await objects.verify(blob); return progress(blob, blob.byteLength); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const path = join(stagingRoot, `${blob.blobHash}-${blob.byteLength}.part`);
    let stored = await fileSize(path);
    check(stored <= blob.byteLength, 'invalid-staging-length');
    if (stored !== blob.byteLength) stored -= stored % CHUNK_BYTES;
    check(requestedOffset === 0 || requestedOffset === stored, 'invalid-offset');
    const handle = await open(path, 'r+').catch(error => {
      if (error.code !== 'ENOENT') throw error;
      return open(path, 'wx+');
    });
    try { await handle.truncate(stored); await handle.sync(); } finally { await handle.close(); }
    if (stored < blob.byteLength || blob.byteLength === 0) {
      const count = Math.min(CHUNK_BYTES, blob.byteLength - stored), end = stored + count - 1;
      const response = await request(`blobs/${blob.blobHash}`, { headers: count ? { Range: `bytes=${stored}-${end}` } : {} });
      if (!response.ok) { await json(response); throw fail('remote-error', response.status); }
      const valid = count ? response.status === 206 && response.headers.get('content-range') === `bytes ${stored}-${end}/${blob.byteLength}` : response.status === 200;
      if (!valid || response.headers.get('content-length') !== String(count)) {
        await response.body?.cancel(); throw fail('invalid-content-range');
      }
      const output = await open(path, 'r+'); let received = 0;
      try {
        for await (const chunk of response.body ?? []) {
          check(received + chunk.length <= count, 'invalid-length');
          let written = 0;
          while (written < chunk.length) {
            const result = await output.write(chunk, written, chunk.length - written, stored + received + written);
            check(result.bytesWritten > 0, 'short-write'); written += result.bytesWritten;
          }
          received += chunk.length;
        }
        check(received === count, 'invalid-length'); await output.sync();
      } catch (error) { await output.truncate(stored); await output.sync(); throw error; }
      finally { await output.close(); }
      stored += received;
    }
    if (stored === blob.byteLength) {
      const actual = await hashFile(path);
      if (actual.blobHash !== blob.blobHash || actual.byteLength !== blob.byteLength) {
        await unlink(path); throw fail('hash-mismatch');
      }
      await objects.put(createReadStream(path)); await objects.verify(blob); await unlink(path);
    }
    return progress(blob, stored);
  }
  async function upload(blob, offset) {
    validateBlob(blob, offset); await objects.verify(blob);
    const count = Math.min(CHUNK_BYTES, blob.byteLength - offset);
    check(count > 0 || blob.byteLength === 0, 'invalid-offset');
    const stream = count ? createReadStream(objects.path(blob.blobHash), { start: offset, end: offset + count - 1, highWaterMark: 65536 }) : null;
    let result;
    try {
      result = await json(await request(`blobs/${blob.blobHash}?offset=${offset}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': String(count),
          'Content-Range': count ? `bytes ${offset}-${offset + count - 1}/${blob.byteLength}` : 'bytes */0' },
        body: stream ?? Buffer.alloc(0), duplex: 'half',
      }));
    } finally { stream?.destroy(); }
    const n = result.verifiedBytes;
    check(result.blobHash === blob.blobHash && integer(n) && n >= offset + count && n <= blob.byteLength
      && (n === blob.byteLength || n % CHUNK_BYTES === 0) && result.complete === (n === blob.byteLength), 'invalid-progress');
    return { blobHash: result.blobHash, verifiedBytes: n, complete: result.complete };
  }
  return {
    async handshake(p) {
      hello = null; check(sameIdentity(p), 'identity-mismatch');
      const candidate = validateHello(await json(await request('hello')));
      check(candidate.vaultId === bound.vaultId && candidate.serverId === bound.serverId, 'identity-mismatch');
      hello = candidate; return structuredClone(candidate);
    },
    snapshot: (token, cursor) => {
      check(token === undefined && cursor === undefined || typeof token === 'string' && token.length > 0 && typeof cursor === 'string' && cursor.length > 0, 'invalid-snapshot');
      return token === undefined ? control('snapshot', {}) : control(`snapshot?snapshotToken=${encodeURIComponent(token)}&cursor=${encodeURIComponent(cursor)}`);
    },
    changes: (cursor, limit) => {
      check(typeof cursor === 'string' && cursor.length > 0 && Number.isInteger(limit) && limit >= 1 && limit <= 100, 'invalid-changes');
      return control(`changes?cursor=${encodeURIComponent(cursor)}&limit=${limit}`);
    },
    async apply(operations) {
      ready(); check(Array.isArray(operations) && operations.length <= 100 && operations.every(op => op.vaultId === bound.vaultId && op.replicaId === bound.replicaId), 'invalid-operations');
      const response = await control('apply', { operations });
      check(Array.isArray(response.results) && response.results.length === operations.length
        && response.results.every((r, i) => r.opId === operations[i].opId && ['applied', 'already-applied', 'blocked', 'conflict'].includes(r.status)), 'invalid-results');
      return response.results;
    },
    downloadBlob: (blob, offset) => {
      const ref = structuredClone(blob); return serialize(() => download(ref, offset));
    },
    uploadBlob: (blob, offset) => {
      const ref = structuredClone(blob); return serialize(() => upload(ref, offset));
    },
  };
}
