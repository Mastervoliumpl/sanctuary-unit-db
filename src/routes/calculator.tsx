import { useEffect, useMemo, useRef, useState } from 'react';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { loadData } from '../lib/data';
import { setMetaLine } from '../lib/meta-line';
import { duration, fmt, shortName } from '../lib/format';
import {
  buildResult,
  buildable,
  canAssist,
  economyResult,
  isConsumer,
  isProducer,
  packRows,
  shown,
  unpackRows,
  type CountedRow,
} from '../lib/calc';
import type { Faction, ResourceRates, Unit } from '../lib/types';
import { FACTION_COLOURS, FACTION_ORDER, UnitIcon } from '../components/UnitIcon';

// The whole setup lives in the URL — same params as the pre-framework site
// (t / p / a / e, plus f for the faction lens), so a build can be shared or
// bookmarked. An absent `e` means the default economy prefill; clearing the
// last structure writes `e=none` so the deliberate empty survives a reload.
interface CalcSearch {
  t?: string;
  p?: string;
  a?: string;
  e?: string;
  f?: string;
}

const str = (v: unknown): string | undefined => {
  const s = v == null ? '' : String(v);
  return s ? s : undefined;
};

export const Route = createFileRoute('/calculator')({
  ssr: false,
  validateSearch: (raw: Record<string, unknown>): CalcSearch => ({
    t: str(raw.t),
    p: str(raw.p),
    a: str(raw.a),
    e: str(raw.e),
    f: str(raw.f),
  }),
  head: () => ({
    meta: [
      { title: 'Calculator — SanctuaryDB' },
      {
        name: 'description',
        content:
          "Build time, resource drain and economy planning for Sanctuary: Shattered Sun, using the game's own formulas.",
      },
    ],
  }),
  loader: () => loadData(),
  component: CalculatorPage,
});

type PanelKind = 'target' | 'assist' | 'econ' | 'drain';

/* ---------------- naming & detail lines ---------------- */

const label = (u: Unit): string => u.name ?? shortName(u);

const byTierName = (a: Unit, b: Unit) => (a.tier ?? 0) - (b.tier ?? 0) || label(a).localeCompare(label(b));

// "T2 · EDA · 3,200a · 48,000e" — the sub line under a pickable unit.
const subLine = (u: Unit): string =>
  [u.tier ? `T${u.tier}` : null, u.faction, `${fmt(u.cost.alloys, 0)}a · ${fmt(u.cost.energy, 0)}e`]
    .filter(Boolean)
    .join(' · ');

const rateBits = (o: ResourceRates | null, sign: string): string | null => {
  const bits = Object.entries(o ?? {})
    .filter(([, v]) => v)
    .map(([k, v]) => `${sign}${fmt(v)} ${k}/s`);
  return bits.length ? bits.join(' ') : null;
};

// "+18 energy/s · −2 alloys/s · 500 energy store" — what a structure does.
const econDetail = (u: Unit): string =>
  [
    rateBits(u.production, '+'),
    rateBits(u.upkeep, '−'),
    u.storage
      ? Object.entries(u.storage)
          .filter(([, v]) => v)
          .map(([k, v]) => `${fmt(v, 0)} ${k} store`)
          .join(' ')
      : null,
  ]
    .filter(Boolean)
    .join(' · ');

const econSub = (u: Unit): string =>
  `${[u.tier ? `T${u.tier}` : null, u.faction].filter(Boolean).join(' ')} · ${econDetail(u)}`;

// Ids and internal names are searchable too, since people quote them; so are
// "T2" and the faction, which the old combobox labels used to carry.
const haystacks = new WeakMap<Unit, string>();
const haystack = (u: Unit): string => {
  let h = haystacks.get(u);
  if (!h) {
    h = [u.name, u.displayName, u.internalName, u.id, u.role, u.tier ? `T${u.tier}` : null, u.faction]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    haystacks.set(u, h);
  }
  return h;
};

