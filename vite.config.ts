import { defineConfig, loadEnv } from 'vite';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import viteReact from '@vitejs/plugin-react';

// Split personality: the content pages (units, calculator, maps) are
// prerendered to plain HTML and hydrate into an SPA, exactly as before — but
// the ladder needs a backend, so the server bundle we used to throw away is
// now deployed too (vercel.json's tanstack-start preset wraps dist/server in
// a serverless function). Server functions and /api/auth/* live there; the
// prerendered pages are still served as static files.
//
// Routes set `ssr: false` because their data is fetched at runtime;
// prerendering runs no loaders and emits the shell.
export default defineConfig(({ mode }) => {
  // Server functions read process.env (SUPABASE_URL etc.), which plain Vite
  // only fills from the shell — so surface .env files there too, without
  // letting them shadow anything the shell already set.
  const env = loadEnv(mode, process.cwd(), '');
  for (const [key, value] of Object.entries(env)) {
    process.env[key] ??= value;
  }

  return {
    server: { port: 5173 },
    plugins: [
      tanstackStart({
        prerender: { enabled: true, crawlLinks: true },
      }),
      viteReact(),
    ],
  };
});
