import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const dir = await mkdtemp(join(tmpdir(), 'pm-renderers-'));
test.after(() => rm(dir, { recursive: true, force: true }));
await build({ stdin: { contents: `
  import React from 'react';
  import { renderToStaticMarkup } from 'react-dom/server';
  import { SignalBackground } from './src/features/workspace/SignalBackground';
  import { AcrylicLayer } from './src/features/workspace/AcrylicLayer';
  export { attachAmbientSignals, attachEnergyHover } from './src/features/workspace/signal-renderer';
  export { attachAcrylicRenderer } from './src/features/workspace/acrylic-renderer';
  export const background = props => renderToStaticMarkup(React.createElement(SignalBackground, {theme:'pearl', ...props}));
  export const acrylic = props => renderToStaticMarkup(React.createElement(AcrylicLayer, {theme:'pearl', ...props}));
`, resolveDir: process.cwd() }, outfile: join(dir, 'renderers.cjs'), bundle: true, platform: 'node', format: 'cjs' });
const { background, acrylic, attachAmbientSignals, attachEnergyHover, attachAcrylicRenderer } = (await import(pathToFileURL(join(dir, 'renderers.cjs')))).default;
test('disabled background mounts no host, SVG, or canvas', () => {
  assert.equal(background({animated:false,reactive:false}), '');
});
test('ambient-only background allocates no reactive canvas', () => {
  assert.doesNotMatch(background({animated:true,reactive:false}), /canvas/);
});
test('reactive-only background allocates no ambient host', () => {
  const html = background({animated:false,reactive:true});
  assert.match(html, /canvas/);
  assert.doesNotMatch(html, /pm-ambient-signals/);
});
test('disabled low-level renderers do not access DOM, geometry, media queries or canvas', () => {
  const forbidden = new Proxy({}, {get() { throw Error('disabled renderer touched a resource'); }, set() { throw Error('disabled renderer mutated a resource'); }});
  attachAmbientSignals(forbidden, 100, 100, false)();
  attachEnergyHover(forbidden, forbidden, forbidden, 1, false)();
});
test('disabled acrylic mounts no canvas', () => assert.equal(acrylic({ enabled: false }), ''));
test('disabled acrylic renderer installs no observers, listeners, geometry or GPU resources', () => {
  const forbidden = new Proxy({}, { get() { throw Error('disabled acrylic accessed a resource'); } });
  attachAcrylicRenderer(forbidden, forbidden, { enabled: false })();
});
