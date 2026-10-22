import { publicPath } from './paths.mjs';
export const uuid = value => typeof value === 'string' && /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(value);
export function check(value, message = 'invalid-command') { if (!value) throw new Error(message); }
export function record(value, required, optional = []) {
  check(value && typeof value === 'object' && !Array.isArray(value));
  check(required.every(key => Object.hasOwn(value, key)) && Object.keys(value).every(key => [...required, ...optional].includes(key)));
}
export function profileValue(p) {
  record(p, ['vaultId', 'serverId', 'replicaId', 'origin', 'offlineEnabled', 'mode']);
  check([p.vaultId, p.serverId, p.replicaId].every(uuid));
  configValue({ offlineEnabled: p.offlineEnabled, mode: p.mode });
  const u = new URL(p.origin); check(['http:', 'https:'].includes(u.protocol) && !u.username && !u.password && u.origin === p.origin);
}
export function configValue(p) { record(p, ['offlineEnabled', 'mode']); check(typeof p.offlineEnabled === 'boolean' && ['manual', 'automatic'].includes(p.mode)); }
export function versionValue(v) {
  if (v === null) return;
  record(v, ['entryId', 'kind', 'path', 'revision', 'blobHash', 'byteLength', 'deleted']);
  check(uuid(v.entryId) && ['note', 'asset', 'directory'].includes(v.kind) && typeof v.revision === 'string' && v.revision.length > 0);
  check(typeof v.deleted === 'boolean' && Number.isSafeInteger(v.byteLength) && v.byteLength >= 0);
  publicPath(v.path);
  check(v.deleted || v.kind === 'directory' ? v.blobHash === null && v.byteLength === 0 : /^[a-f0-9]{64}$/.test(v.blobHash));
}
export function conflictValue(c) {
  record(c, ['conflictId', 'entryId', 'base', 'local', 'remote', 'reason']);
  check(uuid(c.conflictId) && uuid(c.entryId) && typeof c.reason === 'string');
  for (const v of [c.base, c.local, c.remote]) { versionValue(v); check(!v || v.entryId === c.entryId); }
}
export function batchValue(b) {
  record(b, ['nextCursor', 'items'], ['epoch', 'initialCopy']);
  check(typeof b.nextCursor === 'string' && b.nextCursor.length > 0 && Array.isArray(b.items) && b.items.length <= 10000);
  check(b.epoch === undefined || typeof b.epoch === 'string' && b.epoch.length > 0);
  if (b.initialCopy) {
    record(b.initialCopy, ['snapshotToken', 'atCursor', 'pageCursor']);
    check(typeof b.initialCopy.snapshotToken === 'string' && b.initialCopy.snapshotToken.length > 0 && b.initialCopy.atCursor === b.nextCursor);
    check(b.initialCopy.pageCursor === null || typeof b.initialCopy.pageCursor === 'string' && b.initialCopy.pageCursor.length > 0);
  }
  const ids = new Set();
  for (const item of b.items) {
    record(item, ['decision', 'expectedLocalHead']); check(typeof item.expectedLocalHead === 'string');
    const d = item.decision; record(d, ['action', 'reason', 'base', 'local', 'remote']);
    check(['none', 'push', 'pull', 'converged', 'conflict'].includes(d.action) && typeof d.reason === 'string');
    for (const v of [d.base, d.local, d.remote]) versionValue(v);
    const id = (d.remote || d.local || d.base)?.entryId;
    check(id && !ids.has(id)); ids.add(id);
    check([d.base, d.local, d.remote].every(v => !v || v.entryId === id));
  }
}
export function resultValue(r) {
  record(r, ['opId', 'status'], ['confirmed', 'conflict', 'errorCode']);
  check(uuid(r.opId) && ['applied', 'already-applied', 'conflict', 'blocked'].includes(r.status));
  if (['applied', 'already-applied'].includes(r.status)) { check(r.confirmed); versionValue(r.confirmed); }
  if (r.status === 'conflict') conflictValue(r.conflict);
  check(r.errorCode === undefined || typeof r.errorCode === 'string');
}
export function resolutionValue(r) {
  record(r, ['conflictId', 'expectedRemoteRevision', 'expectedLocalHead', 'choice'], ['mergedContent']);
  check(uuid(r.conflictId) && typeof r.expectedLocalHead === 'string' && (r.expectedRemoteRevision === null || typeof r.expectedRemoteRevision === 'string'));
  check(['keep-both', 'local', 'remote', 'merged'].includes(r.choice));
  check(r.choice !== 'merged' || typeof r.mergedContent === 'string' && Buffer.byteLength(r.mergedContent) <= 32 * 1024 * 1024);
}
export function requestValue(url, method, body) {
  check(typeof url === 'string' && /^\/api\/(state|config|presence|note|folder|asset)(\?|$)/.test(url) && !/[\\#\r\n]/.test(url), 'invalid-url');
  check(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method));
  const parsed = new URL(url, 'http://replica.invalid');
  for (const key of parsed.searchParams.keys()) check(['path', 'clientId'].includes(key));
  if (parsed.searchParams.has('path')) publicPath(parsed.searchParams.get('path'));
  if (body !== undefined) {
    if (parsed.pathname === '/api/presence') {
      check(method === 'POST');
      record(body, [], ['clientId', 'name', 'avatar', 'color', 'path', 'cursor', 'selectionEnd', 'mode', 'editing']);
      for (const key of ['clientId', 'name', 'avatar', 'color', 'path', 'mode']) check(body[key] === undefined || typeof body[key] === 'string');
      for (const key of ['cursor', 'selectionEnd']) check(body[key] === undefined || Number.isSafeInteger(body[key]) && body[key] >= 0);
      check(body.editing === undefined || typeof body.editing === 'boolean');
      check(JSON.stringify(body).length <= 256 * 1024);
      if (body.path) publicPath(body.path);
      return parsed;
    }
    record(body, [], ['path', 'newPath', 'content', 'baseRevision', 'clientId']);
    for (const key of ['path', 'newPath']) if (body[key] !== undefined) publicPath(body[key]);
    if (body.content !== undefined) check(typeof body.content === 'string' && Buffer.byteLength(body.content) <= 32 * 1024 * 1024);
    if (body.baseRevision !== undefined) check(body.baseRevision === null || typeof body.baseRevision === 'string');
  }
  return parsed;
}
export function commandValue(c) {
  record(c, ['requestId', 'replicaId', 'method', 'payload']); check(uuid(c.requestId) && uuid(c.replicaId));
  switch (c.method) {
    case 'open': profileValue(c.payload); check(c.payload.replicaId === c.replicaId, 'wrong-replica'); break;
    case 'configure': configValue(c.payload); break;
    case 'snapshot': record(c.payload, []); break;
    case 'preparePending': record(c.payload, ['limit']); check(Number.isInteger(c.payload.limit) && c.payload.limit > 0 && c.payload.limit <= 100); break;
    case 'request': record(c.payload, ['url', 'method'], ['body']); requestValue(c.payload.url, c.payload.method, c.payload.body); break;
    case 'persistIncoming': batchValue(c.payload); break;
    case 'confirm': resultValue(c.payload); break;
    case 'resolve': resolutionValue(c.payload); break;
    default: throw new Error('invalid-method');
  }
}
