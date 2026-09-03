// The match room. From pairing to result this is every participant's home
// page: it names the map, shows both teams and who hosts, and carries the
// report → confirm/dispute flow plus the cancel handshake. The game has no
// lobby API, so "create the game" is an instruction to a human, not a
// button.

import { useEffect, useRef, useState } from 'react';
import { Link, createFileRoute } from '@tanstack/react-router';
import { loadMe } from '../lib/auth';
import { stopMatchAlert, useMatchAlert } from '../lib/match-alert';
import { launchProgress } from '../lib/mm';
import { useNow } from '../lib/use-now';
import { matchCancel, matchConfirm, matchDispute, matchGet, matchReport } from '../server/match-fns';
import type { MatchParticipant, MatchView, Me } from '../lib/ladder-types';

const POLL_MS = 5000;
const OPEN = ['in_progress', 'reported', 'disputed'];

export const Route = createFileRoute('/ladder_/match/$matchId')({
  ssr: false,
  head: () => ({ meta: [{ title: 'Match — SanctuaryDB' }] }),
  component: MatchRoom,
});

const mmss = (seconds: number) =>
  `${Math.floor(Math.max(0, seconds) / 60)}:${String(Math.max(0, seconds) % 60).padStart(2, '0')}`;

const secondsUntil = (iso: string | null, now: number) =>
  iso ? Math.max(0, Math.floor((Date.parse(iso) - now) / 1000)) : 0;

const names = (players: MatchParticipant[]) => players.map((p) => p.personaName).join(', ');

