import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const dir = await mkdtemp(join(tmpdir(), 'pm-graphics-'));
test.after(() => rm(dir, { recursive: true, force: true }));
await build({ entryPoints: ['src/features/workspace/graphics-policy.ts'], outfile: join(dir, 'policy.mjs'), bundle: true, platform: 'node', format: 'esm' });
const { loadAppearance, resolveGraphics, applyGraphicsPreset } = await import(pathToFileURL(join(dir, 'policy.mjs')));
const off = { animated: false, reactive: false, acrylic: false, refraction: false, interfaceMotion: false };
function storage(value) {
  const map = new Map(value === undefined ? [] : [['pentamark:appearance', JSON.stringify(value)]]);
  return { getItem: key => map.get(key) ?? null, setItem: (key, value) => map.set(key, value) };
}
test('first entry on constrained devices disables all expensive effects', () => {
  for (const capabilities of [{ android: true }, { coarsePointer: true }, { reducedMotion: true }, { deviceMemory: 4 }, { hardwareConcurrency: 2 }]) {
    assert.deepEqual(resolveGraphics(loadAppearance(storage(), capabilities)), off);
  }
});
test('first desktop entry recommends balanced and persists across capability changes', () => {
  const saved = storage();
  const first = loadAppearance(saved, {});
  assert.equal(first.graphicsPreset, 'balanced');
  assert.deepEqual(loadAppearance(saved, { android: true }), first);
});
test('legacy Flat without explicit effects becomes economical, preserving typography and theme', () => {
  const appearance = loadAppearance(storage({ graphicsMode: 'flat', theme: 'pearl', editorSize: 25, uiFont: 'serif' }), {});
  assert.deepEqual(resolveGraphics(appearance), off);
  assert.equal(appearance.theme, 'pearl');
  assert.equal(appearance.editorSize, 25);
  assert.equal(appearance.uiFont, 'serif');
});
test('legacy explicit effects and subsequent custom choices survive constrained sessions', () => {
  const saved = storage({ graphicsMode: 'flat', backgroundMotion: true, backgroundHover: false, interfaceMotion: true, refraction: true, graphicsPreset: 'custom' });
  const appearance = loadAppearance(saved, { android: true, reducedMotion: true });
  assert.deepEqual(resolveGraphics(appearance), { animated: true, reactive: false, acrylic: true, refraction: true, interfaceMotion: true });
  assert.deepEqual(loadAppearance(saved, { hardwareConcurrency: 1 }), appearance);
});
test('upgrade migrates automatically saved legacy Flat effects once, preserving all non-graphics preferences', () => {
  const saved = storage({ graphicsMode:'flat', backgroundMotion:true, backgroundHover:true, theme:'pearl', editorFont:'mono', customUiFont:'My Font', appScale:1.25 });
  const migrated = loadAppearance(saved, {});
  assert.deepEqual(resolveGraphics(migrated), off);
  assert.equal(migrated.graphicsPreset, 'economical');
  assert.equal(migrated.theme, 'pearl');
  assert.equal(migrated.editorFont, 'mono');
  assert.equal(migrated.customUiFont, 'My Font');
  assert.equal(migrated.appScale, 1.25);
  saved.setItem('pentamark:appearance', JSON.stringify({ ...migrated, graphicsPreset:'custom', backgroundMotion:true }));
  assert.equal(resolveGraphics(loadAppearance(saved, {android:true})).animated, true);
});
test('legacy acrylic retains its chosen effects and gets a valid custom profile', () => {
  const migrated = loadAppearance(storage({graphicsMode:'acrylic',backgroundMotion:false,backgroundHover:true}), {android:true});
  assert.deepEqual(resolveGraphics(migrated), {animated:false,reactive:true,acrylic:true,refraction:true,interfaceMotion:true});
  assert.equal(migrated.graphicsPreset, 'custom');
});
test('older combined background switch still disables both effects on legacy acrylic', () => {
  const migrated = loadAppearance(storage({graphicsMode:'acrylic',backgroundMotion:false}), {});
  assert.equal(resolveGraphics(migrated).animated, false);
  assert.equal(resolveGraphics(migrated).reactive, false);
});
test('presets reset graphics only and explicit toggles are independent', () => {
  const appearance = loadAppearance(storage({ theme: 'ember', editorSize: 24 }), {});
  const economical = applyGraphicsPreset(appearance, 'economical');
  assert.deepEqual(resolveGraphics(economical), off);
  assert.equal(economical.theme, 'ember');
  assert.equal(economical.editorSize, 24);
  assert.deepEqual(resolveGraphics({ ...economical, backgroundHover: true, graphicsPreset: 'custom' }), { ...off, reactive: true });
  assert.deepEqual(resolveGraphics(applyGraphicsPreset(appearance, 'quality')), { animated: true, reactive: true, acrylic: true, refraction: true, interfaceMotion: true });
});
test('invalid or unavailable storage safely falls back without throwing', () => {
  for (const saved of [{ getItem: () => '{' }, storage(null), storage([]), { getItem() { throw Error('denied'); } }]) {
    assert.deepEqual(resolveGraphics(loadAppearance(saved, { android: true })), off);
  }
});
