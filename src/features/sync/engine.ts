import type { BlobRef, EntryVersion, Handshake, IncomingBatch, Operation, ReplicaPort, ReplicaSnapshot, RemotePort, Scheduler, SnapshotPage, SyncMode, SyncStatus } from './contracts';
import { normalizePath, planEntry } from './reconcile';

/** New native adapters must emit immutable prepared operations and guard completion.
 * This structural type keeps the integration requirement explicit during rollout. */
export type EngineReplica = Omit<ReplicaPort, 'snapshot' | 'completeCycle'> & {
  snapshot(): Promise<ReplicaSnapshot & { preparedOperations: Operation[] }>;
  completeCycle(input: { expectedCursor: string; expectedEpoch: string }): Promise<SyncStatus>;
};
export interface SyncEngine {
  start(): Promise<void>;
  stop(): void;
  synchronizeNow(): Promise<void>;
  setMode(mode: SyncMode): Promise<void>;
  onStatus(listener: (status: SyncStatus) => void): () => void;
  localChanged(): void;
  resume(): Promise<void>;
  reconnect(): Promise<void>;
}
export const systemScheduler: Scheduler = {
  now: () => Date.now(), random: () => Math.random(),
  schedule: (callback, delay) => { const timer = setTimeout(callback, delay); return () => clearTimeout(timer); },
};
const codeOf = (error: unknown) => {
  const e = error as { errorCode?: string; code?: string; message?: string };
  return e?.errorCode ?? e?.code ?? e?.message ?? 'sync-failed';
};
const fail = (code: string): never => { throw new Error(code); };
const emptyStatus = (): SyncStatus => ({ phase: 'initial-copy', localSaved: false, pendingCount: 0, conflictCount: 0, snapshotComplete: false, lastSuccessfulSync: null, errorCode: null });
// Native replica IDs are persistent: even distinct JS wrappers cannot overlap cycles.
const activeReplicas = new Map<string, Promise<void>>();

