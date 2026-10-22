import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { publicPath } from './paths.mjs';
import { CHUNK_BYTES, createTransfers, failure, integer, readBounded } from './transfer.mjs';

const PREFIX = '/api/sync/v1/';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH = /^[a-f0-9]{64}$/;
const uuid = value => typeof value === 'string' && UUID.test(value);
const revision = value => typeof value === 'string' && value.length > 0 && value.length <= 512;
function validate(op, host, maximum) {
  if (!op || !['vaultId', 'replicaId', 'entryId', 'opId'].every(key => uuid(op[key]))) return 'invalid-uuid';
  if (op.vaultId !== host.vaultId) return 'wrong-vault';
  if (!['put', 'move', 'delete', 'mkdir', 'rmdir'].includes(op.kind)
    || !(op.baseRevision === null || revision(op.baseRevision))) return 'invalid-operation';
  if (!Array.isArray(op.dependsOn) || op.dependsOn.length > 100 || !op.dependsOn.every(uuid)
    || new Set(op.dependsOn).size !== op.dependsOn.length || op.dependsOn.includes(op.opId)) return 'invalid-dependencies';
  if (['delete', 'rmdir'].includes(op.kind)) return op.after === null && op.baseRevision !== null ? null : 'invalid-operation';
  const after = op.after;
  if (!after || !['note', 'asset', 'directory'].includes(after.kind)
    || !Number.isSafeInteger(after.byteLength) || after.byteLength < 0) return 'invalid-operation';
  if (after.byteLength > maximum) return 'file-too-large';
  try { if (after.path.length > 4096 || publicPath(after.path).path !== after.path) return 'invalid-path'; }
  catch { return 'invalid-path'; }
  if (after.kind === 'directory' ? after.blobHash !== null || after.byteLength !== 0 : typeof after.blobHash !== 'string' || !HASH.test(after.blobHash)) return 'invalid-blob';
  if (op.kind === 'put' && after.kind === 'directory' || op.kind === 'mkdir' && (after.kind !== 'directory' || op.baseRevision !== null)
    || op.kind === 'move' && op.baseRevision === null) return 'invalid-operation';
  return null;
}
function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}
async function body(req) {
  try { return JSON.parse((await readBounded(req, CHUNK_BYTES)).toString('utf8') || '{}'); }
  catch (error) { if (error.statusCode) throw error; throw failure(400, 'invalid-json'); }
}
function limit(value) {
  const result = integer(value ?? 100);
  if (result < 1 || result > 100) throw failure(400, 'invalid-limit');
  return result;
}

/** Mount after authentication/origin checks, before legacy verb-only write gates.
 * permission(req) must return viewer/editor/admin. authorizeOperation(req, op,
 * current) checks note/folder locks for both current.path and op.after.path.
 * Both callbacks are mandatory: omission must never silently enable writes.
 */
