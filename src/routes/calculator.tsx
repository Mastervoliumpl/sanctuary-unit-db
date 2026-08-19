import { useEffect, useMemo, useState } from 'react';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { loadData } from '../lib/data';
import { setMetaLine } from '../lib/meta-line';
import { duration, fmt } from '../lib/format';
import {
  assistOptions,
  buildResult,
  buildable,
  econOptions,
  economyResult,
  nameOf,
  packRows,
  primaryOptions,
  targetOptions,
  unpackRows,
  type CountedRow,
} from '../lib/calc';
import type { Unit } from '../lib/types';
import { Combobox } from '../components/Combobox';

// The whole setup lives in the URL — same params as the pre-framework site
// (t / p / a / e), so a build can be shared or bookmarked.
interface CalcSearch {
  t?: string;
  p?: string;
  a?: string;
  e?: string;
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

function CalculatorPage() {
  const { data, byId } = Route.useLoaderData();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });

  const patch = (p: Partial<CalcSearch>) =>
    navigate({ search: (prev: CalcSearch) => ({ ...prev, ...p }), replace: true });

  const targets = useMemo(() => targetOptions(data.units), [data]);

  // Behave like a select: a stale URL, or a builder that cannot make the newly
  // chosen target, falls back to the first valid option rather than sitting
  // empty. The URL is only rewritten when the user actually picks something.
  const urlTarget = search.t && byId.has(search.t) && buildable(byId.get(search.t)!) ? search.t : null;
  const targetId = urlTarget ?? targets[0]?.value ?? null;
  const target = targetId ? byId.get(targetId) : undefined;

  const primaries = useMemo(() => primaryOptions(target, byId), [target, byId]);
  const urlPrimary = search.p && target?.builtBy.includes(search.p) ? search.p : null;
  const primaryId = urlPrimary ?? primaries[0]?.value ?? null;
  const primary = primaryId ? byId.get(primaryId) : undefined;

  const assists = useMemo(() => unpackRows(search.a, byId), [search.a, byId]);
  const economy = useMemo(() => unpackRows(search.e, byId), [search.e, byId]);

  const [assistPick, setAssistPick] = useState<string | null>(null);
  const [econPick, setEconPick] = useState<string | null>(null);
  const assistOpts = useMemo(() => assistOptions(data.units), [data]);
  const econOpts = useMemo(() => econOptions(data.units), [data]);

  useEffect(() => {
    setMetaLine(
      `${data.units.filter((u) => u.builtBy.length).length} buildable · ` +
        `${data.units.filter((u) => u.canAssist).length} can assist · ` +
        `extracted ${new Date(data.meta.generatedAt).toLocaleDateString()}`,
    );
  }, [data]);

  const addRow = (key: 'a' | 'e', rows: CountedRow[], id: string | null) => {
    if (!id) return;
    const existing = rows.find((r) => r.id === id);
    const next = existing
      ? rows.map((r) => (r.id === id ? { ...r, count: r.count + 1 } : r))
      : [...rows, { id, count: 1 }];
    patch({ [key]: packRows(next) });
  };

  const bumpRow = (key: 'a' | 'e', rows: CountedRow[], i: number, delta: number) => {
    const next = rows
      .map((r, j) => (j === i ? { ...r, count: r.count + delta } : r))
      .filter((r) => r.count >= 1);
    patch({ [key]: packRows(next) });
  };

  const dropRow = (key: 'a' | 'e', rows: CountedRow[], i: number) =>
    patch({ [key]: packRows(rows.filter((_, j) => j !== i)) });

  const build = buildResult(target, primary, assists, byId);
  const econ = economyResult(economy, byId);

  return (
    <main className="calc">
      <section className="panel">
        <h2>Build time &amp; drain</h2>
        <div className="field">
          <label>Building</label>
          <Combobox
            options={targets}
            value={targetId}
            placeholder="Search units…"
            onPick={(id) => {
              // The valid builders change with the target, and the previous
              // pick may no longer be able to start this build.
              const nextTarget = byId.get(id);
              const keepPrimary =
                primaryId && nextTarget?.builtBy.includes(primaryId) ? primaryId : undefined;
              patch({ t: id, p: keepPrimary });
            }}
          />
        </div>

        <div className="field">
          <label>Built by</label>
          <Combobox
            options={primaries}
            value={primaryId}
            placeholder="Search builders…"
            empty="Nothing in the game can build this"
            onPick={(id) => patch({ p: id })}
          />
        </div>

        <div className="field">
          <label>
            Assisted by <span className="opt">optional</span>
          </label>
          <RowList
            rows={assists}
            byId={byId}
            kind="assist"
            onBump={(i, d) => bumpRow('a', assists, i, d)}
            onDrop={(i) => dropRow('a', assists, i)}
          />
          <div className="add-row">
            <div className="grow">
              <Combobox
                options={assistOpts}
                value={assistPick}
                placeholder="Search assisting units…"
                onPick={setAssistPick}
              />
            </div>
            <button
              type="button"
              onClick={() => addRow('a', assists, assistPick ?? assistOpts[0]?.value ?? null)}
            >
              Add
            </button>
          </div>
        </div>

        <div className="readout">
          {build ? (
            <dl className="statgrid">
              <div>
                <dt>Time</dt>
                <dd>{duration(build.seconds)}</dd>
              </div>
              <div>
                <dt>Build power</dt>
                <dd>
                  {fmt(build.power)}
                  {build.assistPower ? (
                    <small>
                      {' '}
                      ({fmt(build.primary.buildPower)} + {fmt(build.assistPower)})
                    </small>
                  ) : null}
                </dd>
              </div>
              <div>
                <dt>Alloys/s</dt>
                <dd className="alloy-val">{fmt(build.alloysPerSec)}</dd>
              </div>
              <div>
                <dt>Energy/s</dt>
                <dd className="energy-val">{fmt(build.energyPerSec)}</dd>
              </div>
              <div>
                <dt>Total alloys</dt>
                <dd className="alloy-val">{fmt(build.target.cost.alloys, 0)}</dd>
              </div>
              <div>
                <dt>Total energy</dt>
                <dd className="energy-val">{fmt(build.target.cost.energy, 0)}</dd>
              </div>
            </dl>
          ) : (
            <p className="empty-row">Pick something to build and who builds it.</p>
          )}
        </div>
      </section>

      <section className="panel">
        <h2>Economy</h2>
        <RowList
          rows={economy}
          byId={byId}
          kind="economy"
          onBump={(i, d) => bumpRow('e', economy, i, d)}
          onDrop={(i) => dropRow('e', economy, i)}
        />
        <div className="add-row">
          <div className="grow">
            <Combobox
              options={econOpts}
              value={econPick}
              placeholder="Search structures…"
              onPick={setEconPick}
            />
          </div>
          <button type="button" onClick={() => addRow('e', economy, econPick ?? econOpts[0]?.value ?? null)}>
            Add structure
          </button>
        </div>

        <div className="readout">
          {economy.length ? (
            <>
              <dl className="statgrid">
                <div>
                  <dt>Net alloys/s</dt>
                  <Net v={econ.alloysNet} />
                </div>
                <div>
                  <dt>Net energy/s</dt>
                  <Net v={econ.energyNet} />
                </div>
                <div>
                  <dt>Alloy storage</dt>
                  <dd>{fmt(econ.alloysStore, 0)}</dd>
                </div>
                <div>
                  <dt>Energy storage</dt>
                  <dd>{fmt(econ.energyStore, 0)}</dd>
                </div>
              </dl>
              <dl className="kv" style={{ marginTop: 10 }}>
                <dt>Gross production</dt>
                <dd>
                  {fmt(econ.alloysIn)} alloys/s · {fmt(econ.energyIn)} energy/s
                </dd>
                <dt>Upkeep</dt>
                <dd>
                  {fmt(econ.alloysOut)} alloys/s · {fmt(econ.energyOut)} energy/s
                </dd>
              </dl>
            </>
          ) : (
            <p className="empty-row">Add structures to see net income.</p>
          )}
        </div>
      </section>

      <section className="panel wide">
        <h2>Can I afford it?</h2>
        <div className="readout">
          <Verdict build={build} econ={econ} hasEconomy={economy.length > 0} />
        </div>
      </section>
    </main>
  );
}

