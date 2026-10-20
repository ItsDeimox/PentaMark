import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';

async function ready(page, theme = 'pentagory', graphicsMode = 'flat') {
  await page.addInitScript(({ theme, graphicsMode }) => {
    localStorage.setItem('pentamark:appearance', JSON.stringify({ theme, graphicsMode, graphicsPreset:'custom', backgroundMotion:false, backgroundHover:false, interfaceMotion:true, refraction:graphicsMode==='acrylic' }));
  }, { theme, graphicsMode });
  await page.goto('/');
  await expect(page.getByRole('textbox', { name: 'Editor Markdown em Live Preview' })).toBeVisible();
}

async function settings(page) {
  await page.getByRole('button', { name: 'Ferramentas e ações', exact: true }).click();
  await page.getByRole('button', { name: 'Configurações', exact: true }).click();
  const dialog=page.getByRole('dialog', { name: 'Configurações', exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute('data-entered', 'true');
  // The form animates inside the top-layer dialog, after its autofocus frame.
  await expect.poll(()=>dialog.locator('.pm-dialog').evaluate(el=>el.getAnimations().some(animation=>animation.playState==='running'))).toBe(false);
  return dialog;
}

for (const graphics of ['flat', 'acrylic']) {
  for (const theme of ['pentagory', 'eclipse', 'ember', 'terminal', 'pearl']) {
    test(`${theme}/${graphics}: settings checkbox keeps its size, themed check and keyboard focus`, async ({ page }) => {
      await ready(page, theme, graphics);
      const dialog = await settings(page);
      await dialog.getByRole('tab', { name:'Gráficos', exact:true }).click();
      const box = dialog.getByRole('checkbox', { name: 'Animações de fundo', exact: true });
      const geometry = await box.boundingBox();
      await expect(box).not.toBeChecked();
      expect(await box.evaluate(el => getComputedStyle(el).appearance)).toBe('none');
      await box.focus();
      await page.keyboard.press('Shift+Tab');
      await page.keyboard.press('Tab');
      await expect(box).toBeFocused();
      await page.keyboard.press('Space');
      await expect(box).toBeChecked();
      await expect.poll(() => box.evaluate(el => getComputedStyle(el).backgroundColor)).toBe(await box.evaluate(el => {
        const swatch = document.createElement('i'); swatch.style.backgroundColor = 'var(--pm-cyan)';
        el.parentElement.append(swatch); const color = getComputedStyle(swatch).backgroundColor; swatch.remove(); return color;
      }));
      const styles = await box.evaluate(el => {
        const s = getComputedStyle(el), mark = getComputedStyle(el, '::after');
        const swatch = document.createElement('i');
        swatch.style.backgroundColor = 'var(--pm-cyan)'; el.parentElement.append(swatch);
        const accent = getComputedStyle(swatch).backgroundColor; swatch.remove();
        return { fill: s.backgroundColor, accent, outline: s.outlineStyle, mark: mark.opacity };
      });
      expect(styles.fill).toBe(styles.accent);
      expect(styles.mark).toBe('1');
      expect(styles.outline).toBe('solid');
      const after = await box.boundingBox();
      expect(after.width).toBe(geometry.width);
      expect(after.height).toBe(geometry.height);
      await page.keyboard.press('Space');
      await expect(box).not.toBeChecked();
    });
  }
}

test('task and Kanban inputs share the themed paint without changing task gutters', async ({ page }) => {
  await ready(page, 'ember', 'flat');
  const name = `Controls-${randomUUID()}`;
  const response = await page.request.post('/api/note', { data: {
    path: `${name}.md`,
    content: '# Controls\n\n- [ ] Keyboard task\n- [x] Finished task\n\n```kanban horizontal\n## Ideas\n- [ ] Keyboard card\n```\n',
  } });
  expect(response.ok(), await response.text()).toBe(true);
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'Editor Markdown em Live Preview' })).toBeVisible();
  await page.keyboard.press('Control+p');
  await page.getByRole('combobox', { name: 'Buscar arquivos' }).fill(name);
  await page.keyboard.press('Enter');
  await expect(page.locator('.pm-document-path')).toContainText(name);
  await expect(page.locator('.pm-quick-open')).toHaveCount(0);
  const task = page.locator('.pm-live-task-checkbox').first();
  const gutter = () => task.evaluate(el => {
    const box = el.getBoundingClientRect(), line = el.closest('.cm-line').getBoundingClientRect();
    return { width: box.width, height: box.height, gutter: box.left - line.left };
  });
  const before = await gutter();
  expect(await task.evaluate(el => getComputedStyle(el).appearance)).toBe('none');
  await task.focus(); await page.keyboard.press('Space');
  await expect(task).toBeChecked();
  expect(await gutter()).toEqual(before);
  const card = page.locator('.pm-kanban-card input[type="checkbox"]').first();
  expect(await card.evaluate(el => getComputedStyle(el).appearance)).toBe('none');
  await card.check(); await expect(card).toBeChecked();
  await page.locator('[data-pm-kanban-action="edit-card"]').first().click();
  const dialogBox = page.getByRole('checkbox', { name: 'Cartão com checkbox', exact: true });
  await expect(dialogBox).toBeChecked();
  expect(await dialogBox.evaluate(el => getComputedStyle(el).appearance)).toBe('none');
  await dialogBox.focus(); await page.keyboard.press('Space');
  await expect(dialogBox).not.toBeChecked();
});

