import { test, expect } from '@playwright/test';
async function open(page, label, acrylic = true) {
  await page.goto('/');await expect(page.getByRole('textbox',{name:'Editor Markdown em Live Preview'})).toBeVisible();
  await page.getByRole('button',{name:'Ferramentas e ações',exact:true}).click();
  if(acrylic) await page.getByRole('button',{name:'Acrílico',exact:true}).click();
  await page.getByRole('button',{name:label==='Conectados'?/^\d+ conectado/:label,exact:label!=='Conectados'}).click();
}
test('settings merge only their own edits and do not reset newer unrelated host flags',async({page})=>{
  const before=await (await page.request.get('/api/config')).json();
  try {
    await open(page,'Ponte MCP');
    const token=page.getByLabel('Token da ponte');await token.fill('fixture_changed_token_123456');
    await page.request.put('/api/config',{data:{...before,openBrowser:!before.openBrowser}});
    await page.getByRole('button',{name:'Salvar ponte',exact:true}).click();
    await expect(page.locator('.pm-mcp-dialog')).toHaveCount(0);
    const after=await (await page.request.get('/api/config')).json();
    expect(after.openBrowser).toBe(!before.openBrowser);expect(after.aiBridgeEnabled).toBe(before.aiBridgeEnabled);expect(after.aiBridgeToken).toBe('fixture_changed_token_123456');
  } finally {await page.request.put('/api/config',{data:before});}
});
test('stale settings show a conflict instead of overwriting the edited server field',async({page})=>{
  const before=await (await page.request.get('/api/config')).json();
  try {
    await open(page,'Configurações');await page.getByRole('tab',{name:'Cofre e host',exact:true}).click();
    await page.getByLabel('Nome do cofre',{exact:true}).fill('Local unsaved name');
    await page.request.put('/api/config',{data:{...before,vaultName:'Concurrent fixture name'}});
    await page.getByRole('button',{name:'Salvar configurações',exact:true}).click();
    await page.getByRole('alert').scrollIntoViewIfNeeded();
    await expect(page.getByRole('alert')).toContainText('mudou');
    expect((await (await page.request.get('/api/config')).json()).vaultName).toBe('Concurrent fixture name');
  } finally {await page.request.put('/api/config',{data:before});}
});
test('context loss restores a usable shader without growing the canvas pool',async({page})=>{
  await open(page,'Configurações');
  const renderer=page.locator('canvas[data-material="acrylic"]');await expect(renderer).toHaveAttribute('data-renderer','webgl');
  await renderer.evaluate(c=>{const gl=c.getContext('webgl');window.__lost=gl.getExtension('WEBGL_lose_context');if(!window.__lost)throw new Error('Missing loss fixture extension');window.__lost.loseContext();});
  await expect(renderer).toHaveAttribute('data-renderer','fallback');
  await expect(page.getByRole('button',{name:'Salvar configurações',exact:true})).toBeVisible();
  await page.waitForTimeout(100);await page.evaluate(()=>window.__lost.restoreContext());
  await expect(renderer).toHaveAttribute('data-renderer','webgl');
  await page.mouse.move(700,400);await page.waitForTimeout(450);
  expect(Number(await renderer.getAttribute('data-surfaces'))).toBeLessThanOrEqual(20);
  expect(Number(await renderer.getAttribute('data-backing-pixels'))).toBeLessThanOrEqual(8_000_000);
  expect(await page.locator('canvas[data-material="acrylic"]').count()).toBe(1);
});
test('Kanban editing and destructive confirmation both use the shared dialog, never a browser confirm',async({page},info)=>{
  const path='98 - Kanban visual fixture.md';
  const content='# Quadro\n\n```kanban horizontal\n## Ideias\n- [ ] Circuitos no acrílico\n- Revisar as conexões\n```\n';
  const existing=await page.request.get('/api/note?path='+encodeURIComponent(path));
  if(existing.ok()){const data=await existing.json();await page.request.put('/api/note?path='+encodeURIComponent(path),{data:{content,baseRevision:data.revision}});}else await page.request.post('/api/note',{data:{path,content}});
  await page.goto('/');await expect(page.locator('.pm-note-item').first()).toBeVisible();
  await page.keyboard.press('Control+p');await page.getByRole('combobox').fill('98 - Kanban');await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog',{name:'Abrir arquivo'})).not.toBeVisible();
  await page.locator('[data-pm-kanban-action="edit-card"]').first().click();
  await expect(page.getByRole('dialog',{name:'Editar cartão · Ideias',exact:true})).toBeVisible();
  await page.screenshot({path:info.outputPath('kanban-dialog.png')});
  await page.getByRole('button',{name:'Cancelar',exact:true}).click();
  await expect(page.locator('.pm-kanban-editor')).toHaveCount(0);
  const native=[];page.on('dialog',d=>{native.push(d.type());void d.dismiss();});
  await page.locator('[data-pm-kanban-action="remove-card"]').first().click();
  const dialog=page.getByRole('dialog',{name:'Remover cartão',exact:true});await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button',{name:'Cancelar',exact:true})).toBeFocused();
  await dialog.getByRole('button',{name:'Cancelar',exact:true}).click();
  await expect(page.locator('.pm-confirm-dialog')).toHaveCount(0);expect(native).toEqual([]);
  await expect(page.locator('.pm-kanban-card')).toHaveCount(2);
});
for(const viewport of [{width:1672,height:941},{width:1280,height:720},{width:390,height:660},{width:844,height:390}]){
 test(`all settings sections remain bounded at ${viewport.width}x${viewport.height}`,async({page},info)=>{
  await page.setViewportSize(viewport);await open(page,'Configurações');
  for(const tab of ['Aparência','Tipografia','Cofre e host','MCP']){
    await page.getByRole('tab',{name:tab,exact:true}).click();await page.waitForTimeout(300);
    const panel=page.locator('.pm-settings-dialog'),bounds=await panel.boundingBox();
    expect(bounds.x).toBeGreaterThanOrEqual(-1);expect(bounds.y).toBeGreaterThanOrEqual(-1);
    expect(bounds.x+bounds.width).toBeLessThanOrEqual(viewport.width+1);expect(bounds.y+bounds.height).toBeLessThanOrEqual(viewport.height+1);
    expect(await panel.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
    await expect(page.getByRole('button',{name:'Salvar configurações',exact:true})).toBeInViewport();
    await page.mouse.move(bounds.x+bounds.width*.7,bounds.y+bounds.height*.45);await page.waitForTimeout(300);
    await page.screenshot({path:info.outputPath(`settings-${tab}.png`)});
  }
 });
}
for(const [button,title] of [['Conta','Conta local'],['Conectados','Conectados ao cofre'],['Compartilhar','Compartilhar o cofre'],['Ponte MCP','Ponte MCP']]){
 test(`review ${title} in desktop acrylic`,async({page},info)=>{
  await open(page,button);const dialog=page.getByRole('dialog',{name:title,exact:true});await expect(dialog).toBeVisible();
  await page.waitForTimeout(300);const b=await dialog.locator('.pm-dialog').boundingBox();await page.mouse.move(b.x+b.width*.66,b.y+b.height*.52);await page.waitForTimeout(300);
  await page.screenshot({path:info.outputPath('dialog.png')});
  await page.keyboard.press('Escape');await expect(dialog).not.toBeVisible();
 });
}
test('appearance cancellation restores the approved theme and saved settings are unchanged',async({page})=>{
  await open(page,'Configurações');const shell=page.locator('.pm-shell'),before=await shell.getAttribute('data-theme');
  await page.getByRole('button',{name:'Ember',exact:true}).click();await expect(shell).toHaveAttribute('data-theme','ember');
  await page.getByRole('button',{name:'Cancelar',exact:true}).click();await expect(page.locator('.pm-settings-dialog')).toHaveCount(0);await expect(shell).toHaveAttribute('data-theme',before);
});
