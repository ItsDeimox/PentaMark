import { test, expect } from '@playwright/test';

async function openEditingFixture(page) {
  await page.goto('/');
  await expect(page.getByRole('textbox', { name: 'Editor Markdown em Live Preview' })).toBeVisible();
  await page.keyboard.press('Control+p');
  await page.getByRole('combobox', { name: 'Buscar arquivos' }).fill('Edicao');
  await page.keyboard.press('Enter');
  await expect(page.locator('.pm-document-path')).toContainText('02 - Edicao');
  await expect(page.getByRole('dialog', { name: 'Abrir arquivo' })).not.toBeVisible();
}
async function readSource(page) {
  return page.evaluate(async () => {
    const response = await fetch('/api/note?path=' + encodeURIComponent('Referencias/02 - Edicao.md'), {
      headers: { 'X-PentaMark-Client': localStorage.getItem('pentamark:client-id') },
    });
    if (!response.ok) throw new Error('Fixture read failed: ' + response.status);
    return (await response.json()).content;
  });
}

test('bold, code and wikilink text retain their measured position on focus', async ({ page }) => {
  await openEditingFixture(page);
  for (const selector of ['.pm-live-strong', '.pm-live-inline-code', '.pm-live-link']) {
    if (selector !== ".pm-live-strong") {
      await page.getByRole("textbox", { name: "Editor Markdown em Live Preview" }).focus();
      await page.keyboard.press("Control+End");
    }
    const element = page.locator(selector).first();
    await element.scrollIntoViewIfNeeded();
    await page.getByRole('button', { name: 'Abrir arquivo', exact: true }).focus();
    const measure = () => element.evaluate(el => {
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        if (!node.textContent.trim()) continue;
        const range = document.createRange(); range.setStart(node, 0); range.setEnd(node, 1);
        const r = range.getBoundingClientRect();
        return { x: r.x, y: r.y, height: el.closest('.cm-line').getBoundingClientRect().height };
      }
      throw new Error('No inline text');
    });
    const before = await measure(); await element.click(); const after = await measure();
    expect(Math.abs(after.x - before.x), selector + ' x').toBeLessThanOrEqual(1);
    expect(Math.abs(after.y - before.y), selector + ' y').toBeLessThanOrEqual(1);
    expect(Math.abs(after.height - before.height), selector + ' height').toBeLessThanOrEqual(1);
  }
});

test('editing, contextual formatting, save, undo and redo remain functional', async ({ page }, testInfo) => {
  await openEditingFixture(page);
  const original = await readSource(page);
  const editor = page.getByRole('textbox', { name: 'Editor Markdown em Live Preview' });
  await editor.focus(); await page.keyboard.press('Control+End');
  await page.keyboard.insertText('\n\nValidação de edição');
  await page.keyboard.press('Shift+Home');
  await expect(page.getByRole('toolbar', { name: 'Formatação da seleção' })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('contextual-formatting.png') });
  await page.getByRole('button', { name: 'Negrito na seleção' }).click();
  await page.keyboard.press('Control+s');
  await expect(async()=>expect(await readSource(page)).toContain('**Validação de edição**')).toPass({timeout:6000});
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+s');
  // The existing host replaces a file via unlink/rename; retry transient reads
  // during that asynchronous save, while still asserting the final real file.
  await expect(async()=>expect(await readSource(page)).not.toContain('**Validação de edição**')).toPass({timeout:6000});
  await expect(async()=>expect(await readSource(page)).toContain('Validação de edição')).toPass({timeout:6000});
  // Use the uppercase key emitted by a physical Shift+Z, not a synthetic lowercase z.
  await page.keyboard.press('Control+Shift+Z');
  await page.keyboard.press('Control+s');
  await expect(async()=>expect(await readSource(page)).toContain('**Validação de edição**')).toPass({timeout:6000});
  // Restore this synthetic note through the explicit source editor.
  await page.getByRole('button', { name: 'Ferramentas e ações', exact: true }).click();
  await page.getByRole('button', { name: 'Editor Markdown', exact: true }).click();
  await page.keyboard.press('Escape');
  const raw = page.locator('.pm-editor-pane textarea');
  await raw.fill(original); await page.keyboard.press('Control+s');
  await expect(async()=>expect(await readSource(page)).toBe(original)).toPass({timeout:6000});
});

test('rapid open/close and keyboard switching between overlays do not trap focus', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Ferramentas e ações', exact: true }).click();
  await page.keyboard.press('Control+p');
  await expect(page.getByRole('combobox', { name: 'Buscar arquivos' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Abrir arquivo' })).not.toBeVisible();
  for (let i = 0; i < 4; i++) {
    await page.keyboard.press('Control+p'); await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Abrir arquivo' })).not.toBeVisible();
  }
});

test('new-note and rename actions reopen a collapsed tree and close obstructing panels', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Mostrar ou ocultar arquivos', exact: true }).click();
  await page.keyboard.press('Control+p');
  await expect(page.getByRole('combobox')).toBeFocused();
  await page.keyboard.press('Control+n');
  await expect(page.getByRole('dialog', { name: 'Abrir arquivo' })).not.toBeVisible();
  const input = page.getByPlaceholder('Nome da nota');
  await expect(input).toBeFocused();
  await input.fill('90 - Nova nota de teste'); await input.press('Enter');
  await expect(page.locator('.pm-document-path')).toContainText('90 - Nova nota de teste');
  await page.getByRole('button', { name: 'Mostrar ou ocultar arquivos', exact: true }).click();
  await page.getByRole('button', { name: 'Ferramentas e ações', exact: true }).click();
  await page.getByRole('button', { name: 'Mais ações', exact: true }).click();
  await page.getByRole('button', { name: 'Renomear', exact: true }).click();
  await expect(input).toBeFocused();
  await expect(input).toHaveValue('90 - Nova nota de teste');
  await input.fill('91 - Nota renomeada'); await input.press('Enter');
  await expect(page.locator('.pm-document-path')).toContainText('91 - Nota renomeada');
});

test('Ctrl+B in the quick-open text field does not change the tree state', async ({ page }) => {
  await page.goto('/');
  await page.keyboard.press('Control+p');
  await expect(page.getByRole('combobox')).toBeFocused();
  const before = await page.locator('.pm-sidebar').getAttribute('aria-hidden');
  await page.keyboard.press('Control+b');
  expect(await page.locator('.pm-sidebar').getAttribute('aria-hidden')).toBe(before);
});
