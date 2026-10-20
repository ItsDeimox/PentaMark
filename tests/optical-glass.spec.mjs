import { test, expect } from '@playwright/test';

async function settings(page) {
  await page.getByRole('button', { name:'Ferramentas e ações', exact:true }).click();
  await page.getByRole('button', { name:'Configurações', exact:true }).click();
  return page.locator('.pm-settings-dialog');
}

test('Pearl persists, renders both materials and pauses its background', async ({page}, info) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('/');
  await expect(page.getByRole('textbox', {name:'Editor Markdown em Live Preview'})).toBeVisible();
  const dialog = await settings(page);
  await dialog.getByRole('button', {name:'Pérola', exact:true}).click();
  await expect(page.locator('.pm-shell')).toHaveAttribute('data-theme','pearl');
  for (const name of ['Flat','Acrílico']) {
    await dialog.getByRole('button', {name,exact:true}).click();
    if (name==='Acrílico') await expect(page.locator('canvas[data-material="acrylic"]')).toHaveAttribute('data-renderer','webgl');
    const box = await dialog.boundingBox();
    await page.mouse.move(box.x+box.width-3,box.y+box.height-30);
    await page.screenshot({path:info.outputPath(`pearl-${name}.png`)});
    expect(await dialog.evaluate(el => getComputedStyle(el).color)).toBe('rgb(35, 53, 65)');
    await expect(dialog.getByRole('button',{name:'Pérola',exact:true})).toHaveCSS('background-color','rgba(48, 122, 148, 0.12)');
  }
  await dialog.getByLabel('Animações de fundo',{exact:true}).uncheck();
  await expect(page.locator('.pm-signal-background')).toHaveAttribute('data-animated','false');
  expect(await page.locator('.pm-signal-packet').first().evaluate(el=>el.getAnimations().every(a=>a.playState==='paused'))).toBe(true);
  await dialog.getByRole('button',{name:'Salvar configurações',exact:true}).click();
  await expect(dialog).not.toBeVisible();
  await page.reload();
  await expect(page.locator('.pm-shell')).toHaveAttribute('data-theme','pearl');
  await expect(page.locator('.pm-signal-background')).toHaveAttribute('data-animated','false');
  const reopened = await settings(page);
  await reopened.getByLabel('Animações de fundo',{exact:true}).check();
  await reopened.getByRole('button',{name:'Salvar configurações',exact:true}).click();
  await expect(reopened).not.toBeVisible();
  const packet=page.locator('.pm-signal-packet').first();
  const offset=await packet.evaluate(el=>getComputedStyle(el).transform);
  await expect.poll(()=>packet.evaluate(el=>getComputedStyle(el).transform)).not.toBe(offset);
  await page.screenshot({path:info.outputPath('pearl-writing.png')});
  await page.emulateMedia({reducedMotion:'reduce'});
  expect(await packet.evaluate(el=>el.getAnimations().every(a=>a.playState==='paused'))).toBe(true);
  expect(errors).toEqual([]);
});

test('dark glass and compact Pearl retain readable actions', async ({page}, info) => {
  await page.goto('/');
  const dialog = await settings(page);
  await dialog.getByRole('button',{name:'Acrílico',exact:true}).click();
  await expect(page.locator('canvas[data-material="acrylic"]')).toHaveAttribute('data-renderer','webgl');
  const b=await dialog.boundingBox();
  await page.mouse.move(b.x+b.width-3,b.y+b.height-25);
  await page.screenshot({path:info.outputPath('dark-optical-rim.png')});
  await dialog.getByRole('button',{name:'Pérola',exact:true}).click();
  await page.setViewportSize({width:390,height:844});
  await expect(dialog.getByRole('button',{name:'Salvar configurações',exact:true})).toBeInViewport();
  await expect(dialog.getByRole('button',{name:'Pérola',exact:true})).toBeInViewport();
  await page.screenshot({path:info.outputPath('pearl-compact.png')});
});