function MatchRoom() {
  const { matchId } = Route.useParams();
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [match, setMatch] = useState<MatchView | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);
  const now = useNow();
  const alerting = useMatchAlert() === matchId;

  useEffect(() => {
    alive.current = true;
    loadMe().then((m) => alive.current && setMe(m));
    return () => {
      alive.current = false;
    };
  }, []);

  // A match that's over has nothing left to announce.
  useEffect(() => {
    if (match && !OPEN.includes(match.status)) stopMatchAlert();
  }, [match]);

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
    stopMatchAlert(); // any action here means you've seen it
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
  const myTeam = mine?.team ?? null;
  const team1 = match.participants.filter((p) => p.team === 1);
  const team2 = match.participants.filter((p) => p.team === 2);
  const host = match.participants.find((p) => p.playerId === match.hostPlayerId);
  const iAmHost = mine !== undefined && match.hostPlayerId === mine.playerId;
  const teamGame = match.teamSize > 1;
  const we = teamGame ? 'We' : 'I';
  // Auto matches: has the game actually started on both sides?
  const joiner = match.participants.find((p) => p.playerId !== match.hostPlayerId);
  const launched =
    match.mmStatus === 'launch' &&
    joiner !== undefined &&
    launchProgress(match.mmEvents, match.hostPlayerId, joiner.playerId).started;

  return (
    <main className="match-room">
      {alerting && (
        <div className="match-found">
          <strong>🔔 Match found!</strong>
          <button type="button" className="btn primary" onClick={stopMatchAlert}>
            OK, I'm here
          </button>
        </div>
      )}

      <Link to="/ladder" className="linkish back">
        ← Ladder
      </Link>

      <div className="match-map">
        <div className="rk">
          Ranked {match.mode} · map
          {match.mode === '1v1' && (
            <span className="mm-badge" data-auto={match.mmMode === 'auto' || undefined}>
              {match.mmMode === 'auto' ? 'auto-launch' : 'manual hosting'}
            </span>
          )}
        </div>
        <h1>{match.mapName}</h1>
      </div>

      <div className="match-teams">
        <TeamColumn label="Team 1" players={team1} me={mine} hostId={match.hostPlayerId} />
        <div className="team-vs">vs</div>
        <TeamColumn label="Team 2" players={team2} me={mine} hostId={match.hostPlayerId} />
      </div>

      {match.status === 'in_progress' && match.mmStatus === 'countdown' && (
        <div className="countdown">
          <div className="num">{secondsUntil(match.countdownEndsAt, now)}</div>
          <p>
            <strong>Auto-launch.</strong> Both games are ready — in a moment{' '}
            {iAmHost ? 'your game creates the lobby' : `${host?.personaName}'s game creates the lobby`} and{' '}
            {iAmHost ? `${names(match.participants.filter((p) => p !== mine))} joins` : 'yours joins'}. Leave
            the game in the main menu.
          </p>
          {mine && (
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() => act(() => matchCancel({ data: { matchId } }))}
            >
              Cancel
            </button>
          )}
        </div>
      )}

      {match.status === 'in_progress' && match.mmStatus === 'launch' && (
        <LaunchPanel match={match} host={host} />
      )}

      {match.status === 'in_progress' && match.mmStatus === 'manual' && match.mmReason && (
        <p className="match-note">
          Auto-launch is off for this match: <strong>{match.mmReason}</strong>.
        </p>
      )}

      {match.status === 'in_progress' && match.mmStatus !== 'countdown' && (
        <>
          {/* A launching match needs no hosting instructions; once it has
              started, the report controls come back in case the mods' own
              report never arrives. */}
          <div className="match-instructions" hidden={match.mmStatus === 'launch'}>
            {!mine ? (
              <p>Match in progress.</p>
            ) : teamGame ? (
              <p>
                <strong>{iAmHost ? 'You host' : `${host?.personaName} hosts`}.</strong>{' '}
                {iAmHost ? 'Create' : 'They create'} a multiplayer lobby in Sanctuary on{' '}
                <strong>{match.mapName}</strong>; everyone joins and sets the teams exactly as shown —{' '}
                <strong>Team 1:</strong> {names(team1)} · <strong>Team 2:</strong> {names(team2)}.
              </p>
            ) : iAmHost ? (
              <p>
                <strong>You host.</strong> Create a multiplayer lobby in Sanctuary on{' '}
                <strong>{match.mapName}</strong> and invite{' '}
                {names(team2.concat(team1).filter((p) => p !== mine))}.
              </p>
            ) : (
              <p>
                <strong>{host?.personaName} hosts.</strong> Join their lobby in Sanctuary — the map is{' '}
                <strong>{match.mapName}</strong>.
              </p>
            )}
          </div>
          {mine && myTeam !== null && (match.mmStatus !== 'launch' || launched) && (
            <div className="match-actions column">
              <div>
                <span className="rk">When the game ends, report the result:</span>
                <div className="match-actions">
                  <button
                    type="button"
                    className="btn primary"
                    disabled={busy}
                    onClick={() => act(() => matchReport({ data: { matchId, winnerTeam: myTeam } }))}
                  >
                    {we} won
                  </button>
                  <button
                    type="button"
                    className="btn"
                    disabled={busy}
                    onClick={() =>
                      act(() => matchReport({ data: { matchId, winnerTeam: myTeam === 1 ? 2 : 1 } }))
                    }
                  >
                    {we} lost
                  </button>
                </div>
              </div>
              <CancelControl
                match={match}
                myTeam={myTeam}
                now={now}
                busy={busy}
                onCancel={() => act(() => matchCancel({ data: { matchId } }))}
              />
            </div>
          )}
        </>
      )}

      {match.status === 'reported' && mine && myTeam !== null && (
        <ReportedPanel match={match} myTeam={myTeam} now={now} busy={busy} act={act} matchId={matchId} />
      )}

      {match.status === 'disputed' && (
        <p className="match-note">
          This result is disputed and frozen until an admin rules on it. Ratings are unchanged in the
          meantime.
        </p>
      )}

      {match.status === 'cancelled' && (
        <p className="match-note">
          {match.mmStatus === 'failed' ? (
            <>
              Auto-launch failed: <strong>{match.mmReason ?? 'the game did not start'}</strong>. No rating
              change — host a game manually next time, or{' '}
            </>
          ) : match.mmMode === 'auto' ? (
            <>Auto-launch cancelled — no rating change. </>
          ) : (
            <>Match cancelled — no rating change. </>
          )}
          <Link to="/play">Queue again?</Link>
        </p>
      )}

      {match.status === 'completed' && (
        <p className="match-note">
          Result recorded. <Link to="/play">Play again</Link> · <Link to="/ladder">Standings</Link>
        </p>
      )}

      {error && <p className="queue-error">{error}</p>}
    </main>
  );
}

