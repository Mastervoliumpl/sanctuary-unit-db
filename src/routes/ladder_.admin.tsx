// The disputes queue. Renders only for the admin; the server functions
// enforce the same gate, so this page is convenience, not security.

import { useEffect, useState } from 'react';
import { Link, createFileRoute } from '@tanstack/react-router';
import { loadMe } from '../lib/auth';
import { adminDisputes, adminResolve } from '../server/admin-fns';
import type { DisputeView, Me } from '../lib/ladder-types';

export const Route = createFileRoute('/ladder_/admin')({
  ssr: false,
  head: () => ({ meta: [{ title: 'Ladder admin — SanctuaryDB' }] }),
  component: AdminPage,
});

function AdminPage() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [disputes, setDisputes] = useState<DisputeView[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    loadMe().then((m) => alive && setMe(m));
    return () => {
      alive = false;
    };
  }, []);

  const load = () =>
    adminDisputes()
      .then(setDisputes)
      .catch(() => setDisputes([]));

  useEffect(() => {
    if (me?.isAdmin) void load();
  }, [me]);

  if (me === undefined) return <main className="profile" />;
  if (!me?.isAdmin) {
    return (
      <main className="profile">
        <p className="empty">
          Admins only. <Link to="/ladder">Back to the ladder</Link>
        </p>
      </main>
    );
  }

  const resolve = async (matchId: string, action: 'team1' | 'team2' | 'void') => {
    setBusy(matchId);
    try {
      await adminResolve({ data: { matchId, action } });
      await load();
    } finally {
      setBusy(null);
    }
  };

  return (
    <main className="profile admin">
      <Link to="/ladder" className="linkish back">
        ← Ladder
      </Link>
      <h1>Disputes</h1>
      {disputes === null ? null : disputes.length === 0 ? (
        <p className="empty">Nothing disputed. Lovely.</p>
      ) : (
        disputes.map((d) => {
          const team = (n: number) =>
            d.participants
              .filter((p) => p.team === n)
              .map((p) => p.personaName)
              .join(', ');
          return (
            <div className="dispute" key={d.matchId}>
              <div className="dispute-head">
                <strong>
                  {d.mode} · {d.mapName}
                </strong>
                <span className="dim">{new Date(d.createdAt).toLocaleString()}</span>
              </div>
              <p>
                <strong>Team 1:</strong> {team(1)} · <strong>Team 2:</strong> {team(2)}
              </p>
              <p>
                {d.reportedBy ?? 'Someone'} reported <strong>Team {d.reportedWinnerTeam} won</strong>;{' '}
                {d.raisedBy} disputed{d.reason ? `: “${d.reason}”` : '.'}
              </p>
              <div className="match-actions">
                <button
                  type="button"
                  className="btn primary"
                  disabled={busy === d.matchId}
                  onClick={() => resolve(d.matchId, 'team1')}
                >
                  Team 1 won
                </button>
                <button
                  type="button"
                  className="btn primary"
                  disabled={busy === d.matchId}
                  onClick={() => resolve(d.matchId, 'team2')}
                >
                  Team 2 won
                </button>
                <button
                  type="button"
                  className="btn"
                  disabled={busy === d.matchId}
                  onClick={() => resolve(d.matchId, 'void')}
                >
                  Void (no rating change)
                </button>
                <Link to="/ladder/match/$matchId" params={{ matchId: d.matchId }} className="linkish">
                  Open match
                </Link>
              </div>
            </div>
          );
        })
      )}
    </main>
  );
}
