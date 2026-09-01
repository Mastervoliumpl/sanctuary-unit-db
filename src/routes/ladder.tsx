// The ladder home: leaderboard + queue. Works signed-out (public standings),
// and degrades to its empty state wherever the backend is unreachable — the
// static e2e build serves this page with no server at all.

import { useEffect, useState } from 'react';
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router';
import { QueueWidget } from '../components/QueueWidget';
import { loadMe } from '../lib/auth';
import { LADDER_MAPS_1V1 } from '../lib/ladder-maps';
import { leaderboard } from '../server/queue-fns';
import { testLoseGame } from '../server/test-fns';
import type { LeaderboardRow, Me } from '../lib/ladder-types';

export const Route = createFileRoute('/ladder')({
  ssr: false,
  head: () => ({
    meta: [
      { title: 'Ladder — SanctuaryDB' },
      {
        name: 'description',
        content: 'Ranked 1v1 ladder for Sanctuary: Shattered Sun — queue up, play, climb.',
      },
    ],
  }),
  loader: (): Promise<LeaderboardRow[] | null> => leaderboard().catch(() => null),
  component: LadderPage,
});

// TEMPORARY pre-launch test control — delete with src/server/test-fns.ts
// before the ladder goes live (the DB reset then wipes its fake results).
function TestControls() {
  const [me, setMe] = useState<Me | null>(null);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    let alive = true;
    loadMe().then((m) => alive && setMe(m));
    return () => {
      alive = false;
    };
  }, []);

  if (!me) return null;

  return (
    <button
      type="button"
      className="btn"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          const { matchId } = await testLoseGame();
          navigate({ to: '/ladder/match/$matchId', params: { matchId } });
        } catch {
          setBusy(false);
        }
      }}
    >
      TEST: log a loss vs a dummy
    </button>
  );
}

function LadderPage() {
  const rows = Route.useLoaderData();

  return (
    <>
      <div className="toolbar">
        <span className="toolbar-summary">
          Ranked 1v1{rows?.length ? ` · ${rows.length} ranked player${rows.length === 1 ? '' : 's'}` : ''}
        </span>
      </div>
      <main className="layout ladder">
        <aside className="ladder-side">
          <QueueWidget />
          <TestControls />
          <div className="map-pool">
            <h3>Map pool</h3>
            <ul>
              {LADDER_MAPS_1V1.map((m) => (
                <li key={m.name}>
                  {m.name} <span className="dim">{m.size}</span>
                </li>
              ))}
            </ul>
          </div>
        </aside>
        <section className="results">
          {rows === null ? (
            <p className="empty">The ladder isn't reachable right now — standings will be back shortly.</p>
          ) : rows.length === 0 ? (
            <p className="empty">Nobody on the board yet. Play one ranked game to appear here.</p>
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
