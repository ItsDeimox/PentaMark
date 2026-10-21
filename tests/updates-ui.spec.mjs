import { test, expect } from '@playwright/test';
import { build } from 'esbuild';

let script, styles;
test.beforeAll(async () => {
  const result = await build({
    stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import {UpdateSettings} from './src/components/dialogs/UpdateSettings';
      const root = createRoot(document.getElementById('updates-fixture'));
      window.unmountUpdates = () => root.unmount();
      root.render(React.createElement(UpdateSettings, {beforeInstall: async () => {
        window.updateCalls.push('save');
        if (window.holdSave) await new Promise(resolve => { window.releaseSave = resolve; });
        if (window.failSave) throw new Error('Não foi possível salvar o rascunho.');
        window.updateCalls.push('saved');
        if (window.unmountOnSave) window.unmountUpdates();
      }}));`, resolveDir: process.cwd(), loader: 'tsx' },
    bundle: true, format: 'iife', write: false, outfile: 'updates-fixture.js', jsx: 'automatic',
  });
  script = result.outputFiles.find(file => file.path.endsWith('.js')).text;
  styles = result.outputFiles.find(file => file.path.endsWith('.css'))?.text || '';
});

async function open(page, options = {}) {
  // The existing fixture starts a disposable, real vault host. Only native calls
  // are replaced; the component, platform adapter and React are production code.
  await page.goto('/');
  await page.getByRole('button', {name: 'Ferramentas e ações', exact: true}).waitFor();
  await page.evaluate(options => {
    window.updateCalls = [];
    window.updateStatus = {phase: 'idle', currentVersion: '2.13.18', ...options.status};
    window.holdSave = options.holdSave;
    window.failSave = options.failSave;
    window.failCheck = options.failCheck;
    window.failStatus = options.failStatus;
    window.unmountOnSave = options.unmountOnSave;
    window.holdDownload = options.holdDownload;
    window.statusDelay = options.statusDelay || 0;
    window.concurrentReads = 0;
    window.maxConcurrentReads = 0;
    const status = async () => {
      window.updateCalls.push('status');
      window.maxConcurrentReads = Math.max(window.maxConcurrentReads, ++window.concurrentReads);
      await new Promise(resolve => setTimeout(resolve, window.statusDelay));
      window.concurrentReads--;
      if (window.failStatus) throw new Error('Sem conexão com o serviço de atualizações.');
      return {...window.updateStatus};
    };
    const check = async () => {
      window.updateCalls.push('check');
      if (window.failCheck) throw new Error('Sem conexão. Tente novamente.');
      if (window.checkError) return window.updateStatus = {...window.updateStatus, phase: 'error', error: 'Falha ao validar o pacote.'};
      return window.updateStatus = {...window.updateStatus, phase: 'available', version: '2.13.19'};
    };
    const download = async () => {
      window.updateCalls.push('download');
      if (window.holdDownload) await new Promise(resolve => { window.releaseDownload = resolve; });
      return window.updateStatus = {...window.updateStatus, phase: 'downloading', progress: 25};
    };
    const install = async () => {
      window.updateCalls.push('install');
      if (window.failInstall) throw new Error('Instalador indisponível.');
      return window.updateStatus = {...window.updateStatus, phase: 'installing'};
    };
    window.pentaMarkDesktop = options.unsupported || options.android ? undefined : {
      getUpdateStatus: status, checkForUpdates: check, downloadUpdate: download, installUpdate: install,
    };
    if (options.android) {
      window.androidBridge = {};
      window.Capacitor = {
        PluginHeaders: [{name: 'AppUpdate', methods: ['getStatus', 'check', 'download', 'install', 'openPermissionSettings'].map(name => ({name, rtype: 'promise'}))}],
        nativePromise: async (plugin, method) => {
          if (plugin !== 'AppUpdate') throw new Error('Unexpected plugin');
          if (method === 'openPermissionSettings') { window.updateCalls.push('permission'); return {}; }
          return ({getStatus: status, check, download, install})[method]();
        },
      };
    }
    const fixture = document.createElement('div');
    fixture.id = 'updates-fixture';
    fixture.className = 'pm-shell';
    fixture.style.cssText = 'position:fixed;inset:0;z-index:999999;padding:24px;background:var(--pm-panel-2,#101820);overflow:auto';
    document.body.append(fixture);
  }, options);
  await page.addStyleTag({content: styles});
  await page.addScriptTag({content: script});
  await expect(page.locator('.pm-update-settings')).toBeVisible();
  return page.locator('.pm-update-settings');
}

test('check, download progress and install await saving and ignore duplicate clicks', async ({page}) => {
  const ui = await open(page, {holdSave: true});
  await expect(ui).toContainText('2.13.18');
  await ui.getByRole('button', {name: 'Verificar atualizações', exact: true}).click();
  await expect(ui.getByRole('status')).toContainText('2.13.19');
  await ui.getByRole('button', {name: 'Baixar atualização', exact: true}).click();
  await expect(ui.getByRole('progressbar')).toHaveAttribute('value', '25');
  await page.evaluate(() => { window.updateStatus = {...window.updateStatus, phase: 'ready', progress: 100}; });
  const install = ui.getByRole('button', {name: 'Instalar e reiniciar', exact: true});
  await expect(install).toBeEnabled();
  await install.evaluate(button => { button.click(); button.click(); });
  await expect(ui).toContainText('Salvando');
  expect(await page.evaluate(() => window.updateCalls.filter(call => call === 'install'))).toEqual([]);
  await page.evaluate(() => window.releaseSave());
  await expect(ui.getByRole('status')).toContainText('Instalando');
  expect(await page.evaluate(() => window.updateCalls.filter(call => ['save','saved','install'].includes(call)))).toEqual(['save','saved','install']);
});

test('a failed beforeInstall leaves the package ready and never invokes installer', async ({page}) => {
  const ui = await open(page, {status: {phase: 'ready', version: '2.13.19'}, failSave: true});
  const install = ui.getByRole('button', {name: 'Instalar e reiniciar', exact: true});
  await install.click();
  await expect(ui.getByRole('alert')).toContainText('rascunho');
  await expect(install).toBeEnabled();
  expect(await page.evaluate(() => window.updateCalls.filter(call => call === 'install'))).toEqual([]);
  await page.evaluate(() => { window.failSave = false; window.failInstall = true; });
  await install.click();
  await expect(ui.getByRole('alert')).toContainText('Instalador indisponível');
});

test('a pending native download still polls progress without duplicate downloads or status reads', async ({page}) => {
  const ui = await open(page, {status: {phase: 'available', version: '2.13.19'}, holdDownload: true});
  const download = ui.getByRole('button', {name: 'Baixar atualização', exact: true});
  await download.evaluate(button => { button.click(); button.click(); });
  await page.evaluate(() => { window.updateStatus = {...window.updateStatus, phase: 'downloading', progress: 35}; });
  await expect(ui.getByRole('progressbar')).toHaveAttribute('value', '35');
  await page.evaluate(() => { window.updateStatus.progress = 75; });
  await expect(ui.getByRole('progressbar')).toHaveAttribute('value', '75');
  expect(await page.evaluate(() => window.updateCalls.filter(call => call === 'download').length)).toBe(1);
  expect(await page.evaluate(() => window.maxConcurrentReads)).toBe(1);
  await page.evaluate(() => window.releaseDownload());
});

test('successful saving may close settings before the explicit install is invoked', async ({page}) => {
  const ui = await open(page, {status: {phase: 'ready', version: '2.13.19'}, unmountOnSave: true});
  await ui.getByRole('button', {name: 'Instalar e reiniciar', exact: true}).click();
  await expect(ui).toHaveCount(0);
  expect(await page.evaluate(() => window.updateCalls.filter(call => ['save','saved','install'].includes(call)))).toEqual(['save','saved','install']);
});

test('initial status rejection is caught and a manual check recovers', async ({page}) => {
  const failures = [];
  page.on('pageerror', error => failures.push(error.message));
  const ui = await open(page, {failStatus: true});
  await expect(ui.getByRole('alert')).toContainText('Sem conexão');
  await ui.getByRole('button', {name: 'Verificar atualizações', exact: true}).click();
  await expect(ui.getByRole('status')).toContainText('2.13.19');
  await expect(ui.getByRole('alert')).toHaveCount(0);
  expect(failures).toEqual([]);
});

test('Android observes a later verification error after install immediately returns installing', async ({page}) => {
  const ui = await open(page, {android: true, status: {phase: 'ready', version: '2.13.19'}});
  await ui.getByRole('button', {name: 'Instalar atualização', exact: true}).click();
  await expect(ui.getByRole('status')).toContainText('Instalando');
  await page.evaluate(() => { window.updateStatus = {...window.updateStatus, phase: 'error', error: 'O APK não está mais disponível. Baixe novamente.'}; });
  await expect(ui.getByRole('alert')).toContainText('APK');
  await expect(ui.getByRole('button', {name: 'Verificar atualizações', exact: true})).toBeEnabled();
  expect(await page.evaluate(() => window.updateCalls.filter(call => call === 'install').length)).toBe(1);
});

test('Android observes a later permission requirement after install returns installing', async ({page}) => {
  const ui = await open(page, {android: true, status: {phase: 'ready', version: '2.13.19'}});
  await ui.getByRole('button', {name: 'Instalar atualização', exact: true}).click();
  await expect(ui.getByRole('status')).toContainText('Instalando');
  await page.evaluate(() => { window.updateStatus = {...window.updateStatus, phase: 'ready', permissionRequired: true}; });
  await expect(ui.getByRole('button', {name: 'Autorizar instalação', exact: true})).toBeEnabled();
  await expect(ui.getByRole('button', {name: 'Instalar atualização', exact: true})).toBeEnabled();
  expect(await page.evaluate(() => window.updateCalls.filter(call => call === 'install').length)).toBe(1);
});

test('returning from Android installer refreshes ready without relaunching installation', async ({page}) => {
  const ui = await open(page, {android: true, status: {phase: 'ready', version: '2.13.19'}});
  await ui.getByRole('button', {name: 'Instalar atualização', exact: true}).click();
  await expect(ui.getByRole('status')).toContainText('Instalando');
  await page.evaluate(() => {
    window.updateStatus = {...window.updateStatus, phase: 'ready'};
    document.dispatchEvent(new Event('resume'));
  });
  await expect(ui.getByRole('button', {name: 'Instalar atualização', exact: true})).toBeEnabled();
  expect(await page.evaluate(() => window.updateCalls.filter(call => call === 'install').length)).toBe(1);
});

test('offline check errors are readable and a user can retry', async ({page}) => {
  const failures = [];
  page.on('pageerror', error => failures.push(error.message));
  const ui = await open(page, {failCheck: true});
  const check = ui.getByRole('button', {name: 'Verificar atualizações', exact: true});
  await check.click();
  await expect(ui.getByRole('alert')).toContainText('Sem conexão');
  await expect(check).toBeEnabled();
  await page.evaluate(() => { window.failCheck = false; });
  await check.click();
  await expect(ui.getByRole('status')).toContainText('2.13.19');
  await expect(ui.getByRole('alert')).toHaveCount(0);
  expect(failures).toEqual([]);
});

test('polling never overlaps, stops after unmount, and does not download by itself', async ({page}) => {
  await open(page, {status: {phase: 'checking'}, statusDelay: 900});
  await expect.poll(() => page.evaluate(() => window.updateCalls.length)).toBeGreaterThanOrEqual(3);
  expect(await page.evaluate(() => window.maxConcurrentReads)).toBe(1);
  expect(await page.evaluate(() => window.updateCalls.filter(call => call !== 'status'))).toEqual([]);
  await page.evaluate(() => window.unmountUpdates());
  const count = await page.evaluate(() => window.updateCalls.length);
  await page.waitForTimeout(1500);
  expect(await page.evaluate(() => window.updateCalls.length)).toBe(count);
});

test('a polling error is caught and stops further polling', async ({page}) => {
  const failures = [];
  page.on('pageerror', error => failures.push(error.message));
  const ui = await open(page, {status: {phase: 'downloading', progress: 60}});
  await expect(ui.getByRole('progressbar')).toHaveAttribute('value', '60');
  await page.evaluate(() => { window.failStatus = true; });
  await expect(ui.getByRole('alert')).toContainText('Sem conexão');
  const count = await page.evaluate(() => window.updateCalls.length);
  await page.waitForTimeout(1400);
  expect(await page.evaluate(() => window.updateCalls.length)).toBe(count);
  expect(failures).toEqual([]);
});

test('Android permission settings refresh on focus and resume without installing', async ({page}) => {
  const ui = await open(page, {android: true, status: {phase: 'ready', version: '2.13.19', permissionRequired: true}});
  await ui.getByRole('button', {name: 'Autorizar instalação', exact: true}).click();
  await expect(ui.getByRole('button', {name: 'Instalar atualização', exact: true})).toBeVisible();
  await page.evaluate(() => { window.updateStatus.permissionRequired = false; window.dispatchEvent(new Event('focus')); });
  await expect(ui.getByRole('button', {name: 'Autorizar instalação', exact: true})).toHaveCount(0);
  await page.evaluate(() => document.dispatchEvent(new Event('resume')));
  await expect.poll(() => page.evaluate(() => window.updateCalls.filter(call => call === 'status').length)).toBeGreaterThanOrEqual(3);
  expect(await page.evaluate(() => window.updateCalls.filter(call => call === 'install'))).toEqual([]);
  await ui.getByRole('button', {name: 'Instalar atualização', exact: true}).click();
  await expect(ui.getByRole('status')).toContainText('Instalando');
  expect(await page.evaluate(() => window.updateCalls.filter(call => ['permission','save','saved','install'].includes(call)))).toEqual(['permission','save','saved','install']);
});

test('browser shows the device guidance and no update controls', async ({page}) => {
  const ui = await open(page, {unsupported: true});
  await expect(ui).toContainText('Atualize o aplicativo no dispositivo que hospeda este cofre');
  await expect(ui.getByRole('button')).toHaveCount(0);
});

test('current version and native errors render with keyboard focus and phone layout', async ({page}) => {
  await page.setViewportSize({width: 390, height: 844});
  const ui = await open(page, {status: {phase: 'current'}});
  await expect(ui.getByRole('status')).toContainText('atualizado');
  const check = ui.getByRole('button', {name: 'Verificar atualizações', exact: true});
  await check.focus();
  await expect(check).toBeFocused();
  expect(await check.evaluate(button => parseFloat(getComputedStyle(button).fontSize))).toBeGreaterThanOrEqual(14);
  await page.evaluate(() => { window.checkError = true; });
  await page.keyboard.press('Enter');
  await expect(ui.getByRole('alert')).toContainText('Falha ao validar o pacote.');
  expect(await ui.evaluate(element => element.getBoundingClientRect().right)).toBeLessThanOrEqual(390);
  expect(await ui.evaluate(element => element.getBoundingClientRect().height)).toBeLessThan(400);
  await page.screenshot({path: test.info().outputPath('updates-phone.png')});
});
