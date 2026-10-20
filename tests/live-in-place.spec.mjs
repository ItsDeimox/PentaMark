import { test, expect } from '@playwright/test';
import { ensureVisualFixtures } from './visual-fixtures.mjs';

async function open(page) {
  await ensureVisualFixtures(page,true); await page.goto('/');
  await expect(page.locator('.pm-note-item').first()).toBeVisible();
  await page.keyboard.press('Control+p'); await page.getByRole('combobox').fill('03 - Blocos');
  await page.keyboard.press('Enter'); await expect(page.locator('.pm-document-path')).toContainText('03 - Blocos');
  await expect(page.locator('.pm-quick-open')).toHaveCount(0);
}
const current = page => page.request.get('/api/note?path='+encodeURIComponent('03 - Blocos.md')).then(r=>r.json());
async function useSource(page,source){
  const original=await current(page);
  const updated=await page.request.put('/api/note?path='+encodeURIComponent('03 - Blocos.md'),{data:{content:source,baseRevision:original.revision}});
  expect(updated.ok()).toBe(true);await page.reload();await expect(page.locator('.cm-content')).toBeVisible();
  await page.keyboard.press('Control+p');await page.getByRole('combobox').fill('03 - Blocos');await page.keyboard.press('Enter');
  await expect(page.locator('.pm-document-path')).toContainText('03 - Blocos');await expect(page.locator('.pm-quick-open')).toHaveCount(0);
}

test('Live and reading share the same measured geometry for headings, callout, table and code', async ({page},info)=>{
  await page.setViewportSize({width:1920,height:1600});await open(page);
  const live=['.pm-live-heading-1','.pm-callout','.pm-live-heading-2','.pm-live-widget table','.pm-live-widget pre'];
  const reading=['.pm-preview-pane h1','.pm-preview-pane .pm-callout','.pm-preview-pane h2','.pm-preview-pane table','.pm-preview-pane pre'];
  const boxes=[];for(const selector of live)boxes.push(await page.locator(selector).first().boundingBox());
  await expect(page.locator('.pm-decode-glyphs')).toHaveCount(0);
  await page.screenshot({path:info.outputPath('live-editing.png')});
  await page.getByRole('button',{name:'Ferramentas e ações',exact:true}).click();
  await page.getByRole('button',{name:'Somente leitura',exact:true}).click();await page.keyboard.press('Escape');
  await expect(page.locator('.pm-workspace-panel')).toHaveCount(0);
  for(let i=0;i<reading.length;i++) {
    const actual=await page.locator(reading[i]).first().boundingBox();
    console.log('parity',reading[i],boxes[i],actual);
    for(const dimension of ['x','y','width','height'])expect.soft(Math.abs(actual[dimension]-boxes[i][dimension]),reading[i]+' '+dimension).toBeLessThanOrEqual(1);
  }
  await expect(page.locator('.pm-decode-glyphs')).toHaveCount(0);
  await page.screenshot({path:info.outputPath('reading-matching.png')});
});

test('callout edits rendered text in place without moving the next block, and saves undoably', async ({page}) => {
  await open(page);
  const before = await current(page);
  const paragraph = page.locator('.pm-callout p').first();
  const anchor = page.locator('.cm-line').filter({hasText:'Âncora depois do painel'});
  const geometry = await anchor.boundingBox();
  await paragraph.getByText('destaque', {exact:true}).click();
  await expect(page.getByRole('dialog', {name:'Editar bloco'})).toHaveCount(0);
  expect(Math.abs((await anchor.boundingBox()).y-geometry.y)).toBeLessThanOrEqual(1);
  await expect(paragraph).toHaveAttribute('contenteditable','true');
  await paragraph.evaluate(el => {
    const text=el.querySelector('strong').firstChild, range=document.createRange();
    range.selectNodeContents(text); const selection=getSelection(); selection.removeAllRanges(); selection.addRange(range);
  });
  await page.keyboard.insertText('ênfase');
  await page.keyboard.press('Control+s');
  await expect.poll(async()=>(await current(page)).content).toContain('**ênfase**');
  await page.keyboard.press('Control+z'); await page.keyboard.press('Control+s');
  await expect.poll(async()=>(await current(page)).content).toBe(before.content);
});

test('a table cell edits in place without changing its geometry on focus', async ({page}) => {
  await open(page);
  const cell=page.locator('.pm-live-widget td').filter({hasText:'42'});
  await cell.scrollIntoViewIfNeeded(); const before=await cell.boundingBox();
  await cell.click(); await expect(cell).toHaveAttribute('contenteditable','true');
  expect(await cell.boundingBox()).toEqual(before);
  await cell.press('Home'); await page.keyboard.press('Delete'); await page.keyboard.press('Delete'); await page.keyboard.insertText('84');
  await page.keyboard.press('Control+s');
  await expect.poll(async()=>(await current(page)).content).toContain('| Peso | 84 |');
  await page.keyboard.press('Control+z');
});

