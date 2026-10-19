import { test, expect } from '@playwright/test';

test('baseline: the real vault and editor load without runtime exceptions', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('/');
  await expect(page.locator('.pm-note-item').first()).toBeVisible();
  await expect(page.locator('.pm-live-recovery')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('new installations open the document-first live view', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('textbox', { name: 'Editor Markdown em Live Preview' })).toBeVisible();
  await expect(page.locator('.pm-toolbar')).not.toBeVisible();
});

test('approved theme has square controls and a matte graphite base', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.pm-note-item').first()).toBeVisible();
  const style = await page.locator('.pm-shell').evaluate(el => ({
    bg: getComputedStyle(el).backgroundColor,
    corners: Array.from(el.querySelectorAll('.pm-note-item, .pm-search, .pm-view-switch')).map(e => getComputedStyle(e).borderRadius),
  }));
  expect(style.bg).toBe('rgb(24, 26, 27)');
  expect(style.corners.every(v => v === '0px')).toBe(true);
});

test('collapsing the tree does not move or rewrap the document', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('pentamark:view', 'live'));
  await page.goto('/');
  const editor = page.getByRole('textbox', { name: 'Editor Markdown em Live Preview' });
  await expect(editor).toBeVisible();
  const before = await editor.boundingBox();
  await page.getByRole('button', { name: 'Mostrar ou ocultar arquivos', exact: true }).click();
  await page.waitForTimeout(260);
  const after = await editor.boundingBox();
  expect(Math.abs(after.x - before.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(after.width - before.width)).toBeLessThanOrEqual(1);
  await page.getByRole('button', { name: 'Mostrar ou ocultar arquivos', exact: true }).click();
  await page.waitForTimeout(260);
  expect(Math.abs((await editor.boundingBox()).x - before.x)).toBeLessThanOrEqual(1);
});

test('clicking bold near wrapping boundaries preserves the rendered block height', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('pentamark:view', 'live'));
  await page.goto('/');
  await expect(page.locator('.pm-note-item').first()).toBeVisible();
  await page.getByRole('button', { name: /Referencias/ }).first().click();
  await page.getByRole('button', { name: /02 - Edicao/ }).first().click();
  const bold = page.locator('.pm-live-strong').first();
  await expect(bold).toBeVisible();
  const changes = [];
  for (const width of [491, 497, 503, 509, 515, 521, 527, 533]) {
    await page.locator('.pm-live-codemirror').evaluate((el, w) => { el.style.width = `${w}px`; }, width);
    await page.locator('.pm-brand').click();
    await page.waitForTimeout(100);
    const line = page.locator('.cm-line').filter({ has: page.locator('.pm-live-strong') }).first();
    const before = await line.boundingBox();
    await bold.click();
    await page.waitForTimeout(100);
    const after = await line.boundingBox();
    changes.push(Math.abs(after.height - before.height));
  }
  console.log('inline-focus-height-deltas', JSON.stringify(changes));
  expect(Math.max(...changes)).toBeLessThanOrEqual(1);
});
