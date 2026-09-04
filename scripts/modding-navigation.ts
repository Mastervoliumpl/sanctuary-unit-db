import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createServer, normalizePath, type Plugin } from 'vite';
import { fumadocsMdx } from 'fumadocs-mdx/vite';
import type { ModdingDocumentData } from '../src/content/modding/source.server.ts';

/** Compile navigation with the same source model used to validate the documents. */
export function moddingNavigation(): Plugin {
  const root = process.cwd();
  const contentRoot = normalizePath(resolve(root, 'src/content/modding')) + '/';
  const generate = async () => {
    const compiler = await createServer({
      root,
      configFile: false,
      plugins: [...fumadocsMdx({ globalOptions: { mdxOptions: { development: false } } })],
      server: { middlewareMode: true, hmr: false, watch: null },
      appType: 'custom',
    });
    try {
      const source = await compiler.ssrLoadModule('/src/content/modding/source.server.ts');
      const pages: Record<
        string,
        Pick<ModdingDocumentData, 'collectionPath' | 'title' | 'description' | 'toc'>
      > = {};
      const groups: Record<string, ModdingDocumentData['groups']> = {};
      for (const page of source.moddingSource.getPages()) {
        const data: ModdingDocumentData = await source.getModdingDocumentData(
          page.slugs[0],
          page.slugs.slice(1).join('/'),
        );
        groups[data.snapshot.id] = data.groups;
        pages[`${data.snapshot.id}/${data.documentPath}`] = {
          collectionPath: data.collectionPath,
          title: data.title,
          description: data.description,
          toc: data.toc,
        };
      }
      mkdirSync(resolve(root, '.tanstack'), { recursive: true });
      writeFileSync(
        resolve(root, '.tanstack/modding-navigation.json'),
        JSON.stringify({ origin: process.env.SITE_URL, groups, pages }),
      );
    } finally {
      await compiler.close();
    }
  };

  return {
    name: 'modding-static-navigation',
    configResolved: generate,
    configureServer(server) {
      let pending = Promise.resolve();
      const refresh = (event: string, file: string) => {
        if (!['add', 'change', 'unlink'].includes(event) || !normalizePath(file).startsWith(contentRoot))
          return;
        pending = pending
          .catch(() => {})
          .then(generate)
          .then(() => {
            server.moduleGraph.invalidateAll();
            server.ws.send({ type: 'full-reload' });
          });
        void pending.catch((error: Error) => {
          server.config.logger.error(error.message);
          server.ws.send({ type: 'error', err: { message: error.message, stack: error.stack ?? '' } });
        });
      };
      server.watcher.on('all', refresh);
    },
  };
}
