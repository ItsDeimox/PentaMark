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

test('refined theme has restrained corners and a matte graphite base', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.pm-note-item').first()).toBeVisible();
  const style = await page.locator('.pm-shell').evaluate(el => ({
    bg: getComputedStyle(el).backgroundColor,
    corners: Array.from(el.querySelectorAll('.pm-note-item, .pm-search, .pm-view-switch')).map(e => getComputedStyle(e).borderRadius),
  }));
  expect(style.bg).toBe('rgb(24, 26, 27)');
  expect(style.corners.every(v => parseFloat(v) <= 5)).toBe(true);
});

test('collapsing the tree recenters without rewrapping the document', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('pentamark:view', 'live'));
  await page.goto('/');
  const editor = page.getByRole('textbox', { name: 'Editor Markdown em Live Preview' });
  await expect(editor).toBeVisible();
  const before = await editor.boundingBox();
  await page.getByRole('button', { name: 'Mostrar ou ocultar arquivos', exact: true }).click();
  await page.waitForTimeout(260);
  const after = await editor.boundingBox();
  expect(Math.abs(after.x + after.width / 2 - page.viewportSize().width / 2)).toBeLessThanOrEqual(1);
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
    await page.getByRole('button', {name:'Abrir arquivo',exact:true}).focus();
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

test('opening a heading for editing keeps the first letter in place', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('pentamark:view', 'live'));
  await page.goto('/');
  const heading = page.locator('.pm-live-heading-1').first();
  await expect(heading).toBeVisible();
  const rect = () => heading.evaluate(el => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const at = node.textContent.indexOf('Visão');
      if (at >= 0) { const r = document.createRange(); r.setStart(node, at); r.setEnd(node, at + 1); const b = r.getBoundingClientRect(); return { x: b.x, y: b.y }; }
    }
    throw new Error('Heading text not found');
  });
  const before = await rect();
  await heading.click();
  const after = await rect();
  console.log('heading-first-character', { before, after });
  expect(Math.abs(before.x - after.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(before.y - after.y)).toBeLessThanOrEqual(1);
});

test('quick open is keyboard operated and restores focus without moving text', async ({ page }) => {
  await page.goto('/');
  const trigger = page.getByRole('button', { name: 'Abrir arquivo', exact: true });
  await expect(trigger).toBeVisible();
  await trigger.focus();
  await page.keyboard.press('Control+p');
  await expect(page.getByRole('combobox', { name: 'Buscar arquivos' })).toBeFocused();
  await page.getByRole('combobox').fill('Direcao');
  await page.keyboard.press('Enter');
  await expect(page.locator('.pm-document-path')).toContainText('01 - Direcao');
  await page.keyboard.press('Control+p');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Abrir arquivo' })).not.toBeVisible();
});

test('tools preserve all view modes and appearance preferences', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Ferramentas e ações', exact: true }).click();
  for (const label of ['Editor Markdown', 'Editor + visualização', 'Somente leitura', 'Live Preview']) {
    await page.getByRole('button', { name: label, exact: true }).click();
  }
  await page.getByRole('button', { name: 'Configurações', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Configurações', exact: true });
  await dialog.getByRole('tab', { name: 'MCP', exact: true }).click();
  await expect(dialog.getByText('Streamable HTTP', { exact: true })).toBeVisible();
  await dialog.getByRole('tab', { name: 'Tipografia', exact: true }).click();
  await expect(dialog.getByLabel('Fonte da interface', { exact: true })).toHaveValue('technical');
});

test('tree expansion and scroll survive collapse', async ({ page }) => {
  await page.goto('/');
  const folder = page.locator('.pm-folder-title').filter({ hasText: 'Planejamento' }).first();
  await folder.click();
  await page.waitForTimeout(210);
  await page.locator('.pm-note-list').evaluate(el => el.scrollTop = 310);
  const scroll = await page.locator('.pm-note-list').evaluate(el => el.scrollTop);
  await page.getByRole('button', { name: 'Mostrar ou ocultar arquivos', exact: true }).click();
  await page.waitForTimeout(230);
  await page.getByRole('button', { name: 'Mostrar ou ocultar arquivos', exact: true }).click();
  await expect(folder).toHaveAttribute('aria-expanded', 'true');
  expect(await page.locator('.pm-note-list').evaluate(el => el.scrollTop)).toBe(scroll);
});

for (const viewport of [{ width: 1672, height: 941 }, { width: 1280, height: 800 }, { width: 390, height: 844 }]) {
  test(`workspace remains usable at ${viewport.width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await page.goto('/');
    await expect(page.getByRole('textbox', { name: 'Editor Markdown em Live Preview' })).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: testInfo.outputPath(`workspace-${viewport.width}.png`) });
    const geometry = await page.locator('.pm-shell').evaluate(el => ({ width: el.clientWidth, scroll: el.scrollWidth }));
    expect(geometry.scroll).toBeLessThanOrEqual(geometry.width + 1);
    if (viewport.width < 1100) {
      const editor = page.getByRole('textbox', { name: 'Editor Markdown em Live Preview' });
      const before = await editor.boundingBox();
      await page.getByRole('button', { name: 'Mostrar ou ocultar arquivos', exact: true }).click();
      await expect(page.locator('.pm-sidebar')).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath('mobile-tree.png') });
      const after = await editor.boundingBox();
      expect(after.width).toBe(before.width);
      await page.getByRole('button', { name: 'Mostrar ou ocultar arquivos', exact: true }).click();
    }
  });
}

test('saved font and scale remain respected and reduced motion has no panel animation', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('pentamark:appearance', JSON.stringify({ uiFont: 'mono', editorFont: 'serif', uiSize: 14, editorSize: 18, appScale: 1.5 })));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  const styles = await page.locator('.pm-shell').evaluate(el => ({ ui: el.style.getPropertyValue('--pm-ui-font'), font: el.style.getPropertyValue('--pm-editor-font'), scale: el.style.zoom }));
  expect(styles.ui).toContain('Consolas'); expect(styles.font).toContain('Georgia'); expect(styles.scale).toBe('1.5');
  await page.getByRole('button', { name: 'Ferramentas e ações', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Ferramentas e ações' })).toBeVisible();
  expect(await page.getByRole('dialog', { name: 'Ferramentas e ações' }).evaluate(el => getComputedStyle(el).transitionDuration)).toBe('0s');
});
