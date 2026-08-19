import { defineConfig } from 'vitest/config';

// Unit tests only — e2e/*.spec.ts belongs to Playwright, and Vitest's default
// include pattern would otherwise try to run it.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
  },
});
