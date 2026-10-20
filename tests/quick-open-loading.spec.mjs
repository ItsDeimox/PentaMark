import { test, expect } from '@playwright/test';

test('quick open waits for the vault index before accepting keyboard input', async ({page}) => {
  let release;
  const gate = new Promise(resolve => release=resolve);
  await page.route('**/api/state', async route => { await gate; await route.continue(); });
  await page.goto('/');
  await page.getByRole('button',{name:'Abrir arquivo',exact:true}).click();
  const input=page.getByRole('combobox',{name:'Buscar arquivos'});
  try { await expect(input).toBeDisabled(); } finally { release(); }
  await expect(input).toBeEnabled();
  await expect(input).toBeFocused();
  await input.fill('Direcao');
  await page.keyboard.press('Enter');
  await expect(page.locator('.pm-document-path')).toContainText('01 - Direcao');
});
