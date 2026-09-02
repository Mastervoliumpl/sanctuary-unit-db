// The standings: one tab per mode plus the games-weighted overall. Public,
// and degrades to its empty state wherever the backend is unreachable — the
// static e2e build serves this page with no server at all. Queueing lives on
// /play.

import { useEffect, useState } from 'react';
import { Link, createFileRoute } from '@tanstack/react-router';
import { LADDER_MAPS, type LadderMap } from '../lib/ladder-maps';
import { MODES, isLeaderboardMode, type LeaderboardMode, type Mode } from '../lib/ladder-modes';
import { leaderboard, mapPools, queueCounts } from '../server/queue-fns';
import type { LeaderboardRow, QueueCounts } from '../lib/ladder-types';

interface LadderSearch {
  mode?: string;
}

const str = (v: unknown): string | undefined => {
  const s = v == null ? '' : String(v);
  return s ? s : undefined;
};

const TABS: { mode: LeaderboardMode; label: string }[] = [
  { mode: '1v1', label: '1v1' },
  { mode: '2v2', label: '2v2' },
  { mode: '3v3', label: '3v3' },
  { mode: 'overall', label: 'Overall' },
];

export const Route = createFileRoute('/ladder')({
  ssr: false,
  validateSearch: (raw: Record<string, unknown>): LadderSearch => ({ mode: str(raw.mode) }),
  loaderDeps: ({ search }) => ({ mode: isLeaderboardMode(search.mode) ? search.mode : '1v1' }),
  head: () => ({
    meta: [
      { title: 'Ladder — SanctuaryDB' },
      {
        name: 'description',
        content: 'Ranked ladder standings for Sanctuary: Shattered Sun — 1v1, 2v2 and 3v3.',
      },
    ],
  }),
  loader: ({ deps }): Promise<LeaderboardRow[] | null> =>
    leaderboard({ data: { mode: deps.mode } }).catch(() => null),
  component: LadderPage,
});

function LadderPage() {
  const rows = Route.useLoaderData();
  const { mode } = Route.useLoaderDeps();
  const [counts, setCounts] = useState<QueueCounts | null>(null);
  // The curated pools; the seed list stands in until (or if) they load.
  const [pools, setPools] = useState<Record<Mode, LadderMap[]>>(LADDER_MAPS);

  useEffect(() => {
    let alive = true;
    queueCounts()
      .then((c) => alive && setCounts(c))
      .catch(() => {});
    mapPools()
      .then((p) => alive && setPools(p))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const pool = mode === 'overall' ? null : pools[mode];

  return (
    <>
      <div className="toolbar">
        <span className="toolbar-summary">
          Ladder{rows?.length ? ` · ${rows.length} ranked player${rows.length === 1 ? '' : 's'}` : ''}
        </span>
      </div>
      <main className="layout ladder">
        <aside className="ladder-side">
          <div className="queue-widget">
            <h2>In queue right now</h2>
            <ul className="queue-strip">
              {MODES.map((m) => (
                <li key={m}>
                  <span>{m}</span>
                  <strong>{counts ? counts.waiting[m] : '—'}</strong>
                </li>
              ))}
              <li>
                <span>live games</span>
                <strong>{counts ? counts.liveGames : '—'}</strong>
              </li>
            </ul>
            <Link to="/play" className="btn primary block">
              Play ranked
            </Link>
          </div>
          {pool && (
            <div className="map-pool">
              <h3>{mode} map pool</h3>
              <ul>
                {pool.map((m) => (
                  <li key={m.name}>
                    {m.name} <span className="dim">{m.size}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </aside>
        <section className="results">
          <nav className="mode-tabs">
            {TABS.map((t) => (
              <Link
                key={t.mode}
                to="/ladder"
                search={{ mode: t.mode === '1v1' ? undefined : t.mode }}
                className="mode-tab"
                data-active={t.mode === mode || undefined}
              >
                {t.label}
              </Link>
            ))}
          </nav>
          {rows === null ? (
            <p className="empty">The ladder isn't reachable right now — standings will be back shortly.</p>
          ) : rows.length === 0 ? (
            <p className="empty">
              Nobody on the {mode === 'overall' ? 'overall' : mode} board yet. Play one ranked game to appear
              here.
            </p>
          ) : (
            <table className="lb-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Player</th>
                  <th>Rating</th>
                  <th>W</th>
                  <th>L</th>
                  <th>Games</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.steamId}>
                    <td className="dim">{r.rank}</td>
                    <td>
                      <Link
                        to="/ladder/player/$steamId"
                        params={{ steamId: r.steamId }}
                        className="lb-player"
                      >
                        {r.avatarUrl && <img src={r.avatarUrl} alt="" width={20} height={20} />}
                        {r.personaName}
                      </Link>
                    </td>
                    <td className="lb-rating">{r.rating}</td>
                    <td>{r.wins}</td>
                    <td>{r.losses}</td>
                    <td className="dim">{r.gamesPlayed}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </main>
    </>
  );
}
