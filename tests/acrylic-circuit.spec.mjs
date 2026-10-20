import { test, expect } from '@playwright/test';

test('circuit material responds locally and releases its animation while idle', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.pm-note-item').first()).toBeVisible();
  await page.getByRole('button', { name: 'Ferramentas e ações', exact: true }).click();
  await page.getByRole('button', { name: 'Acrílico', exact: true }).click();
  const pane = page.locator('.pm-workspace-tools > .pm-acrylic-pane');
  await expect(pane).toHaveAttribute('data-circuit', 'true');
  await page.mouse.move(1, 1); await page.waitForTimeout(650);
  const pixels = () => pane.evaluate(c => Array.from(c.getContext('2d').getImageData(0,0,c.width,c.height).data));
  const before = await pixels();
  const sidebarPaints = await page.locator('.pm-sidebar > .pm-acrylic-pane').getAttribute('data-paints');
  const bounds = await page.locator('.pm-workspace-tools').boundingBox();
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + 100);
  await page.waitForTimeout(500);
  const after = await pixels();
  expect(after.some((value, index) => value !== before[index])).toBe(true);
  expect(await page.locator('.pm-sidebar > .pm-acrylic-pane').getAttribute('data-paints')).toBe(sidebarPaints);
  const count = await pane.getAttribute('data-paints');
  await page.waitForTimeout(400);
  expect(await pane.getAttribute('data-paints')).toBe(count);
});
