// The admin page: disputes to rule on, games live right now, recent results
// — and deletion, for test games that shouldn't count. Renders only for the
// admin; the server functions enforce the same gate, so this page is
// convenience, not security.

import { useEffect, useState } from 'react';
import { Link, createFileRoute } from '@tanstack/react-router';
import { loadMe } from '../lib/auth';
import { MODES, type Mode } from '../lib/ladder-modes';
import {
  adminDelete,
  adminDisputes,
  adminMapDelete,
  adminMapPools,
  adminMapSave,
  adminMatches,
  adminResolve,
} from '../server/admin-fns';
import type {
  AdminMatches,
  DisputeView,
  LadderMapRow,
  MatchParticipant,
  MatchView,
  Me,
} from '../lib/ladder-types';

export const Route = createFileRoute('/ladder_/admin')({
  ssr: false,
  head: () => ({ meta: [{ title: 'Ladder admin — SanctuaryDB' }] }),
  component: AdminPage,
});

const team = (players: MatchParticipant[], n: number) =>
  players
    .filter((p) => p.team === n)
    .map((p) => p.personaName)
    .join(', ');

const STATUS_LABEL: Record<MatchView['status'], string> = {
  in_progress: 'in progress',
  reported: 'reported, awaiting confirm',
  disputed: 'disputed',
  completed: 'completed',
  cancelled: 'cancelled',
};

function AdminPage() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [disputes, setDisputes] = useState<DisputeView[] | null>(null);
  const [matches, setMatches] = useState<AdminMatches | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    loadMe().then((m) => alive && setMe(m));
    return () => {
      alive = false;
    };
  }, []);

  const load = () =>
    Promise.all([
      adminDisputes()
        .then(setDisputes)
        .catch(() => setDisputes([])),
      adminMatches()
        .then(setMatches)
        .catch(() => setMatches({ live: [], recent: [] })),
    ]);

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

  const run = async (matchId: string, fn: () => Promise<void>) => {
    setBusy(matchId);
    try {
      await fn();
      await load();
    } finally {
      setBusy(null);
    }
  };

  const remove = (m: MatchView) => {
    const what =
      m.status === 'completed'
        ? 'Delete this completed match and reverse its rating changes for everyone in it?'
        : 'Delete this match? The players are freed to queue again; no ratings are involved.';
    if (!window.confirm(what)) return;
    void run(m.id, () => adminDelete({ data: { matchId: m.id } }));
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
        disputes.map((d) => (
          <div className="dispute" key={d.matchId}>
            <div className="dispute-head">
              <strong>
                {d.mode} · {d.mapName}
              </strong>
              <span className="dim">{new Date(d.createdAt).toLocaleString()}</span>
            </div>
            <p>
              <strong>Team 1:</strong> {team(d.participants, 1)} · <strong>Team 2:</strong>{' '}
              {team(d.participants, 2)}
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
                onClick={() =>
                  run(d.matchId, () => adminResolve({ data: { matchId: d.matchId, action: 'team1' } }))
                }
              >
                Team 1 won
              </button>
              <button
                type="button"
                className="btn primary"
                disabled={busy === d.matchId}
                onClick={() =>
                  run(d.matchId, () => adminResolve({ data: { matchId: d.matchId, action: 'team2' } }))
                }
              >
                Team 2 won
              </button>
              <button
                type="button"
                className="btn"
                disabled={busy === d.matchId}
                onClick={() =>
                  run(d.matchId, () => adminResolve({ data: { matchId: d.matchId, action: 'void' } }))
                }
              >
                Void (no rating change)
              </button>
              <Link to="/ladder/match/$matchId" params={{ matchId: d.matchId }} className="linkish">
                Open match
              </Link>
            </div>
          </div>
        ))
      )}

      <h1>Live games</h1>
      {matches === null ? null : matches.live.length === 0 ? (
        <p className="empty">No games on right now.</p>
      ) : (
        matches.live.map((m) => (
          <MatchRow key={m.id} match={m} busy={busy === m.id} onDelete={() => remove(m)} />
        ))
      )}

      <h1>Recent results</h1>
      <p className="hint">
        Deleting a completed match reverses the rating changes it recorded — for test games that shouldn't
        count. Later games aren't recomputed.
      </p>
      {matches === null ? null : matches.recent.length === 0 ? (
        <p className="empty">No completed games yet.</p>
      ) : (
        matches.recent.map((m) => (
          <MatchRow key={m.id} match={m} busy={busy === m.id} onDelete={() => remove(m)} />
        ))
      )}

      <h1>Map pools</h1>
      <p className="hint">
        Names exactly as the game's lobby shows them. Disabled maps stay here but are neither shown nor
        rolled; changes apply to the next match that forms.
      </p>
      <MapPools />
    </main>
  );
}

