import {test,expect} from '@playwright/test';

async function ready(page) {
  await page.goto('/');
  await expect(page.getByRole('textbox',{name:'Editor Markdown em Live Preview'})).toBeVisible();
  await expect(page.locator('.pm-note-item').first()).toBeAttached();
}

test('Ctrl+F opens cofre search and leaves Ctrl+P as a backward-compatible alias', async ({page}) => {
  await ready(page);
  await expect(page.getByRole('button',{name:'Abrir arquivo',exact:true})).toContainText('Ctrl F');
  await page.keyboard.press('Control+f');
  await expect(page.getByRole('combobox',{name:'Buscar arquivos'})).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog',{name:'Abrir arquivo'})).not.toBeVisible();
  await page.keyboard.press('Control+p');
  await expect(page.getByRole('combobox',{name:'Buscar arquivos'})).toBeFocused();
});

test('right-click note has hover submenu to copy relative path, absolute only on Desktop',async({page})=>{
  await page.addInitScript(()=>{
    window.__clipboard='';
    Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async value=>{window.__clipboard=value;}}});
  });
  await ready(page);
  const note=page.locator('.pm-note-item').first();
  const fullPath=await note.getAttribute('title');
  await note.click({button:'right'});
  const trigger=page.getByRole('button',{name:'Copiar caminho',exact:true});
  await expect(trigger).toBeVisible();
  await trigger.hover();
  const menu=page.getByRole('menu',{name:'Copiar caminho'});
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('menuitem',{name:'Copiar caminho absoluto'})).toBeDisabled();
  await menu.getByRole('menuitem',{name:'Copiar caminho relativo'}).click();
  await expect(menu).not.toBeVisible();
  expect(await page.evaluate(()=>window.__clipboard)).toBe(fullPath?.split(' — ')[0]);
});

test('file context submenu is keyboard-accessible and flips inward at the right viewport edge',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await ready(page);
  await page.getByRole('button',{name:'Mostrar ou ocultar arquivos',exact:true}).click();
  const note=page.locator('.pm-note-item').first();
  await expect(note).toBeVisible();
  await note.click({button:'right'});
  const trigger=page.getByRole('button',{name:'Copiar caminho',exact:true});
  await trigger.focus();await page.keyboard.press('ArrowRight');
  const menu=page.getByRole('menu',{name:'Copiar caminho'});
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('menuitem',{name:'Copiar caminho relativo'})).toBeFocused();
  const rect=await menu.boundingBox();
  expect(rect.x).toBeGreaterThanOrEqual(0);
  expect(rect.x+rect.width).toBeLessThanOrEqual(391);
  await page.keyboard.press('ArrowLeft');
  await expect(trigger).toBeFocused();
});

test('Cortex character decode preserves the actual document and settles after navigating',async({page})=>{
  await ready(page);
  // The editor shell is mounted before the asynchronous note arrives.
  await expect(page.locator('.pm-live-codemirror .cm-content')).toContainText('Visão Geral do Projeto');
  const original=await page.locator('.pm-live-codemirror .cm-content').innerText();
  await page.keyboard.press('Control+f');
  await page.getByRole('combobox').fill('01 - Direcao');
  await page.keyboard.press('Enter');
  await expect(page.locator('.pm-document-path')).toContainText('01 - Direcao');
  const reveal=page.locator('.pm-decode-glyphs');
  await expect(reveal.first()).toBeAttached({timeout:1500});
  expect(await page.locator('.pm-live-codemirror .cm-content').innerText()).not.toBe('');
  await page.waitForTimeout(700);
  await expect(reveal).toHaveCount(0);
  await page.keyboard.press('Control+f');
  await page.getByRole('combobox').fill('00 - Visao Geral');
  await page.keyboard.press('Enter');
  await expect(page.locator('.pm-document-path')).toContainText('00 - Visao Geral');
  await page.waitForTimeout(700);
  expect(await page.locator('.pm-live-codemirror .cm-content').innerText()).toBe(original);
  await expect(page.locator('.pm-note-resolve')).toHaveCount(0);
});

test('reduced motion skips scrambling and document never writes fake glyphs',async({page})=>{
  await page.emulateMedia({reducedMotion:'reduce'});await ready(page);
  await page.keyboard.press('Control+f');
  await page.getByRole('combobox').fill('01 - Direcao');
  await page.keyboard.press('Enter');
  await expect(page.locator('.pm-document-path')).toContainText('01 - Direcao');
  await expect(page.locator('.pm-decode-glyphs')).toHaveCount(0);
  await expect(page.locator('.pm-live-codemirror .cm-content')).toContainText('Direção');
});

test('selected Live and nonselected modes have background blur without blue theme bleed',async({page})=>{
  await ready(page);
  await page.getByRole('button',{name:'Ferramentas e ações',exact:true}).click();
  await page.getByRole('button',{name:'Acrílico',exact:true}).click();
  const selected=page.getByRole('button',{name:'Live Preview',exact:true});
  const unselected=page.getByRole('button',{name:'Editor Markdown',exact:true});
  for(const button of [selected,unselected]){
    expect(await button.evaluate(el=>getComputedStyle(el).backdropFilter)).toContain('blur(');
  }
  await page.getByRole('button',{name:'Configurações',exact:true}).click();
  await page.getByRole('button',{name:'Ember',exact:true}).click();
  await page.getByRole('button',{name:'Cancelar',exact:true}).click();
});

test('text column stays centered in workspace and the acrylic selection bar has no circuit canvas',async({page})=>{
  await ready(page);
  const center = async () => page.evaluate(()=>{
    const a=document.querySelector('.pm-live-codemirror .cm-content').getBoundingClientRect();
    const w=document.querySelector('.pm-workspace').getBoundingClientRect();
    return Math.abs((a.left+a.right-w.left-w.right)/2);
  });
  expect(await center()).toBeLessThanOrEqual(2);
  await page.getByRole('button',{name:'Ferramentas e ações',exact:true}).click();
  await page.getByRole('button',{name:'Acrílico',exact:true}).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog',{name:'Ferramentas e ações'})).not.toBeVisible();
  const editor=page.getByRole('textbox',{name:'Editor Markdown em Live Preview'});
  await editor.click();
  await expect(page.locator('.pm-live-codemirror .cm-editor.cm-focused')).toBeVisible();
  await editor.focus();
  await page.keyboard.press('Control+Home');
  await page.keyboard.press('End');
  await page.keyboard.press('Shift+Home');
  await expect(page.getByRole('toolbar',{name:'Formatação da seleção'})).toBeVisible();
  await expect(page.locator('.pm-selection-tools .pm-acrylic-pane')).toHaveCount(0);
  expect(await center()).toBeLessThanOrEqual(2);
});

test('hover material remains on the clicked file, not at the brand',async({page})=>{
  await ready(page);
  await page.getByRole('button',{name:'Ferramentas e ações',exact:true}).click();
  await page.getByRole('button',{name:'Acrílico',exact:true}).click();
  await page.keyboard.press('Escape');
  const note=page.locator('.pm-note-item').first();
  await note.hover();await page.waitForTimeout(230);
  await note.click();await page.waitForTimeout(240);
  const material=note.locator(':scope > .pm-acrylic-pane');
  await expect(material).toHaveCount(1);
  const row=await note.boundingBox(),glass=await material.boundingBox();
  expect(glass.y).toBeGreaterThanOrEqual(row.y-2);
  expect(glass.y+glass.height).toBeLessThanOrEqual(row.y+row.height+2);
});
