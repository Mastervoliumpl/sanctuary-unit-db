import { defineConfig, loadEnv } from 'vite';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import { nitro } from 'nitro/vite';
import viteReact from '@vitejs/plugin-react';
import { fumadocsMdx } from 'fumadocs-mdx/vite';
import { readdirSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { MODDING_SNAPSHOTS } from './src/content/modding/registry.ts';
import { siteOrigin } from './src/lib/site-origin.ts';

const contentRoot = resolve('src/content/modding/docs');

function findMdxFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return findMdxFiles(path);
    return entry.isFile() && entry.name.endsWith('.mdx') ? [path] : [];
  });
}

function moddingPrerenderPages(): { path: string }[] {
  return MODDING_SNAPSHOTS.flatMap((snapshot) =>
    findMdxFiles(resolve(contentRoot, snapshot.id)).map((file) => ({
      path: `/modding/${snapshot.id}/${relative(resolve(contentRoot, snapshot.id), file)
        .replace(/\\/g, '/')
        .replace(/\.mdx$/, '')}`,
    })),
  );
}

// Content routes are prerendered where possible, while the ladder and modding
// reference retain server handlers for authenticated data, redirects, and
// proper 404 responses. Nitro packages both the static output and Node server.
export default defineConfig(({ mode, command }) => {
  // Server functions read process.env (SUPABASE_URL etc.), which plain Vite
  // only fills from the shell — so surface .env files there too, without
  // letting them shadow anything the shell already set.
  const env = loadEnv(mode, process.cwd(), '');
  for (const [key, value] of Object.entries(env)) {
    process.env[key] ??= value;
  }
  process.env.SITE_URL = siteOrigin(process.env.SITE_URL, command === 'build');

  return {
    server: { port: 5173 },
    plugins: [
      ...fumadocsMdx(),
      tanstackStart({
        pages: [{ path: '/' }, ...moddingPrerenderPages()],
        prerender: {
          enabled: true,
          crawlLinks: true,
          filter: ({ path }) =>
            path !== '/modding' && !MODDING_SNAPSHOTS.some((snapshot) => path === `/modding/${snapshot.id}`),
        },
      }),
      // Nitro packages the server for the deployment target: on Vercel it
      // emits the Build Output API layout (.vercel/output) their platform
      // serves — without it the build has no shape Vercel recognises and
      // every route 404s.
      nitro(),
      viteReact(),
    ],
  };
});
