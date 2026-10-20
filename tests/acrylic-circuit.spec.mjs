import { test, expect } from '@playwright/test';

test('optical coating responds locally and releases its animation while idle', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.pm-note-item').first()).toBeVisible();
  await page.getByRole('button', { name: 'Ferramentas e ações', exact: true }).click();
  await page.getByRole('button', { name: 'Acrílico', exact: true }).click();
  const pane = page.locator('.pm-workspace-tools > .pm-acrylic-pane');
  await expect(pane).toBeVisible();
  await page.mouse.move(1, 1); await page.waitForTimeout(650);
  // Keep the complete baseline in the page: serializing millions of byte
  // values through the test protocol costs more than rendering the effect.
  await pane.evaluate(c => { window.coatingBaseline = c.getContext('2d').getImageData(0,0,c.width,c.height).data; });
  const sidebarPaints = await page.locator('.pm-sidebar > .pm-acrylic-pane').getAttribute('data-paints');
  const bounds = await page.locator('.pm-workspace-tools').boundingBox();
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + 100);
  await page.waitForTimeout(500);
  const changed = await pane.evaluate(c => {
    const after = c.getContext('2d').getImageData(0,0,c.width,c.height).data;
    const before = window.coatingBaseline;
    const result = { sameSize:after.length===before.length, changed:after.some((value,index)=>value!==before[index]) };
    delete window.coatingBaseline;
    return result;
  });
  expect(changed.sameSize).toBe(true);
  expect(changed.changed).toBe(true);
  expect(await page.locator('.pm-sidebar > .pm-acrylic-pane').getAttribute('data-paints')).toBe(sidebarPaints);
  const count = await pane.getAttribute('data-paints');
  await page.waitForTimeout(400);
  expect(await pane.getAttribute('data-paints')).toBe(count);
});
