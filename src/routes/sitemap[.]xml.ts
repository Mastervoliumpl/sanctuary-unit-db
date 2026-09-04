import { createFileRoute } from '@tanstack/react-router';
import { siteOrigin } from '../lib/site-origin';

const fixedPages = ['/', '/calculator', '/maps', '/play', '/ladder'];

function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&apos;',
    };
    return entities[character] ?? character;
  });
}

export const Route = createFileRoute('/sitemap.xml')({
  server: {
    handlers: {
      GET: async () => {
        const { moddingSource } = await import('../content/modding/source.server');
        const origin = siteOrigin(process.env.SITE_URL, process.env.NODE_ENV === 'production');
        const pages = [...fixedPages, ...moddingSource.getPages().map((page) => page.url)];
        const urls = [...new Set(pages)].map(
          (path) => `  <url><loc>${escapeXml(`${origin}${path}`)}</loc></url>`,
        );
        const body = [
          '<?xml version="1.0" encoding="UTF-8"?>',
          '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
          ...urls,
          '</urlset>',
        ].join('\n');

        return new Response(body, {
          headers: {
            'Cache-Control': 'public, max-age=300, s-maxage=3600',
            'Content-Type': 'application/xml; charset=utf-8',
          },
        });
      },
    },
  },
});
