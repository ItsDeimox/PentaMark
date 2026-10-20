import { test, expect } from '@playwright/test';
import { ensureVisualFixtures } from './visual-fixtures.mjs';
async function blocks(page) {
  await ensureVisualFixtures(page,true);
  await page.goto('/');
  await expect(page.locator('.pm-note-item').first()).toBeVisible();
  await page.keyboard.press('Control+p');
  await page.getByRole('combobox').fill('03 - Blocos');
  await page.keyboard.press('Enter');
  await expect(page.locator('.pm-document-path')).toContainText('03 - Blocos');
  await expect(page.getByRole('dialog', { name: 'Abrir arquivo' })).not.toBeVisible();
}
test('opening a complex block for editing leaves the next heading at the same coordinates', async ({ page }) => {
  await blocks(page);
  const anchor = page.locator('.cm-line').filter({ hasText: 'Âncora depois do painel' }).first();
  const callout = page.locator('.pm-live-widget .pm-callout').first().getByText('Mais uma linha', { exact: false });
  for (let attempt = 0; attempt < 3; attempt++) {
    await callout.click({ trial: true });
    const before = await anchor.boundingBox();
    const scroll = await page.locator('.cm-scroller').evaluate(el => el.scrollTop);
    await callout.click();
    await expect(page.getByRole('dialog', { name: 'Editar bloco' })).toHaveCount(0);
    await expect(page.locator('.pm-callout p').first()).toHaveAttribute('contenteditable','true');
    await page.waitForTimeout(250);
    const after = await anchor.boundingBox();
    expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(1);
    expect(await page.locator('.cm-scroller').evaluate(el => el.scrollTop)).toBe(scroll);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Editar bloco' })).toHaveCount(0);
  }
});
test('sidebar collapse recenters reading, with rounded compact navigation and animated folder children', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.pm-note-item').first()).toBeVisible();
  const radius = await page.locator('.pm-sidebar').evaluate(el => parseFloat(getComputedStyle(el).borderRadius));
  expect(radius).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Mostrar ou ocultar arquivos', exact: true }).click();
  await page.waitForTimeout(300);
  const editor = await page.getByRole('textbox', { name: 'Editor Markdown em Live Preview' }).boundingBox();
  expect(Math.abs(editor.x + editor.width / 2 - page.viewportSize().width / 2)).toBeLessThan(3);
});
test('acrylic graphics mode has a real WebGL material and no old toolbar gradients', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Ferramentas e ações', exact: true }).click();
  await page.getByRole('button', { name: 'Acrílico', exact: true }).click();
  await expect(page.locator('.pm-shell')).toHaveAttribute('data-graphics', 'acrylic');
  await expect(page.locator('canvas[data-material="acrylic"]')).toHaveAttribute('data-renderer', 'webgl');
  expect(await page.locator('.pm-workspace-tools').evaluate(el => getComputedStyle(el).backgroundImage)).toBe('none');
});
test('context menu offers directory immediately and preview remains anchored', async ({ page }) => {
  await blocks(page);
  await page.locator('.pm-note-item--active').click({ button: 'right' });
  await expect(page.getByRole('button', { name: 'Mostrar no diretório', exact: true })).toBeVisible({timeout: 600});
  await page.keyboard.press('Escape');
  const editor=page.getByRole('textbox',{name:'Editor Markdown em Live Preview'});
  await editor.focus(); await page.keyboard.press('Control+End');
  const link = page.locator('.pm-live-link').filter({hasText:'Link A'});
  await link.hover();
  const preview=page.locator('.pm-link-hover-preview').first();
  await expect(preview).toBeVisible();
  await page.waitForTimeout(200);
  const initial=await preview.boundingBox();
  const box=await link.boundingBox();await page.mouse.move(box.x + 2, box.y + 2);
  await page.waitForTimeout(100);
  expect(await preview.boundingBox()).toEqual(initial);
  await preview.getByText('Link B', {exact:true}).hover();
  await expect(page.locator('.pm-link-hover-preview')).toHaveCount(2);
});

test('block source applies through an undoable transaction and cancel keeps the document intact', async ({ page }) => {
  await blocks(page);
  const editor=page.getByRole('textbox',{name:'Editor Markdown em Live Preview'});
  const current=()=>page.evaluate(async()=>{
    const response=await fetch('/api/note?path='+encodeURIComponent('03 - Blocos.md'));
    return (await response.json()).content;
  });
  const original=await current();
  const open=()=>page.locator('.pm-live-widget').filter({has:page.locator('.pm-callout')}).getByRole('button',{name:'Editar fonte do bloco',exact:true}).click();
  await open();
  const source=page.getByRole('textbox',{name:'Fonte Markdown do bloco'});
  const before=await source.inputValue();
  await source.fill(before.replace('Uma citação','Uma citação revisada'));
  await page.getByRole('button',{name:'Aplicar',exact:true}).click();
  await expect(page.locator('.pm-inline-source')).toHaveCount(0);
  await editor.focus();await page.keyboard.press('Control+s');
  await expect.poll(current).toContain('Uma citação revisada');
  await page.keyboard.press('Control+z');await page.keyboard.press('Control+s');
  await expect.poll(current).toBe(original);
  await open();await source.fill(before+'\n> alteração descartada');
  await page.getByRole('button',{name:'Cancelar',exact:true}).click();
  await expect(page.locator('.pm-inline-source')).toHaveCount(0);
  await expect.poll(current).toBe(original);
});

