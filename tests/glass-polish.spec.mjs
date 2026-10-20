import { test, expect } from '@playwright/test';
async function ready(page, acrylic=false) {
  await page.goto('/');
  await expect(page.getByRole('textbox',{name:'Editor Markdown em Live Preview'})).toBeVisible();
  if(acrylic){
    await page.getByRole('button',{name:'Ferramentas e ações',exact:true}).click();
    await page.getByRole('button',{name:'Acrílico',exact:true}).click();
    await expect(page.locator('canvas[data-material="acrylic"]')).toHaveAttribute('data-renderer','webgl');
  }
}
test('double clicks never rename notes or folders; explicit rename stays available',async({page})=>{
  await ready(page);
  await page.locator('.pm-note-item').first().dblclick();
  await expect(page.locator('.pm-tree-inline')).toHaveCount(0);
  const folder=page.locator('.pm-folder-title').filter({hasText:'Planejamento'}).first();
  await folder.dblclick();await page.waitForTimeout(300);
  await expect(page.locator('.pm-tree-inline')).toHaveCount(0);
  await page.locator('.pm-note-item').first().click({button:'right'});
  await page.getByRole('button',{name:'Renomear',exact:true}).click();
  await expect(page.getByPlaceholder('Nome da nota')).toBeVisible();
});
test('cold and repeated folder transitions pass through intermediate sizes',async({page})=>{
  await ready(page);
  const folder=page.locator('.pm-folder').filter({has:page.locator(':scope > .pm-folder-title').filter({hasText:'Planejamento'})}).first();
  for(let cycle=0;cycle<4;cycle++){
    const data=await folder.evaluate(el=>new Promise(resolve=>{
      const button=el.querySelector(':scope > button');button.click();
      const values=[];let n=0;const sample=()=>{const d=el.querySelector(':scope > .pm-tree-disclosure');values.push(d?.getBoundingClientRect().height||0);if(++n<22)requestAnimationFrame(sample);else resolve(values)};
      requestAnimationFrame(sample);
    }));
    expect(new Set(data.map(n=>Math.round(n))).size,JSON.stringify(data)).toBeGreaterThan(3);
  }
});
test('profile inset uses actual transparent acrylic and only one optical contour',async({page})=>{
  await ready(page,true);await page.getByRole('button',{name:'Conta',exact:true}).click();
  const profile=page.locator('.pm-identity-card');
  await expect(profile.locator(':scope > .pm-acrylic-pane')).toHaveCount(1);
  await page.waitForTimeout(400);
  for(const selector of ['.pm-profile-dialog','.pm-identity-card']){
    const info=await page.locator(selector).evaluate(el=>{const s=getComputedStyle(el);return {border:s.borderTopColor,radius:parseFloat(s.borderRadius),shadow:s.boxShadow}});
    expect(info.border).toBe('rgba(0, 0, 0, 0)');expect(info.radius).toBeLessThanOrEqual(10);expect(info.shadow).not.toContain('inset');
    const alpha=await page.locator(selector+' > .pm-acrylic-pane').evaluate(c=>{const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let total=0,n=0;for(let y=20;y<c.height-20;y+=9)for(let x=20;x<c.width-20;x+=9){total+=d[(y*c.width+x)*4+3];n++}return total/Math.max(1,n)});
    expect(alpha).toBeLessThan(180);expect(alpha).toBeGreaterThan(2);
  }
});
test('controls get the local Checkpoint-style optical light, not a second CSS border',async({page})=>{
  await ready(page,true);
  const button=page.getByRole('button',{name:'Ponte MCP',exact:true});await button.hover();
  await expect(button.locator(':scope > .pm-acrylic-pane')).toHaveCount(1);
  await expect(button).toHaveAttribute('data-surface','control');
  expect(await button.evaluate(el=>getComputedStyle(el).borderTopColor)).toBe('rgba(0, 0, 0, 0)');
});
test('navigation fragments horizontally only in acrylic and supports reversal',async({page},info)=>{
  await ready(page,true);await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog',{name:'Ferramentas e ações',exact:true})).not.toBeVisible();
  const sidebar=page.locator('.pm-sidebar');const trigger=page.getByRole('button',{name:'Mostrar ou ocultar arquivos',exact:true});
  const samples=await trigger.evaluate(button=>new Promise(resolve=>{
    const p=document.querySelector('.pm-sidebar'),values=[];button.click();let n=0;
    const sample=()=>{values.push({phase:p.getAttribute('data-reveal'),clip:getComputedStyle(p).clipPath,y:p.getBoundingClientRect().y});if(++n<22)requestAnimationFrame(sample);else resolve(values)};
    requestAnimationFrame(sample);
  }));
  expect(samples.some(s=>s.phase!==null&&Number(s.phase)>0&&Number(s.phase)<1)).toBe(true);
  expect(samples.some(s=>s.clip.startsWith('polygon'))).toBe(true);
  const ys=samples.filter(s=>s.phase!==null).map(s=>s.y);expect(Math.max(...ys)-Math.min(...ys)).toBeLessThan(1);
  await trigger.click();await page.waitForTimeout(70);await trigger.click();await page.waitForTimeout(500);
  await expect(sidebar).toHaveAttribute('aria-hidden','true');
  await trigger.click();await page.waitForTimeout(500);await expect(sidebar).toHaveAttribute('aria-hidden','false');
  await page.screenshot({path:info.outputPath('glass-navigation.png')});
  await page.getByRole('button',{name:'Ferramentas e ações',exact:true}).click();await page.getByRole('button',{name:'Flat',exact:true}).click();await page.keyboard.press('Escape');
  await trigger.click();await expect(sidebar).not.toHaveAttribute('data-fragmenting','true');
});
test('graphics controls drop technical filler while retaining MCP security information',async({page})=>{
  await ready(page,true);
  await expect(page.locator('.pm-material-hint')).toHaveCount(0);
  await expect(page.getByRole('dialog',{name:'Ferramentas e ações'})).not.toContainText('WebGL');
  await page.getByRole('button',{name:'Configurações',exact:true}).click();
  await expect(page.getByRole('dialog',{name:'Configurações'})).not.toContainText('sob demanda');
  await page.getByRole('tab',{name:'MCP',exact:true}).click();
  await expect(page.getByLabel('Token da ponte')).toHaveAttribute('type','password');
});
