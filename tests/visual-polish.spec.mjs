import {test, expect} from '@playwright/test';

async function editorReady(page) {
  await page.goto('/');
  await expect(page.getByRole('textbox', {name: 'Editor Markdown em Live Preview'})).toBeVisible();
  await expect(page.locator('.pm-note-item').first()).toBeVisible();
}

test('the selection bar exposes eight direct actions with accessible custom shortcut hints', async ({page}) => {
  await editorReady(page);
  const editor = page.getByRole('textbox', {name:'Editor Markdown em Live Preview'});
  await editor.focus();
  await page.keyboard.press('Control+Home');
  await page.keyboard.press('End');
  await page.keyboard.press('Shift+Home');
  const bar = page.getByRole('toolbar', {name:'Formatação da seleção'});
  await expect(bar).toBeVisible();
  for (const label of ['Negrito','Itálico','Título','Lista','Tarefa','Citação','Link','Código']) {
    await expect(bar.getByRole('button', {name: `${label} na seleção`})).toBeVisible();
  }
  const bold = bar.getByRole('button', {name:'Negrito na seleção'});
  await expect(bold).toHaveAttribute('data-tooltip','Negrito');
  await expect(bold).not.toHaveAttribute('title',/.+/);
  await bold.hover();
  const hint = page.getByRole('tooltip');
  await expect(hint).toContainText('Negrito');
  await expect(hint).toContainText(/Ctrl|⌘/);
});

test('selected text glows without reflow; reduced motion makes the energy static', async ({page}) => {
  await editorReady(page);
  await page.getByRole('button',{name:'Ferramentas e ações',exact:true}).click();
  await page.getByRole('button',{name:'Acrílico',exact:true}).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog',{name:'Ferramentas e ações'})).not.toBeVisible();
  const editor = page.getByRole('textbox', {name:'Editor Markdown em Live Preview'});
  await editor.click();
  await expect(page.locator('.pm-live-codemirror .cm-editor.cm-focused')).toBeVisible();
  await editor.focus();
  await page.keyboard.press('Control+Home');
  await page.keyboard.press('End');
  await page.keyboard.press('Shift+Home');
  const drawn = page.locator('.cm-selectionBackground').first();
  await expect(drawn).toBeVisible();
  const before = await page.locator('.pm-live-codemirror .cm-content').boundingBox();
  const style = await drawn.evaluate(el => ({ background: getComputedStyle(el).backgroundImage, animation: getComputedStyle(el).animationName }));
  expect(style.background).toContain('gradient');
  expect(style.animation).not.toBe('none');
  const after = await page.locator('.pm-live-codemirror .cm-content').boundingBox();
  expect(after).toEqual(before);
  await page.emulateMedia({reducedMotion:'reduce'});
  expect(await drawn.evaluate(el=>getComputedStyle(el).animationName)).toBe('none');
});

test('the selected Live mode keeps a blurred glass backplate and the close X stays aligned', async ({page}) => {
  await editorReady(page);
  await page.getByRole('button',{name:'Ferramentas e ações',exact:true}).click();
  await page.getByRole('button',{name:'Acrílico',exact:true}).click();
  const active=page.getByRole('button',{name:'Live Preview',exact:true});
  const idle=page.getByRole('button',{name:'Editor Markdown',exact:true});
  await idle.hover();
  for (const button of [active,idle]) {
    const result = await button.evaluate(el=>({filter:getComputedStyle(el).backdropFilter, bg:getComputedStyle(el).backgroundColor}));
    expect(result.filter).toContain('blur(');
    expect(result.bg).not.toBe('rgba(0, 0, 0, 0)');
  }
  const heading=page.locator('.pm-workspace-panel-heading h2');
  const close=page.getByRole('button',{name:'Fechar Ferramentas e ações'});
  const h=await heading.boundingBox(), b=await close.boundingBox();
  expect(Math.abs((h.y+h.height/2)-(b.y+b.height/2))).toBeLessThan(2);
});

test('the document resolves visually on navigation without changing text dimensions', async ({page}) => {
  await editorReady(page);
  const content=page.locator('.pm-live-codemirror .cm-content');
  const before=await content.boundingBox();
  await expect(page.locator('.pm-note-resolve')).toHaveCount(0);
  await page.keyboard.press('Control+p');
  await page.getByRole('combobox',{name:'Buscar arquivos'}).fill('01 - Direcao');
  await page.keyboard.press('Enter');
  await expect(page.locator('.pm-document-path')).toContainText('01 - Direcao');
  const after=await content.boundingBox();
  expect(after.width).toBe(before.width);
  expect(after.x).toBe(before.x);
});