// After the countdown: what the two mods have reported so far. The site
// times each step out (see sweep_mm_matches) and the match comes back as
// failed with the reason if one is missed.
function LaunchPanel({ match, host }: { match: MatchView; host: MatchParticipant | undefined }) {
  const joiner = match.participants.find((p) => p.playerId !== match.hostPlayerId);
  const progress = joiner
    ? launchProgress(match.mmEvents, match.hostPlayerId, joiner.playerId)
    : { lobbyCreated: false, joined: false, started: false };
  return (
    <div className="match-instructions">
      <p>
        <strong>{progress.started ? 'Game on.' : 'Launching…'}</strong>{' '}
        {progress.started
          ? 'Both games are in. Results report themselves when it ends.'
          : 'Leave both games in the main menu — the mods are creating and joining the lobby.'}
      </p>
      <ul className="launch-steps">
        <li data-done={progress.lobbyCreated || match.sessionId !== null || undefined}>
          {host?.personaName ?? 'Host'} creates the lobby
        </li>
        <li data-done={progress.joined || undefined}>{joiner?.personaName ?? 'Opponent'} joins</li>
        <li data-done={progress.started || undefined}>Game starts</li>
      </ul>
    </div>
  );
}

function TeamColumn({
  label,
  players,
  me,
  hostId,
}: {
  label: string;
  players: MatchParticipant[];
  me: MatchParticipant | undefined;
  hostId: string;
}) {
  return (
    <div className="team-col">
      <h3>{label}</h3>
      {players.map((p) => (
        <div className="match-player" key={p.playerId} data-me={p.playerId === me?.playerId || undefined}>
          {p.avatarUrl && <img src={p.avatarUrl} alt="" width={36} height={36} />}
          <div>
            <Link to="/ladder/player/$steamId" params={{ steamId: p.steamId }}>
              {p.personaName}
            </Link>
            {p.playerId === hostId && <span className="host-badge">host</span>}
            {p.faction && (
              <span className="assign" title="Assigned for the auto-launched game">
                {p.faction}
                {p.slot && ` · slot ${p.slot}`}
              </span>
            )}
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
  );
}

// Free for the first minutes (no-shows), then one request from each side.
function CancelControl({
  match,
  myTeam,
  now,
  busy,
  onCancel,
}: {
  match: MatchView;
  myTeam: number;
  now: number;
  busy: boolean;
  onCancel: () => void;
}) {
  const windowLeft = secondsUntil(match.cancelWindowEndsAt, now);

  if (windowLeft > 0) {
    return (
      <p className="cancel-line">
        <button type="button" className="linkish" disabled={busy} onClick={onCancel}>
          Cancel match (game never happened)
        </button>{' '}
        <span className="dim">
          — free for <strong>{mmss(windowLeft)}</strong> more, then both sides have to agree
        </span>
      </p>
    );
  }
  if (match.cancelRequestedByTeam === myTeam) {
    return <p className="cancel-line dim">Cancel requested — waiting for the other side to agree.</p>;
  }
  if (match.cancelRequestedByTeam !== null) {
    return (
      <p className="cancel-line">
        <span className="dim">The other side wants to cancel. </span>
        <button type="button" className="btn" disabled={busy} onClick={onCancel}>
          Agree to cancel
        </button>
      </p>
    );
  }
  return (
    <p className="cancel-line">
      <button type="button" className="linkish" disabled={busy} onClick={onCancel}>
        Request cancel
      </button>{' '}
      <span className="dim">— the other side has to agree too</span>
    </p>
  );
}

function ReportedPanel({
  match,
  myTeam,
  now,
  busy,
  act,
  matchId,
}: {
  match: MatchView;
  myTeam: number;
  now: number;
  busy: boolean;
  act: (fn: () => Promise<MatchView>) => Promise<void>;
  matchId: string;
}) {
  const countdown = mmss(secondsUntil(match.autoConfirmAt, now));
  const reporterTeam = match.participants.find((p) => p.playerId === match.reportedBy)?.team ?? null;
  const ourReport = reporterTeam === myTeam;
  const claimIsOurWin = match.reportedWinnerTeam === myTeam;

  if (ourReport) {
    return (
      <p className="match-note">
        Result reported — waiting for the other side to confirm. It confirms automatically in{' '}
        <strong>{countdown}</strong>.
      </p>
    );
  }

  return (
    <div className="match-actions column">
      <p>
        The other side reported that <strong>{claimIsOurWin ? 'you won' : 'they won'}</strong>. It
        auto-confirms in <strong>{countdown}</strong>.
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
