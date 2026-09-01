// The match room. From pairing to result this is both players' home page:
// it names the map, says who hosts the lobby, and carries the report →
// confirm/dispute flow. The game has no lobby API, so "create the game" is an
// instruction to a human, not a button.

import { useEffect, useRef, useState } from 'react';
import { Link, createFileRoute } from '@tanstack/react-router';
import { loadMe } from '../lib/auth';
import { matchCancel, matchConfirm, matchDispute, matchGet, matchReport } from '../server/match-fns';
import type { MatchView, Me } from '../lib/ladder-types';

const POLL_MS = 5000;
const OPEN = ['in_progress', 'reported', 'disputed'];

export const Route = createFileRoute('/ladder_/match/$matchId')({
  ssr: false,
  head: () => ({ meta: [{ title: 'Match — SanctuaryDB' }] }),
  component: MatchRoom,
});

function MatchRoom() {
  const { matchId } = Route.useParams();
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [match, setMatch] = useState<MatchView | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    loadMe().then((m) => alive.current && setMe(m));
    return () => {
      alive.current = false;
    };
  }, []);

  const matchRef = useRef(match);
  useEffect(() => {
    matchRef.current = match;
  }, [match]);

  const refresh = () =>
    matchGet({ data: { matchId } })
      .then((m) => alive.current && setMatch(m))
      .catch(() => alive.current && setMatch(null));

  useEffect(() => {
    refresh();
    const id = setInterval(() => {
      // Only open matches change under us; completed ones are settled record.
      const current = matchRef.current;
      if (current === undefined || (current && OPEN.includes(current.status))) refresh();
    }, POLL_MS);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchId]);

  const act = async (fn: () => Promise<MatchView>) => {
    setBusy(true);
    setError(null);
    try {
      const m = await fn();
      if (alive.current) setMatch(m);
    } catch {
      if (alive.current) setError('That didn’t go through — try again.');
    } finally {
      if (alive.current) setBusy(false);
    }
  };

  if (match === undefined) {
    return <main className="match-room" />;
  }
  if (match === null) {
    return (
      <main className="match-room">
        <p className="empty">
          Match not found — it may not be yours to see, or the ladder isn't reachable.{' '}
          <Link to="/ladder">Back to the ladder</Link>
        </p>
      </main>
    );
  }

  const mine = me ? match.participants.find((p) => p.playerId === me.playerId) : undefined;
  const opponent = mine
    ? match.participants.find((p) => p.playerId !== mine.playerId)
    : match.participants[1];
  const host = match.participants.find((p) => p.playerId === match.hostPlayerId);
  const iAmHost = mine !== undefined && match.hostPlayerId === mine.playerId;

  return (
    <main className="match-room">
      <Link to="/ladder" className="linkish back">
        ← Ladder
      </Link>

      <div className="match-map">
        <div className="rk">Map</div>
        <h1>{match.mapName}</h1>
      </div>

      <div className="match-vs">
        {match.participants.map((p) => (
          <div className="match-player" key={p.playerId} data-me={p.playerId === mine?.playerId || undefined}>
            {p.avatarUrl && <img src={p.avatarUrl} alt="" width={40} height={40} />}
            <div>
              <Link to="/ladder/player/$steamId" params={{ steamId: p.steamId }}>
                {p.personaName}
              </Link>
              <div className="dim">
                {/* Settled: the change, then the rating they now hold. Open:
                    the rating they brought in. */}
                {p.ratingDelta != null && p.ratingAfter != null ? (
                  <>
                    <strong className={p.ratingDelta >= 0 ? 'delta-up' : 'delta-down'}>
                      {p.ratingDelta >= 0 ? '+' : ''}
                      {p.ratingDelta}
                    </strong>{' '}
                    <strong className="lb-rating">{p.ratingAfter}</strong>
                  </>
                ) : (
                  p.ratingBefore
                )}
              </div>
            </div>
            {p.outcome && <span className={`outcome ${p.outcome}`}>{p.outcome}</span>}
          </div>
        ))}
      </div>

      {match.status === 'in_progress' && (
        <>
          <div className="match-instructions">
            {mine ? (
              iAmHost ? (
                <p>
                  <strong>You host.</strong> Create a multiplayer lobby in Sanctuary on{' '}
                  <strong>{match.mapName}</strong> and invite {opponent?.personaName}.
                </p>
              ) : (
                <p>
                  <strong>{host?.personaName} hosts.</strong> Join their lobby in Sanctuary — the map is{' '}
                  <strong>{match.mapName}</strong>.
                </p>
              )
            ) : (
              <p>Match in progress.</p>
            )}
          </div>
          {mine && (
            <div className="match-actions">
              <span className="rk">When the game ends, report the result:</span>
              <button
                type="button"
                className="btn primary"
                disabled={busy}
                onClick={() => act(() => matchReport({ data: { matchId, winnerTeam: mine.team } }))}
              >
                I won
              </button>
              <button
                type="button"
                className="btn"
                disabled={busy}
                onClick={() =>
                  act(() => matchReport({ data: { matchId, winnerTeam: mine.team === 1 ? 2 : 1 } }))
                }
              >
                I lost
              </button>
              <button
                type="button"
                className="linkish"
                disabled={busy}
                onClick={() => act(() => matchCancel({ data: { matchId } }))}
              >
                Cancel match (game never happened)
              </button>
            </div>
          )}
        </>
      )}

      {match.status === 'reported' && mine && (
        <ReportedPanel match={match} mine={mine} busy={busy} act={act} matchId={matchId} />
      )}

      {match.status === 'disputed' && (
        <p className="match-note">
          This result is disputed and frozen until an admin rules on it. Ratings are unchanged in the
          meantime.
        </p>
      )}

      {match.status === 'cancelled' && (
        <p className="match-note">
          Match cancelled — no rating change. <Link to="/ladder">Queue again?</Link>
        </p>
      )}

      {match.status === 'completed' && (
        <p className="match-note">
          Result recorded. <Link to="/ladder">Back to the ladder</Link>
        </p>
      )}

      {error && <p className="queue-error">{error}</p>}
    </main>
  );
}

