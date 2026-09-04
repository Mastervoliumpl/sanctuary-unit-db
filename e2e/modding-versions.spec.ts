import { expect, test } from '@playwright/test';

test('version selection preserves a document and reports a missing-document fallback', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/modding');
  const originalId = await page.getByLabel('Documentation version').inputValue();
  await page.goto(`/modding/${originalId}/lua/overview`);
  await page.getByLabel('Documentation version').selectOption('test-snapshot-1');
  await expect(page).toHaveURL(/\/modding\/test-snapshot-1\/lua\/overview$/);
  await expect(page.getByRole('heading', { name: 'Test Lua overview' })).toBeVisible();
  await expect(page.getByRole('status')).toHaveCount(0);

  await page.getByLabel('Documentation version').selectOption(originalId);
  await expect(page).toHaveURL(new RegExp(`/modding/${originalId}/lua/overview$`));
  await expect(page.getByRole('heading', { name: 'Lua runtime, APIs, and templates' })).toBeVisible();
  await page
    .locator('.docs-nav')
    .getByRole('link', { name: /Managed code/ })
    .click();
  await expect(page).toHaveURL(new RegExp(`/modding/${originalId}/managed$`));
  await expect(page.getByRole('heading', { name: 'Managed code and DLL loading' })).toBeVisible();
  await page.getByLabel('Documentation version').selectOption('test-snapshot-1');
  await expect(page).toHaveURL(/\/modding\/test-snapshot-1\/start\?versionFallback=managed$/);
  await expect(page.getByRole('heading', { name: 'Test snapshot start' })).toBeVisible();
  await expect(page.getByRole('status')).toContainText('does not contain managed');
  await page.reload();
  await expect(page.getByRole('status')).toContainText('does not contain managed');
  expect(errors).toEqual([]);
});
