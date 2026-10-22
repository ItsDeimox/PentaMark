import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink, readdir, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { EventEmitter } from 'node:events';
import { watch, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { installReplicaIpc } from '../local/sync/replica-ipc.mjs';
import { acquireWriter } from '../local/sync/database.mjs';
const { createSyncBridge } = createRequire(import.meta.url)('../desktop/sync-ipc.cjs');
async function fixture(t) {
  // Windows runners expose TEMP through an 8.3 alias (RUNNER~1). The recovery
  // contract intentionally requires canonical, non-aliased paths.
  const base = await realpath(await mkdtemp(join(tmpdir(), 'pentamark-recovery-')));
  const userData = join(base, 'private'), destination = join(base, 'exports');
  const profile = { vaultId: randomUUID(), serverId: randomUUID(), replicaId: randomUUID(), origin: 'http://host.test:3417', offlineEnabled: true, mode: 'manual' };
  const root = join(userData, 'sync', 'replicas', profile.vaultId, profile.replicaId);
  await mkdir(join(root, 'objects'), { recursive: true }); await mkdir(destination);
  const db = new DatabaseSync(join(root, 'replica.sqlite'));
  db.exec('PRAGMA user_version=999; CREATE TABLE future_pending(content BLOB); INSERT INTO future_pending VALUES (X\'000102ff\')'); db.close();
  await writeFile(join(root, 'objects', 'future-pending'), 'irreplaceable pending bytes');
  const channel = new EventEmitter(); channel.send = () => {};
  const ipc = installReplicaIpc({ channel, userData });
  t.after(async () => { await ipc.close(); await rm(base, { recursive: true, force: true }); });
  const command = (method, payload = { profile }) => ({ requestId: randomUUID(), replicaId: profile.replicaId, method, payload });
  const failOpen = () => assert.rejects(ipc.dispatch(command('open', profile)), /unsupported-schema/);
  return { base, root, userData, destination, profile, ipc, command, failOpen };
}
test('opaque recovery requires matching failed open and copies future bytes without schema access', async t => {
  const f = await fixture(t); const before = await readFile(join(f.root, 'replica.sqlite'));
  await assert.rejects(f.ipc.dispatch(f.command('exportRecovery'), { exportDirectory: f.destination }), /recovery-not-authorized/);
  await f.failOpen();
  await assert.rejects(f.ipc.dispatch(f.command('exportRecovery', { profile: { ...f.profile, serverId: randomUUID() } }), { exportDirectory: f.destination }), /recovery-not-authorized/);
  // Unknown-format sidecars are opaque, not opened or checkpointed by export.
  await writeFile(join(f.root, 'replica.sqlite-wal'), 'future WAL bytes');
  await writeFile(join(f.root, 'replica.sqlite-shm'), 'future SHM bytes');
  await mkdir(join(f.root, 'history')); await writeFile(join(f.root, 'history', 'unknown'), 'future history');
  const result = await f.ipc.dispatch(f.command('exportRecovery'), { exportDirectory: f.destination });
  assert.equal(result.cancelled, false); assert.equal(result.format, 'pentamark-opaque-replica-v1');
  const output = join(f.destination, result.directoryName);
  assert.deepEqual(await readFile(join(f.root, 'replica.sqlite')), before);
  assert.deepEqual(await readFile(join(output, 'replica', 'replica.sqlite')), before);
  for (const path of ['objects/future-pending', 'history/unknown', 'replica.sqlite-wal', 'replica.sqlite-shm', 'writer.sqlite']) {
    assert.deepEqual(await readFile(join(output, 'replica', path)), await readFile(join(f.root, path)));
  }
  const manifest = JSON.parse(await readFile(join(output, 'manifest.json'), 'utf8'));
  assert.equal(manifest.interpreted, false);
  const release = acquireWriter(join(f.root, 'writer.sqlite')); release();
});
test('opaque recovery rejects lock contention, renderer paths and private or linked destinations', async t => {
  const f = await fixture(t); await f.failOpen();
  await assert.rejects(f.ipc.dispatch(f.command('exportRecovery', { profile: f.profile, exportDirectory: f.destination })), /invalid-command/);
  await assert.rejects(f.ipc.dispatch(f.command('exportRecovery')), /native-picker-required/);
  const release = acquireWriter(join(f.root, 'writer.sqlite'));
  try { await assert.rejects(f.ipc.dispatch(f.command('exportRecovery'), { exportDirectory: f.destination }), /host-already-open/); } finally { release(); }
  await assert.rejects(f.ipc.dispatch(f.command('exportRecovery'), { exportDirectory: f.userData }), /unsafe-recovery-path/);
  const link = join(f.base, 'alias'); await symlink(f.userData, link, 'junction');
  await assert.rejects(f.ipc.dispatch(f.command('exportRecovery'), { exportDirectory: link }), /unsafe-recovery-path/);
  await symlink(f.destination, join(f.root, 'escape'), 'junction');
  await assert.rejects(f.ipc.dispatch(f.command('exportRecovery'), { exportDirectory: f.destination }), /unsafe-recovery-path/);
  assert.deepEqual(await readdir(f.destination), []);
});
test('recovery folder picker cancellation and context changes never dispatch', async () => {
  const child = new EventEmitter(); child.connected = true; let sent = 0; child.send = () => { sent++; };
  const profile = { vaultId: randomUUID(), serverId: randomUUID(), replicaId: randomUUID(), origin: 'http://host.test:3417', offlineEnabled: true, mode: 'manual' };
  const command = { requestId: randomUUID(), replicaId: profile.replicaId, method: 'exportRecovery', payload: { profile } };
  let trusted = true, picked = null;
  const bridge = createSyncBridge({ getChild: () => child, trustedFrame: () => trusted, pickExportDirectory: async () => { if (picked) trusted = false; return picked; } });
  try {
    assert.equal((await bridge.invoke({}, command)).value.cancelled, true);
    picked = 'C:/native-selected'; await assert.rejects(bridge.invoke({}, command), /sync-context-changed/);
    assert.equal(sent, 0);
  } finally { bridge.close(); }
});

test('recovery authorization is cleared by a successful open and rejects wrong replica IDs', async t => {
  const f = await fixture(t); await f.failOpen();
  await assert.rejects(f.ipc.dispatch({ ...f.command('exportRecovery'), replicaId: randomUUID() }), /wrong-replica/);
  const db = new DatabaseSync(join(f.root, 'replica.sqlite')); db.exec('PRAGMA user_version=1'); db.close();
  await f.ipc.dispatch(f.command('open', f.profile));
  await assert.rejects(f.ipc.dispatch(f.command('exportRecovery'), { exportDirectory: f.destination }), /recovery-not-authorized/);
  assert.deepEqual(await readdir(f.destination), []);
});

test('recovery rejects excessive depth before making a destination', async t => {
  const f = await fixture(t); await f.failOpen();
  await mkdir(join(f.root, ...Array(65).fill('d')), { recursive: true });
  await assert.rejects(f.ipc.dispatch(f.command('exportRecovery'), { exportDirectory: f.destination }), /recovery-limit-exceeded|unsafe-recovery-path/);
  assert.deepEqual(await readdir(f.destination), []);
});

test('failed recovery publication retains partial output, never overwrites, and releases the writer', async t => {
  const f = await fixture(t); await f.failOpen();
  let blockedName;
  const watcher = watch(f.destination, (_event, filename) => {
    if (!blockedName && filename?.endsWith('.partial')) {
      blockedName = filename.slice(0, -8);
      mkdirSync(join(f.destination, blockedName)); writeFileSync(join(f.destination, blockedName, 'sentinel'), 'do not overwrite');
    }
  });
  try { await assert.rejects(f.ipc.dispatch(f.command('exportRecovery'), { exportDirectory: f.destination })); }
  finally { watcher.close(); }
  assert.ok(blockedName);
  assert.equal(await readFile(join(f.destination, blockedName, 'sentinel'), 'utf8'), 'do not overwrite');
  assert.equal(await readFile(join(f.destination, blockedName + '.partial', 'replica', 'objects', 'future-pending'), 'utf8'), 'irreplaceable pending bytes');
  assert.equal(await readFile(join(f.root, 'objects', 'future-pending'), 'utf8'), 'irreplaceable pending bytes');
  const release = acquireWriter(join(f.root, 'writer.sqlite')); release();
});