function ReportedPanel({
  match,
  mine,
  busy,
  act,
  matchId,
}: {
  match: MatchView;
  mine: { playerId: string; team: number };
  busy: boolean;
  act: (fn: () => Promise<MatchView>) => Promise<void>;
  matchId: string;
}) {
  // Live countdown to auto-confirm, ticking locally between polls.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const secondsLeft = match.autoConfirmAt
    ? Math.max(0, Math.floor((Date.parse(match.autoConfirmAt) - now) / 1000))
    : 0;
  const countdown = `${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, '0')}`;
  const iReported = match.reportedBy === mine.playerId;
  const claimIsMyWin = match.reportedWinnerTeam === mine.team;

  if (iReported) {
    return (
      <p className="match-note">
        Result reported — waiting for your opponent to confirm. It confirms automatically in{' '}
        <strong>{countdown}</strong>.
      </p>
    );
  }

  return (
    <div className="match-actions column">
      <p>
        Your opponent reported that <strong>{claimIsMyWin ? 'you won' : 'they won'}</strong>. It auto-confirms
        in <strong>{countdown}</strong>.
      </p>
      <div>
        <button
          type="button"
          className="btn primary"
          disabled={busy}
          onClick={() => act(() => matchConfirm({ data: { matchId } }))}
        >
          Confirm
        </button>
        <button
          type="button"
          className="btn"
          disabled={busy}
          onClick={() => {
            const reason = window.prompt('What happened? (shown to the admin)') ?? '';
            void act(() => matchDispute({ data: { matchId, reason } }));
          }}
        >
          Dispute
        </button>
      </div>
    </div>
  );
}
