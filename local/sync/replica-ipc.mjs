import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { createWriteStream } from 'node:fs';
import { open, rename, unlink } from 'node:fs/promises';
import { join, dirname, resolve, sep } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createReplicaService } from './replica-service.mjs';
import { commandValue, check, uuid, helloValue } from './replica-validation.mjs';

/** Install only on the Electron-spawned process IPC channel. No HTTP management API. */
export function installReplicaIpc({ channel, userData, mediaCapability = randomBytes(32).toString('hex'), discoverOrigin, transportFactory }) {
  check(channel && typeof channel.on === 'function' && typeof channel.send === 'function', 'ipc-required');
  check(typeof userData === 'string' && userData.length > 0, 'user-data-required');
  check(/^[a-f0-9]{64}$/.test(mediaCapability), 'invalid-capability');
  const services = new Map(), remotes = new Map(), discoveries = new Map(); let queue = Promise.resolve(), closed = false;
  async function discover(origin) {
    const discovery = discoverOrigin ?? (await import('./transport.mjs')).discoverNativeSyncOrigin;
    check(typeof discovery === 'function', 'native-discovery-unavailable');
    const hello = await discovery(origin); helloValue(hello); discoveries.set(origin, structuredClone(hello)); return structuredClone(hello);
  }
  async function connection(service, replicaId) {
    if (!remotes.has(replicaId)) {
      const factory = transportFactory ?? (await import('./transport.mjs')).createNativeSyncTransport;
      const profile = (await service.snapshot()).profile;
      remotes.set(replicaId, await factory({ profile, objects: service.objects, stagingRoot: join(service.root, 'staging') }));
    }
    return remotes.get(replicaId);
  }
  async function dispatch(command, native = {}) {
    commandValue(command); check(!closed, 'ipc-closed');
    if (command.method === 'discover') return discover(command.payload.origin);
    let service = services.get(command.replicaId);
    if (command.method === 'open') {
      const proof = discoveries.get(command.payload.origin);
      if (proof) check(proof.vaultId === command.payload.vaultId && proof.serverId === command.payload.serverId, 'replica-identity-mismatch');
      if (!service) { service = await createReplicaService({ userData, profile: command.payload }); services.set(command.replicaId, service); }
      return service.open(command.payload);
    }
    check(service, 'replica-not-open');
    const p = command.payload;
    switch (command.method) {
      case 'configure': return service.configure(p);
      case 'request': return service.request(p.url, p.method, p.body);
      case 'snapshot': return service.snapshot();
      case 'preparePending': return service.preparePending(p.limit);
      case 'persistIncoming': return service.persistIncoming(p);
      case 'confirm': return service.confirm(p);
      case 'resolve': return service.resolve(p);
      case 'completeCycle': return service.completeCycle(p);
      case 'history': return { versions: await service.history(p.entryId) };
      case 'readVersion': return service.readVersion(p.version);
      case 'mediaUrl': {
        const snapshot = await service.snapshot();
        check(snapshot.entries.some(e => e.local?.entryId === p.entryId && !e.local.deleted && e.local.blobHash), 'unknown-entry');
        return { url: mediaPath(command.replicaId, p.entryId) };
      }
      case 'rebind': {
        const hello = await discover(p.origin);
        const profile = await service.rebindVerified(p.origin, hello);
        await remotes.get(command.replicaId)?.close?.(); remotes.delete(command.replicaId);
        return { profile, hello };
      }
      case 'handshake': {
        const saved = (await service.snapshot()).profile;
        check(['origin', 'vaultId', 'serverId', 'replicaId'].every(k => saved[k] === p.profile[k]), 'replica-identity-mismatch');
        return (await connection(service, command.replicaId)).handshake(saved);
      }
      case 'remoteSnapshot': return (await connection(service, command.replicaId)).snapshot(p.snapshotToken, p.cursor);
      case 'changes': return (await connection(service, command.replicaId)).changes(p.cursor, p.limit);
      case 'apply': {
        const prepared = (await service.snapshot()).preparedOperations;
        check(p.operations.every(op => prepared.some(existing => JSON.stringify(existing) === JSON.stringify(op))), 'operation-not-prepared');
        return { results: await (await connection(service, command.replicaId)).apply(p.operations) };
      }
      case 'downloadBlob': return (await connection(service, command.replicaId)).downloadBlob(p.blob, p.offset);
      case 'uploadBlob': return (await connection(service, command.replicaId)).uploadBlob(p.blob, p.offset);
      case 'importDocument': {
        check(typeof native.importPath === 'string', 'native-picker-required');
        async function* chunks() { yield* createReadStream(native.importPath); }
        return service.importStream(p.path, chunks());
      }
      case 'exportVersion': {
        check(typeof native.exportPath === 'string', 'native-picker-required');
        const target = resolve(native.exportPath);
        const comparable = value => process.platform === 'win32' ? value.toLowerCase() : value;
        check(!comparable(target).startsWith(comparable(resolve(userData) + sep)) && comparable(target) !== comparable(resolve(userData)), 'private-export-destination');
        const temporary = join(dirname(target), `.pentamark-export-${randomBytes(16).toString('hex')}`);
        try {
          await service.objects.verify(p.blob);
          await service.exportBlob(p.blob, () => createWriteStream(temporary, { flags: 'wx' }));
          const handle = await open(temporary, 'r+'); try { await handle.sync(); } finally { await handle.close(); }
          await rename(temporary, target); return { cancelled: false };
        } finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
      }
      case 'exportReplica': check(typeof native.exportDirectory === 'string', 'native-picker-required'); return service.exportReplica(native.exportDirectory);
      default: throw new Error('invalid-method');
    }
  }
  function receive(message) {
    if (message?.type !== 'pentamark:sync:command') return;
    const c = message.command;
    // Do not echo malformed data or filesystem errors into the renderer.
    if (!uuid(c?.requestId) || !uuid(c?.replicaId)) return;
    queue = queue.then(async () => {
      let response;
      try { response = { ok: true, value: await dispatch(c, message.native) }; }
      catch (error) { response = { ok: false, error: /^[a-z][a-z0-9-]{0,80}$/.test(error.message) ? error.message : 'native-storage-error' }; }
      if (channel.connected !== false) channel.send({ type: 'pentamark:sync:result', requestId: c.requestId, replicaId: c.replicaId, ...response });
    }).catch(() => {});
  }
  channel.on('message', receive);
  const loopback = address => address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
  // Called by trusted native integration, never with paths or URLs from the page.
  function mediaPath(replicaId, entryId) {
    check(uuid(replicaId) && uuid(entryId) && services.has(replicaId), 'invalid-media');
    return `/__replica_media/${mediaCapability}/${replicaId}/${entryId}`;
  }
  async function handleMedia(req, res) {
    if (!req.url?.startsWith('/__replica_media/')) return false;
    const deny = status => { res.writeHead(status, { 'Cache-Control': 'no-store' }); res.end(); return true; };
    if (!loopback(req.socket?.remoteAddress) || !['GET', 'HEAD'].includes(req.method)) return deny(403);
    const parts = req.url.split('/');
    if (parts.length !== 5 || !/^[a-f0-9]{64}$/.test(parts[2]) || !timingSafeEqual(Buffer.from(parts[2]), Buffer.from(mediaCapability)) || !uuid(parts[3]) || !uuid(parts[4])) return deny(403);
    const service = services.get(parts[3]); if (!service) return deny(404);
    const snapshot = await service.snapshot();
    const v = snapshot.entries.find(e => e.local?.entryId === parts[4])?.local;
    if (!v || v.deleted || !v.blobHash) return deny(404);
    await service.objects.verify(v);
    // Active document types are never served as executable same-origin content.
    const ext = v.path.split('.').pop().toLowerCase();
    const types = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', mp3: 'audio/mpeg', mp4: 'video/mp4', webm: 'video/webm', wav: 'audio/wav' };
    res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream', 'Content-Length': v.byteLength, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox", ...(types[ext] ? {} : { 'Content-Disposition': 'attachment' }) });
    if (req.method === 'HEAD') res.end(); else await pipeline(createReadStream(service.objects.path(v.blobHash)), res);
    return true;
  }
  return { dispatch, mediaPath, handleMedia,
    // Task 6 binds native transfer to this existing object store; no remote transport here.
    getReplica: replicaId => services.get(replicaId),
    close: async () => { closed = true; channel.off('message', receive); await queue; for (const remote of remotes.values()) await remote.close?.(); for (const service of services.values()) await service.close(); services.clear(); remotes.clear(); },
  };
}
