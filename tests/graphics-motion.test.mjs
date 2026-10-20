import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const result = await build({ stdin: { contents: `
import React from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {GraphicsMotionProvider} from './src/features/workspace/graphics-motion';
import {AnimatedDisclosure} from './src/features/workspace/AnimatedDisclosure';
import {WorkspacePanel} from './src/features/workspace/WorkspacePanel';
import {DocumentDecode} from './src/features/workspace/DocumentDecode';
import {SignalBackground} from './src/features/workspace/SignalBackground';
import {GraphicsSettings} from './src/features/workspace/GraphicsSettings';
import {applyGraphicsPreset} from './src/features/workspace/graphics-policy';
import {DEFAULT_APPEARANCE} from './src/app/constants';
import {DialogPresence} from './src/components/dialogs/DialogFrame';
const root=createRoot(document.getElementById('root'));
function Settings(){
 const [appearance,setAppearance]=React.useState({...applyGraphicsPreset(DEFAULT_APPEARANCE,'economical'),theme:'pearl',editorSize:24});
 return React.createElement(React.Fragment,null,
  React.createElement(GraphicsSettings,{appearance,setAppearance,capabilities:{android:true}}),
  React.createElement('output',null,JSON.stringify(appearance)));
}
window.renderBackground=(animated,reactive)=>flushSync(()=>root.render(React.createElement(SignalBackground,{animated,reactive,theme:'pearl'})));
window.renderGraphics=(kind,enabled,open=true)=>flushSync(()=>root.render(
 React.createElement(GraphicsMotionProvider,{enabled},
  kind==='settings'?React.createElement(Settings):
  kind==='presence'?React.createElement(DialogPresence,{open},React.createElement('div',{'data-dialog-child':true},'Retained dialog')):
  kind==='disclosure'?React.createElement(AnimatedDisclosure,{open,children:()=>React.createElement('p',null,'Child content')}):
  kind==='panel'?React.createElement(WorkspacePanel,{open,title:'Tools',onClose:()=>{}},React.createElement('button',null,'Action')):
  kind==='decode'?React.createElement(DocumentDecode,{path:'Note.md',enabled:true,mode:'preview'}):
  React.createElement(SignalBackground,{animated:false,reactive:false,theme:'pearl'}))));
`, resolveDir: process.cwd() }, write: false, bundle: true, platform: 'browser', format: 'iife', loader: { '.css': 'empty' } });
let browser;
test.before(async () => { browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) }); });
test.after(async () => { await browser?.close(); });
async function pageForTest() {
  const page = await browser.newPage();
  await page.setContent('<main class="pm-shell"><div id="root"></div><div class="pm-workspace"><div class="pm-preview-pane"><div class="pm-markdown"><p>Note content</p></div></div></div></main>');
  await page.evaluate(() => {
    window.work = { animations: 0, frames: 0, observers: 0, geometry: 0 };
    const animate = Element.prototype.animate;
    Element.prototype.animate = function(...args) { window.work.animations++; return animate.apply(this,args); };
    const raf = window.requestAnimationFrame;
    window.requestAnimationFrame = callback => { window.work.frames++; return raf(callback); };
    const rect = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function() { window.work.geometry++; return rect.call(this); };
    const Observer = window.ResizeObserver;
    window.ResizeObserver = class extends Observer { constructor(callback) { window.work.observers++; super(callback); } };
  });
  await page.addScriptTag({ content: result.outputFiles[0].text });
  return page;
}
test('disabled background performs no geometry, observer, canvas or animation work after mount', async () => {
  const page = await pageForTest();
  try {
    await page.evaluate(() => window.renderGraphics('background', false));
    assert.equal(await page.locator('#root').innerHTML(), '');
    assert.deepEqual(await page.evaluate(() => window.work), { animations:0,frames:0,observers:0,geometry:0 });
  } finally { await page.close(); }
});
test('disabled disclosure immediately opens and closes without animation resources', async () => {
  const page = await pageForTest();
  try {
    await page.evaluate(() => window.renderGraphics('disclosure', false, false));
    await page.evaluate(() => window.renderGraphics('disclosure', false, true));
    assert.equal(await page.locator('.pm-folder-children').innerText(), 'Child content');
    await page.evaluate(() => window.renderGraphics('disclosure', false, false));
    assert.equal(await page.locator('.pm-folder-children').innerText(), '');
    assert.equal((await page.evaluate(() => window.work)).animations, 0);
  } finally { await page.close(); }
});
test('disabled note decode never schedules its frame loop', async () => {
  const page = await pageForTest();
  try {
    await page.evaluate(() => window.renderGraphics('decode', false));
    assert.equal(await page.locator('.pm-decode-layer').count(), 0);
    assert.equal((await page.evaluate(() => window.work)).frames, 0);
  } finally { await page.close(); }
});
test('disabled panel opens and unmounts immediately without fragment animation', async () => {
  const page = await pageForTest();
  try {
    // Load the real cascade: glass-polish starts panels fully clipped, which
    // a DOM-only mounting check would miss even though children look visible.
    for (const file of ['chrome.css','glass-polish.css','visual-polish.css','graphics.css']) {
      await page.addStyleTag({content:await readFile(new URL(`../src/features/workspace/${file}`,import.meta.url),'utf8')});
    }
    await page.locator('.pm-shell').evaluate(el=>{
      el.dataset.theme='pentagory';el.dataset.graphics='flat';el.dataset.interfaceMotion='false';
    });
    await page.evaluate(() => window.renderGraphics('panel', false, true));
    assert.equal(await page.locator('[data-fragmenting]').count(), 0);
    assert.equal(await page.locator('.pm-workspace-panel').count(), 1);
    assert.deepEqual(await page.locator('.pm-workspace-panel').evaluate(el=>{
      const style=getComputedStyle(el),transform=new DOMMatrixReadOnly(style.transform);
      return {clip:style.clipPath,opacity:style.opacity,x:transform.m41,y:transform.m42};
    }),{clip:'none',opacity:'1',x:0,y:0});
    await page.getByRole('button',{name:'Action',exact:true}).click({trial:true});
    await page.evaluate(() => window.renderGraphics('panel', false, false));
    assert.equal(await page.locator('.pm-workspace-panel').count(), 0);
  } finally { await page.close(); }
});
test('disabled dialog presence removes outgoing content synchronously without exit retention', async () => {
  const page = await pageForTest();
  try {
    const states = await page.evaluate(() => {
      window.renderGraphics('presence', false, true);
      const opened = !!document.querySelector('[data-dialog-child]');
      window.renderGraphics('presence', false, false);
      return {opened, retained:!!document.querySelector('[data-dialog-child]')};
    });
    assert.deepEqual(states, {opened:true,retained:false});
  } finally { await page.close(); }
});
test('ambient activation allocates animations and disabling releases them and stops geometry work', async () => {
  const page = await pageForTest();
  try {
    await page.evaluate(() => window.renderBackground(true, false));
    assert.equal(await page.locator('canvas').count(), 0);
    assert.ok((await page.evaluate(() => window.work)).animations > 0);
    await page.evaluate(() => window.renderBackground(false, false));
    assert.equal(await page.locator('.pm-signal-background').count(), 0);
    assert.equal(await page.evaluate(() => document.getAnimations().length), 0);
    await page.evaluate(() => { window.work = {animations:0,frames:0,observers:0,geometry:0}; window.dispatchEvent(new Event('resize')); });
    await page.waitForTimeout(150);
    assert.deepEqual(await page.evaluate(() => window.work), {animations:0,frames:0,observers:0,geometry:0});
  } finally { await page.close(); }
});
test('graphics controls independently edit effects, select presets and preserve theme and typography', async () => {
  const page = await pageForTest();
  try {
    await page.evaluate(() => window.renderGraphics('settings', false));
    const state = async () => JSON.parse(await page.locator('output').innerText());
    for (const [label,key] of [['Animações de fundo','backgroundMotion'],['Reação ao mouse','backgroundHover'],['Movimento de interface','interfaceMotion'],['Refração','refraction']]) {
      await page.getByLabel(label,{exact:true}).check();
      assert.equal((await state())[key], true);
      assert.equal((await state()).graphicsPreset, 'custom');
      await page.getByLabel(label,{exact:true}).uncheck();
    }
    await page.getByLabel('Perfil gráfico').selectOption('quality');
    assert.equal((await state()).refraction, true);
    await page.getByRole('button',{name:'Aplicar recomendação'}).click();
    assert.equal((await state()).graphicsPreset, 'economical');
    assert.equal((await state()).theme, 'pearl');
    assert.equal((await state()).editorSize, 24);
  } finally { await page.close(); }
});
