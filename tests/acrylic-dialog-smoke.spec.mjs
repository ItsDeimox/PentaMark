import { test, expect } from '@playwright/test';

test('MCP has a direct entry and a labeled dialog without changing bridge state', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.pm-note-item').first()).toBeVisible();
  const before = await (await page.request.get('/api/config')).json();
  await page.getByRole('button', { name: 'Ferramentas e ações', exact: true }).click();
  await page.getByRole('button', { name: 'Ponte MCP', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Ponte MCP', exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('Token da ponte')).toHaveAttribute('type', 'password');
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  expect((await (await page.request.get('/api/config')).json()).aiBridgeEnabled).toBe(before.aiBridgeEnabled);
});

test('settings offer appearance and typography categories', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.pm-note-item').first()).toBeVisible();
  await page.getByRole('button', { name: 'Ferramentas e ações', exact: true }).click();
  await page.getByRole('button', { name: 'Configurações', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Configurações', exact: true });
  await expect(dialog.getByRole('tab', { name: 'Aparência', exact: true })).toBeVisible();
  await dialog.getByRole('tab', { name: 'Tipografia', exact: true }).click();
  await expect(dialog.getByLabel('Fonte da interface', { exact: true })).toBeVisible();
});
