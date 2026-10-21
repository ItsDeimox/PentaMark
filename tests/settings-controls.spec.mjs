import { test, expect } from '@playwright/test';

async function open(page, mode) {
  await page.addInitScript(mode => localStorage.setItem('pentamark:appearance', JSON.stringify({graphicsPreset:'custom',graphicsMode:mode,backgroundHover:true,backgroundMotion:false,interfaceMotion:true,refraction:true})), mode);
  await page.goto('/');
  await page.getByRole('button', {name:'Ferramentas e ações',exact:true}).click();
  await page.getByRole('button', {name:'Configurações',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Configurações',exact:true});
  await expect(dialog).toHaveAttribute('data-entered','true');
  return dialog;
}

for (const mode of ['flat','acrylic']) test(`${mode}: settings headings, slider geometry and readable MCP`,async ({page})=>{
  const dialog=await open(page,mode);
  await dialog.getByRole('tab',{name:'Tipografia',exact:true}).click();
  const slider=dialog.getByRole('slider',{name:'Escala do app',exact:true});
  await slider.scrollIntoViewIfNeeded();
  await page.mouse.move(0,0);
  await page.waitForTimeout(300);
  const bounds=await slider.boundingBox();
  await dialog.screenshot({path:`../../outputs/settings-${mode}-scale-before.png`});
  await slider.hover();
  await page.waitForTimeout(300);
  expect(await slider.boundingBox()).toEqual(bounds);
  await dialog.screenshot({path:`../../outputs/settings-${mode}-scale-hover.png`});
  await slider.focus();
  await page.keyboard.press('ArrowRight');
  await expect(slider).toHaveValue('1.05');
  await dialog.getByRole('tab',{name:'Gráficos',exact:true}).click();
  const heading=dialog.locator('.pm-settings-heading,.pm-section-heading');
  expect(await heading.evaluate(el=>getComputedStyle(el).paddingLeft)).toBe('0px');
  const preset=dialog.getByRole('combobox',{name:'Perfil gráfico',exact:true});
  await preset.click();
  expect(await preset.evaluate(el=>el.matches(':open'))).toBe(true);
  await dialog.screenshot({path:`../../outputs/settings-${mode}-picker.png`});
  await page.getByRole('option',{name:'Equilibrado',exact:true}).click();
  await expect(preset).toHaveValue('balanced');
  await dialog.screenshot({path:`../../outputs/settings-${mode}-graphics.png`});
  await dialog.getByRole('tab',{name:'MCP',exact:true}).click();
  expect(await dialog.locator('.pm-connection-status small').evaluate(el=>parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(13);
  await dialog.screenshot({path:`../../outputs/settings-${mode}-mcp.png`});
});

test('compact settings and themed picker fit a phone viewport',async ({page})=>{
  await page.setViewportSize({width:390,height:844});
  const dialog=await open(page,'flat');
  await dialog.getByRole('tab',{name:'Gráficos',exact:true}).click();
  const preset=dialog.getByRole('combobox',{name:'Perfil gráfico',exact:true});
  await expect(preset).toBeVisible();
  const field=await preset.boundingBox();
  expect(field.x).toBeGreaterThanOrEqual(0);
  expect(field.x+field.width).toBeLessThanOrEqual(390);
  const heading=dialog.locator('.pm-section-heading');
  expect(await heading.evaluate(el=>getComputedStyle(el).paddingLeft)).toBe('0px');
  await dialog.screenshot({path:'../../outputs/settings-phone-graphics.png'});
  await preset.click();
  expect(await preset.evaluate(el=>el.matches(':open'))).toBe(true);
  await page.getByRole('option',{name:'Econômico',exact:true}).click();
  await expect(preset).toHaveValue('economical');
  await dialog.getByRole('tab',{name:'MCP',exact:true}).click();
  expect(await dialog.locator('.pm-connection-status small').evaluate(el=>parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(13);
  await dialog.screenshot({path:'../../outputs/settings-phone-mcp.png'});
});
