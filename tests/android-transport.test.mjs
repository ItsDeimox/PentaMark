import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const dir = await mkdtemp(join(tmpdir(), 'pentamark-android-test-'));
after(() => rm(dir, { recursive: true, force: true }));
await build({ entryPoints: ['src/platform/local-files.ts'], outfile: join(dir, 'files.mjs'), bundle: true, format: 'esm', platform: 'node' });
const { resolveLocalFile, DraftStore } = await import(pathToFileURL(join(dir, 'files.mjs')).href);
const paths = ['assets/Foto verão.png', 'Projetos/local.png', 'Projetos/Nota.md', 'A/dup.png', 'B/dup.png'];

test('relative media resolves beside the note and Unicode names stay intact', () => {
  assert.equal(resolveLocalFile('./local.png', 'Projetos/Nota.md', paths), 'Projetos/local.png');
  assert.equal(resolveLocalFile('../assets/Foto verão.png', 'Projetos/Nota.md', paths), 'assets/Foto verão.png');
  assert.equal(resolveLocalFile('Foto verão.png', 'Projetos/Nota.md', paths), 'assets/Foto verão.png');
});
test('missing, ambiguous, system and escaping paths cannot expose other app files', () => {
  for (const path of ['../../secret', '/data/private', '.history/x', 'dup.png', 'missing.png']) {
    assert.equal(resolveLocalFile(path, 'Projetos/Nota.md', paths), null);
  }
});
function memoryStorage() {
  const map = new Map();
  return { getItem: k => map.get(k) ?? null, setItem: (k,v) => map.set(k,v), removeItem: k => map.delete(k), get length() { return map.size; }, key: i => [...map.keys()][i] ?? null };
}
test('drafts survive reconstructing the store and include their base revision', () => {
  const storage = memoryStorage();
  new DraftStore(storage).put('A.md', 'escrita não salva', 'r1');
  assert.deepEqual(new DraftStore(storage).get('A.md'), { content: 'escrita não salva', revision: 'r1' });
});
test('an older save completion cannot remove a newer draft', () => {
  const store = new DraftStore(memoryStorage());
  store.put('A.md', 'novo', 'r1');
  store.saved('A.md', 'antigo', 'r2');
  assert.deepEqual(store.get('A.md'), { content: 'novo', revision: 'r2' });
  store.saved('A.md', 'novo', 'r3');
  assert.equal(store.get('A.md'), null);
});
test('malformed draft data is ignored, never substituted for a note', () => {
  const storage = memoryStorage();
  storage.setItem('pentamark:android:draft:A.md', '{bad');
  assert.equal(new DraftStore(storage).get('A.md'), null);
});
test('folder rename migrates late drafts so they recover at the new path', () => {
  const store = new DraftStore(memoryStorage());
  store.put('Old/A.md','late typing','r2');
  store.put('Other.md','unrelated','r1');
  store.move('Old','New');
  assert.equal(store.get('Old/A.md'),null);
  assert.deepEqual(store.get('New/A.md'),{content:'late typing',revision:'r2'});
  assert.deepEqual(store.get('Other.md'),{content:'unrelated',revision:'r1'});
});
