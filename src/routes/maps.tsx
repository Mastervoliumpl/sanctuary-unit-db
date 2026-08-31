import { useEffect, useMemo, useState } from 'react';
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router';
import { copyText } from '../lib/clipboard';
import { HeaderSearch } from '../components/HeaderSearch';
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
  q?: string;
  players?: string;
  size?: string;
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
    q: str(raw.q),
    players: str(raw.players),
    size: str(raw.size),
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

const toSet = (raw: string | undefined): Set<string> => new Set((raw ?? '').split(',').filter(Boolean));

// Player counts cluster into the shapes people actually search for; 5 and 7
// player maps are rare enough that a chip each would mostly sit empty.
const playerBucket = (n: number): string => (n <= 2 ? '2' : n <= 4 ? '4' : n <= 6 ? '6' : '8');
const PLAYER_CHIPS = [
  { value: '2', label: '1v1' },
  { value: '4', label: '3–4' },
  { value: '6', label: '5–6' },
  { value: '8', label: '7–8' },
];

const SIZE_LABELS: Record<string, string> = {
  '256': 'Small (256)',
  '512': 'Medium (512)',
  '1024': 'Large (1024)',
  '2048': 'Huge (2048)',
};

// The FA conversions ship CC0 stand-in textures rather than the originals'
// art. That is a licensing necessity, but it changes how they look, so say so
// instead of leaving people to wonder why a remembered map reads differently.
const isConverted = (m: MapEntry) => /converted from supreme commander/i.test(m.author);

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
  const open = search.m ? data.maps.find((m) => m.slug === search.m) : undefined;

  // Filters are comma-joined id lists in the URL, same encoding the units
  // board uses for its chips.
  const players = toSet(search.players);
  const sizes = toSet(search.size);
  const needle = (search.q ?? '').trim().toLowerCase();

  const maps = useMemo(() => {
    const match = (m: MapEntry) =>
      (!players.size || players.has(playerBucket(m.players))) &&
      (!sizes.size || sizes.has(String(m.width))) &&
      (!needle || `${m.name} ${m.author} ${m.description}`.toLowerCase().includes(needle));
    return data.maps.filter(match).sort(SORTS[sort]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, sort, search.players, search.size, search.q]);

  const toggle = (key: 'players' | 'size', value: string) => {
    const set = new Set(key === 'players' ? players : sizes);
    set.has(value) ? set.delete(value) : set.add(value);
    patch({ [key]: set.size ? [...set].join(',') : undefined });
  };

  // Live download counts per release tag; purely decorative, so a failed or
  // rate-limited API call just leaves them off.
  const [counts, setCounts] = useState<Map<string, number>>(new Map());
  useEffect(() => {
    if (data.maps.length) fetchDownloadCounts(data.repo).then(setCounts);
  }, [data]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && search.m) patch({ m: undefined });
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  if (open) {
    return (
      <>
        <div className="toolbar">
          <span className="toolbar-summary">
            {open.name} · {open.players} players · {sizeLabel(open)}
          </span>
        </div>
        <main className="maps">
          <MapDetail map={open} downloads={counts.get(open.tag)} />
        </main>
      </>
    );
  }

  return (
    <>
      <HeaderSearch
        value={search.q ?? ''}
        onChange={(q) => patch({ q: q.trim() || undefined })}
        placeholder="Search maps by name or author…"
      />

      <div className="toolbar">
        <span className="toolbar-summary">
          {maps.length === data.maps.length
            ? `${maps.length} map${maps.length === 1 ? '' : 's'}`
            : `${maps.length} of ${data.maps.length} maps`}
        </span>
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
      </div>

      <main className="layout">
        <aside className="filters">
          <div className="filter-head">
            <h2>Filters</h2>
            <button type="button" className="linkish" onClick={() => navigate({ search: {}, replace: true })}>
              Reset
            </button>
          </div>
          <div className="fgroup">
            <h3>Players</h3>
            <div className="chips">
              {PLAYER_CHIPS.map((chip) => (
                <button
                  type="button"
                  className="chip"
                  key={chip.value}
                  aria-pressed={players.has(chip.value)}
                  onClick={() => toggle('players', chip.value)}
                >
                  {chip.label}
                </button>
              ))}
            </div>
          </div>
          <div className="fgroup">
            <h3>Size</h3>
            <div className="chips">
              {Object.keys(SIZE_LABELS).map((value) => (
                <button
                  type="button"
                  className="chip"
                  key={value}
                  aria-pressed={sizes.has(value)}
                  onClick={() => toggle('size', value)}
                >
                  {SIZE_LABELS[value]}
                </button>
              ))}
            </div>
          </div>
        </aside>

        <section className="results maps">
          <InstallHelp />
          {maps.some(isConverted) && <TextureNote />}
          {data.maps.length === 0 ? (
            <p className="empty">No maps published yet — the first ones are on their way.</p>
          ) : maps.length === 0 ? (
            <p className="empty">No maps match those filters.</p>
          ) : (
            <div className="map-grid">
              {maps.map((m) => (
                <MapCard map={m} key={m.slug} downloads={counts.get(m.tag)} />
              ))}
            </div>
          )}
        </section>
      </main>
    </>
  );
}

function TextureNote() {
  return (
    <p className="map-note">
      <strong>On the Forged Alliance conversions:</strong> their ground textures are open-licence (CC0)
      stand-ins, not the originals' art, so terrain can read better or worse than the map you remember. The
      heightmap, layout, spawns and resources are exact.
    </p>
  );
}

// Installing is a manual copy, so say where the folder is and let people take
// the path with one click rather than transcribing it. Collapsed by default:
// it matters once, and the maps are what people came for.
function InstallHelp() {
  const [copied, setCopied] = useState(false);

  return (
    <details className="install">
      <summary>How to install a map</summary>
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
    </details>
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
          {isConverted(m) && <TextureNote />}
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