const Net = ({ v }: { v: number }) => (
  <dd className={v < 0 ? 'bad' : 'good'}>
    {v > 0 ? '+' : ''}
    {fmt(v)}
  </dd>
);

function RowList({
  rows,
  byId,
  kind,
  onBump,
  onDrop,
}: {
  rows: CountedRow[];
  byId: Map<string, Unit>;
  kind: 'assist' | 'economy';
  onBump: (i: number, delta: number) => void;
  onDrop: (i: number) => void;
}) {
  if (!rows.length)
    return (
      <div className="builders">
        <p className="empty-row">None added.</p>
      </div>
    );

  const rates = (o: Record<string, number | undefined>) =>
    Object.entries(o)
      .map(([k, v]) => `${fmt(v)} ${k}/s`)
      .join(', ');
  const amounts = (o: Record<string, number | undefined>) =>
    Object.entries(o)
      .map(([k, v]) => `${fmt(v, 0)} ${k}`)
      .join(', ');

  return (
    <div className="builders">
      {rows.map((row, i) => {
        const u = byId.get(row.id)!;
        const detail =
          kind === 'assist'
            ? `${fmt(u.buildPower)} build power each`
            : [
                u.production ? `+${rates(u.production as Record<string, number>)}` : null,
                u.upkeep ? `−${rates(u.upkeep as Record<string, number>)}` : null,
                u.storage ? `${amounts(u.storage as Record<string, number>)} storage` : null,
              ]
                .filter(Boolean)
                .join(' · ');

        return (
          <div className="row" key={row.id}>
            <span className="row-name">
              {nameOf(u)}
              <small>{detail}</small>
            </span>
            <span className="row-controls">
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

// The useful question isn't the cost, it's whether the economy sustains it — a
// build drawing more than net income stalls and stretches out.
function Verdict({
  build,
  econ,
  hasEconomy,
}: {
  build: ReturnType<typeof buildResult>;
  econ: ReturnType<typeof economyResult>;
  hasEconomy: boolean;
}) {
  if (!build || !hasEconomy) return <p className="empty-row">Fill in both panels above.</p>;

  const lines = (
    [
      ['Alloys', build.alloysPerSec, econ.alloysNet],
      ['Energy', build.energyPerSec, econ.energyNet],
    ] as const
  ).map(([res, need, have]) => {
    const ok = have >= need;
    const stretched = have > 0 ? build.seconds * (need / have) : Infinity;
    return (
      <div style={{ display: 'contents' }} key={res}>
        <dt>{res}</dt>
        <dd className={ok ? 'good' : 'bad'}>
          needs {fmt(need)}/s, income {fmt(have)}/s —{' '}
          {ok ? 'sustained' : have > 0 ? `stalls, ~${duration(stretched)} at this income` : 'no income'}
        </dd>
      </div>
    );
  });

  const worst = Math.max(
    econ.alloysNet > 0 ? build.alloysPerSec / econ.alloysNet : Infinity,
    econ.energyNet > 0 ? build.energyPerSec / econ.energyNet : Infinity,
  );
  const real = worst > 1 ? build.seconds * worst : build.seconds;
  // With no income of a resource the build never finishes, which reads better
  // than the em dash a non-finite duration would produce.
  const realLabel = Number.isFinite(real) ? duration(real) : 'never';

  return (
    <>
      <dl className="kv">{lines}</dl>
      <dl className="statgrid" style={{ marginTop: 12 }}>
        <div>
          <dt>Unconstrained</dt>
          <dd>{duration(build.seconds)}</dd>
        </div>
        <div>
          <dt>At this income</dt>
          <dd className={worst > 1 ? 'bad' : 'good'}>{realLabel}</dd>
        </div>
      </dl>
    </>
  );
}
