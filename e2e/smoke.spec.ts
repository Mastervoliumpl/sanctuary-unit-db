import { expect, test, type Page } from '@playwright/test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// Hydration/runtime smoke over the production output — the unit tests cover
// the logic, this covers "the site actually works in a browser": data loads,
// the board renders, the detail panel opens, the calculator computes, and
// nothing throws on the way.

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    // The Vercel Analytics/Speed Insights scripts and the game-version check
    // (/api/game-version) can be unavailable in test, so their failures are
    // expected noise.
    const url = m.location().url;
    if (
      m.type() === 'error' &&
      !url.includes('/_vercel/') &&
      !url.includes('/api/game-version') &&
      !m.text().includes('net::ERR_NETWORK_ACCESS_DENIED')
    ) {
      errors.push(`console: ${m.text()}`);
    }
  });
  return errors;
}

test('unit board renders, filters via URL, and opens the detail panel', async ({ page }) => {
  const errors = collectErrors(page);

  await page.goto('/');
  await expect(page.locator('.toolbar')).toContainText(/of \d+ units/);
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

test('modding docs honor the versioned routing and metadata contract', async ({ page, request }) => {
  const errors = collectErrors(page);

  const rootResponse = await request.get('/modding', { maxRedirects: 0 });
  expect(rootResponse.status()).toBe(308);
  const startPath = rootResponse.headers().location;
  expect(startPath).toMatch(/^\/modding\/[^/]+\/start$/);
  const snapshotId = startPath.split('/')[2];

  const versionResponse = await request.get(`/modding/${snapshotId}`, { maxRedirects: 0 });
  expect(versionResponse.status()).toBe(308);
  expect(versionResponse.headers().location).toBe(startPath);

  await page.goto('/modding');
  await expect(page).toHaveURL(new RegExp(`${startPath}$`));
  await expect(page.getByRole('heading', { name: 'Modding the current playtest' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Modding', exact: true })).toHaveClass(/active/);

  const overviewPath = `/modding/${snapshotId}/lua/overview`;
  const directResponse = await request.get(overviewPath);
  expect(directResponse.status()).toBe(200);
  const prerenderedHtml = await directResponse.text();
  expect(prerenderedHtml).toContain('Lua runtime, APIs, and templates');
  expect(prerenderedHtml).toContain('requiredLuaHash');

  await page.goto(overviewPath);
  await expect(page.getByRole('heading', { name: 'Lua runtime, APIs, and templates' })).toBeVisible();
  await expect(page.locator('.docs-document')).toContainText('xxHash3-128');
  await expect(page).toHaveTitle('Lua runtime, APIs, and templates | SanctuaryDB');
  await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', /Lua source locations/);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    'href',
    `http://localhost:4173${overviewPath}`,
  );

  await page
    .locator('.docs-nav')
    .getByRole('link', { name: /Build information/ })
    .click();
  await expect(page).toHaveURL(new RegExp(`/modding/${snapshotId}/build-information$`));
  await expect(page.getByRole('heading', { name: 'Inspected game build' })).toBeVisible();

  await page.locator('.docs-pager').getByRole('link', { name: /Next/ }).click();
  await expect(page).toHaveURL(new RegExp(`/modding/${snapshotId}/system$`));
  await expect(page.getByRole('heading', { name: 'System and file layout' })).toBeVisible();
  await page
    .locator('.docs-pager')
    .getByRole('link', { name: /Previous/ })
    .click();
  await expect(page).toHaveURL(new RegExp(`/modding/${snapshotId}/build-information$`));

  const unknownVersion = await request.get('/modding/not-a-version/start', { maxRedirects: 0 });
  const unknownDocument = await request.get(`/modding/${snapshotId}/not-a-document`, { maxRedirects: 0 });
  expect(unknownVersion.status()).toBe(404);
  expect(unknownDocument.status()).toBe(404);

  const navLinks = await page
    .locator('.docs-nav a')
    .evaluateAll((links) => links.map((link) => link.getAttribute('href')));
  const sitemap = await (await request.get('/sitemap.xml')).text();
  const parsedSitemap = await page.evaluate((xml) => {
    const parsed = new DOMParser().parseFromString(xml, 'application/xml');
    return {
      namespace: parsed.documentElement.namespaceURI,
      errors: parsed.querySelectorAll('parsererror').length,
      locations: [...parsed.getElementsByTagNameNS('http://www.sitemaps.org/schemas/sitemap/0.9', 'loc')].map(
        (node) => node.textContent,
      ),
    };
  }, sitemap);
  expect(parsedSitemap.errors).toBe(0);
  expect(parsedSitemap.namespace).toBe('http://www.sitemaps.org/schemas/sitemap/0.9');
  expect(parsedSitemap.locations).not.toContain('http://localhost:4173/ladder/admin');
  expect(parsedSitemap.locations).not.toContain('http://localhost:4173/modding');
  for (const href of navLinks) expect(sitemap).toContain(`<loc>http://localhost:4173${href}</loc>`);

  const pageMetadata = new Map<string, string>();
  for (const href of navLinks) {
    if (!href) continue;
    await page.goto(href);
    const title = await page.title();
    const description = await page.locator('meta[name="description"]').getAttribute('content');
    const canonical = await page.locator('link[rel="canonical"]').getAttribute('href');
    expect(description).toBeTruthy();
    expect(canonical).toBe(`http://localhost:4173${href}`);
    expect(pageMetadata.has(title)).toBe(false);
    pageMetadata.set(title, description ?? '');
  }

  await page.goto(overviewPath);
  const toc = page.getByRole('navigation', { name: 'On this page' });
  const anchors = await toc
    .locator('a')
    .evaluateAll((links) => links.map((link) => link.getAttribute('href')));
  expect(anchors.length).toBeGreaterThan(0);
  for (const anchor of anchors) {
    expect(anchor).toMatch(/^#/);
    await expect(page.locator(anchor!)).toHaveCount(1);
  }
  await toc.getByRole('link', { name: 'Multiplayer Lua hash gate' }).click();
  await expect(page).toHaveURL(/#multiplayer-lua-hash-gate$/);

  for (const metadata of readdirSync('src/content/modding/snapshots')) {
    const snapshot = JSON.parse(
      readFileSync(join('src/content/modding/snapshots', metadata, 'snapshot.json'), 'utf8'),
    );
    const files = readdirSync(join('src/content/modding/docs', snapshot.id), { recursive: true })
      .map(String)
      .filter((file) => file.endsWith('.mdx'));
    for (const file of files) {
      const path = `/modding/${snapshot.id}/${file.replaceAll('\\', '/').replace(/\.mdx$/, '')}`;
      expect(parsedSitemap.locations).toContain(`http://localhost:4173${path}`);
      const html = readFileSync(join('.output/public', path, 'index.html'), 'utf8');
      expect(html).toContain('class="docs-document"');
      expect(html).toContain('<h1');
      expect(html).not.toContain('$fumadocs_loader');
      expect(html).not.toContain('structuredData');
    }
  }

  expect(errors).toEqual([]);
});

test('modding ToC is usable on a narrow screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/modding');
  await page
    .locator('.docs-nav')
    .getByRole('link', { name: /Lua overview/ })
    .click();
  const toc = page.getByRole('navigation', { name: 'On this page' });
  await expect(toc).toBeVisible();
  await toc.getByRole('link', { name: 'Multiplayer Lua hash gate' }).click();
  await expect(page).toHaveURL(/#multiplayer-lua-hash-gate$/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('ladder and play pages render their shells with no database', async ({ page }) => {
  // No database is configured in this test environment, so both pages must
  // render signed-out/empty instead of crashing.
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
