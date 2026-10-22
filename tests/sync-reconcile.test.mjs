import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const cases = JSON.parse(await readFile(new URL('./fixtures/sync/contract-cases.json', import.meta.url), 'utf8'));
const dir = await mkdtemp(join(tmpdir(), 'pm-sync-contract-'));
after(() => rm(dir, { recursive: true, force: true }));
let planEntry, normalizePath;
// Missing implementation produces assertion failures for each required behavior in RED.
if (existsSync('src/features/sync/reconcile.ts')) {
  await build({ entryPoints: ['src/features/sync/reconcile.ts'], outfile: join(dir, 'sync.mjs'), bundle: true, format: 'esm', platform: 'node' });
  ({ planEntry, normalizePath } = await import(pathToFileURL(join(dir, 'sync.mjs')).href));
}
for (const c of cases.reconciliation) {
  test(c.name, () => {
    assert.equal(typeof planEntry, 'function', 'planEntry must implement reconciliation');
    const inputs = [c.base, c.local, c.remote].map(key => key === null ? null : Object.freeze(structuredClone(cases.versions[key])));
    const before = structuredClone(inputs);
    assert.deepEqual(planEntry(...inputs), { action: c.action, reason: c.reason, base: before[0], local: before[1], remote: before[2] });
    assert.deepEqual(inputs, before, 'must not mutate supplied versions');
  });
}
for (const c of cases.paths) {
  test(`path ${JSON.stringify(c.input)}`, () => {
    assert.equal(typeof normalizePath, 'function', 'normalizePath must validate paths');
    assert.deepEqual(normalizePath(c.input), c.expected);
  });
}
test('inverted clocks cannot choose a winner or replace the original base revision', () => {
  assert.equal(typeof planEntry, 'function');
  const base = { ...cases.versions.A, modifiedAt: '2099-01-01' };
  const local = { ...cases.versions.B, modifiedAt: '1900-01-01' };
  const remote = { ...cases.versions.C, modifiedAt: '2100-01-01' };
  assert.deepEqual(planEntry(base, local, remote), { action: 'conflict', reason: 'concurrent-change', base, local, remote });
  const push = planEntry(base, local, base);
  assert.equal(push.action, 'push');
  assert.equal(push.base.revision, 'base-original');
  assert.deepEqual([push.base.blobHash, push.local.blobHash, push.remote.blobHash], ['A', 'B', 'A']);
});
