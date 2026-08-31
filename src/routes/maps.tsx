import { useEffect, useMemo, useState } from 'react';
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router';
import { setMetaLine } from '../lib/meta-line';
import { fetchDownloadCounts, fileSizeLabel, loadMaps, sizeLabel, type MapEntry } from '../lib/maps';

// The listing and each map's own view share this route: ?m=<slug> opens a map,
// the same URL-param pattern the units page uses for its detail panel, so
// every map has a shareable address without needing per-map prerendering.
interface MapsSearch {
  m?: string;
  sort?: string;
}

const str = (v: unknown): string | undefined => {
  const s = v == null ? '' : String(v);
  return s ? s : undefined;
};

export const Route = createFileRoute('/maps')({
  ssr: false,
  validateSearch: (raw: Record<string, unknown>): MapsSearch => ({
    m: str(raw.m),
    sort: str(raw.sort),
  }),
  head: () => ({
    meta: [
      { title: 'Maps — SanctuaryDB' },
      {
        name: 'description',
        content: 'Community-made maps for Sanctuary: Shattered Sun — browse, preview and download.',
      },
    ],
  }),
  loader: () => loadMaps(),
  component: MapsPage,
});

const SORTS: Record<string, (a: MapEntry, b: MapEntry) => number> = {
  newest: (a, b) => b.addedAt.localeCompare(a.addedAt),
  name: (a, b) => a.name.localeCompare(b.name),
  players: (a, b) => b.players - a.players || a.name.localeCompare(b.name),
  size: (a, b) => b.width * b.length - a.width * a.length || a.name.localeCompare(b.name),
};

function MapsPage() {
  const data = Route.useLoaderData();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });

  const patch = (p: Partial<MapsSearch>) =>
    navigate({ search: (prev: MapsSearch) => ({ ...prev, ...p }), replace: true });

  const sort = search.sort && SORTS[search.sort] ? search.sort : 'newest';
  const maps = useMemo(() => [...data.maps].sort(SORTS[sort]), [data, sort]);
  const open = search.m ? data.maps.find((m) => m.slug === search.m) : undefined;

  // Live download counts per release tag; purely decorative, so a failed or
  // rate-limited API call just leaves them off.
  const [counts, setCounts] = useState<Map<string, number>>(new Map());
  useEffect(() => {
    if (data.maps.length) fetchDownloadCounts(data.repo).then(setCounts);
  }, [data]);

  useEffect(() => {
    const mb = data.maps.reduce((n, m) => n + m.sizeBytes, 0) / 1048576;
    setMetaLine(
      data.maps.length
        ? `${data.maps.length} map${data.maps.length === 1 ? '' : 's'} · ${mb.toFixed(1)} MB of terrain · ` +
            `updated ${new Date(data.updatedAt).toLocaleDateString()}`
        : 'community maps',
    );
  }, [data]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && search.m) patch({ m: undefined });
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  return (
    <>
      <div className="toolbar">
        <span className="toolbar-summary">
          {open
            ? `${open.name} · ${open.players} players · ${sizeLabel(open)}`
            : `${maps.length} map${maps.length === 1 ? '' : 's'}`}
        </span>
        {!open && maps.length > 1 && (
          <label className="sortctl">
            Order
            <select
              value={sort}
              onChange={(e) => patch({ sort: e.target.value === 'newest' ? undefined : e.target.value })}
            >
              <option value="newest">Newest</option>
              <option value="name">Name</option>
              <option value="players">Players</option>
              <option value="size">Size</option>
            </select>
          </label>
        )}
      </div>

      <main className="maps">
        {open ? (
          <MapDetail map={open} downloads={counts.get(open.tag)} />
        ) : maps.length === 0 ? (
          <p className="empty">No maps published yet — the first ones are on their way.</p>
        ) : (
          <div className="map-grid">
            {maps.map((m) => (
              <MapCard map={m} key={m.slug} downloads={counts.get(m.tag)} />
            ))}
          </div>
        )}
      </main>
    </>
  );
}

function MapCard({ map: m, downloads }: { map: MapEntry; downloads: number | undefined }) {
  return (
    <article className="map-card">
      <Link to="/maps" search={{ m: m.slug }} className="map-card-main">
        <img src={`/maps/${m.slug}/preview.png`} alt={`${m.name} preview`} loading="lazy" />
        <span className="map-card-body">
          <span className="map-card-name">{m.name}</span>
          <small>
            {m.players} players · {sizeLabel(m)}
            {m.author ? ` · by ${m.author}` : ''}
          </small>
        </span>
      </Link>
      <footer>
        <span className="dim">
          {fileSizeLabel(m.sizeBytes)}
          {downloads !== undefined ? ` · ${downloads} downloads` : ''}
        </span>
        <a className="dl-mini" href={m.download} title={`Download ${m.name}`}>
          Download
        </a>
      </footer>
    </article>
  );
}

function MapDetail({ map: m, downloads }: { map: MapEntry; downloads: number | undefined }) {
  return (
    <div className="map-detail">
      <Link to="/maps" className="linkish back">
        ← All maps
      </Link>
      <div className="map-detail-cols">
        <img className="map-detail-preview" src={`/maps/${m.slug}/preview.png`} alt={`${m.name} preview`} />
        <div className="map-detail-info">
          <h1>{m.name}</h1>
          {m.author && <p className="map-author">by {m.author}</p>}
          {m.description && <p className="map-desc">{m.description}</p>}
          <div className="rgrid">
            <div>
              <div className="rk">Players</div>
              <div className="rv">{m.players}</div>
            </div>
            <div>
              <div className="rk">Map size</div>
              <div className="rv">{sizeLabel(m)}</div>
            </div>
            <div>
              <div className="rk">Water</div>
              <div className="rv">{m.hasWater ? 'Yes' : 'No'}</div>
            </div>
            <div>
              <div className="rk">File size</div>
              <div className="rv">{fileSizeLabel(m.sizeBytes)}</div>
            </div>
            <div>
              <div className="rk">Version</div>
              <div className="rv">v{m.version}</div>
            </div>
            <div>
              <div className="rk">Added</div>
              <div className="rv">{new Date(m.addedAt).toLocaleDateString()}</div>
            </div>
            {downloads !== undefined && (
              <div>
                <div className="rk">Downloads</div>
                <div className="rv">{downloads}</div>
              </div>
            )}
          </div>
          <a className="dl-btn" href={m.download}>
            Download map · {fileSizeLabel(m.sizeBytes)}
          </a>
          <p className="map-hint">Extract the zip into the game's Maps folder.</p>
        </div>
      </div>
      {m.screenshots.length > 0 && (
        <div className="shots">
          {m.screenshots.map((s) => (
            <a href={`/maps/${m.slug}/${s}`} target="_blank" rel="noreferrer" key={s}>
              <img src={`/maps/${m.slug}/${s}`} alt={`${m.name} screenshot`} loading="lazy" />
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
