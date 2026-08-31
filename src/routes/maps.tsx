import { useEffect, useMemo, useState } from 'react';
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router';
import { setMetaLine } from '../lib/meta-line';
import { copyText } from '../lib/clipboard';
import { fetchDownloadCounts, fileSizeLabel, loadMaps, sizeLabel, type MapEntry } from '../lib/maps';

// Where the game reads maps from. The install root moves with the branch and
// the Steam library, so this is the common default rather than a promise.
const MAPS_PATH =
  'C:\\Program Files (x86)\\Steam\\steamapps\\common\\Sanctuary Shattered Sun Playtest\\engine\\Sanctuary_Data\\Maps';

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
          <>
            <div className="map-grid">
              {maps.map((m) => (
                <MapCard map={m} key={m.slug} downloads={counts.get(m.tag)} />
              ))}
            </div>
            <InstallHelp />
          </>
        )}
      </main>
    </>
  );
}

// Installing is a manual copy, so say where the folder is and let people take
// the path with one click rather than transcribing it.
function InstallHelp() {
  const [copied, setCopied] = useState(false);

  return (
    <div className="install">
      <h2>Installing</h2>
      <ol>
        <li>Download the zip and extract it — you get one folder named after the map.</li>
        <li>
          Put that folder in your Sanctuary <code>Maps</code> folder, so the map sits at{' '}
          <code>…\Maps\Map_Name\</code>.
        </li>
        <li>Restart the game — the map appears in the skirmish and lobby map lists.</li>
      </ol>
      <div className="install-path">
        <code>{MAPS_PATH}</code>
        <button
          type="button"
          className="linkish"
          onClick={async () => {
            if (await copyText(MAPS_PATH)) {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }
          }}
        >
          {copied ? 'Copied ✓' : 'Copy'}
        </button>
      </div>
      <p className="hint">
        That's the default for the Steam Playtest build. If you installed elsewhere or play a different
        branch, use that install's own <code>engine\Sanctuary_Data\Maps</code>.
      </p>
    </div>
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
          {/* Verbatim credits from the .sanmap — sometimes a name, sometimes a
          full provenance line, so no "by" prefix. */}
          {m.author && <p className="map-author">{m.author}</p>}
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
          <InstallHelp />
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
