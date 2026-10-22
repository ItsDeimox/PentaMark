import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync } from 'node:fs';
import { build } from 'esbuild';

let model = {};
if (existsSync('src/features/sync/conflict-model.ts')) {
  const result = await build({ entryPoints: ['src/features/sync/conflict-model.ts'], bundle: true, write: false, format: 'esm', platform: 'node' });
  model = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}
const version = (revision, extra = {}) => ({ entryId: 'entry', kind: 'note', path: 'note.md', revision, blobHash: revision.repeat(64).slice(0, 64), byteLength: 4, deleted: false, ...extra });
const conflict = { conflictId: 'c1', entryId: 'entry', base: version('b'), local: version('l'), remote: version('r'), reason: 'both-modified' };
const review = { conflict, localHead: 'head-7' };
const capabilities = { 'keep-both': true, local: true, remote: true, merged: true };

test('four choices carry the displayed revision and local head without modifying retained versions', () => {
  assert.equal(typeof model.createResolution, 'function');
  const before = structuredClone(conflict);
  for (const choice of ['keep-both', 'local', 'remote', 'merged']) {
    assert.deepEqual(model.createResolution(review, review, choice, capabilities, 'draft'), {
      conflictId: 'c1', expectedRemoteRevision: 'r', expectedLocalHead: 'head-7', choice,
      ...(choice === 'merged' ? { mergedContent: 'draft' } : {}),
    });
  }
  assert.deepEqual(conflict, before);
});

test('changed host, local head, conflict identity or removed conflict cannot reuse approval', () => {
  assert.equal(typeof model.createResolution, 'function');
  for (const current of [null, { ...review, localHead: 'head-8' },
    { ...review, conflict: { ...conflict, remote: version('new') } },
    { ...review, conflict: { ...conflict, conflictId: 'c2' } }]) {
    assert.throws(() => model.createResolution(review, current, 'merged', capabilities, 'precious draft'), /stale-conflict/);
  }
});

test('known empty native local head is preserved; an unknown head cannot authorize resolution', () => {
  const empty = { ...review, localHead: '' };
  assert.equal(model.createResolution(empty, empty, 'keep-both', capabilities).expectedLocalHead, '');
  const unknown = { ...review, localHead: null };
  assert.throws(() => model.createResolution(unknown, unknown, 'keep-both', capabilities), /missing-local-head/);
});

test('binary, directory and deletion conflicts never merge; native unsupported choices remain blocked', () => {
  assert.equal(typeof model.choiceUnavailable, 'function');
  for (const local of [version('l', { kind: 'asset' }), version('l', { kind: 'directory', blobHash: null }), version('l', { deleted: true, blobHash: null }), null]) {
    const item = { ...conflict, local };
    assert.ok(model.choiceUnavailable(item, 'merged', capabilities));
    assert.equal(model.choiceUnavailable(item, 'keep-both', capabilities), null);
  }
  assert.ok(model.choiceUnavailable(conflict, 'local', { local: 'Envio indisponível' }));
  assert.ok(model.choiceUnavailable(conflict, 'remote', {}));
  assert.throws(() => model.createResolution(review, review, 'local', {}), /unsupported-choice/);
});

test('rename/delete and Windows name collisions delegate naming and retention to the native port', () => {
  assert.equal(typeof model.createResolution, 'function');
  for (const item of [
    { ...conflict, local: version('l', { path: 'Renamed.md' }), remote: version('r', { deleted: true, blobHash: null }), reason: 'delete-edit' },
    { ...conflict, local: version('l', { path: 'NOTE.md' }), remote: version('r', { path: 'note.md' }), reason: 'path-collision' },
  ]) {
    const state = { conflict: item, localHead: 'head-7' };
    assert.deepEqual(model.createResolution(state, state, 'keep-both', capabilities), {
      conflictId: 'c1', expectedRemoteRevision: 'r', expectedLocalHead: 'head-7', choice: 'keep-both',
    });
  }
});

const complete = { phase: 'idle', localSaved: true, snapshotComplete: true, pendingCount: 0, conflictCount: 0, lastSuccessfulSync: '2026-10-22T12:00:00.000Z', errorCode: null };
test('synchronized requires complete snapshot, zero counters, successful timestamp and idle phase', () => {
  assert.equal(typeof model.syncStatusLabel, 'function');
  assert.equal(model.syncStatusLabel(complete), 'Sincronizado');
  for (const patch of [{ snapshotComplete: false }, { pendingCount: 1 }, { conflictCount: 1 }, { lastSuccessfulSync: null }, { lastSuccessfulSync: 'invalid' }, { errorCode: 'disk-full' }, { phase: 'offline' }, { phase: 'waiting-manual' }, { phase: 'initial-copy' }, { phase: 'blocked' }, { phase: 'syncing' }]) {
    assert.notEqual(model.syncStatusLabel({ ...complete, ...patch }), 'Sincronizado');
  }
  assert.notEqual(model.syncStatusLabel(undefined), 'Sincronizado');
});

test('disable is conservative when status is unknown or anything is pending', () => {
  assert.equal(typeof model.canDisableOffline, 'function');
  assert.equal(model.canDisableOffline(complete), true);
  for (const state of [undefined, { ...complete, pendingCount: 1 }, { ...complete, conflictCount: 1 },
    { ...complete, phase: 'syncing' }, { ...complete, phase: 'blocked' }, { ...complete, errorCode: 'disk-full' },
    { ...complete, snapshotComplete: false, phase: 'offline' }]) {
    assert.equal(model.canDisableOffline(state), false);
  }
});