export function createSyncEngine({ replica, remote, clock = systemScheduler }: { replica: EngineReplica; remote: RemotePort; clock?: Scheduler }): SyncEngine {
  let running = false, mode: SyncMode | undefined, generation = 0, retry = 0;
  let active: Promise<void> | null = null, activeGeneration = 0, cancelTimer: (() => void) | undefined;
  let status = emptyStatus();
  const listeners = new Set<(s: SyncStatus) => void>();
  function emit(next: SyncStatus) {
    status = { ...next };
    for (const listener of listeners) { try { listener({ ...status }); } catch { /* UI observers cannot interrupt durable work. */ } }
  }
  function cancel() { cancelTimer?.(); cancelTimer = undefined; }
  function schedule(delay: number) {
    cancel(); if (!running || mode !== 'automatic') return;
    cancelTimer = clock.schedule(() => { cancelTimer = undefined; void launch(false); }, delay);
  }
  async function read() {
    const snapshot = await replica.snapshot(); mode ??= snapshot.profile.mode;
    return snapshot;
  }
  function settled(snapshot: ReplicaSnapshot, errorCode: string | null = null): SyncStatus {
    const s = { ...(snapshot.status ?? emptyStatus()), errorCode };
    s.phase = s.conflictCount ? 'conflicts' : !s.snapshotComplete ? 'initial-copy' : mode === 'manual' ? 'waiting-manual' : 'offline';
    return s;
  }
  async function cycle(explicit: boolean, token: number) {
    const checkpoint = () => { if (generation !== token) fail('cycle-stopped'); };
    let snapshot = await read();
    if (!snapshot.profile.offlineEnabled) { emit(settled(snapshot)); return; }
    if (!explicit && mode === 'manual' && snapshot.status?.snapshotComplete) { emit(settled(snapshot)); return; }
    let completed = false;
    try {
      checkpoint();
      emit({ ...settled(snapshot), phase: snapshot.status?.snapshotComplete ? 'syncing' : 'initial-copy' });
      const hello: Handshake = await remote.handshake(snapshot.profile); checkpoint();
      if (hello.vaultId !== snapshot.profile.vaultId || hello.serverId !== snapshot.profile.serverId) fail('identity-mismatch');
      if (hello.protocol !== 1 || hello.chunkBytes !== 1048576 || !hello.epoch || !Number.isSafeInteger(hello.maxFileBytes) || hello.maxFileBytes < 0) fail('incompatible-protocol');
      if (!Array.isArray(snapshot.preparedOperations) || typeof replica.completeCycle !== 'function') fail('adapter-upgrade-required');
      async function transfer(direction: 'downloadBlob' | 'uploadBlob', blob: BlobRef) {
        if (!Number.isSafeInteger(blob.byteLength) || blob.byteLength < 0 || blob.byteLength > hello.maxFileBytes) fail('file-too-large');
        let offset = 0;
        for (;;) {
          checkpoint(); const p = await remote[direction](blob, offset); checkpoint();
          if (p.blobHash !== blob.blobHash || !Number.isSafeInteger(p.verifiedBytes) || p.verifiedBytes < offset || p.verifiedBytes > blob.byteLength
            || p.complete !== (p.verifiedBytes === blob.byteLength) || !p.complete && (p.verifiedBytes === offset || p.verifiedBytes % hello.chunkBytes !== 0)) fail('invalid-progress');
          if (p.complete) return; offset = p.verifiedBytes;
        }
      }
      async function download(v: EntryVersion | null | undefined) {
        if (v?.blobHash && !v.deleted) await transfer('downloadBlob', { blobHash: v.blobHash, byteLength: v.byteLength });
      }
      let partialError: string | null = null;
      const confirmedDuringReplay = new Map<string, EntryVersion>();
      const conflictedDuringReplay = new Set<string>();
      async function send(operations: Operation[]) {
        for (const prepared of operations) {
          checkpoint();
          // Copy at the boundary: the adapter owns immutable durable preparation.
          const op = structuredClone(prepared);
          if (op.vaultId !== snapshot.profile.vaultId || op.replicaId !== snapshot.profile.replicaId) fail('identity-mismatch');
          try {
            if (op.after?.blobHash) await transfer('uploadBlob', { blobHash: op.after.blobHash, byteLength: op.after.byteLength });
            checkpoint(); const results = await remote.apply([op]);
            if (results.length !== 1 || results[0].opId !== op.opId) fail('invalid-results');
            const result = results[0];
            if (result.status === 'conflict') {
              if (!result.conflict) throw new Error('invalid-results');
              // Current remote and retained host base may not yet exist locally.
              await download(result.conflict.remote); await download(result.conflict.base);
            } else if (!['applied', 'already-applied', 'blocked'].includes(result.status)) fail('invalid-results');
            // Even if stopped during apply, durably acknowledge its returned result.
            await replica.confirm(result);
            if (result.confirmed) confirmedDuringReplay.set(op.entryId, result.confirmed);
            if (result.status === 'conflict') conflictedDuringReplay.add(op.entryId);
            if (result.status === 'blocked') partialError = result.errorCode ?? 'remote-blocked';
          } catch (error) {
            if (codeOf(error) === 'cycle-stopped') throw error;
            partialError = codeOf(error); // Keep failed op; independent files may proceed.
          }
        }
      }
      async function persist(entries: EntryVersion[], batch: Omit<IncomingBatch, 'items'>, manifestIds?: Set<string>) {
        // One latest version per entry per page; page cursor still covers every log row.
        const latest = [...new Map(entries.map(v => [v.entryId, v])).values()];
        for (const v of latest) await download(v);
        for (let attempt = 0; attempt < 8; attempt++) {
          checkpoint(); const current = await read();
          const items = latest.map(v => {
            const path = normalizePath(v.path);
            const collision = !v.deleted && path.ok ? current.entries.find(e => {
              if (!e.local || e.local.deleted || e.local.entryId === v.entryId) return false;
              const localPath = normalizePath(e.local.path);
              return localPath.ok && localPath.pathKey === path.pathKey;
            }) : undefined;
            const row = collision ?? current.entries.find(e => (e.local ?? e.base)?.entryId === v.entryId);
            return { decision: planEntry(row?.base ?? null, row?.local ?? null, v), expectedLocalHead: row?.localHead ?? '' };
          });
          if (manifestIds) for (const row of current.entries) {
            if (row.base && !manifestIds.has(row.base.entryId) && !items.some(item => item.decision.local?.entryId === row.base?.entryId)) items.push({
              decision: planEntry(row.base, row.local, null), expectedLocalHead: row.localHead,
            });
          }
          try { await replica.persistIncoming({ ...batch, items }); return; }
          catch (error) { if (codeOf(error) !== 'stale-local-head') throw error; }
        }
        fail('stale-local-head');
      }
      // For a new epoch/incomplete copy, first observe the entire manifest. Entries
      // with immutable operations are deferred until replay resolves their outcome.
      const needsManifest = !snapshot.status?.snapshotComplete || !snapshot.cursor || snapshot.epoch !== hello.epoch;
      const replayAfterManifest = needsManifest ? snapshot.preparedOperations : [];
      const deferredIds = new Set(replayAfterManifest.map(op => op.entryId));
      if (!needsManifest) await send(snapshot.preparedOperations);
      checkpoint();
      if (partialError) throw new Error(partialError);
      snapshot = await read();
      if (!snapshot.status?.snapshotComplete || !snapshot.cursor || snapshot.epoch !== hello.epoch) {
        let progress = snapshot.epoch === hello.epoch && !replayAfterManifest.length ? snapshot.initialCopy : null;
        // Re-read a partial stable manifest from its beginning to reconstruct the
        // complete ID set after restart. Native verified objects remain reusable.
        if (progress?.pageCursor) progress = { ...progress, pageCursor: '0' };
        const manifestIds = new Set<string>();
        let tokenExpired = false;
        for (let pages = 0; ; pages++) {
          checkpoint(); if (pages >= 10000) fail('snapshot-budget-exhausted');
          let page: SnapshotPage;
          try { page = await remote.snapshot(progress?.pageCursor ? progress.snapshotToken : undefined, progress?.pageCursor ?? undefined); }
          catch (error) {
            if ((error as { statusCode?: number }).statusCode === 410 && !tokenExpired) { progress = null; manifestIds.clear(); tokenExpired = true; continue; }
            throw error;
          }
          checkpoint();
          if (!page.snapshotToken || !page.atCursor || !Array.isArray(page.entries) || page.pageCursor !== null && !page.pageCursor
            || progress?.pageCursor && (page.snapshotToken !== progress.snapshotToken || page.atCursor !== progress.atCursor || page.pageCursor === progress.pageCursor)) fail('invalid-snapshot');
          for (const entry of page.entries) manifestIds.add(entry.entryId);
          let entries = page.entries.filter(entry => !deferredIds.has(entry.entryId));
          if (page.pageCursor === null && replayAfterManifest.length) {
            await send(replayAfterManifest); checkpoint();
            if (partialError) throw new Error(partialError);
            // An ACK is a newer, durable remote observation than the manifest.
            // Conflicts are already represented by confirm; never replace them
            // with an older snapshot observation or synthesize an operation.
            entries = entries.concat([...confirmedDuringReplay.values()]);
            for (const id of [...confirmedDuringReplay.keys(), ...conflictedDuringReplay]) manifestIds.add(id);
          }
          await persist(entries, { nextCursor: page.atCursor, epoch: hello.epoch, initialCopy: { snapshotToken: page.snapshotToken, atCursor: page.atCursor, pageCursor: page.pageCursor } }, page.pageCursor === null ? manifestIds : undefined);
          progress = page; if (page.pageCursor === null) break;
        }
      }
      for (let round = 0; round < 1000; round++) {
        checkpoint(); snapshot = await read();
        if (!snapshot.cursor) throw new Error('initial-copy-incomplete');
        const page = await remote.changes(snapshot.cursor, 100); checkpoint();
        if (page.fromCursor !== snapshot.cursor || !page.nextCursor || !Array.isArray(page.entries)
          || page.entries.length && page.nextCursor === snapshot.cursor) fail('invalid-changes');
        if (page.entries.length || page.nextCursor !== snapshot.cursor) {
          await persist(page.entries, { nextCursor: page.nextCursor, epoch: hello.epoch }); continue;
        }
        // Empty response at this cursor is the observed catch-up boundary, not a
        // promise that another writer cannot immediately change the remote vault.
        checkpoint(); const pending = await replica.preparePending(100); checkpoint();
        if (pending.length) {
          await send(pending); checkpoint();
          if (partialError) throw new Error(partialError); continue;
        }
        snapshot = await read();
        if (snapshot.status?.pendingCount || snapshot.status?.conflictCount) { emit(settled(snapshot)); return; }
        checkpoint();
        emit(await replica.completeCycle({ expectedCursor: page.nextCursor, expectedEpoch: hello.epoch }));
        retry = 0; completed = true; return;
      }
      fail('cycle-budget-exhausted');
    } catch (error) {
      const code = codeOf(error); snapshot = await read();
      if (code === 'cycle-stopped') { emit(settled(snapshot)); return; }
      const blocked = ['identity-mismatch', 'incompatible-protocol', 'adapter-upgrade-required'].includes(code);
      emit({ ...settled(snapshot, code), phase: blocked ? 'blocked' : snapshot.status?.conflictCount ? 'conflicts' : 'offline' });
      if (!blocked && running && mode === 'automatic') {
        const base = Math.min(30000, 1000 * 2 ** Math.min(retry++, 5));
        schedule(Math.min(30000, Math.round(base * (0.8 + clock.random() * 0.4))));
      }
    } finally {
      // A foreground automatic engine polls for remote-only changes, even without
      // local edits or connectivity events. Manual mode never schedules content.
      if (completed) schedule(30000);
    }
  }
  function launch(explicit: boolean): Promise<void> {
    if (active) {
      if (activeGeneration !== generation) return active.then(() => launch(explicit));
      return active;
    }
    cancel(); const token = generation;
    activeGeneration = token;
    active = (async () => {
      const snapshot = await read(), id = snapshot.profile.replicaId;
      const existing = activeReplicas.get(id);
      if (existing) { await existing; emit(settled(await read())); return; }
      const work = cycle(explicit, token); activeReplicas.set(id, work);
      try { await work; } finally { if (activeReplicas.get(id) === work) activeReplicas.delete(id); }
    })().catch(async error => { emit({ ...settled(await read(), codeOf(error)), phase: 'blocked' }); }).finally(() => { active = null; });
    return active;
  }
  const engine: SyncEngine = {
    start() { running = true; return launch(false); },
    stop() { running = false; generation++; cancel(); },
    synchronizeNow: () => launch(true),
    async setMode(next) {
      if (next !== 'automatic' && next !== 'manual') fail('invalid-mode');
      const snapshot = await read();
      const configured = await replica.configure({ offlineEnabled: snapshot.profile.offlineEnabled, mode: next });
      mode = next; cancel(); if (next === 'manual') generation++;
      emit({ ...configured, phase: configured.conflictCount ? 'conflicts' : next === 'manual' ? 'waiting-manual' : 'offline' });
      if (next === 'automatic' && running) schedule(0);
    },
    onStatus(listener) { listeners.add(listener); listener({ ...status }); return () => { listeners.delete(listener); }; },
    localChanged() { if (running && mode === 'automatic') schedule(1000); else void read().then(s => emit(settled(s))); },
    resume() { running = true; return launch(false); },
    reconnect() { return launch(false); },
  };
  return engine;
}
