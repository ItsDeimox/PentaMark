import { test, expect } from '@playwright/test';

const CLEAR = 'rgba(0, 0, 0, 0)';
const background = locator => locator.evaluate(el => getComputedStyle(el).backgroundColor);
const hasBackground = locator => expect.poll(() => background(locator)).not.toBe(CLEAR);

for (const acrylic of [false, true]) {
  test(`selection and hover retain button surfaces in ${acrylic ? 'Acrylic' : 'Flat'}`, async ({ page }, testInfo) => {
    await page.goto('/');
    await expect(page.getByRole('textbox', { name: 'Editor Markdown em Live Preview' })).toBeVisible();
    await page.getByRole('button', { name: 'Ferramentas e ações', exact: true }).click();
    await page.getByRole('button', { name: acrylic ? 'Acrílico' : 'Flat', exact: true }).click();
    await page.keyboard.press('Escape');

    const note = page.locator('.pm-note-item--active').first();
    await expect(note).toBeVisible();
    await hasBackground(note);
    const before = await note.boundingBox();
    await note.hover();
    await hasBackground(note);
    const after = await note.boundingBox();
    expect(after.width).toBe(before.width);
    expect(after.height).toBe(before.height);
    expect(await note.evaluate(el => getComputedStyle(el).boxShadow)).toContain('inset');

    await page.getByRole('button', { name: 'Ferramentas e ações', exact: true }).click();
    const live = page.getByRole('button', { name: 'Live Preview', exact: true });
    const code = page.getByRole('button', { name: 'Editor Markdown', exact: true });
    await expect(live).toHaveAttribute('aria-pressed', 'true');
    await hasBackground(live);
    await code.hover();
    await hasBackground(code);
    await code.click();
    await expect(code).toHaveAttribute('aria-pressed', 'true');
    await page.locator('.pm-workspace-panel-heading h2').hover();
    await hasBackground(code);
    await expect(live).toHaveAttribute('aria-pressed', 'false');
    await expect.poll(async () => (await background(live)) !== (await background(code))).toBe(true);

    const action = page.getByRole('button', { name: 'Mostrar no diretório', exact: true });
    await action.hover();
    await hasBackground(action);
    if (acrylic) {
      for (const control of [live, code, action]) {
        await hasBackground(control);
        expect(await control.evaluate(el => getComputedStyle(el).backdropFilter)).toContain('blur(');
      }
      await expect(page.locator('canvas[data-material="acrylic"]')).toHaveAttribute('data-renderer', 'webgl');
    }
    await page.screenshot({ path: testInfo.outputPath(acrylic ? 'acrylic-button-backgrounds.png' : 'flat-button-backgrounds.png') });
  });
}

test('context actions and copy-path submenu retain their hover background', async ({ page }) => {
  await page.goto('/');
  const note = page.locator('.pm-note-item--active').first();
  await expect(note).toBeVisible();
  await note.click({ button: 'right' });
  const copy = page.getByRole('button', { name: 'Copiar caminho', exact: true });
  await copy.hover();
  await hasBackground(copy);
  const relative = page.getByRole('menuitem', { name: 'Copiar caminho relativo' });
  await relative.hover();
  await hasBackground(relative);
});