// The async clipboard API needs a secure context and permission; fall back to
// the old textarea trick where it's unavailable.
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try {
      return document.execCommand('copy');
    } catch {
      return false;
    } finally {
      ta.remove();
    }
  }
}

/* ---------------- page ---------------- */

function CalculatorPage() {
  const { data, byId, iconManifest } = Route.useLoaderData();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });

  const patch = (p: Partial<CalcSearch>) =>
    navigate({ search: (prev: CalcSearch) => ({ ...prev, ...p }), replace: true });

  const [panel, setPanel] = useState<PanelKind | null>(null);
  const togglePanel = (kind: PanelKind) => setPanel(panel === kind ? null : kind);

  // Step 1 — the faction lens. Narrows the target/assist pools; what's already
  // chosen survives it, so a shared cross-faction setup stays intact.
  const shownUnits = useMemo(() => data.units.filter(shown), [data]);
  const faction = search.f && FACTION_ORDER.includes(search.f as Faction) ? (search.f as Faction) : undefined;
  const pool = useMemo(
    () => (faction ? shownUnits.filter((u) => u.faction === faction) : shownUnits),
    [shownUnits, faction],
  );
  const targetPool = useMemo(() => pool.filter(buildable).sort(byTierName), [pool]);
  const assistPool = useMemo(() => pool.filter(canAssist), [pool]);

  // Step 2 — the target. A stale URL falls back to the first valid option
  // rather than sitting empty; the URL is only rewritten on a real pick.
  const urlTarget = search.t && byId.has(search.t) && buildable(byId.get(search.t)!) ? search.t : null;
  const targetId = urlTarget ?? targetPool[0]?.id ?? null;
  const target = targetId ? byId.get(targetId) : undefined;

  // Step 3 — one-tap builder chips, lowest tier first. The tier prefix matters:
  // factions have same-named engineers at several tiers.
  const builders = useMemo(
    () =>
      target
        ? target.builtBy
            .map((id) => byId.get(id))
            .filter((u): u is Unit => Boolean(u))
            .sort((a, b) => (a.tier ?? 0) - (b.tier ?? 0) || (a.buildPower ?? 0) - (b.buildPower ?? 0))
        : [],
    [target, byId],
  );
  const primary = (search.p && builders.find((u) => u.id === search.p)) || builders[0] || undefined;

  const assists = useMemo(() => unpackRows(search.a, byId), [search.a, byId]);

  // Economy follows the target's faction (cross-faction economy is
  // irrelevant), falling back to the faction chip. Untouched, it prefills a
  // basic T1 income so the page lands on a live answer.
  const econFaction: Faction | undefined = target?.faction ?? faction;
  const econBase = useMemo(
    () => (econFaction ? shownUnits.filter((u) => u.faction === econFaction) : pool),
    [shownUnits, econFaction, pool],
  );
  const producerPool = useMemo(() => econBase.filter(isProducer), [econBase]);
  const consumerPool = useMemo(() => econBase.filter(isConsumer), [econBase]);

  const defaultEconomy = useMemo(() => {
    const t1 = econBase
      .filter((u) => u.domain === 'Structure' && u.tier === 1 && isProducer(u))
      .sort(byTierName);
    const egen = t1.find((u) => (u.production?.energy ?? 0) > 0);
    const agen = t1.find((u) => (u.production?.alloys ?? 0) > 0 && u.id !== egen?.id);
    const rows: CountedRow[] = [];
    if (egen) rows.push({ id: egen.id, count: 6 });
    if (agen) rows.push({ id: agen.id, count: 4 });
    return rows;
  }, [econBase]);
  const economy = useMemo(
    () => (search.e === undefined ? defaultEconomy : search.e === 'none' ? [] : unpackRows(search.e, byId)),
    [search.e, defaultEconomy, byId],
  );

  useEffect(() => {
    setMetaLine(
      `${data.units.filter((u) => u.builtBy.length).length} buildable · ` +
        `${data.units.filter((u) => u.canAssist).length} can assist · ` +
        `extracted ${new Date(data.meta.generatedAt).toLocaleDateString()}`,
    );
  }, [data]);

  const writeRows = (key: 'a' | 'e', next: CountedRow[]) =>
    patch({ [key]: key === 'e' ? (packRows(next) ?? 'none') : packRows(next) });

  const addRow = (key: 'a' | 'e', rows: CountedRow[], id: string) => {
    const hit = rows.find((r) => r.id === id);
    const next = hit
      ? rows.map((r) => (r.id === id ? { ...r, count: r.count + 1 } : r))
      : [...rows, { id, count: 1 }];
    writeRows(key, next);
    setPanel(null);
  };

  const bumpRow = (key: 'a' | 'e', rows: CountedRow[], i: number, delta: number) =>
    writeRows(
      key,
      rows.map((r, j) => (j === i ? { ...r, count: r.count + delta } : r)).filter((r) => r.count >= 1),
    );

  const dropRow = (key: 'a' | 'e', rows: CountedRow[], i: number) =>
    writeRows(
      key,
      rows.filter((_, j) => j !== i),
    );

  const build = buildResult(target, primary, assists, byId);
  const econ = economyResult(economy, byId);

  // Sharing: the URL only carries what was explicitly picked — defaults (the
  // fallback target, the first builder chip, the economy prefill) are
  // re-derived on load and could drift after a game patch. Copy link pins
  // every current selection into the URL before putting it on the clipboard,
  // so the recipient sees exactly this setup.
  const [copied, setCopied] = useState(false);
  const copyLink = async () => {
    setPanel(null);
    await navigate({
      search: {
        t: targetId ?? undefined,
        p: primary?.id,
        a: packRows(assists),
        e: packRows(economy) ?? 'none',
        f: faction,
      },
      replace: true,
    });
    if (await copyText(window.location.href)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
    // On refusal the address bar still holds the pinned URL, so copying by
    // hand works regardless.
  };

  return (
    <>
      <div className="toolbar">
        <span className="toolbar-summary">
          {build
            ? `${label(build.target)} · ${fmt(build.power)} build power · ${duration(build.seconds)}`
            : 'Build time, drain and economy planning'}
        </span>
        <span className="toolbar-controls">
          <button type="button" className="linkish" onClick={copyLink}>
            {copied ? 'Copied ✓' : 'Copy link'}
          </button>
          <button
            type="button"
            className="linkish"
            onClick={() => {
              setPanel(null);
              navigate({ search: {}, replace: true });
            }}
          >
            Reset
          </button>
        </span>
      </div>

      <main className="calc">
        <section className="calc-col">
          <h2>Build</h2>

          <div className="calc-step">1 · Faction</div>
          <div className="chip-row">
            {FACTION_ORDER.map((fc) => (
              <button
                type="button"
                className="fac-chip"
                key={fc}
                aria-pressed={faction === fc}
                onClick={() => {
                  setPanel(null);
                  patch({ f: faction === fc ? undefined : fc });
                }}
              >
                <span className="dot" style={{ background: FACTION_COLOURS[fc] ?? '#888' }} />
                {fc}
              </button>
            ))}
          </div>

          <div className="calc-step">2 · What are you building?</div>
          <button
            type="button"
            className="select-btn"
            aria-expanded={panel === 'target'}
            onClick={() => togglePanel('target')}
          >
            {target ? (
              <>
                <UnitIcon icon={target.icon} faction={target.faction} manifest={iconManifest} size={36} />
                <span className="select-who">
                  <span className="select-name">{label(target)}</span>
                  <small>{subLine(target)}</small>
                </span>
              </>
            ) : (
              <span className="select-empty">Pick a unit or structure…</span>
            )}
            <span className="caret">▾</span>
          </button>
          {panel === 'target' && (
            <PickerPanel
              units={targetPool}
              subFor={subLine}
              placeholder="Search buildable units…"
              listMax={264}
              iconManifest={iconManifest}
              // A new target invalidates the builder choice — its builtBy list
              // is a different set, so fall back to that list's first chip.
              onPick={(u) => {
                patch({ t: u.id, p: undefined });
                setPanel(null);
              }}
              onClose={() => setPanel(null)}
            />
          )}

          <div className="calc-step">3 · Who starts it?</div>
          <div className="chip-row">
            {builders.map((u) => (
              <button
                type="button"
                className="builder-chip"
                key={u.id}
                aria-pressed={u.id === primary?.id}
                onClick={() => patch({ p: u.id })}
              >
                {(u.tier ? `T${u.tier} ` : '') + label(u)} <small>{fmt(u.buildPower)} bp</small>
              </button>
            ))}
          </div>

          <div className="calc-step">
            4 · Assisted by <span className="opt">(optional)</span>
          </div>
          {assists.length === 0 && <div className="col-empty">None — the builder works alone.</div>}
          <StepperList
            rows={assists}
            byId={byId}
            iconManifest={iconManifest}
            detail={(u) => `${fmt(u.buildPower)} bp each`}
            onBump={(i, d) => bumpRow('a', assists, i, d)}
            onDrop={(i) => dropRow('a', assists, i)}
          />
          <button type="button" className="add-btn" onClick={() => togglePanel('assist')}>
            + Add assisting unit
          </button>
          {panel === 'assist' && (
            <PickerPanel
              units={assistPool}
              subFor={(u) => `${subLine(u)} · ${fmt(u.buildPower)} bp`}
              placeholder="Search assisting units…"
              listMax={220}
              iconManifest={iconManifest}
              onPick={(u) => addRow('a', assists, u.id)}
              onClose={() => setPanel(null)}
            />
          )}
        </section>

        <section className="calc-col">
          <h2>Economy</h2>
          {economy.length === 0 && (
            <div className="col-empty">No structures — add your generators and extractors.</div>
          )}
          <StepperList
            rows={economy}
            byId={byId}
            iconManifest={iconManifest}
            detail={econDetail}
            onBump={(i, d) => bumpRow('e', economy, i, d)}
            onDrop={(i) => dropRow('e', economy, i)}
          />
          <div className="add-btns">
            <button type="button" className="add-btn" onClick={() => togglePanel('econ')}>
              + Add generator / extractor
            </button>
            <button type="button" className="add-btn secondary" onClick={() => togglePanel('drain')}>
              + Energy users…
            </button>
          </div>
          {panel === 'econ' && (
            <PickerPanel
              units={producerPool}
              subFor={econSub}
              placeholder="Search economy structures…"
              listMax={264}
              iconManifest={iconManifest}
              onPick={(u) => addRow('e', economy, u.id)}
              onClose={() => setPanel(null)}
            />
          )}
          {panel === 'drain' && (
            <PickerPanel
              units={consumerPool}
              subFor={econSub}
              placeholder="Search energy users…"
              explainer="Structures that consume alloys or energy — usually not needed, add only if they're part of your base."
              listMax={220}
              iconManifest={iconManifest}
              onPick={(u) => addRow('e', economy, u.id)}
              onClose={() => setPanel(null)}
            />
          )}
        </section>

        <aside className="calc-rail">
          <div className="rail-inner">
            <h2>Can I afford it?</h2>
            <Verdict build={build} econ={econ} hasEconomy={economy.length > 0} />

            {build && (
              <>
                <h2>Build readout</h2>
                <div className="rgrid">
                  <div>
                    <div className="rk">Time</div>
                    <div className="rv">{duration(build.seconds)}</div>
                  </div>
                  <div>
                    <div className="rk">Build power</div>
                    <div className="rv">
                      {fmt(build.power)}
                      {build.assistPower
                        ? ` (${fmt(build.primary.buildPower)}+${fmt(build.assistPower)})`
                        : ''}
                    </div>
                  </div>
                  <div>
                    <div className="rk">Alloys/s</div>
                    <div className="rv alloy-val">{fmt(build.alloysPerSec)}</div>
                  </div>
                  <div>
                    <div className="rk">Energy/s</div>
                    <div className="rv energy-val">{fmt(build.energyPerSec)}</div>
                  </div>
                  <div>
                    <div className="rk">Total alloys</div>
                    <div className="rv alloy-val">{fmt(build.target.cost.alloys, 0)}</div>
                  </div>
                  <div>
                    <div className="rk">Total energy</div>
                    <div className="rv energy-val">{fmt(build.target.cost.energy, 0)}</div>
                  </div>
                </div>
              </>
            )}

            {economy.length > 0 && (
              <>
                <h2>Economy readout</h2>
                <div className="rgrid tight">
                  <div>
                    <div className="rk">Net alloys/s</div>
                    <Net v={econ.alloysNet} />
                  </div>
                  <div>
                    <div className="rk">Net energy/s</div>
                    <Net v={econ.energyNet} />
                  </div>
                </div>
                <div className="rlines">
                  <div>
                    Gross {fmt(econ.alloysIn)} alloys/s · {fmt(econ.energyIn)} energy/s
                  </div>
                  <div>
                    Upkeep {fmt(econ.alloysOut)} alloys/s · {fmt(econ.energyOut)} energy/s
                  </div>
                </div>
              </>
            )}
          </div>
        </aside>
      </main>
    </>
  );
}

