import { randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';

// These notes are created only in the test host's temporary vault.
async function notes(page, contents) {
  const folder = `Rendering-${randomUUID().slice(0, 8)}`;
  for (const [name, content] of Object.entries(contents)) {
    const response = await page.request.post('/api/note', { data: { path: `${folder}/${name}.md`, content } });
    expect(response.ok(), await response.text()).toBe(true);
  }
  return folder;
}
async function open(page, folder, name) {
  await page.goto('/');
  await expect(page.getByRole('textbox', { name: 'Editor Markdown em Live Preview' })).toBeVisible();
  await page.keyboard.press('Control+p');
  await page.getByRole('combobox', { name: 'Buscar arquivos' }).fill(`${folder}/${name}`);
  await page.keyboard.press('Enter');
  await expect(page.locator('.pm-document-path')).toContainText(name);
  await expect(page.getByRole('dialog', { name: 'Abrir arquivo' })).not.toBeVisible();
}
async function mode(page, name) {
  await page.getByRole('button', { name: 'Ferramentas e ações', exact: true }).click();
  await page.getByRole('button', { name, exact: true }).click();
  await page.keyboard.press('Escape');
}
async function settings(page) {
  await page.getByRole('button', { name: 'Ferramentas e ações', exact: true }).click();
  await page.getByRole('button', { name: 'Configurações', exact: true }).click();
  return page.locator('.pm-settings-dialog');
}

// Removing SVG text labels, narrowing Mermaid to flowcharts, or transforming
// wiki syntax inside fences must each break these real renderer checks.
for (const [grammar, source, label] of [
  ['flowchart', 'flowchart LR\n A["[[literal label]]"] -->|next| B[Ready]', '[[literal label]]'],
  ['graph', 'graph TD\n A[Start] --> B[Finish]', 'Start'],
  ['sequence', 'sequenceDiagram\n Alice->>Bob: Hello Bob\n Bob-->>Alice: Hello Alice', 'Hello Bob'],
  ['class', 'classDiagram\n class Document {\n +String title\n +open()\n }', 'Document'],
  ['state', 'stateDiagram-v2\n [*] --> Ready\n Ready --> Done\n Done --> [*]', 'Ready'],
  ['entity', 'erDiagram\n AUTHOR ||--o{ BOOK : writes', 'AUTHOR'],
  ['pie', 'pie title Distribution\n "Ready" : 70\n "Pending" : 30', 'Distribution'],
  ['mindmap', 'mindmap\n root((Knowledge))\n  Notes\n  Links', 'Knowledge'],
]) {
  test(`${grammar} keeps visible SVG labels in live and reading modes`, async ({ page }) => {
    const folder = await notes(page, { Diagram: `# Diagram\n\n~~~mermaid\n${source}\n~~~\n` });
    await open(page, folder, 'Diagram');
    for (const reading of [false, true]) {
      if (reading) await mode(page, 'Somente leitura');
      const diagram = page.locator('.pm-document .pm-mermaid');
      await expect(diagram.locator('svg')).toBeVisible();
      await expect(diagram.locator('svg')).toContainText(label);
      await expect(diagram.locator('foreignObject')).toHaveCount(0);
      expect(await diagram.locator('svg text').evaluateAll(nodes => nodes.some(node => {
        const box = node.getBBox(); return box.width > 0 && box.height > 0;
      }))).toBe(true);
      await expect(diagram).not.toHaveClass(/pm-mermaid--error/);
    }
  });
}

test('diagram labels survive init directives, duplicate diagrams have independent SVG ids, and theme changes update them', async ({ page }) => {
  const source = "%%{init: {'htmlLabels': true, 'flowchart': {'htmlLabels': true}}}%%\nflowchart LR\n A[Readable] --> B[Safe]";
  const folder = await notes(page, { Theme: `# Theme\n\n\`\`\`mermaid\n${source}\n\`\`\`\n\n\`\`\`mermaid\n${source}\n\`\`\`\n` });
  await open(page, folder, 'Theme');
  await mode(page, 'Somente leitura');
  const diagrams = page.locator('.pm-document .pm-mermaid');
  await expect(diagrams.locator('svg')).toHaveCount(2);
  await expect(diagrams.nth(0)).toContainText('Readable');
  await expect(diagrams.nth(1)).toContainText('Readable');
  await expect(diagrams.locator('foreignObject')).toHaveCount(0);
  const ids = await diagrams.locator('[id]').evaluateAll(nodes => nodes.map(node => node.id));
  expect(new Set(ids).size).toBe(ids.length);
  const dialog = await settings(page);
  // Force browser-supported colors that Mermaid's own color parser cannot read.
  // Removing palette normalization must fail this check in either theme.
  await page.addStyleTag({ content: '.pm-mermaid { --pm-panel: color-mix(in oklab, var(--pm-text) 8%, var(--pm-panel-2)); --pm-cyan: oklch(65% .12 210); }' });
  const darkId = await diagrams.first().locator('svg').getAttribute('id');
  await dialog.getByRole('button', { name: 'Pérola', exact: true }).click();
  await expect(diagrams.first().locator('svg')).not.toHaveAttribute('id', darkId);
  const light = await diagrams.first().locator('svg text').first().evaluate(node => getComputedStyle(node).fill);
  const lightId = await diagrams.first().locator('svg').getAttribute('id');
  await dialog.getByRole('button', { name: 'Ember', exact: true }).click();
  await expect(diagrams.first().locator('svg')).not.toHaveAttribute('id', lightId);
  await expect.poll(() => diagrams.first().locator('svg text').first().evaluate(node => getComputedStyle(node).fill)).not.toBe(light);
  await expect(diagrams.locator('foreignObject')).toHaveCount(0);
  await expect(page.locator('.pm-document .pm-mermaid--error')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Cancelar', exact: true }).click();
});

test('a malformed diagram is local to its fence and later diagrams still render', async ({ page }) => {
  const folder = await notes(page, { Errors: '# Errors\n\n```mermaid\nflowchart LR\n A[broken\n```\n\n```mermaid\nflowchart LR\n A[Recovered] --> B[Okay]\n```\n' });
  await open(page, folder, 'Errors');
  await mode(page, 'Somente leitura');
  await expect(page.locator('.pm-document .pm-mermaid--error')).toHaveCount(1);
  await expect(page.locator('.pm-document .pm-mermaid svg')).toContainText('Recovered');
  await expect(page.locator('body > [id^="dpm-"]')).toHaveCount(0);
});

test('cyclic nested previews reuse notes, stay anchored and readonly, and require Ctrl or Meta to navigate', async ({ page }) => {
  const folder = await notes(page, {
    Home: '# Home\n\n[[./A|Preview A]]\n',
    A: '# A\n\n[[./B|Preview B]]\n\n- [ ] Readonly task\n\n```mermaid\nflowchart LR\n A[Preview diagram] --> B[Ready]\n```\n',
    B: '# B\n\n[[./A|Preview A again]]\n',
  });
  await open(page, folder, 'Home');
  const counts = new Map();
  page.on('request', request => {
    const url = new URL(request.url());
    if (request.method() === 'GET' && url.pathname === '/api/note') {
      const path = url.searchParams.get('path'); counts.set(path, (counts.get(path) || 0) + 1);
    }
  });
  await page.locator('.pm-document a[data-pm-note]').hover();
  const cards = page.locator('.pm-link-hover-preview');
  await expect(cards).toHaveCount(1);
  await expect(cards.nth(0).locator('.pm-mermaid svg')).toContainText('Preview diagram');
  await expect(cards.nth(0).locator('input[type="checkbox"]')).toBeDisabled();
  const firstBox = await cards.nth(0).boundingBox();
  const firstSvgId = await cards.nth(0).locator('.pm-mermaid svg').getAttribute('id');
  await cards.nth(0).getByRole('link', { name: 'Preview B' }).hover();
  await expect(cards).toHaveCount(2);
  await cards.nth(1).getByRole('link', { name: 'Preview A again' }).hover();
  await expect(cards).toHaveCount(3);
  await expect(cards.nth(2).locator('.pm-mermaid svg')).toContainText('Preview diagram');
  await cards.nth(2).getByRole('link', { name: 'Preview B' }).hover();
  await expect(cards).toHaveCount(4);
  await cards.nth(3).getByRole('link', { name: 'Preview A again' }).hover();
  await expect(cards).toHaveCount(4);
  expect(counts.get(`${folder}/A.md`)).toBe(1);
  expect(counts.get(`${folder}/B.md`)).toBe(1);
  expect(await cards.nth(0).boundingBox()).toEqual(firstBox);
  expect(await cards.nth(0).locator('.pm-mermaid svg').getAttribute('id')).toBe(firstSvgId);
  await cards.nth(3).getByRole('link', { name: 'Preview A again' }).click();
  await expect(page.locator('.pm-document-path')).toContainText('Home');
  await expect(cards).toHaveCount(4);
  await cards.nth(3).getByRole('link', { name: 'Preview A again' }).click({ modifiers: ['Control'] });
  await expect(page.locator('.pm-document-path')).toContainText('A');
  await expect(cards).toHaveCount(0);
  await open(page, folder, 'Home');
  await page.locator('.pm-document a[data-pm-note]').hover();
  await expect(cards).toHaveCount(1);
  await cards.first().getByRole('link', { name: 'Preview B' }).click({ modifiers: ['Meta'] });
  await expect(page.locator('.pm-document-path')).toContainText('B');
  await expect(cards).toHaveCount(0);
});

test('nested embeds resolve from their own folder, share fetches and terminate cycles', async ({ page }) => {
  const folder = await notes(page, {
    Home: '# Home\n\n![[./Nested/A]]\n\n![[./Nested/A]]\n',
    'Nested/A': '# Embedded A\n\n[[../Target|Relative target]]\n\n![[../Home]]\n\n```mermaid\nsequenceDiagram\n Alice->>Bob: Embedded message\n```\n',
    Target: '# Target\n',
  });
  await open(page, folder, 'Home');
  await mode(page, 'Somente leitura');
  const target = page.locator('.pm-preview-pane a[data-pm-note]');
  await expect(target).toHaveCount(2);
  await expect(target.first()).toHaveAttribute('data-pm-note', `${folder}/Target.md`);
  await expect(page.locator('.pm-preview-pane .pm-mermaid svg')).toHaveCount(2);
  await expect(page.locator('.pm-preview-pane')).toContainText('Referência circular');
  await expect(page.locator('.pm-preview-pane .pm-note-embed .pm-note-embed .pm-note-embed')).toHaveCount(0);
  await expect(page.locator('.pm-preview-pane')).not.toContainText('Carregando');
  // A cyclic embed stops expansion; a manually hovered note link remains usable.
  await target.first().hover();
  await expect(page.locator('.pm-link-hover-preview')).toContainText('Target');
});

test('closing a delayed preview cancels its fetch and never resurrects the card', async ({ page }) => {
  const folder = await notes(page, { Home: '# Home\n\n[[./Slow|Slow preview]]\n', Slow: '# Delayed content\n' });
  await open(page, folder, 'Home');
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  await page.route('**/api/note?**', async route => {
    if (new URL(route.request().url()).searchParams.get('path') !== `${folder}/Slow.md`) return route.continue();
    const response = await route.fetch();
    await gate;
    await route.fulfill({ response }).catch(() => {});
  });
  const pending = page.waitForRequest(request => new URL(request.url()).searchParams.get('path') === `${folder}/Slow.md`);
  await page.locator('.pm-document a[data-pm-note]').hover();
  const request = await pending;
  const cancelled = page.waitForEvent('requestfailed', failed => failed === request);
  await page.keyboard.press('Escape');
  await cancelled;
  release();
  await expect(page.locator('.pm-link-hover-preview')).toHaveCount(0);
  await page.getByRole('button', { name: 'Ferramentas e ações', exact: true }).click();
  await expect(page.locator('.pm-link-hover-preview')).toHaveCount(0);
});
