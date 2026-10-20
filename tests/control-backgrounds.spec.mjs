import { test, expect } from '@playwright/test';

const CLEAR = 'rgba(0, 0, 0, 0)';
const background = locator => locator.evaluate(el => getComputedStyle(el).backgroundColor);
const hasBackground = locator => expect.poll(() => background(locator)).not.toBe(CLEAR);

test('text selection preserves line geometry and compact panels fit', async ({ page }, testInfo) => {
  await page.goto('/');
  const editor = page.getByRole('textbox', { name: 'Editor Markdown em Live Preview' });
  await expect(editor).toBeVisible();
  await page.getByRole('button', { name: 'Ferramentas e ações', exact: true }).click();
  await page.getByRole('button', { name: 'Acrílico', exact: true }).click();
  await page.keyboard.press('Escape');
  const line = page.locator('.cm-line').filter({ hasText: 'Um espaço para compreender' }).first();
  await line.click();
  await page.keyboard.press('Home');
  const before = await line.boundingBox();
  await page.keyboard.press('Shift+End');
  const after = await line.boundingBox();
  expect(after).toEqual(before);
  await expect(page.locator('.cm-selectionBackground').first()).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('selection-energy.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Ferramentas e ações', exact: true }).click();
  const panel = page.locator('.pm-workspace-panel');
  await expect(panel).toHaveCSS('opacity', '1');
  const box = await panel.boundingBox();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(390);
  await page.screenshot({ path: testInfo.outputPath('compact-tools.png') });
});

test('themes, centered writing column and reversible tools motion', async ({ page }, testInfo) => {
  await page.goto('/');
  const editor = page.getByRole('textbox', { name: 'Editor Markdown em Live Preview' });
  await expect(editor).toBeVisible();
  const column = await editor.boundingBox();
  const workspace = await page.locator('.pm-workspace').boundingBox();
  expect(Math.abs(column.x + column.width / 2 - workspace.x - workspace.width / 2)).toBeLessThan(2);
  const trigger = page.getByRole('button', { name: 'Ferramentas e ações', exact: true });
  await trigger.click();
  await page.getByRole('button', { name: 'Acrílico', exact: true }).click();
  const panel = page.locator('.pm-workspace-panel');
  await expect(panel).toHaveCSS('opacity', '1');
  await page.screenshot({ path: testInfo.outputPath('acrylic-workspace.png') });
  await trigger.click();
  await expect(panel).toHaveAttribute('data-entered', 'false');
  // It stays mounted while fading out; reopening reverses that transition.
  await expect(panel).toBeAttached();
  await trigger.click();
  await expect(panel).toHaveCSS('opacity', '1');
  await page.getByRole('button', { name: 'Configurações', exact: true }).click();
  const dialog = page.locator('.pm-settings-dialog');
  await dialog.getByRole('button', { name: 'Flat', exact: true }).click();
  const surfaces = [];
  for (const name of ['PentaMark', 'Eclipse', 'Ember', 'Terminal']) {
    await dialog.getByRole('button', { name, exact: true }).click();
    surfaces.push(await page.locator('.pm-shell').evaluate(el => getComputedStyle(el).backgroundColor));
    expect(await background(dialog.locator('.pm-preferences-nav'))).toBe(CLEAR);
    expect(await background(dialog)).toBe(await background(page.locator('.pm-sidebar')));
    await page.screenshot({ path: testInfo.outputPath(`flat-${name}.png`) });
  }
  expect(new Set(surfaces).size).toBe(4);
  await dialog.getByRole('button', { name: 'Acrílico', exact: true }).click();
  await dialog.getByRole('button', { name: 'PentaMark', exact: true }).click();
  await dialog.getByRole('tab', { name: 'Tipografia' }).click();
  for (const scale of ['1', '1.25']) {
    await dialog.getByRole('slider', { name: 'Escala do app' }).fill(scale);
    const bounds = await dialog.boundingBox();
    await page.mouse.move(bounds.x + bounds.width - 4, bounds.y + bounds.height - 4);
    await expect(page.locator('canvas[data-material="acrylic"]')).toHaveAttribute('data-renderer', 'webgl');
    await page.screenshot({ path: testInfo.outputPath(`acrylic-edge-${scale}.png`) });
  }
});

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

test('acrylic tools panel shares the sidebar and settings surface', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('textbox', { name: 'Editor Markdown em Live Preview' })).toBeVisible();
  await page.getByRole('button', { name: 'Ferramentas e ações', exact: true }).click();
  await page.getByRole('button', { name: 'Acrílico', exact: true }).click();

  const sidebar = page.locator('.pm-sidebar').first();
  const tools = page.locator('.pm-workspace-panel').first();
  await expect(tools).toBeVisible();
  await expect.poll(() => tools.evaluate(el => getComputedStyle(el).clipPath)).toBe('none');
  const surface = locator => locator.evaluate(el => {
    const style = getComputedStyle(el);
    return { background: style.backgroundColor, border: style.borderColor, shadow: style.boxShadow };
  });
  expect(await surface(tools)).toEqual(await surface(sidebar));

  await page.getByRole('button', { name: 'Configurações', exact: true }).click();
  const settings = page.locator('.pm-dialog').first();
  await expect(settings).toBeVisible();
  expect((await surface(settings)).background).toBe((await surface(sidebar)).background);
  const selectedTheme = settings.locator('.pm-theme-options button[aria-pressed="true"]');
  await selectedTheme.hover();
  expect(await selectedTheme.evaluate(el => getComputedStyle(el).backdropFilter)).toContain('blur(');
});

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
