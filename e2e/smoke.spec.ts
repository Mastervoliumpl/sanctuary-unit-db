import { expect, test, type Page } from '@playwright/test';

// Hydration/runtime smoke over the built static output — the unit tests cover
// the logic, this covers "the site actually works in a browser": data loads,
// the board renders, the detail panel opens, the calculator computes, and
// nothing throws on the way.

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`);
  });
  return errors;
}

test('unit board renders, filters via URL, and opens the detail panel', async ({ page }) => {
  const errors = collectErrors(page);

  await page.goto('/');
  await expect(page.locator('.toolbar span')).toContainText(/of \d+ units/);
  expect(await page.locator('.card').count()).toBeGreaterThan(50);

  // Legacy URL format still filters.
  await page.goto('/?faction=EDA&tier=2&sort=dps');
  await expect(page.locator('.col-head')).toHaveCount(1);

  // Card click opens the detail and writes the unit into the URL.
  await page.locator('.card').first().click();
  await expect(page.locator('.detail h2')).not.toBeEmpty();
  expect(page.url()).toContain('unit=');

  // Escape closes it again.
  await page.keyboard.press('Escape');
  await expect(page.locator('.detail')).toHaveCount(0);

  expect(errors).toEqual([]);
});

test('calculator restores a shared setup and computes the documented example', async ({ page }) => {
  const errors = collectErrors(page);

  // The README's worked example: T3 Land Factory, T3 Engineer + 2 T2 Engineers
  // = 40 build power -> 1 m 45 s.
  await page.goto('/calculator?t=ues3511&p=uel3501&a=uel2501:2');
  await expect(page.locator('.select-btn')).toContainText('Land Factory');
  await expect(page.locator('.calc-rail')).toContainText('1 m 45 s');
  await expect(page.locator('.calc-rail')).toContainText('40 (20+20)');

  // Copy link pins the derived defaults (builder, economy prefill) into the
  // URL so the shared setup can't drift under a future data update.
  await page.getByRole('button', { name: 'Copy link' }).click();
  await page.waitForURL(/p=uel3501/);
  expect(page.url()).toContain('t=ues3511');
  expect(page.url()).toContain('e=');

  expect(errors).toEqual([]);
});
