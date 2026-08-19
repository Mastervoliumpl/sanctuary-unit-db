import { defineConfig } from 'vite';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import viteReact from '@vitejs/plugin-react';

// The site stays purely static: both routes are prerendered to plain HTML and
// hydrate into an SPA. There is no server at runtime — the build output is
// static files only, which is what Vercel serves.
//
// Routes set `ssr: false` because unit data is fetched from /data/units.json
// at runtime; prerendering runs no loaders and emits the shell.
export default defineConfig({
  server: { port: 5173 },
  plugins: [
    tanstackStart({
      prerender: { enabled: true, crawlLinks: true },
    }),
    viteReact(),
  ],
});