function MapPools() {
  const [rows, setRows] = useState<LadderMapRow[] | null>(null);
  const [draft, setDraft] = useState<Record<Mode, { name: string; size: string }>>({
    '1v1': { name: '', size: '512' },
    '2v2': { name: '', size: '512' },
    '3v3': { name: '', size: '512' },
  });
  const [busy, setBusy] = useState(false);

  const load = () =>
    adminMapPools()
      .then(setRows)
      .catch(() => setRows([]));

  useEffect(() => {
    void load();
  }, []);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
      await load();
    } finally {
      setBusy(false);
    }
  };

  if (rows === null) return null;

  return (
    <div className="map-pools">
      {MODES.map((mode) => (
        <div className="dispute" key={mode}>
          <div className="dispute-head">
            <strong>{mode}</strong>
            <span className="dim">{rows.filter((r) => r.mode === mode && r.enabled).length} in rotation</span>
          </div>
          <table className="lb-table maps-table">
            <tbody>
              {rows
                .filter((r) => r.mode === mode)
                .map((r) => (
                  <tr key={r.name} data-disabled={!r.enabled || undefined}>
                    <td>{r.name}</td>
                    <td className="dim">{r.size}</td>
                    <td>
                      <button
                        type="button"
                        className="linkish"
                        disabled={busy}
                        onClick={() => run(() => adminMapSave({ data: { ...r, enabled: !r.enabled } }))}
                      >
                        {r.enabled ? 'Disable' : 'Enable'}
                      </button>
                    </td>
                    <td>
                      <button
                        type="button"
                        className="linkish danger"
                        disabled={busy}
                        onClick={() => {
                          if (window.confirm(`Remove ${r.name} from the ${mode} pool?`)) {
                            void run(() => adminMapDelete({ data: { mode, name: r.name } }));
                          }
                        }}
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
          <form
            className="map-add"
            onSubmit={(e) => {
              e.preventDefault();
              const d = draft[mode];
              if (!d.name.trim()) return;
              void run(async () => {
                await adminMapSave({
                  data: { mode, name: d.name, size: Number(d.size) || 512, enabled: true },
                });
                setDraft({ ...draft, [mode]: { name: '', size: '512' } });
              });
            }}
          >
            <input
              placeholder="Map name as shown in the lobby"
              value={draft[mode].name}
              onChange={(e) => setDraft({ ...draft, [mode]: { ...draft[mode], name: e.target.value } })}
            />
            <input
              type="number"
              min={64}
              step={64}
              value={draft[mode].size}
              title="Map size"
              onChange={(e) => setDraft({ ...draft, [mode]: { ...draft[mode], size: e.target.value } })}
            />
            <button type="submit" className="btn" disabled={busy || !draft[mode].name.trim()}>
              Add
            </button>
          </form>
        </div>
      ))}
    </div>
  );
}

function MatchRow({ match: m, busy, onDelete }: { match: MatchView; busy: boolean; onDelete: () => void }) {
  const winner = m.participants.find((p) => p.outcome === 'win')?.team ?? null;
  return (
    <div className="dispute">
      <div className="dispute-head">
        <strong>
          {m.mode} · {m.mapName} · <span className="dim">{STATUS_LABEL[m.status]}</span>
        </strong>
        <span className="dim">{new Date(m.completedAt ?? m.createdAt).toLocaleString()}</span>
      </div>
      <p>
        <strong>Team 1{winner === 1 ? ' (won)' : ''}:</strong> {team(m.participants, 1)} ·{' '}
        <strong>Team 2{winner === 2 ? ' (won)' : ''}:</strong> {team(m.participants, 2)}
      </p>
      <div className="match-actions">
        <Link to="/ladder/match/$matchId" params={{ matchId: m.id }} className="linkish">
          Open match
        </Link>
        <button type="button" className="btn danger" disabled={busy} onClick={onDelete}>
          {m.status === 'completed' ? 'Delete & reverse ratings' : 'Delete'}
        </button>
      </div>
    </div>
  );
}