const Net = ({ v }: { v: number }) => (
  <div className={`rv ${v < 0 ? 'bad' : 'good'}`}>
    {v > 0 ? '+' : ''}
    {fmt(v)}
  </div>
);

/* ---------------- pieces ---------------- */

function StepperList({
  rows,
  byId,
  iconManifest,
  detail,
  onBump,
  onDrop,
}: {
  rows: CountedRow[];
  byId: Map<string, Unit>;
  iconManifest: Set<string>;
  detail: (u: Unit) => string;
  onBump: (i: number, delta: number) => void;
  onDrop: (i: number) => void;
}) {
  if (!rows.length) return null;
  return (
    <div className="stepper-list">
      {rows.map((row, i) => {
        const u = byId.get(row.id)!;
        return (
          <div className="stepper" key={row.id}>
            <UnitIcon icon={u.icon} faction={u.faction} manifest={iconManifest} size={24} />
            <span className="who">
              <span>{label(u)}</span>
              <small>{detail(u)}</small>
            </span>
            <span className="stepper-controls">
              <button type="button" aria-label="Fewer" onClick={() => onBump(i, -1)}>
                −
              </button>
              <b>{row.count}</b>
              <button type="button" aria-label="More" onClick={() => onBump(i, 1)}>
                +
              </button>
              <button type="button" className="drop" aria-label="Remove" onClick={() => onDrop(i)}>
                ×
              </button>
            </span>
          </div>
        );
      })}
    </div>
  );
}

