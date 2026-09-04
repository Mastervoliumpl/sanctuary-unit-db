import { defineConfig } from '@playwright/test';

// Smoke tests run against the generated production server so redirects,
// server-rendered documents, and HTTP 404 responses are covered as deployed.
// `npm run build` must have run first (CI already builds before testing).
export default defineConfig({
  testDir: 'e2e',
  testIgnore: 'modding-versions.spec.ts',
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: 'http://localhost:4173',
  },
  webServer: {
    command: 'node .output/server/index.mjs',
    env: { HOST: '127.0.0.1', PORT: '4173', SITE_URL: 'http://localhost:4173' },
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
  },
});
