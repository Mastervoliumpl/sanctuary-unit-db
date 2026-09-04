import { defineConfig } from '@playwright/test';

if (!process.env.MODDING_TEST_ROOT)
  throw new Error('Run npm run test:modding-versions to build the isolated fixtures.');

export default defineConfig({
  testDir: 'e2e',
  testMatch: 'modding-versions.spec.ts',
  retries: 0,
  use: { baseURL: 'http://localhost:4174' },
  webServer: {
    command: 'node .output/server/index.mjs',
    cwd: process.env.MODDING_TEST_ROOT,
    env: { HOST: '127.0.0.1', PORT: '4174', SITE_URL: 'http://localhost:4174' },
    url: 'http://localhost:4174',
    reuseExistingServer: false,
  },
});
