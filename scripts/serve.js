// Minimal static server for local development — no dependencies, so `npm run dev`
// works on a clean checkout. Vercel serves `public/` directly and never runs this.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const PORT = Number(process.env.PORT) || 5173;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

http
  .createServer((req, res) => {
    const urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    // Directory URLs resolve to their index.html, matching how the host serves
    // /calculator/ in production.
    let file = path.join(ROOT, urlPath.slice(1));
    if (urlPath.endsWith('/')) file = path.join(file, 'index.html');
    else if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');

    // Refuse anything that escapes the public directory.
    if (!file.startsWith(ROOT)) {
      res.writeHead(403).end('Forbidden');
      return;
    }
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404).end('Not found');
      return;
    }

    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    fs.createReadStream(file).pipe(res);
  })
  .listen(PORT, () => console.log(`http://localhost:${PORT}`));
