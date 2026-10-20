import { test, expect } from '@playwright/test';

const CLEAR = 'rgba(0, 0, 0, 0)';
async function backgroundIsClear(locator) {
  const computed = await locator.evaluate(el => {
    const style = getComputedStyle(el);
    return { color: style.backgroundColor, image: style.backgroundImage };
  });
  expect(computed.color).toBe(CLEAR);
  expect(computed.image).toBe('none');
}

for (const acrylic of [false, true]) {
  test(`button backgrounds stay clear in ${acrylic ? 'Acrylic' : 'Flat'}`, async ({ page }, testInfo) => {
    await page.goto('/');
    await expect(page.getByRole('textbox', { name: 'Editor Markdown em Live Preview' })).toBeVisible();
    const note = page.locator('.pm-note-item--active').first();
    await expect(note).toBeVisible();
    await backgroundIsClear(note);
    await note.hover();
    await backgroundIsClear(note);

    await page.getByRole('button', {name:'Ferramentas e ações', exact:true}).click();
    if (acrylic) await page.getByRole('button', {name:'Acrílico', exact:true}).click();
    const live = page.getByRole('button', {name:'Live Preview', exact:true});
    const code = page.getByRole('button', {name:'Editor Markdown', exact:true});
    await expect(live).toHaveAttribute('aria-pressed','true');
    await backgroundIsClear(live);
    await code.hover();
    await backgroundIsClear(code);
    await code.click();
    await expect(code).toHaveAttribute('aria-pressed','true');
    await backgroundIsClear(code);
    await backgroundIsClear(live);
    const action = page.getByRole('button', {name:'Mostrar no diretório', exact:true});
    await action.hover();
    await backgroundIsClear(action);

    if (acrylic) {
      const glass = await code.evaluate(el => getComputedStyle(el).backdropFilter);
      expect(glass).toContain('blur(');
      await expect(page.locator('canvas[data-material="acrylic"]')).toHaveAttribute('data-renderer','webgl');
    }
    await page.screenshot({path:testInfo.outputPath(acrylic?'acrylic-clear-buttons.png':'flat-clear-buttons.png')});
  });
}

test('clear hover keeps the selected note recognisable and does not alter its geometry', async ({ page }) => {
  await page.goto('/');
  const note = page.locator('.pm-note-item--active').first();
  await expect(note).toBeVisible();
  const old = await note.boundingBox();
  await note.hover();
  await backgroundIsClear(note);
  const next = await note.boundingBox();
  expect(next.width).toBe(old.width);
  expect(next.height).toBe(old.height);
  expect(await note.evaluate(el => getComputedStyle(el).boxShadow)).toContain('inset');
});