test('formatting the selected text inside a callout changes that text, not the main editor caret',async({page})=>{
  await open(page);
  const paragraph=page.locator('.pm-callout p').first();await paragraph.click();
  await paragraph.evaluate(el=>{
    const walker=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);let node;
    while(node=walker.nextNode())if(node.textContent.includes('Uma citação')) {
      const range=document.createRange();range.setStart(node,0);range.setEnd(node,3);
      const selection=getSelection();selection.removeAllRanges();selection.addRange(range);break;
    }
  });
  await page.getByRole('button',{name:'Itálico na seleção'}).click();await page.keyboard.press('Control+s');
  await expect.poll(async()=>(await current(page)).content).toContain('*Uma* citação');
});

test('code typing and callout line breaks keep their source structure',async({page})=>{
  await open(page);
  const code=page.locator('.pm-live-widget pre > code');await code.scrollIntoViewIfNeeded();
  await expect(code).toHaveAttribute('contenteditable','true');
  await code.click();await page.keyboard.press('Control+End');await expect(code).toBeFocused();await page.keyboard.insertText('\n// inline code');
  await page.keyboard.press('Control+s');
  await expect.poll(async()=>(await current(page)).content).toContain('console.log(teste);\n// inline code\n```');
});

test('replacing across an emphasis boundary does not leave dangling Markdown markers',async({page})=>{
  await open(page);
  const paragraph=page.locator('.pm-callout p').first();await paragraph.click();
  await paragraph.evaluate(el=>{
    const strong=el.querySelector('strong'),previous=strong.previousSibling;
    const range=document.createRange();range.setStart(previous,previous.textContent.indexOf('citação'));range.setEnd(strong.firstChild,strong.textContent.length);
    const selection=getSelection();selection.removeAllRanges();selection.addRange(range);
  });
  await page.keyboard.insertText('texto');await page.keyboard.press('Control+s');
  const source=(await current(page)).content;
  await expect.poll(async()=>(await current(page)).content).toContain('> Uma texto que precisa');
  expect(source).not.toContain('texto**');
});

test('undo, redo and formatting preserve the in-block caret for continued typing',async({page})=>{
  await open(page);
  const cell=page.locator('.pm-live-widget td').last();await cell.click();
  await page.keyboard.press('Control+End');await page.keyboard.insertText('7');
  await page.keyboard.press('Control+z');await expect(cell).toBeFocused();
  await page.keyboard.press('Control+Shift+Z');await expect(cell).toBeFocused();
  await page.keyboard.insertText('8');await page.keyboard.press('Control+s');
  await expect.poll(async()=>(await current(page)).content).toContain('| Peso | 4278 |');
  await page.keyboard.press('Control+a');await page.keyboard.press('Control+b');
  await expect(cell).toBeFocused();await page.keyboard.press('ArrowRight');await page.keyboard.insertText('9');
  await page.keyboard.press('Control+s');
  await expect.poll(async()=>(await current(page)).content).toContain('| Peso | **42789** |');
});

test('an empty fenced block accepts text without absorbing its closing fence',async({page})=>{
  await open(page);
  const original=await current(page);
  await page.request.put('/api/note?path='+encodeURIComponent('03 - Blocos.md'),{data:{content:'# Empty\n\n```\n```\n\n## After\n',baseRevision:original.revision}});
  await expect(page.locator('.pm-live-widget pre > code')).toHaveText('');
  const code=page.locator('.pm-live-widget pre > code');await code.click();await page.keyboard.insertText('x');await page.keyboard.press('Control+s');
  await expect.poll(async()=>(await current(page)).content).toContain('```\nx\n```\n\n## After');
});

test('another client moving its cursor leaves the focused table cell intact',async({page})=>{
  await open(page);
  await page.evaluate(()=>new Promise((resolve,reject)=>{
    window.__presenceEvents=0;
    window.__otherEditor=new EventSource('/api/events?clientId=inline-peer&name=InlinePeer');
    window.__otherEditor.addEventListener('presence',()=>window.__presenceEvents++);
    window.__otherEditor.onopen=resolve;window.__otherEditor.onerror=reject;
  }));
  const cell=page.locator('.pm-live-widget td').last();await cell.click();
  const original=await cell.elementHandle();
  const before=await page.evaluate(()=>window.__presenceEvents);
  const result=await page.request.post('/api/presence',{data:{clientId:'inline-peer',name:'InlinePeer',path:'03 - Blocos.md',mode:'live',editing:true,cursor:100,selectionEnd:100}});
  expect(result.ok()).toBe(true);
  await expect.poll(()=>page.evaluate(()=>window.__presenceEvents)).toBeGreaterThan(before);
  await expect(cell).toBeFocused();expect(await cell.evaluate((node,old)=>node===old,original)).toBe(true);
  await page.keyboard.press('Control+End');await page.keyboard.insertText('7');await page.keyboard.press('Control+s');
  await expect.poll(async()=>(await current(page)).content).toContain('| Peso | 427 |');
  await page.evaluate(()=>window.__otherEditor.close());
});

