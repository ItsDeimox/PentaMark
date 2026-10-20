import { test, expect } from '@playwright/test';
import { ensureVisualFixtures } from './visual-fixtures.mjs';
async function openBlocks(page) {
  await ensureVisualFixtures(page); await page.goto('/');
  await expect(page.locator('.pm-note-item').first()).toBeVisible();
  await page.keyboard.press('Control+p');await page.getByRole('combobox').fill('03 - Blocos');await page.keyboard.press('Enter');
  await expect(page.locator('.pm-document-path')).toContainText('03 - Blocos');
}
const editCallout=page=>page.locator('.pm-live-widget .pm-callout').getByText('Mais uma linha',{exact:false}).click();
test('dirty source has a single acrylic confirmation and cancel returns to the source editor',async({page})=>{
  await openBlocks(page);await editCallout(page);
  const source=page.getByRole('textbox',{name:'Fonte Markdown do bloco'});
  await expect(source).toBeFocused();
  await source.fill((await source.inputValue())+'\n> confirmação única');
  await page.getByRole('button',{name:'Aplicar',exact:true}).focus();await page.keyboard.press('Tab');
  await expect(page.getByRole('button',{name:'Fechar Editar bloco',exact:true})).toBeFocused();
  await page.locator('.pm-dialog-layer').click({position:{x:8,y:8}});
  const confirm=page.getByRole('dialog',{name:'Descartar alterações',exact:true});
  await expect(confirm).toHaveCount(1);await expect(confirm.getByRole('button',{name:'Cancelar',exact:true})).toBeFocused();
  await page.keyboard.press('Escape');await expect(confirm).not.toBeVisible();
  await expect(source).toHaveValue(/confirmação única/);
  await page.locator('.pm-dialog-layer').click({position:{x:8,y:8}});
  await expect(confirm).toHaveCount(1);await confirm.getByRole('button',{name:'Descartar',exact:true}).click();
  await expect(page.locator('.pm-block-source-dialog')).toHaveCount(0);
});
test('a concurrent document update cannot be overwritten by a stale block editor',async({page})=>{
  await openBlocks(page);
  const url='/api/note?path='+encodeURIComponent('03 - Blocos.md');
  const original=await (await page.request.get(url)).json();
  await editCallout(page);
  const source=page.getByRole('textbox',{name:'Fonte Markdown do bloco'});
  await source.fill((await source.inputValue())+'\n> alteração local');
  const updated=await page.request.put(url,{data:{content:original.content.replace('Uma citação','Atualização concorrente de teste. Uma citação'),baseRevision:original.revision}});
  expect(updated.ok()).toBe(true);
  await expect(page.locator('.pm-live-codemirror .cm-content')).toContainText('Atualização concorrente de teste');
  await page.getByRole('button',{name:'Aplicar',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('mudou');
  const remote=await (await page.request.get(url)).json();
  expect(remote.content).toContain('Atualização concorrente de teste');expect(remote.content).not.toContain('alteração local');
  await page.request.put(url,{data:{content:original.content,baseRevision:remote.revision}});
});
test('task checkboxes align with first text line and source overlays leave table geometry fixed',async({page},info)=>{
  await openBlocks(page);
  const editor=page.getByRole('textbox',{name:'Editor Markdown em Live Preview'});await editor.focus();await page.keyboard.press('Control+End');
  const deltas=await page.locator('.pm-live-task-checkbox').evaluateAll(boxes=>boxes.map(c=>{
    const line=c.closest('.cm-line'),walker=document.createTreeWalker(line,NodeFilter.SHOW_TEXT);let node;
    while(node=walker.nextNode()){
      if(!node.textContent.trim())continue;
      const range=document.createRange();range.setStart(node,0);range.setEnd(node,1);
      const t=range.getBoundingClientRect(),b=c.getBoundingClientRect();return Math.abs((b.y+b.height/2)-(t.y+t.height/2));
    }
    throw new Error('Missing task text');
  }));
  expect(deltas.length).toBe(2);expect(Math.max(...deltas)).toBeLessThanOrEqual(1);
  const table=page.locator('.pm-live-widget table').first();await table.scrollIntoViewIfNeeded();
  const before=await table.boundingBox();await table.getByText('42',{exact:true}).click();
  await expect(page.getByRole('dialog',{name:'Editar bloco'})).toBeVisible();
  expect(await table.boundingBox()).toEqual(before);
  await page.screenshot({path:info.outputPath('stable-block-editor.png')});
});
