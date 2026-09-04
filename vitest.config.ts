import { defineConfig } from 'vitest/config';
import { fumadocsMdx } from 'fumadocs-mdx/vite';

// Unit tests only — e2e/*.spec.ts belongs to Playwright, and Vitest's default
// include pattern would otherwise try to run it.
export default defineConfig({
  plugins: [...fumadocsMdx()],
  test: {
    include: ['src/**/*.test.ts'],
  },
});
