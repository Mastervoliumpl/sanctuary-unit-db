import { expect, test, type Page } from '@playwright/test';

// Hydration/runtime smoke over the built static output — the unit tests cover
// the logic, this covers "the site actually works in a browser": data loads,
// the board renders, the detail panel opens, the calculator computes, and
// nothing throws on the way.

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    // The Vercel Analytics/Speed Insights scripts only exist on Vercel, so
    // their 404s under the static test server are expected noise.
    if (m.type() === 'error' && !m.location().url.includes('/_vercel/')) {
      errors.push(`console: ${m.text()}`);
    }
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

test('maps listing renders cards and opens a map page by slug', async ({ page }) => {
  const errors = collectErrors(page);

  await page.goto('/maps');
  // The listing loads its manifest client-side, so wait for the first card
  // before counting — count() does not retry.
  await expect(page.locator('.map-card').first()).toBeVisible();
  expect(await page.locator('.map-card').count()).toBeGreaterThan(10);
  await expect(page.locator('.install-path code')).toContainText('Sanctuary_Data\\Maps');

  // Each map has a shareable ?m=<slug> address with its own stats and zip.
  await page.goto('/maps?m=seton-s-clutch');
  await expect(page.locator('.map-detail h1')).toHaveText("Seton's Clutch");
  await expect(page.locator('.map-detail')).toContainText('8');
  await expect(page.locator('.dl-btn')).toHaveAttribute('href', /releases\/download\/map-seton-s-clutch\//);

  expect(errors).toEqual([]);
});

test('ladder and play pages render their shells with no backend', async ({ page }) => {
  // e2e serves the static build — no server functions exist here, so this
  // pins the degradation contract: both pages must render signed-out/empty
  // instead of crashing. (No console-error assertion: the fetches 404 by
  // design in this environment, and the browser logs that itself.)
  await page.goto('/ladder');
  await expect(page.locator('.mode-tabs')).toBeVisible();
  await expect(page.locator('.map-pool li').first()).toBeVisible();
  await expect(page.locator('.results .empty')).toContainText("isn't reachable");

  await page.goto('/play');
  await expect(page.locator('.queue-card')).toHaveCount(3);
  await expect(page.locator('.play-signin')).toContainText('Sign in through Steam');
});

test('calculator restores a shared setup and computes the documented example', async ({ page }) => {
  const errors = collectErrors(page);

  // The README's worked example: T3 Land Factory, T3 Engineer + 2 T2 Engineers
  // = 40 build power -> 1 m 45 s.
  await page.goto('/calculator?t=ues3511&p=uel3501&a=uel2501:2');
  await expect(page.locator('.select-btn')).toContainText('Land Factory');
  await expect(page.locator('.calc-rail')).toContainText('1 m 45 s');
  await expect(page.locator('.calc-rail')).toContainText('40 (20+20)');

  // With no explicit builder the first chip auto-selects (the T2 factory's
  // in-place upgrade); Copy link pins that derived choice into the URL so a
  // shared setup can't drift under a future data update. Untouched sections
  // stay absent.
  await page.goto('/calculator?t=ues3511');
  await page.getByRole('button', { name: 'Copy link' }).click();
  await page.waitForURL(/p=ues2511/);
  expect(page.url()).toContain('t=ues3511');
  expect(page.url()).not.toContain('e=');

  expect(errors).toEqual([]);
});
