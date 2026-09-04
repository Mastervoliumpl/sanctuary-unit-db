import { createServerFn } from '@tanstack/react-start';
import { Link, createFileRoute, notFound, useNavigate } from '@tanstack/react-router';
import { z } from 'zod';
import { getModdingMdxComponents } from '../content/modding/components';
import { moddingDocs } from '../content/modding/collection';
import { resolveVersionSwitch } from '../content/modding/registry';

const requestSchema = z.object({
  documentPath: z.string().min(1),
  snapshotId: z.string().min(1),
});

const loadDocument = createServerFn({ method: 'GET' })
  .validator((input: unknown) => requestSchema.parse(input))
  .handler(async ({ data }) => {
    const { getModdingDocumentData } = await import('../content/modding/source.server');
    const result = await getModdingDocumentData(data.snapshotId, data.documentPath);
    if (!result) throw notFound();
    return result;
  });

interface ModdingSearch {
  versionFallback?: string;
}

export const Route = createFileRoute('/modding/$version/$')({
  validateSearch: (input: Record<string, unknown>): ModdingSearch => ({
    versionFallback: typeof input.versionFallback === 'string' ? input.versionFallback : undefined,
  }),
  loader: async ({ params }) => {
    const documentPath = params._splat?.replace(/^\/+|\/+$/g, '') ?? '';
    if (!documentPath) throw notFound();
    const data = await loadDocument({ data: { documentPath, snapshotId: params.version } });
    await moddingDocs.getPage(data.collectionPath)?.preload();
    return data;
  },
  head: ({ loaderData }) => ({
    meta: loaderData
      ? [
          { title: `${loaderData.title} | SanctuaryDB` },
          { name: 'description', content: loaderData.description },
        ]
      : [],
    links: loaderData ? [{ rel: 'canonical', href: loaderData.canonicalUrl }] : [],
  }),
  component: ModdingDocumentPage,
});

function ModdingDocumentPage() {
  const data = Route.useLoaderData();
  const search = Route.useSearch();
  const navigate = useNavigate();
  const page = moddingDocs.getPage(data.collectionPath);
  if (!page) throw notFound();
  const Mdx = page.body;

  const changeVersion = async (snapshotId: string) => {
    const selected = data.snapshots.find((snapshot) => snapshot.id === snapshotId);
    if (!selected) return;

    const target = resolveVersionSwitch(
      selected,
      data.documentPath,
      data.snapshotDocumentPaths[snapshotId] ?? [],
    );
    const fallback = target.fallbackFrom ? `?versionFallback=${encodeURIComponent(target.fallbackFrom)}` : '';
    await navigate({ href: `/modding/${snapshotId}/${target.documentPath}${fallback}` });
  };

  return (
    <>
      <div className="toolbar">
        <span className="toolbar-summary">Modding reference · {page.navTitle}</span>
        <span className="docs-toolbar-version">Game {data.snapshot.gameVersion}</span>
      </div>

      <main className="modding-docs">
        <aside className="docs-sidebar" aria-label="Modding documentation">
          <div className="docs-version-control">
            <label htmlFor="modding-version">Documentation version</label>
            <select
              id="modding-version"
              value={data.snapshot.id}
              onChange={(event) => void changeVersion(event.target.value)}
            >
              {data.snapshots.map((snapshot) => (
                <option key={snapshot.id} value={snapshot.id}>
                  {snapshot.gameVersion} · Steam {snapshot.steamBuild}
                </option>
              ))}
            </select>
          </div>

          <nav className="docs-nav" aria-label="Modding documents">
            {data.groups.map((group) => (
              <div className="docs-nav-group" key={group.title}>
                <p>{group.title}</p>
                {group.documents.map((entry) => (
                  <Link
                    to="/modding/$version/$"
                    params={{ version: data.snapshot.id, _splat: entry.path }}
                    key={entry.path}
                    className={entry.path === data.documentPath ? 'active' : ''}
                    aria-current={entry.path === data.documentPath ? 'page' : undefined}
                  >
                    <span>{entry.title}</span>
                    <small>{entry.description}</small>
                  </Link>
                ))}
              </div>
            ))}
          </nav>
        </aside>

        <article className="docs-article">
          <div className="docs-version-line">
            <span>{data.snapshot.status}</span>
            <span>Inspected {data.inspectedOnLabel}</span>
          </div>

          {search.versionFallback ? (
            <div className="docs-version-notice" role="status">
              This snapshot does not contain <code>{search.versionFallback}</code>. Its start page is shown
              instead.
            </div>
          ) : null}

          <div className="docs-document">
            {data.toc.length > 0 ? (
              <details className="docs-toc" open>
                <summary>On this page</summary>
                <nav aria-label="On this page">
                  <ol>
                    {data.toc.map((entry) => (
                      <li key={entry.url} style={{ marginInlineStart: `${Math.max(0, entry.depth - 2)}em` }}>
                        <a href={entry.url}>{entry.title}</a>
                      </li>
                    ))}
                  </ol>
                </nav>
              </details>
            ) : null}
            <Mdx components={getModdingMdxComponents(data.snapshot, data.documentPath)} />
          </div>

          <nav className="docs-pager" aria-label="Adjacent documents">
            {data.previous ? (
              <Link
                to="/modding/$version/$"
                params={{ version: data.snapshot.id, _splat: data.previous.path }}
              >
                <small>Previous</small>
                <span>{data.previous.title}</span>
              </Link>
            ) : (
              <span />
            )}
            {data.next ? (
              <Link
                to="/modding/$version/$"
                params={{ version: data.snapshot.id, _splat: data.next.path }}
                className="next"
              >
                <small>Next</small>
                <span>{data.next.title}</span>
              </Link>
            ) : null}
          </nav>
        </article>
      </main>
    </>
  );
}
