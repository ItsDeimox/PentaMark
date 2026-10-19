import { test, expect } from '@playwright/test';
import { ensureVisualFixtures } from './visual-fixtures.mjs';
async function blocks(page) {
  await ensureVisualFixtures(page);
  await page.goto('/');
  await expect(page.locator('.pm-note-item').first()).toBeVisible();
  await page.keyboard.press('Control+p');
  await page.getByRole('combobox').fill('03 - Blocos');
  await page.keyboard.press('Enter');
  await expect(page.locator('.pm-document-path')).toContainText('03 - Blocos');
}
test('opening a complex block for editing leaves the next heading at the same coordinates', async ({ page }) => {
  await blocks(page);
  const anchor = page.locator('.cm-line').filter({ hasText: 'Âncora depois do painel' }).first();
  const before = await anchor.boundingBox();
  await page.locator('.pm-live-widget .pm-callout').first().getByText('Mais uma linha', { exact: false }).click();
  await page.waitForTimeout(250);
  const after = await anchor.boundingBox();
  expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(1);
  await expect(page.getByRole('dialog', { name: 'Editar bloco' })).toBeVisible();
});
test('sidebar collapse recenters reading, with rounded compact navigation and animated folder children', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.pm-note-item').first()).toBeVisible();
  const radius = await page.locator('.pm-sidebar').evaluate(el => parseFloat(getComputedStyle(el).borderRadius));
  expect(radius).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Mostrar ou ocultar arquivos', exact: true }).click();
  await page.waitForTimeout(300);
  const editor = await page.getByRole('textbox', { name: 'Editor Markdown em Live Preview' }).boundingBox();
  expect(Math.abs(editor.x + editor.width / 2 - page.viewportSize().width / 2)).toBeLessThan(3);
});
test('acrylic graphics mode has a real WebGL material and no old toolbar gradients', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Ferramentas e ações', exact: true }).click();
  await page.getByRole('button', { name: 'Acrílico', exact: true }).click();
  await expect(page.locator('.pm-shell')).toHaveAttribute('data-graphics', 'acrylic');
  await expect(page.locator('canvas[data-material="acrylic"]')).toHaveAttribute('data-renderer', 'webgl');
  expect(await page.locator('.pm-workspace-tools').evaluate(el => getComputedStyle(el).backgroundImage)).toBe('none');
});
test('context menu offers directory immediately and preview remains anchored', async ({ page }) => {
  await blocks(page);
  await page.locator('.pm-note-item--active').click({ button: 'right' });
  await expect(page.getByRole('button', { name: 'Mostrar no diretório', exact: true })).toBeVisible({timeout: 600});
  await page.keyboard.press('Escape');
  const editor=page.getByRole('textbox',{name:'Editor Markdown em Live Preview'});
  await editor.focus(); await page.keyboard.press('Control+End');
  const link = page.locator('.pm-live-link').filter({hasText:'Link A'});
  await link.hover();
  const preview=page.locator('.pm-link-hover-preview').first();
  await expect(preview).toBeVisible();
  const initial=await preview.boundingBox();
  const box=await link.boundingBox();await page.mouse.move(box.x + 2, box.y + 2);
  await page.waitForTimeout(100);
  expect(await preview.boundingBox()).toEqual(initial);
  await preview.getByText('Link B', {exact:true}).hover();
  await expect(page.locator('.pm-link-hover-preview')).toHaveCount(2);
});