export async function createSyncHandler({ host, maxFileBytes, permission, authorizeOperation,
  snapshotTtlMs = 15 * 60 * 1000, maxSnapshots = 32, now = Date.now }) {
  if (typeof permission !== 'function' || typeof authorizeOperation !== 'function') throw new Error('sync-authorization-required');
  const hostLimit = (await host.hello()).maxFileBytes;
  if (!Number.isSafeInteger(hostLimit) || hostLimit < 1) throw new Error('invalid-host-limit');
  const maximum = () => {
    const bytes = typeof maxFileBytes === 'function' ? maxFileBytes() : maxFileBytes;
    if (!Number.isSafeInteger(bytes) || bytes < 0) throw new Error('invalid-max-file-bytes');
    return Math.min(bytes, hostLimit);
  };
  maximum();
  if (!Number.isSafeInteger(snapshotTtlMs) || snapshotTtlMs < 1 || !Number.isSafeInteger(maxSnapshots) || maxSnapshots < 1) throw new Error('invalid-snapshot-limits');
  const upload = await createTransfers({ host, maxFileBytes: maximum });
  const snapshots = new Map();
  function page(snapshot, offset) {
    if (offset > snapshot.entries.length || offset % snapshot.limit !== 0) throw failure(400, 'invalid-page-cursor');
    const next = offset + snapshot.limit;
    return { snapshotToken: snapshot.snapshotToken, atCursor: snapshot.atCursor,
      entries: snapshot.entries.slice(offset, next), pageCursor: next < snapshot.entries.length ? String(next) : null };
  }
  return async function syncHandler(req, res) {
    // Never use an untrusted Host header or renderer URL as an outbound destination.
    const url = new URL(req.url, 'http://localhost');
    if (!url.pathname.startsWith('/api/sync/')) return false;
    try {
      if (!url.pathname.startsWith(PREFIX)) throw failure(409, 'incompatible-protocol');
      for (const [header, expected] of [['x-sync-protocol', '1'], ['x-sync-vault-id', host.vaultId], ['x-sync-server-id', host.serverId]])
        if (req.headers[header] !== undefined && req.headers[header] !== expected) throw failure(409, 'incompatible-host');
      const role = await permission(req);
      if (!['viewer', 'editor', 'admin'].includes(role)) throw failure(403, 'permission-denied');
      const route = url.pathname.slice(PREFIX.length);
      if (route === 'hello' && req.method === 'GET') {
        json(res, 200, { protocol: 1, vaultId: host.vaultId, serverId: host.serverId, epoch: host.epoch,
          maxFileBytes: maximum(), chunkBytes: CHUNK_BYTES });
      } else if (route === 'snapshot' && ['GET', 'POST'].includes(req.method)) {
        for (const [token, snapshot] of snapshots) if (snapshot.expires <= now()) snapshots.delete(token);
        if (req.method === 'POST') {
          const input = await body(req);
          if (!input || typeof input !== 'object' || Array.isArray(input)) throw failure(400, 'invalid-snapshot');
          const size = limit(input.limit);
          if (snapshots.size >= maxSnapshots) throw failure(429, 'snapshot-capacity');
          const snapshot = { ...await host.openSnapshot(), limit: size, expires: now() + snapshotTtlMs };
          snapshots.set(snapshot.snapshotToken, snapshot);
          json(res, 200, page(snapshot, 0));
        } else {
          const snapshot = snapshots.get(url.searchParams.get('snapshotToken') ?? url.searchParams.get('token'));
          if (!snapshot) throw failure(410, 'snapshot-expired');
          json(res, 200, page(snapshot, integer(url.searchParams.get('cursor'))));
        }
      } else if (route === 'changes' && req.method === 'GET') {
        const count = limit(url.searchParams.get('limit') ?? 100);
        await host.rescan();
        json(res, 200, await host.readChanges(url.searchParams.get('cursor'), count));
      } else if (route === 'apply' && req.method === 'POST') {
        const input = await body(req);
        const operations = Array.isArray(input) ? input : input?.operations;
        if (!Array.isArray(operations)) throw failure(400, 'invalid-operations');
        if (operations.length > 100) throw failure(413, 'too-many-operations');
        const results = [];
        for (const op of operations) {
          let errorCode = validate(op, host, maximum());
          if (!errorCode && (role === 'viewer' || role === 'editor' && ['delete', 'rmdir'].includes(op.kind))) errorCode = 'permission-denied';
          if (!errorCode) {
            const current = host.history(op.entryId).at(-1) ?? null;
            if (!await authorizeOperation(req, op, current)) errorCode = 'locked';
          }
          if (!errorCode && op.after?.byteLength > maximum()) errorCode = 'file-too-large';
          results.push(errorCode ? { opId: typeof op?.opId === 'string' ? op.opId : '', status: 'blocked', errorCode } : await host.apply(op));
        }
        json(res, 200, { results });
      } else if (route.startsWith('blobs/') && ['GET', 'PUT'].includes(req.method)) {
        const hash = route.slice(6);
        if (!HASH.test(hash)) throw failure(400, 'invalid-hash');
        if (req.method === 'PUT') {
          if (role === 'viewer') throw failure(403, 'permission-denied');
          json(res, 200, await upload(req, hash, url.searchParams.get('offset')));
        } else {
          const path = host.objects.path(hash);
          const { size } = await stat(path);
          let start = 0, end = size - 1, status = 200;
          const headers = { 'Content-Type': 'application/octet-stream', 'Accept-Ranges': 'bytes', ETag: `"${hash}"`, 'Cache-Control': 'private, immutable' };
          if (req.headers.range) {
            const match = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
            if (!match || !size || !match[1] && !match[2]) throw failure(416, 'invalid-range');
            if (match[1]) { start = integer(match[1]); end = match[2] ? Math.min(integer(match[2]), size - 1) : size - 1; }
            else { const suffix = integer(match[2]); if (!suffix) throw failure(416, 'invalid-range'); start = Math.max(0, size - suffix); }
            if (start >= size || end < start) throw failure(416, 'invalid-range');
            status = 206; headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
          }
          headers['Content-Length'] = String(Math.max(0, end - start + 1));
          res.writeHead(status, headers);
          if (size === 0) res.end();
          else await pipeline(createReadStream(path, { start, end, highWaterMark: CHUNK_BYTES }), res);
        }
      } else throw failure(404, 'unknown-sync-route');
    } catch (error) {
      if (res.headersSent) res.destroy(error);
      else {
        const status = error.statusCode ?? (error.message === 'invalid-cursor' ? 409 : error.code === 'ENOENT' ? 404 : 503);
        json(res, status, { errorCode: error.errorCode ?? (status === 409 ? 'invalid-cursor' : status === 404 ? 'blob-not-found' : 'host-unavailable') });
      }
    }
    return true;
  };
}
