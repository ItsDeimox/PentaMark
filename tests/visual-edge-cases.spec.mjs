import { test, expect } from '@playwright/test';
import { ensureVisualFixtures } from './visual-fixtures.mjs';
async function openBlocks(page) {
  await ensureVisualFixtures(page,true); await page.goto('/');
  await expect(page.locator('.pm-note-item').first()).toBeVisible();
  await page.keyboard.press('Control+p');await page.getByRole('combobox').fill('03 - Blocos');await page.keyboard.press('Enter');
  await expect(page.locator('.pm-document-path')).toContainText('03 - Blocos');
}
const editCallout=page=>page.locator('.pm-live-widget').filter({has:page.locator('.pm-callout')}).getByRole('button',{name:'Editar fonte do bloco',exact:true}).click();
test('inline source cancel discards its draft without a modal or changing the note',async({page})=>{
  await openBlocks(page);await editCallout(page);
  const source=page.getByRole('textbox',{name:'Fonte Markdown do bloco'});
  await expect(source).toBeFocused();
  await source.fill((await source.inputValue())+'\n> confirmação única');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(source).toHaveValue(/confirmação única/);
  await page.getByRole('button',{name:'Cancelar',exact:true}).click();
  await expect(page.locator('.pm-inline-source')).toHaveCount(0);
  expect((await (await page.request.get('/api/note?path='+encodeURIComponent('03 - Blocos.md'))).json()).content).not.toContain('confirmação única');
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
test('task checkboxes align with first text line and inline table editing leaves geometry fixed',async({page},info)=>{
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
  await expect(table.getByRole('textbox',{name:'Editar célula'}).last()).toBeFocused();
  await expect(page.getByRole('dialog',{name:'Editar bloco'})).toHaveCount(0);
  expect(await table.boundingBox()).toEqual(before);
  await page.screenshot({path:info.outputPath('stable-block-editor.png')});
});