// Inline dropdown panel: search on top, scrolling icon rows below. Keyboard
// follows the old combobox conventions — arrows move, Enter picks, Escape
// closes — and a click anywhere outside closes it.
function PickerPanel({
  units,
  subFor,
  placeholder,
  explainer,
  listMax,
  iconManifest,
  onPick,
  onClose,
}: {
  units: Unit[];
  subFor: (u: Unit) => string;
  placeholder: string;
  explainer?: string;
  listMax: number;
  iconManifest: Set<string>;
  onPick: (u: Unit) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const mount = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // mousedown, not click — it fires before the opener button's own click, so
  // switching panels closes this one without the two toggles cancelling out.
  useEffect(() => {
    const onDocDown = (e: MouseEvent) => {
      if (!mount.current?.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', onDocDown);
    return () => document.removeEventListener('mousedown', onDocDown);
  }, [onClose]);

  useEffect(() => {
    listRef.current?.querySelector('.picker-item.active')?.scrollIntoView({ block: 'nearest' });
  });

  const needle = q.trim().toLowerCase();
  const rows = units
    .filter((u) => !needle || haystack(u).includes(needle))
    .sort(byTierName)
    .slice(0, 80);
  const activeIdx = Math.min(active, rows.length - 1);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((activeIdx + (e.key === 'ArrowDown' ? 1 : -1) + rows.length) % Math.max(rows.length, 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (rows[activeIdx]) onPick(rows[activeIdx]);
    } else if (e.key === 'Escape') {
      onClose();
    }
  };

  return (
    <div className="picker" ref={mount} onKeyDown={onKeyDown}>
      {explainer && <div className="picker-note">{explainer}</div>}
      <input
        ref={inputRef}
        type="text"
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        role="combobox"
        aria-expanded="true"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setActive(0);
        }}
      />
      <div className="picker-list" style={{ maxHeight: listMax }} ref={listRef}>
        {rows.length ? (
          rows.map((u, i) => (
            <button
              type="button"
              key={u.id}
              className={`picker-item${i === activeIdx ? ' active' : ''}`}
              onClick={() => onPick(u)}
            >
              <UnitIcon icon={u.icon} faction={u.faction} manifest={iconManifest} size={26} />
              <span className="who">
                <span>{label(u)}</span>
                <small>{subFor(u)}</small>
              </span>
            </button>
          ))
        ) : (
          <p className="picker-empty">No matches</p>
        )}
      </div>
    </div>
  );
}

// The useful question isn't the cost, it's whether the economy sustains it — a
// build drawing more than net income stalls and stretches out. The rail leads
// with that answer as one big figure, backed by a sustain bar per resource.
function Verdict({
  build,
  econ,
  hasEconomy,
}: {
  build: ReturnType<typeof buildResult>;
  econ: ReturnType<typeof economyResult>;
  hasEconomy: boolean;
}) {
  if (!build)
    return (
      <div className="verdict">
        <span className="verdict-label">Verdict</span>
        <span className="verdict-big">—</span>
        <p className="verdict-note">Pick something to build and who builds it.</p>
      </div>
    );

  if (!hasEconomy)
    return (
      <div className="verdict">
        <span className="verdict-label">Unconstrained build time</span>
        <span className="verdict-big">{duration(build.seconds)}</span>
        <p className="verdict-note">Add economy structures to see whether the drain is sustainable.</p>
      </div>
    );

  const bars = (
    [
      ['Alloys', build.alloysPerSec, econ.alloysNet],
      ['Energy', build.energyPerSec, econ.energyNet],
    ] as const
  ).map(([resource, need, have]) => {
    const ok = have >= need;
    return {
      resource,
      ok,
      status: ok ? 'sustained' : have > 0 ? 'stalls' : 'no income',
      text: `needs ${fmt(need)}/s · net ${fmt(have)}/s`,
      pct: `${need > 0 ? Math.min(100, Math.max(0, (have / need) * 100)) : 100}%`,
    };
  });

  const worst = Math.max(
    econ.alloysNet > 0 ? build.alloysPerSec / econ.alloysNet : Infinity,
    econ.energyNet > 0 ? build.energyPerSec / econ.energyNet : Infinity,
  );
  const real = worst > 1 ? build.seconds * worst : build.seconds;
  // With no income of a needed resource the build never finishes, which reads
  // better than the em dash a non-finite duration would produce.
  const realLabel = Number.isFinite(real) ? duration(real) : 'never';

  return (
    <div className="verdict">
      <span className="verdict-label">At this income</span>
      <span className={`verdict-big ${worst > 1 ? 'bad' : 'good'}`}>{realLabel}</span>
      {worst > 1 && Number.isFinite(real) ? (
        <span className="verdict-vs">vs {duration(build.seconds)} unconstrained</span>
      ) : null}
      {bars.map((bar) => (
        <div className="vbar" key={bar.resource}>
          <div className="vbar-head">
            <span>
              {bar.resource} <em className={bar.ok ? 'good' : 'bad'}>{bar.status}</em>
            </span>
            <span className="figures">{bar.text}</span>
          </div>
          <div className="vbar-track">
            <div className={`vbar-fill ${bar.ok ? 'ok' : 'no'}`} style={{ width: bar.pct }} />
          </div>
        </div>
      ))}
    </div>
  );
}
