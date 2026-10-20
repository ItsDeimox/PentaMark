import { test, expect } from '@playwright/test';
async function open(page){
 await page.goto('/');await expect(page.getByRole('textbox',{name:'Editor Markdown em Live Preview'})).toBeVisible();
 await page.getByRole('button',{name:'Ferramentas e ações',exact:true}).click();await page.getByRole('button',{name:'Acrílico',exact:true}).click();await page.keyboard.press('Escape');
 await expect(page.getByRole('dialog',{name:'Ferramentas e ações',exact:true})).not.toBeVisible();
}
test('lighting must never pull an absolute control into document flow',async({page})=>{
 await open(page);await page.mouse.move(1300,700);await page.waitForTimeout(350);
 const editor=page.getByRole('textbox',{name:'Editor Markdown em Live Preview'}),before=await editor.boundingBox();
 const brand=page.getByRole('button',{name:'Mostrar ou ocultar arquivos',exact:true});await brand.hover();await page.waitForTimeout(300);
 expect(await brand.evaluate(el=>getComputedStyle(el).position)).toBe('absolute');
 const after=await editor.boundingBox();expect(after.x).toBe(before.x);expect(after.width).toBe(before.width);
});
test('closing a shader reveal keeps DOM clipped until the next open or Flat mode',async({page})=>{
 await open(page);
 const trigger=page.getByRole('button',{name:'Mostrar ou ocultar arquivos',exact:true});await trigger.click();await page.waitForTimeout(330);
 expect(await page.locator('.pm-sidebar').evaluate(el=>getComputedStyle(el).clipPath)).toBe('inset(0px 100% 0px 0px)');
 await page.getByRole('button',{name:'Ferramentas e ações',exact:true}).click();await page.getByRole('button',{name:'Flat',exact:true}).click();
 expect(await page.locator('.pm-sidebar').evaluate(el=>getComputedStyle(el).clipPath)).toBe('none');
});
test('review optical controls and inset cards with the pointer over the rim',async({page},info)=>{
 await open(page);await page.getByRole('button',{name:'Ferramentas e ações',exact:true}).click();await page.getByRole('button',{name:'Conta',exact:true}).click();
 const card=page.locator('.pm-identity-card');await card.waitFor();await page.waitForTimeout(300);
 const b=await card.boundingBox();await page.mouse.move(b.x+b.width*.67,b.y+b.height*.7);await page.waitForTimeout(350);await page.screenshot({path:info.outputPath('profile-glass.png')});
 const save=page.getByRole('button',{name:'Salvar perfil',exact:true}),button=await save.boundingBox();await page.mouse.move(button.x+button.width-6,button.y+7);await page.waitForTimeout(350);
 await page.screenshot({path:info.outputPath('checkpoint-control-light.png')});
});
