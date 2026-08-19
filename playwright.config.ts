import { defineConfig } from '@playwright/test';

// Smoke tests run against the real production build — `npm run build` must
// have run first (CI already builds before testing; locally the webServer
// command just serves whatever is in dist/client).
export default defineConfig({
  testDir: 'e2e',
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: 'http://localhost:4173',
  },
  webServer: {
    command: 'npx serve -l 4173 dist/client',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
  },
});
