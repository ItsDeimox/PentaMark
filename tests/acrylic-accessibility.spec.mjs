import { test, expect } from '@playwright/test';
async function open(page, label) {
  await page.goto('/');
  await expect(page.getByRole('textbox',{name:'Editor Markdown em Live Preview'})).toBeVisible();
  await page.getByRole('button',{name:'Ferramentas e ações',exact:true}).click();
  await page.getByRole('button',{name:'Acrílico',exact:true}).click();
  await page.getByRole('button',{name:label,exact:true}).click();
}
test('settings respect 160 percent scale and reduced motion without losing their actions',async({page},info)=>{
  await page.setViewportSize({width:1280,height:720});
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.addInitScript(()=>localStorage.setItem('pentamark:appearance',JSON.stringify({appScale:1.6})));
  await open(page,'Configurações');
  const panel=page.locator('.pm-settings-dialog');
  for(const name of ['Aparência','Gráficos','Tipografia','Cofre e host','MCP']){
    await page.getByRole('tab',{name,exact:true}).click();
    const b=await panel.boundingBox();
    expect(b.x).toBeGreaterThanOrEqual(0);expect(b.y).toBeGreaterThanOrEqual(0);
    expect(b.x+b.width).toBeLessThanOrEqual(1281);expect(b.y+b.height).toBeLessThanOrEqual(721);
    await expect(page.getByRole('button',{name:'Salvar configurações',exact:true})).toBeInViewport();
    expect(await panel.evaluate(el=>parseFloat(getComputedStyle(el).transitionDuration))).toBeLessThan(.002);
  }
  await page.screenshot({path:info.outputPath('scaled-settings.png')});
  await page.keyboard.press('Escape');await expect(panel).toHaveCount(0);
});
test('a simulated non-host response exposes no bridge token or configuration actions',async({page})=>{
  await page.route('**/api/config',async route=>{
    const response=await route.fetch();const data=await response.json();
    await route.fulfill({response,json:{...data,isHost:false,aiBridgeToken:''}});
  });
  await open(page,'Ponte MCP');
  const dialog=page.getByRole('dialog',{name:'Ponte MCP',exact:true});
  // The optional footer hint is hidden on compact dialog widths. The access
  // notice in the content is the persistent explanation of non-host access.
  await expect(dialog.getByText('Somente o host pode configurar a ponte.',{exact:false})).toBeVisible();
  await expect(dialog.getByLabel('Token da ponte')).toHaveCount(0);
  await expect(dialog.getByRole('switch')).toHaveCount(0);
  await expect(dialog.getByRole('button',{name:'Salvar ponte',exact:true})).toHaveCount(0);
  await page.keyboard.press('Escape');await expect(dialog).not.toBeVisible();
});
test('an injected revision conflict opens the redesigned review and resolves through the real host',async({page},info)=>{
  const path='97 - Conflict dialog fixture.md',url='/api/note?path='+encodeURIComponent(path);
  const content='# Conflict fixture\n\nServer text\n';
  const response=await page.request.get(url);
  if(response.ok()){const current=await response.json();await page.request.put(url,{data:{content,baseRevision:current.revision}});}
  else expect((await page.request.post('/api/note',{data:{path,content}})).ok()).toBe(true);
  await open(page,'Ponte MCP');await page.keyboard.press('Escape');
  await expect(page.locator('.pm-mcp-dialog')).toHaveCount(0);
  await page.keyboard.press('Control+p');await page.getByRole('combobox').fill('97 - Conflict');await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog',{name:'Abrir arquivo'})).not.toBeVisible();
  let injected=false;
  await page.route('**/api/note?*',async route=>{
    if(!injected && route.request().method()==='PUT' && new URL(route.request().url()).searchParams.get('path')===path){
      injected=true;await route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({error:'Synthetic stale revision'})});
    }else await route.continue();
  });
  const editor=page.getByRole('textbox',{name:'Editor Markdown em Live Preview'});
  await editor.focus();await page.keyboard.press('Control+End');await page.keyboard.insertText('\nLocal fixture change');
  const dialog=page.getByRole('dialog',{name:'Conflito de edição',exact:true});
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('Resultado da mesclagem')).toHaveValue(/Local fixture change/);
  expect((await (await page.request.get(url)).json()).content).toBe(content);
  await page.waitForTimeout(300);await page.screenshot({path:info.outputPath('conflict-review.png')});
  await dialog.getByRole('button',{name:'Salvar mesclagem',exact:true}).click();
  await expect(dialog).not.toBeVisible();
  expect((await (await page.request.get(url)).json()).content).toContain('Local fixture change');
});
