import { defineConfig } from '@playwright/test';

// Smoke tests run against the real production build — `npm run build` must
// have run first (CI already builds before testing; locally the webServer
// command just serves whatever is in .output/public, where Nitro puts the
// client build — dist/client is Vite's intermediate output and goes stale).
export default defineConfig({
  testDir: 'e2e',
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: 'http://localhost:4173',
  },
  webServer: {
    command: 'npx serve -l 4173 .output/public',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
  },
});