test('themed select and range retain keyboard selection and value updates', async ({ page }) => {
  await ready(page, 'pearl', 'acrylic');
  const dialog = await settings(page);
  await dialog.getByRole('tab', { name: 'Tipografia', exact: true }).click();
  const select = dialog.getByRole('combobox', { name: 'Fonte da interface', exact: true });
  expect(await select.evaluate(el => getComputedStyle(el).appearance)).toBe('none');
  expect(await select.evaluate(el => getComputedStyle(el).backgroundImage)).toContain('linear-gradient');
  await select.focus();
  await page.keyboard.press('m');
  await page.keyboard.press('Enter');
  await expect(select).toHaveValue('modern');
  const range = dialog.getByRole('slider', { name: 'Tamanho do editor', exact: true });
  expect(await range.evaluate(el => getComputedStyle(el).appearance)).toBe('none');
  const before = Number(await range.inputValue());
  await range.focus(); await page.keyboard.press('ArrowRight');
  await expect(range).toHaveValue(String(before + 1));
  await expect(dialog.locator('.pm-range-field').filter({
    has: page.getByRole('slider', { name: 'Tamanho do editor', exact: true }),
  }).locator('output')).toHaveText(`${before + 1}px`);
  await expect(range).toBeFocused();
  expect(await range.evaluate(el => getComputedStyle(el).outlineStyle)).toBe('solid');
});

test('mixed and disabled checkboxes and radio inputs keep native state semantics', async ({ page }) => {
  await ready(page);
  const dialog = await settings(page);
  // Exercise reusable control rules for states with no current settings example.
  await dialog.evaluate(el => {
    const field = document.createElement('div'); field.className = 'pm-field-grid';
    for (const [type, name, disabled] of [['checkbox', 'Mixed', false], ['checkbox', 'Unavailable', true], ['radio', 'First', false], ['radio', 'Second', false]]) {
      const label = document.createElement('label'), input = document.createElement('input');
      input.type = type; input.name = type; input.disabled = disabled;
      if (name === 'Mixed') input.indeterminate = true;
      label.append(input, name); field.append(label);
    }
    el.querySelector('.pm-dialog-body').prepend(field);
  });
  const mixed = dialog.getByRole('checkbox', { name: 'Mixed', exact: true });
  await expect(mixed).toBeChecked({ indeterminate: true });
  expect(await mixed.evaluate(el => getComputedStyle(el, '::after').borderBottomWidth)).toBe('2px');
  await mixed.focus(); await page.keyboard.press('Space');
  await expect(mixed).toBeChecked();
  expect(await mixed.evaluate(el => el.indeterminate)).toBe(false);
  const disabled = dialog.getByRole('checkbox', { name: 'Unavailable', exact: true });
  await expect(disabled).toBeDisabled();
  expect(await disabled.evaluate(el => getComputedStyle(el).cursor)).toBe('not-allowed');
  const first = dialog.getByRole('radio', { name: 'First', exact: true });
  const second = dialog.getByRole('radio', { name: 'Second', exact: true });
  // Unselected native groups match :indeterminate, but must not look selected.
  await expect(first).not.toBeChecked();
  expect(await first.evaluate(el => getComputedStyle(el, '::after').opacity)).toBe('0');
  expect(await first.evaluate(el => {
    const mark = getComputedStyle(el, '::after');
    return { width: mark.width, height: mark.height, border: mark.borderBottomWidth, radius: mark.borderRadius };
  })).toEqual({ width: '6px', height: '6px', border: '0px', radius: '50%' });
  await first.check(); await first.focus(); await page.keyboard.press('ArrowRight');
  await expect(second).toBeChecked();
  await expect(second).toBeFocused();
  expect(await second.evaluate(el => getComputedStyle(el).outlineStyle)).toBe('solid');
  expect(await second.evaluate(el => getComputedStyle(el, '::after').opacity)).toBe('1');
  await expect(first).not.toBeChecked();
  expect(await first.evaluate(el => getComputedStyle(el).appearance)).toBe('none');
});

