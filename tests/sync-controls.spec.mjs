// Standalone DOM harness: node --test tests/sync-controls.spec.mjs
// Deliberately bypasses the app server, fixtures and shared Playwright config.
import assert from 'node:assert/strict';
import { test as nodeTest, before as nodeBefore, after as nodeAfter } from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import { build } from 'esbuild';
import { chromium, expect, test as playwrightTest } from '@playwright/test';

// Also safe to collect with the repository's Playwright suite.
const standalone = !!process.env.NODE_TEST_CONTEXT;
const before = standalone ? nodeBefore : playwrightTest.beforeAll;
const after = standalone ? nodeAfter : playwrightTest.afterAll;
const test = standalone ? nodeTest : (name, run) => playwrightTest(name, async ({}) => {
  const cleanups = [];
  try { await run({ after: callback => cleanups.push(callback) }); }
  finally { for (const cleanup of cleanups.reverse()) await cleanup(); }
});

let browser, bundle, css;
const files = ['SyncSettings.tsx', 'SyncStatus.tsx', 'SyncConflictDialog.tsx'];
before(async () => {
  if (!files.every(file => existsSync(`src/features/sync/${file}`))) return;
  const result = await build({ stdin: { contents: `
    import React from 'react'; import {createRoot} from 'react-dom/client';
    import {SyncSettings} from './src/features/sync/SyncSettings';
    import {SyncStatus} from './src/features/sync/SyncStatus';
    import {SyncConflictDialog} from './src/features/sync/SyncConflictDialog';
    const root = createRoot(document.getElementById('root'));
    window.calls = []; window.failResolve = false;
    window.mount = (kind, props) => {
      window.current = {kind, props};
      const actions = {
        onEnable: async input => { window.calls.push(['enable', input]); },
        onConfigure: async config => { window.calls.push(['configure', config]); },
        onSyncNow: async () => { window.calls.push(['sync']); },
        onExportPending: async () => { window.calls.push(['export-pending']); },
        onReviewConflicts: () => {}, onClose: () => {},
        onResolve: async input => { window.calls.push(['resolve', input]); if(window.failResolve) throw new Error('stale-local-head'); },
        onLoadVersion: async version => 'retained ' + version.revision,
        onExportVersion: async version => { window.calls.push(['export', version]); },
      };
      for (const key of props.unsupported || []) delete actions[key];
      root.render(React.createElement({settings: SyncSettings, status: SyncStatus, conflicts: SyncConflictDialog}[kind], {...actions, ...props}));
    };
  `, resolveDir: process.cwd(), loader: 'tsx' }, bundle: true, write: false, format: 'iife', platform: 'browser', outfile: 'harness.js', loader: { '.css': 'css' } });
  bundle = result.outputFiles.find(file => file.path.endsWith('.js')).text;
  css = readFileSync('src/components/dialogs/dialogs.css', 'utf8') + '\n' + result.outputFiles.filter(file => file.path.endsWith('.css')).map(file => file.text).join('\n');
  browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
});
after(async () => { await browser?.close(); });
const status = { phase: 'idle', localSaved: true, snapshotComplete: true, pendingCount: 0, conflictCount: 0, lastSuccessfulSync: '2026-10-22T12:00:00Z', errorCode: null };
const version = (revision, extra = {}) => ({ entryId: 'e1', kind: 'note', path: 'a.md', revision, blobHash: revision.repeat(64), byteLength: 5, deleted: false, ...extra });
const conflict = { conflictId: 'c1', entryId: 'e1', base: version('b'), local: version('l'), remote: version('r'), reason: 'both-modified' };
const capabilities = { 'keep-both': true, local: true, remote: true, merged: true };
async function pageFor(t, kind, props, width = 1100) {
  assert.ok(browser, 'Task 8 components must exist');
  const page = await browser.newPage({ viewport: { width, height: 850 } });
  t.after(() => page.close());
  await page.setContent('<div class="pm-shell" style="--pm-text:#eee;--pm-panel-2:#18212b;--pm-muted:#ddd;--pm-border:#567;--pm-cyan:#7df"><div id="root"></div></div>');
  await page.addStyleTag({ content: css });
  await page.addScriptTag({ content: bundle });
  await page.evaluate(({ kind, props }) => window.mount(kind, props), { kind, props });
  return page;
}
test('existing profile starts off; manual is visible before explicit initial copy', async t => {
  const page = await pageFor(t, 'settings', { offlineEnabled: false, mode: 'automatic', origin: 'http://host.test:3000', status });
  await expect(page.getByRole('checkbox', { name: 'Manter cópia offline' })).not.toBeChecked();
  await page.getByRole('checkbox').check();
  await page.getByRole('radio', { name: 'Manual', exact: true }).check();
  assert.deepEqual(await page.evaluate(() => window.calls), []);
  await page.getByRole('button', { name: 'Criar cópia inicial' }).click();
  assert.deepEqual(await page.evaluate(() => window.calls), [['enable', { origin: 'http://host.test:3000', mode: 'manual' }]]);
});
test('pending disable offers sync/export/cancel and never sends false even after export', async t => {
  const page = await pageFor(t, 'settings', { offlineEnabled: true, mode: 'manual', status: { ...status, pendingCount: 2 } });
  await page.getByRole('checkbox').click();
  await expect(page.getByRole('checkbox')).toBeChecked();
  await page.getByRole('button', { name: 'Exportar pendências' }).click();
  await page.getByRole('button', { name: 'Cancelar' }).click();
  assert.deepEqual(await page.evaluate(() => window.calls), [['export-pending']]);
  await page.getByRole('button', { name: 'Sincronizar agora', exact: true }).click();
  assert.deepEqual(await page.evaluate(() => window.calls), [['export-pending'], ['sync']]);
});
test('status exposes incomplete/offline/manual/counters without a false synchronized claim', async t => {
  const page = await pageFor(t, 'status', { status: { ...status, phase: 'offline', snapshotComplete: false, pendingCount: 2, conflictCount: 1 } });
  await expect(page.getByText('Download inicial incompleto', { exact: true })).toBeVisible();
  await expect(page.getByText('Sincronizado', { exact: true })).toHaveCount(0);
  await expect(page.getByText(/2 pendências/)).toBeVisible();
  await expect(page.getByText(/1 conflitos/)).toBeVisible();
  await expect(page.locator('time')).toHaveAttribute('datetime', '2026-10-22T12:00:00Z');
  await page.evaluate(s => window.mount('status', { status: { ...s, phase: 'waiting-manual' } }), status);
  await expect(page.getByText('Aguardando sincronização manual', { exact: true })).toBeVisible();
});
test('stale errors and refreshed conflict identity preserve draft and require reviewing new versions', async t => {
  const page = await pageFor(t, 'conflicts', { conflicts: [{ conflict, localHead: 'h1' }], capabilities });
  await expect(page.getByText('retained b', { exact: true })).toBeVisible();
  await expect(page.getByText('retained r', { exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: 'Resultado da mesclagem' }).fill('my careful merge');
  await page.evaluate(() => { window.failResolve = true; });
  await page.getByRole('button', { name: 'Salvar mesclagem' }).click();
  await expect(page.getByRole('alert')).toContainText('stale-local-head');
  await page.evaluate(c => window.mount('conflicts', { ...window.current.props, conflicts: [{ conflict: { ...c, conflictId: 'c2', remote: { ...c.remote, revision: 'r2' } }, localHead: 'h2' }] }), conflict);
  await expect(page.getByRole('textbox', { name: 'Resultado da mesclagem' })).toHaveValue('my careful merge');
  await expect(page.getByRole('button', { name: 'Salvar mesclagem' })).toBeDisabled();
  await page.getByRole('button', { name: 'Revisar versões atualizadas' }).click();
  await expect(page.getByText('retained r2', { exact: true })).toBeVisible();
  await page.evaluate(() => { window.failResolve = false; });
  await page.getByRole('button', { name: 'Salvar mesclagem' }).click();
  const calls = await page.evaluate(() => window.calls);
  assert.deepEqual(calls.at(-1), ['resolve', { conflictId: 'c2', expectedRemoteRevision: 'r2', expectedLocalHead: 'h2', choice: 'merged', mergedContent: 'my careful merge' }]);
});
test('binary export and keep both are usable on narrow screens; unavailable operations are explicit', async t => {
  const binary = { ...conflict, local: version('l', { kind: 'asset', path: 'image.png' }), remote: version('r', { kind: 'asset', path: 'image.png' }) };
  const page = await pageFor(t, 'conflicts', { conflicts: [{ conflict: binary, localHead: 'h1' }], capabilities: { 'keep-both': true, local: 'Ainda indisponível neste aparelho' }, unsupported: ['onLoadVersion'] }, 390);
  await expect(page.getByRole('button', { name: 'Salvar mesclagem' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Manter minha versão' })).toBeDisabled();
  await expect(page.getByText('Ainda indisponível neste aparelho', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Exportar Local' }).click();
  await page.getByRole('button', { name: 'Manter ambas' }).click();
  const calls = await page.evaluate(() => window.calls);
  assert.deepEqual(calls[0], ['export', binary.local]);
  assert.equal(calls[1][1].choice, 'keep-both');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
});

test('stale rejection cannot be bypassed by reselecting the same unchanged conflict', async t => {
  const page = await pageFor(t, 'conflicts', { conflicts: [{ conflict, localHead: 'h1' }], capabilities });
  await page.evaluate(() => { window.failResolve = true; });
  await page.getByRole('button', { name: 'Manter minha versão' }).click();
  await expect(page.getByRole('alert')).toContainText('stale-local-head');
  const item = page.getByRole('navigation', { name: 'Lista de conflitos' }).getByRole('button');
  if (await item.isEnabled()) await item.click();
  await expect(page.getByRole('button', { name: 'Manter minha versão' })).toBeDisabled();
  assert.equal((await page.evaluate(() => window.calls)).length, 1);
});

test('empty list receives a conflict after asynchronous snapshot loading', async t => {
  const page = await pageFor(t, 'conflicts', { conflicts: [], capabilities });
  await expect(page.getByText('Nenhum conflito para revisar.', { exact: true })).toBeVisible();
  await page.evaluate(c => window.mount('conflicts', { ...window.current.props, conflicts: [{ conflict: c, localHead: 'h1' }] }), conflict);
  await expect(page.getByText('retained b', { exact: true })).toBeVisible();
});

test('local and host choices use exact guards and never manufacture forced overwrite fields', async t => {
  const page = await pageFor(t, 'conflicts', { conflicts: [{ conflict, localHead: 'h1' }], capabilities });
  for (const [label, choice] of [['Manter minha versão', 'local'], ['Usar versão do host', 'remote']]) {
    await page.getByRole('button', { name: label, exact: true }).click();
    assert.deepEqual((await page.evaluate(() => window.calls)).at(-1), ['resolve', {
      conflictId: 'c1', expectedRemoteRevision: 'r', expectedLocalHead: 'h1', choice,
    }]);
  }
});

test('switching conflicts preserves independent merge drafts including an intentionally empty result', async t => {
  const other = { ...conflict, entryId: 'e2', conflictId: 'c2', local: version('x', { entryId: 'e2', path: 'b.md' }) };
  const page = await pageFor(t, 'conflicts', { conflicts: [{ conflict, localHead: 'h1' }, { conflict: other, localHead: 'h2' }], capabilities });
  await expect(page.getByRole('textbox', { name: 'Resultado da mesclagem' })).toHaveValue('retained l');
  await page.getByRole('textbox').fill('');
  await page.getByRole('navigation').getByRole('button', { name: /b.md/ }).click();
  await page.getByRole('textbox').fill('second draft');
  await page.getByRole('navigation').getByRole('button', { name: /a.md/ }).click();
  await expect(page.getByRole('textbox')).toHaveValue('');
  await page.getByRole('navigation').getByRole('button', { name: /b.md/ }).click();
  await expect(page.getByRole('textbox')).toHaveValue('second draft');
});

test('missing callbacks leave export and merge explicitly disabled', async t => {
  const page = await pageFor(t, 'conflicts', { conflicts: [{ conflict, localHead: 'h1' }], capabilities, unsupported: ['onLoadVersion', 'onExportVersion'] });
  await expect(page.getByRole('button', { name: 'Exportar Local' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Salvar mesclagem' })).toBeDisabled();
  await expect(page.getByText('Exportação de versões ainda indisponível neste aparelho.', { exact: true })).toBeVisible();
  assert.deepEqual(await page.evaluate(() => window.calls), []);
});

test('clean disable and mode save are explicit; missing origin blocks initial discovery', async t => {
  const page = await pageFor(t, 'settings', { offlineEnabled: false, mode: 'automatic' });
  await page.getByRole('checkbox').check();
  await expect(page.getByRole('button', { name: 'Criar cópia inicial' })).toBeDisabled();
  await page.evaluate(s => window.mount('settings', { offlineEnabled: true, mode: 'automatic', status: s }), status);
  await page.getByRole('radio', { name: 'Manual', exact: true }).check();
  assert.deepEqual(await page.evaluate(() => window.calls), []);
  await page.getByRole('button', { name: 'Salvar modo' }).click();
  await page.getByRole('checkbox').click();
  assert.deepEqual(await page.evaluate(() => window.calls), [
    ['configure', { offlineEnabled: true, mode: 'manual' }], ['configure', { offlineEnabled: false, mode: 'automatic' }],
  ]);
});
