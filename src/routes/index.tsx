import { useEffect, useMemo } from 'react';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { loadData } from '../lib/data';
import {
  DEFAULT_STATUS,
  DOMAIN_NAMES,
  METRICS,
  STATUS_LABELS,
  activeFactions,
  buildGroups,
  visibleGroups,
  type BoardFilters,
  type Group,
  type SortKey,
} from '../lib/board';
import type { Faction, Unit } from '../lib/types';
import { FACTION_COLOURS } from '../components/UnitIcon';
import { UnitCard } from '../components/UnitCard';
import { DetailPanel } from '../components/DetailPanel';
import { HeaderSearch } from '../components/HeaderSearch';

// Filters, sort, search and the open unit all live in the URL — same param
// names and comma-joined encoding as the pre-framework site, so shared links
// and bookmarks keep working.
interface BoardSearch {
  q?: string;
  faction?: string;
  domain?: string;
  tier?: string;
  role?: string;
  status?: string;
  sort?: SortKey;
  unit?: string;
}

const str = (v: unknown): string | undefined => {
  // Bare numbers in the URL (?tier=1) arrive parsed; normalise back to string.
  const s = v == null ? '' : String(v);
  return s ? s : undefined;
};

export const Route = createFileRoute('/')({
  // Data comes from /data/units.json at runtime; there is nothing to render on
  // the (static, prerendered) server side.
  ssr: false,
  validateSearch: (raw: Record<string, unknown>): BoardSearch => ({
    q: str(raw.q),
    faction: str(raw.faction),
    domain: str(raw.domain),
    tier: str(raw.tier),
    role: str(raw.role),
    status: str(raw.status),
    sort: METRICS[String(raw.sort)] ? (String(raw.sort) as SortKey) : undefined,
    unit: str(raw.unit),
  }),
  head: () => ({
    meta: [
      { title: 'Units — SanctuaryDB' },
      {
        name: 'description',
        content:
          'Browse every unit in Sanctuary: Shattered Sun with costs, stats and build trees, generated directly from the game files.',
      },
    ],
  }),
  loader: () => loadData(),
  component: BoardPage,
});

const toSet = (raw: string | undefined): Set<string> => new Set((raw ?? '').split(',').filter(Boolean));

// Availability defaults to In game, so an absent param means the default and
// `any` means the deliberate choice of no filter at all.
const statusToSet = (raw: string | undefined): Set<string> =>
  raw === undefined ? new Set([DEFAULT_STATUS]) : raw === 'any' ? new Set() : toSet(raw);

function BoardPage() {
  const loaded = Route.useLoaderData();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });

  const patch = (p: Partial<BoardSearch>) =>
    navigate({ search: (prev: BoardSearch) => ({ ...prev, ...p }), replace: true });

  const filters: BoardFilters = useMemo(
    () => ({
      faction: toSet(search.faction),
      domain: toSet(search.domain),
      tier: toSet(search.tier),
      role: toSet(search.role),
      status: statusToSet(search.status),
      search: search.q ?? '',
    }),
    [search],
  );
  const sort: SortKey = search.sort ?? 'default';

  const groups = useMemo(() => buildGroups(loaded.data.units), [loaded]);
  const visible = useMemo(() => visibleGroups(groups, filters, sort), [groups, filters, sort]);
  const factions = activeFactions(filters.faction);
  const shownCount = visible.reduce((n, g) => n + g.units.length, 0);

  const openDetail = (id: string) => patch({ unit: id });
  const closeDetail = () => patch({ unit: undefined });
  const selected = search.unit ? loaded.byId.get(search.unit) : undefined;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && search.unit) closeDetail();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  // Toggling a chip rewrites its group's param; an empty set drops the param —
  // except Availability, whose default is a real filter, so clearing it has to
  // be written out as `any` or a reload would silently re-apply the default.
  const toggle = (group: keyof Omit<BoardFilters, 'search'>, value: string) => {
    const set = new Set(filters[group]);
    set.has(value) ? set.delete(value) : set.add(value);

    if (group === 'status') {
      const isDefault = set.size === 1 && set.has(DEFAULT_STATUS);
      patch({ status: isDefault ? undefined : set.size ? [...set].join(',') : 'any' });
    } else {
      patch({ [group]: set.size ? [...set].join(',') : undefined });
    }
  };

  const reset = () => navigate({ search: {}, replace: true });

  return (
    <>
      <HeaderSearch
        value={search.q ?? ''}
        onChange={(q) => patch({ q: q.trim() || undefined })}
        placeholder="Search name, id, role or tag…"
      />

      <div className="toolbar">
        <span>
          {shownCount} of {loaded.data.units.length} units · {visible.length} slots
        </span>
        <label className="sortctl">
          Order
          <select
            value={sort}
            onChange={(e) =>
              patch({ sort: e.target.value === 'default' ? undefined : (e.target.value as SortKey) })
            }
          >
            <option value="default">Tech tree</option>
            <option value="alloys">Alloy</option>
            <option value="energy">Energy</option>
            <option value="buildTime">Build time</option>
            <option value="health">Health</option>
            <option value="dps">DPS</option>
            <option value="projectileSpeed">Projectile speed</option>
            <option value="turnRate">Turn rate (unit)</option>
            <option value="traverseSpeed">Turn rate (weapon)</option>
          </select>
        </label>
      </div>

      <main className="layout">
        <FilterSidebar units={loaded.data.units} filters={filters} onToggle={toggle} onReset={reset} />

        <section className="results">
          {visible.length === 0 ? (
            <p className="empty">No units match those filters.</p>
          ) : (
            <Board
              groups={visible}
              factions={factions}
              sort={sort}
              iconManifest={loaded.iconManifest}
              onOpen={openDetail}
            />
          )}
        </section>
      </main>

      {selected && <DetailPanel unit={selected} loaded={loaded} onOpen={openDetail} onClose={closeDetail} />}
    </>
  );
}