for (const graphics of ['flat', 'acrylic']) {
  test(`${graphics}: right panel reveals from the right without vertical movement and closes before unmounting`, async ({ page }) => {
    await ready(page, 'pentagory', graphics);
    const samples = await page.evaluate(() => new Promise(resolve => {
      document.querySelector('[aria-label="Ferramentas e ações"]').click();
      const rows = [], start = performance.now();
      const sample = now => {
        const panel = document.querySelector('.pm-workspace-panel');
        if (panel) {
          const r = panel.getBoundingClientRect(), css = getComputedStyle(panel);
          const inside = x => panel.contains(document.elementFromPoint(x, r.top + Math.min(80, r.height / 2)));
          const matrix = new DOMMatrix(css.transform);
          rows.push({ reveal: Number(panel.dataset.reveal), right: inside(r.right - 18), left: inside(r.left + 18), y: matrix.m42, scaleX: matrix.m11, scaleY: matrix.m22 });
        }
        if (rows.at(-1)?.reveal !== 1 && now - start < 2000) requestAnimationFrame(sample); else resolve(rows);
      };
      requestAnimationFrame(sample);
    }));
    expect(samples.some(s => s.right && !s.left)).toBe(true);
    expect(samples.every(s => s.y === 0)).toBe(true);
    expect(samples.every(s => s.scaleX === 1 && s.scaleY === 1)).toBe(true);
    expect(samples.at(-1).reveal).toBe(1);
    const panel = page.getByRole('dialog', { name: 'Ferramentas e ações', exact: true });
    const closing = await panel.evaluate(el => new Promise(resolve => {
      el.querySelector('header button').click();
      requestAnimationFrame(() => requestAnimationFrame(() => resolve({ attached: el.isConnected, inert: el.inert, reveal: Number(el.dataset.reveal) })));
    }));
    expect(closing.attached).toBe(true); expect(closing.inert).toBe(true);
    expect(closing.reveal).toBeLessThan(1);
    await expect(page.locator('.pm-workspace-panel')).toHaveCount(0);
  });
}

test('rapid panel reversal finishes open and Escape restores its trigger focus', async ({ page }) => {
  await ready(page, 'pentagory', 'acrylic');
  const trigger = page.getByRole('button', { name: 'Ferramentas e ações', exact: true });
  await trigger.focus();
  const continuity = await page.evaluate(() => new Promise(resolve => {
    document.querySelector('[aria-label="Ferramentas e ações"]').click();
    const start = performance.now();
    const tick = () => {
      const panel = document.querySelector('.pm-workspace-panel'), value = Number(panel?.dataset.reveal);
      if (performance.now() - start > 1500) { resolve({ before: -1, after: -1, same: false }); return; }
      if (!panel || value < .2 || value > .8) { requestAnimationFrame(tick); return; }
      panel.querySelector('header button').click();
      requestAnimationFrame(() => {
        const before = Number(panel.dataset.reveal);
        document.querySelector('[aria-label="Ferramentas e ações"]').click();
        requestAnimationFrame(() => resolve({ before, after: Number(panel.dataset.reveal), same: panel === document.querySelector('.pm-workspace-panel') }));
      });
    };
    requestAnimationFrame(tick);
  }));
  expect(continuity.same).toBe(true);
  expect(Math.abs(continuity.after - continuity.before)).toBeLessThan(.2);
  const panel = page.locator('.pm-workspace-panel');
  await expect(panel).toHaveAttribute('data-reveal', '1');
  await expect(panel).not.toHaveAttribute('inert');
  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0); await expect(trigger).toBeFocused();
});

test('reduced motion opens completely and removes the closed panel immediately', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await ready(page);
  await page.getByRole('button', { name: 'Ferramentas e ações', exact: true }).click();
  const panel = page.locator('.pm-workspace-panel');
  await expect(panel).toHaveAttribute('data-reveal', '1');
  await expect(panel).not.toHaveAttribute('data-fragmenting');
  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);
});