test('texture renders real pixels, stops while idle and releases all surfaces in Flat mode', async ({ page }, testInfo) => {
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/');
  await page.getByRole('button',{name:'Ferramentas e ações',exact:true}).click();
  await page.getByRole('button',{name:'Acrílico',exact:true}).click();
  const canvas=page.locator('canvas[data-material="acrylic"]');
  await expect(canvas).toHaveAttribute('data-renderer','webgl');
  await page.mouse.move(1000,900);await page.waitForTimeout(600);
  const rendered=await page.locator('.pm-sidebar .pm-acrylic-pane').evaluate(c=>{
    const data=c.getContext('2d').getImageData(0,0,c.width,c.height).data;
    let count=0;const shades=new Set();
    for(let i=3;i<data.length;i+=4){if(data[i]>0)count++;if(i%28===3)shades.add(data[i-3]+','+data[i-2]+','+data[i-1]);}
    return {count,shades:shades.size};
  });
  expect(rendered.count).toBeGreaterThan(1000);expect(rendered.shades).toBeGreaterThan(10);
  const frames=await canvas.getAttribute('data-draws');await page.waitForTimeout(400);
  expect(await canvas.getAttribute('data-draws')).toBe(frames);
  await page.screenshot({path:testInfo.outputPath('acrylic-tools.png')});
  await page.getByRole('button',{name:'Flat',exact:true}).click();
  await expect(canvas).toHaveCount(0);await expect(page.locator('.pm-acrylic-pane')).toHaveCount(0);
  await page.screenshot({path:testInfo.outputPath('flat-tools.png')});
  expect(errors).toEqual([]);
});

test('WebGL unavailable retains a usable native acrylic fallback', async ({ page }) => {
  await page.addInitScript(()=>{
    const get=HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext=function(kind,...args){return kind==='webgl'||kind==='webgl2'?null:get.call(this,kind,...args);};
  });
  await page.goto('/');await page.getByRole('button',{name:'Ferramentas e ações',exact:true}).click();
  await page.getByRole('button',{name:'Acrílico',exact:true}).click();
  await expect(page.locator('canvas[data-material="acrylic"]')).toHaveAttribute('data-renderer','fallback');
  await expect(page.getByRole('button',{name:'Editor Markdown',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Flat',exact:true}).click();
  await expect(page.locator('canvas[data-material="acrylic"]')).toHaveCount(0);
});

test('folders animate through intermediate heights and document edges fade', async ({ page }) => {
  await page.addInitScript(()=>localStorage.setItem('pentamark:appearance',JSON.stringify({graphicsPreset:'custom',graphicsMode:'flat',interfaceMotion:true,backgroundMotion:false,backgroundHover:false,refraction:false})));
  await page.goto('/');await expect(page.locator('.pm-note-item').first()).toBeVisible();
  const folder=page.locator('.pm-folder').filter({has:page.locator(':scope > .pm-folder-title').filter({hasText:'Planejamento'})}).first();
  const title=folder.locator(':scope > .pm-folder-title');
  const disclosure=folder.locator(':scope > .pm-tree-disclosure');
  await expect(disclosure).toHaveAttribute('data-expanded','false');
  // Sample in the same page task as the click; assertion round trips can
  // otherwise consume the entire short opening transition before observation.
  const samples=await folder.evaluate(el=>new Promise(resolve=>{
    const disclosure=el.querySelector(':scope > .pm-tree-disclosure');
    const values=[disclosure.getBoundingClientRect().height],start=performance.now();
    el.querySelector(':scope > .pm-folder-title').click();
    const sample=()=>{values.push(disclosure.getBoundingClientRect().height);if(performance.now()-start<300)requestAnimationFrame(sample);else resolve(values);};requestAnimationFrame(sample);
  }));
  await expect(disclosure).toHaveAttribute('data-expanded','true');
  expect(new Set(samples.map(n=>Math.round(n))).size).toBeGreaterThan(2);
  const fade=await page.locator('.pm-live-pane').evaluate(el=>getComputedStyle(el).maskImage);
  expect(fade).toContain('linear-gradient');
});