/* ---------------- filters ---------------- */

function FilterSidebar({
  units,
  filters,
  onToggle,
  onReset,
}: {
  units: Unit[];
  filters: BoardFilters;
  onToggle: (group: keyof Omit<BoardFilters, 'search'>, value: string) => void;
  onReset: () => void;
}) {
  const groups = useMemo(() => {
    const distinct = <T,>(fn: (u: Unit) => T) => [...new Set(units.map(fn).filter((v) => v != null))];
    return [
      { key: 'faction' as const, title: 'Faction', values: distinct((u) => u.faction), colour: true },
      { key: 'domain' as const, title: 'Domain', values: distinct((u) => u.domain) },
      {
        key: 'tier' as const,
        title: 'Tier',
        values: distinct((u) => u.tier)
          .sort((a, b) => a - b)
          .map(String),
        label: (v: string) => `T${v}`,
      },
      { key: 'role' as const, title: 'Role', values: distinct((u) => u.role).sort() as string[] },
      { key: 'status' as const, title: 'Availability', values: Object.values(STATUS_LABELS) },
    ];
  }, [units]);

  return (
    <aside className="filters">
      <div className="filter-head">
        <h2>Filters</h2>
        <button type="button" className="linkish" onClick={onReset}>
          Reset
        </button>
      </div>
      <div>
        {groups.map((g) => (
          <div className="fgroup" key={g.key}>
            <h3>{g.title}</h3>
            <div className="chips">
              {g.values.map((v) => (
                <button
                  type="button"
                  className="chip"
                  key={String(v)}
                  aria-pressed={filters[g.key].has(String(v))}
                  onClick={() => onToggle(g.key, String(v))}
                >
                  {'colour' in g && g.colour ? (
                    <span className="dot" style={{ background: FACTION_COLOURS[String(v)] ?? '#888' }} />
                  ) : null}
                  {'label' in g && g.label ? g.label(String(v)) : String(v)}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </aside>
  );
}

/* ---------------- the aligned board ---------------- */

function Board({
  groups,
  factions,
  sort,
  iconManifest,
  onOpen,
}: {
  groups: Group[];
  factions: Faction[];
  sort: SortKey;
  iconManifest: Set<string>;
  onOpen: (id: string) => void;
}) {
  const cols = { '--cols': factions.length } as React.CSSProperties;

  // Domain headings are only meaningful while in tech-tree order; a metric
  // sort mixes domains. Derived from the previous row, no render-time state.
  const headingFor = (i: number): string | null => {
    if (sort !== 'default') return null;
    const domain = groups[i].domain;
    if (i > 0 && groups[i - 1].domain === domain) return null;
    return DOMAIN_NAMES[domain] ?? domain;
  };

  return (
    <div className="board">
      <div className="col-heads" style={cols}>
        {factions.map((f) => (
          <div className="col-head" key={f} style={{ '--fc': FACTION_COLOURS[f] } as React.CSSProperties}>
            {f}
          </div>
        ))}
      </div>
      {groups.map((group, i) => {
        const heading = headingFor(i);

        return (
          <div key={group.key} style={{ display: 'contents' }}>
            {heading && <h2 className="domain-head">{heading}</h2>}
            <div className="slot">
              <div className="slot-label">
                {group.tier ? <span className="tier-pill">T{group.tier}</span> : null}
                <span>{group.label}</span>
              </div>
              <div className="slot-row" style={cols}>
                {factions.map((f) => {
                  const units = group.byFaction[f] ?? [];
                  return units.length ? (
                    <div className="cell" key={f}>
                      {units.map((u) => (
                        <UnitCard unit={u} key={u.id} iconManifest={iconManifest} onOpen={onOpen} />
                      ))}
                    </div>
                  ) : (
                    <div className="cell empty-cell" aria-hidden="true" key={f} />
                  );
                })}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