test('editing repeated link labels never modifies a hidden link destination',async({page})=>{
  await open(page);await useSource(page,'# Mapping\n\n> [!note] Title\n> [x](x)**x**\n');
  const strong=page.locator('.pm-callout strong');await strong.click();
  await strong.evaluate(el=>{const range=document.createRange();range.selectNodeContents(el);getSelection().removeAllRanges();getSelection().addRange(range);});
  await page.keyboard.insertText('Y');await page.keyboard.press('Control+s');
  await expect.poll(async()=>(await current(page)).content).toContain('> [x](x)**Y**');
});

test('editing a padded empty table cell does not touch the next row',async({page})=>{
  await open(page);await useSource(page,'# Short rows\n\n| A | B |\n| --- | --- |\n| a |\n| b | c |\n');
  await page.locator('.pm-live-widget td').nth(1).click();await page.keyboard.insertText('new');await page.keyboard.press('Control+s');
  await expect.poll(async()=>(await current(page)).content).toContain('| a | new |\n| b | c |');
});

test('multiline cell input can be followed by more typing',async({page})=>{
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await open(page);await useSource(page,'# Cell breaks\n\n| A | B |\n| --- | --- |\n| ab | tail |\n');
  const cell=page.locator('.pm-live-widget td').first();await cell.click();await page.keyboard.press('Control+a');
  await page.keyboard.insertText('a\nb');await page.keyboard.insertText('c');await page.keyboard.press('Control+s');
  await expect.poll(async()=>(await current(page)).content).toContain('| a<br>bc | tail |');expect(errors).toEqual([]);
});

test('joining callout lines removes the hidden continuation prefix too',async({page})=>{
  await open(page);await useSource(page,'# Quote join\n\n> [!note] Title\n> body\n');
  const paragraph=page.locator('.pm-callout p');await paragraph.click();
  await paragraph.evaluate(el=>{const walker=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);let node;while(node=walker.nextNode())if(node.textContent.includes('body')){getSelection().collapse(node,node.textContent.indexOf('body'));break;}});
  await page.keyboard.press('Backspace');await page.keyboard.press('Control+s');
  await expect.poll(async()=>(await current(page)).content).toContain('> [!note] Titlebody\n');
});

test('ordinary multiline quotes and their following heading match reading geometry',async({page})=>{
  await open(page);await useSource(page,'# Quotes\n\n> first line\n> second line\n\n## After quote\n');
  const live=await page.locator('.pm-live-heading-2').boundingBox();
  await page.getByRole('button',{name:'Ferramentas e ações',exact:true}).click();await page.getByRole('button',{name:'Somente leitura',exact:true}).click();await page.keyboard.press('Escape');
  const reading=await page.locator('.pm-preview-pane h2').boundingBox();
  expect(Math.abs(reading.y-live.y)).toBeLessThanOrEqual(1);
});

test('undoing an edit above the focused widget keeps the same cell ready for typing',async({page})=>{
  await open(page);
  const editor=page.getByRole('textbox',{name:'Editor Markdown em Live Preview'});
  await editor.focus();await page.keyboard.press('Control+Home');await page.keyboard.insertText('prefix\n\n');
  const cell=page.locator('.pm-live-widget td').last();await cell.click();await page.keyboard.press('Control+End');
  await page.keyboard.press('Control+z');await expect(cell).toBeFocused();
  await page.keyboard.insertText('Z');await page.keyboard.press('Control+s');
  await expect.poll(async()=>(await current(page)).content).toContain('| Peso | 42Z |');
  expect((await current(page)).content).not.toContain('prefix');
});

for (const scale of [1,1.25,1.5]) test(`drag selection follows glyph boundaries at scale ${scale}`, async ({page}) => {
  await page.goto('/'); await expect(page.locator('.cm-content')).toBeVisible();
  await page.locator('.pm-shell').evaluate((el, scale)=>{el.style.zoom=String(scale);el.style.width=`${100/scale}vw`;el.style.height=`${100/scale}vh`;},scale);
  const line=page.locator('.cm-line').filter({hasText:'Um espaço'}).first();
  // Select the middle word, using its real glyph bounds rather than font estimates.
  const points=await line.evaluate(el=>{
    const w=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);let n;
    while(n=w.nextNode()) if(n.textContent.startsWith('Um espaço')) {
      const r=document.createRange();r.setStart(n,3);r.setEnd(n,9);const b=r.getBoundingClientRect();
      return {x:b.x,y:b.y+b.height/2,end:b.right};
    }
    throw new Error('Fixture paragraph missing');
  });
  await page.mouse.move(points.x+.2,points.y); await page.mouse.down();
  await page.mouse.move(points.end-.2,points.y,{steps:8});await page.mouse.up();
  expect(await page.evaluate(()=>getSelection().toString())).toBe('espaço');
  const rect=await page.locator('.cm-selectionBackground').first().boundingBox();
  expect(Math.abs(rect.x-points.x)).toBeLessThan(2);
  expect(Math.abs(rect.width-(points.end-points.x))).toBeLessThan(2);
});
