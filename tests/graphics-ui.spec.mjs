import {test,expect} from '@playwright/test';

const effects = '.pm-signal-background,.pm-energy-layer,.pm-acrylic-layer,.pm-acrylic-pane,.pm-lens-defs';
const stored = page => page.evaluate(() => JSON.parse(localStorage.getItem('pentamark:appearance')));
async function ready(page) {
  await page.goto('/');
  await expect(page.getByRole('textbox',{name:'Editor Markdown em Live Preview'})).toBeVisible();
}
async function settings(page) {
  await page.getByRole('button',{name:'Ferramentas e ações',exact:true}).click();
  await page.getByRole('button',{name:'Configurações',exact:true}).click();
  const dialog=page.locator('.pm-settings-dialog');
  await dialog.getByRole('tab',{name:'Gráficos',exact:true}).click();
  return dialog;
}
async function save(dialog) {
  await dialog.getByRole('button',{name:'Salvar configurações',exact:true}).click();
  await expect(dialog).toBeHidden();
}
async function economical(page) {
  await expect(page.locator('.pm-shell')).toHaveAttribute('data-graphics','flat');
  await expect(page.locator('.pm-shell')).toHaveAttribute('data-refraction','false');
  await expect(page.locator('.pm-shell')).toHaveAttribute('data-interface-motion','false');
  await expect(page.locator(effects)).toHaveCount(0);
}

test.describe('first entry on a touch device',()=>{
  test.use({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  test('recommends economical without mounting effects and persists it on reload',async({page})=>{
    await ready(page);
    expect(await page.evaluate(()=>matchMedia('(pointer: coarse)').matches)).toBe(true);
    await economical(page);
    expect((await stored(page)).graphicsPreset).toBe('economical');
    const dialog=await settings(page);
    await expect(dialog.getByLabel('Perfil gráfico',{exact:true})).toHaveValue('economical');
    for(const name of ['Animações de fundo','Reação ao mouse','Movimento de interface','Refração']) {
      await expect(dialog.getByLabel(name,{exact:true})).not.toBeChecked();
    }
    await save(dialog);
    await page.reload();
    await economical(page);
  });
  test('manual custom choices survive reload on the same constrained device',async({page})=>{
    await ready(page);
    const dialog=await settings(page);
    await dialog.getByLabel('Perfil gráfico',{exact:true}).selectOption('quality');
    await dialog.getByLabel('Animações de fundo',{exact:true}).uncheck();
    await dialog.getByLabel('Movimento de interface',{exact:true}).uncheck();
    await save(dialog);
    const before=await stored(page);
    expect(before).toMatchObject({graphicsPreset:'custom',graphicsMode:'acrylic',backgroundMotion:false,backgroundHover:true,interfaceMotion:false,refraction:true});
    await page.reload();
    await expect(page.locator('.pm-shell')).toHaveAttribute('data-graphics','acrylic');
    const reopened=await settings(page);
    await expect(reopened.getByLabel('Perfil gráfico',{exact:true})).toHaveValue('custom');
    await expect(reopened.getByLabel('Animações de fundo',{exact:true})).not.toBeChecked();
    await expect(reopened.getByLabel('Reação ao mouse',{exact:true})).toBeChecked();
    await expect(reopened.getByLabel('Movimento de interface',{exact:true})).not.toBeChecked();
    await expect(reopened.getByLabel('Refração',{exact:true})).toBeChecked();
    expect(await stored(page)).toEqual(before);
  });
});

test('quick Flat after quality removes canvases, ambient animations and refraction filters',async({page})=>{
  await ready(page);
  await page.getByRole('button',{name:'Ferramentas e ações',exact:true}).click();
  await page.getByRole('button',{name:'Acrílico',exact:true}).click();
  await expect(page.locator('.pm-acrylic-layer')).toHaveAttribute('data-renderer','webgl');
  await expect(page.locator('.pm-energy-layer').first()).toBeAttached();
  await expect(page.locator('.pm-signal-packet')).toHaveCount(12);
  await expect.poll(()=>page.locator('.pm-lens-defs').count()).toBeGreaterThan(0);
  await page.getByRole('button',{name:'Flat',exact:true}).click();
  await economical(page);
  await expect.poll(()=>page.locator('.pm-sidebar,.pm-workspace-panel').evaluateAll(nodes=>nodes.every(el=>getComputedStyle(el).backdropFilter==='none'))).toBe(true);
  expect(await page.evaluate(()=>document.getAnimations().filter(animation=>{
    const target=animation.effect?.target;
    return target instanceof Element && !!target.closest('.pm-signal-background');
  }).length)).toBe(0);
  expect((await stored(page)).graphicsPreset).toBe('economical');
});

test('four independent controls mount only requested effects, including custom Flat refraction',async({page})=>{
  await ready(page);
  const dialog=await settings(page);
  await dialog.getByLabel('Perfil gráfico',{exact:true}).selectOption('economical');
  const ambient=dialog.getByLabel('Animações de fundo',{exact:true});
  const reactive=dialog.getByLabel('Reação ao mouse',{exact:true});
  const motion=dialog.getByLabel('Movimento de interface',{exact:true});
  const refraction=dialog.getByLabel('Refração',{exact:true});
  await ambient.check();
  await expect(page.locator('.pm-signal-packet')).toHaveCount(12);
  await expect(page.locator('.pm-energy-layer,.pm-acrylic-layer')).toHaveCount(0);
  await expect(reactive).not.toBeChecked();
  await expect(motion).not.toBeChecked();
  await expect(refraction).not.toBeChecked();
  await ambient.uncheck();
  await reactive.check();
  await expect(page.locator('.pm-energy-layer').first()).toBeAttached();
  await expect(page.locator('.pm-ambient-signals,.pm-acrylic-layer')).toHaveCount(0);
  await reactive.uncheck();
  await motion.check();
  await expect(page.locator('.pm-shell')).toHaveAttribute('data-interface-motion','true');
  await expect(page.locator(effects)).toHaveCount(0);
  await motion.uncheck();
  await refraction.check();
  await expect(dialog.getByRole('radio',{name:'Flat',exact:true})).toBeChecked();
  await expect(page.locator('.pm-acrylic-layer')).toHaveAttribute('data-renderer','webgl');
  await expect.poll(()=>page.locator('.pm-lens-defs').count()).toBeGreaterThan(0);
  await expect(page.locator('.pm-signal-background')).toHaveCount(0);
  await expect(ambient).not.toBeChecked();
  await expect(reactive).not.toBeChecked();
  await expect(motion).not.toBeChecked();
  await refraction.uncheck();
  await expect(page.locator(effects)).toHaveCount(0);
  await expect(dialog.getByLabel('Perfil gráfico',{exact:true})).toHaveValue('custom');
  await save(dialog);
  await page.reload();
  await economical(page);
  expect((await stored(page)).graphicsPreset).toBe('custom');
});
