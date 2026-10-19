import { test, expect } from '@playwright/test';
async function tools(page) {
  await page.goto('/');
  await expect(page.getByRole('textbox',{name:'Editor Markdown em Live Preview'})).toBeVisible();
  await page.getByRole('button',{name:'Ferramentas e ações',exact:true}).click();
  await page.getByRole('button',{name:'Acrílico',exact:true}).click();
}
test('MCP is immediately available and opening its panel never activates the bridge',async({page})=>{
  await tools(page);
  const before=await (await page.request.get('/api/config')).json();
  const entry=page.getByRole('button',{name:'Ponte MCP',exact:true});
  await expect(entry).toBeInViewport();await entry.click();
  const dialog=page.getByRole('dialog',{name:'Ponte MCP',exact:true});
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('Token da ponte')).toHaveAttribute('type','password');
  await expect(dialog.locator('.pm-acrylic-pane')).toHaveCount(1);
  await expect(dialog.getByText('Streamable HTTP',{exact:true})).toBeVisible();
  await page.keyboard.press('Escape');await expect(dialog).not.toBeVisible();
  expect((await (await page.request.get('/api/config')).json()).aiBridgeEnabled).toBe(before.aiBridgeEnabled);
  await expect(page.getByRole('button',{name:'Ferramentas e ações',exact:true})).toBeFocused();
});
test('settings categories have keyboard navigation, one consistent shell and safe cancel',async({page})=>{
  await tools(page);await page.getByRole('button',{name:'Configurações',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Configurações',exact:true});await expect(dialog).toBeVisible();
  const tabs=dialog.getByRole('tablist');await expect(tabs).toBeVisible();
  await dialog.getByRole('tab',{name:'Aparência',exact:true}).focus();await page.keyboard.press('ArrowRight');
  await expect(dialog.getByRole('tab',{name:'Tipografia',exact:true})).toBeFocused();
  await expect(dialog.getByLabel('Fonte da interface',{exact:true})).toBeVisible();
  await dialog.getByRole('tab',{name:'Cofre e host',exact:true}).click();
  await dialog.getByLabel('Nome do cofre',{exact:true}).fill('Não salvar este rascunho');
  await dialog.getByRole('button',{name:'Cancelar',exact:true}).click();
  await expect(dialog).not.toBeVisible();
  expect((await (await page.request.get('/api/config')).json()).vaultName).not.toBe('Não salvar este rascunho');
});
test('account focus stays inside the dialog and closing plays an exit transition',async({page})=>{
  await tools(page);await page.getByRole('button',{name:'Conta',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Conta local',exact:true});await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('Apelido',{exact:true})).toBeFocused();
  await expect(dialog.getByRole('button',{name:'Alterar foto',exact:true})).toBeVisible();
  for(let i=0;i<12;i++){await page.keyboard.press('Tab');expect(await dialog.evaluate(el=>el.contains(document.activeElement))).toBe(true);}
  await dialog.getByRole('button',{name:'Cancelar',exact:true}).click();
  await expect(page.locator('.pm-dialog-layer[data-entered="false"]')).toHaveCount(1);
  await expect(dialog).not.toBeVisible();
});
test('cursor circuit illumination changes real pixels only on its active backing and settles to idle',async({page})=>{
  await tools(page);await page.getByRole('button',{name:'Configurações',exact:true}).click();
  const panel=page.locator('.pm-dialog');await expect(panel).toBeVisible();await page.mouse.move(1,1);await page.waitForTimeout(600);
  const pane=panel.locator(':scope > .pm-acrylic-pane');await expect(pane).toHaveAttribute('data-circuit','true');
  const pixels=()=>pane.evaluate(c=>{const data=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let hash=2166136261;for(let i=0;i<data.length;i++)hash=Math.imul(hash^data[i],16777619);return hash>>>0;});
  const before=await pixels();const b=await panel.boundingBox();const sidebar=await page.locator('.pm-sidebar > .pm-acrylic-pane').getAttribute('data-paints');
  await page.mouse.move(b.x+b.width*.65,b.y+b.height*.5);await page.waitForTimeout(450);
  const after=await pixels();expect(after).not.toBe(before);
  expect(await page.locator('.pm-sidebar > .pm-acrylic-pane').getAttribute('data-paints')).toBe(sidebar);
  const count=await pane.getAttribute('data-paints');await page.waitForTimeout(400);expect(await pane.getAttribute('data-paints')).toBe(count);
});
for(const [button,title] of [['Compartilhar','Compartilhar o cofre'],['Conectar a um cofre','Conectar a um cofre'],['Celular e acesso remoto','PentaMark no celular']]){
 test(`${title} uses the shared acrylic dialog with bounded mobile geometry`,async({page},info)=>{
  await page.setViewportSize({width:390,height:660});await tools(page);await page.getByRole('button',{name:button,exact:true}).click();
  const dialog=page.getByRole('dialog',{name:title,exact:true});await expect(dialog).toBeVisible();await expect(dialog.locator('.pm-acrylic-pane')).toHaveCount(1);
  const b=await dialog.locator('.pm-dialog').boundingBox();expect(b.x).toBeGreaterThanOrEqual(0);expect(b.x+b.width).toBeLessThanOrEqual(391);expect(b.y+b.height).toBeLessThanOrEqual(661);
  await page.screenshot({path:info.outputPath('mobile.png')});await page.keyboard.press('Escape');await expect(dialog).not.toBeVisible();
 });
}
