// One queue on the Play page. The count line ("3 in queue · need 4") is the
// honest signal of whether a game is likely soon, so it's always shown —
// signed in or not.

import { playersNeeded, type Mode } from '../lib/ladder-modes';
import { searchRadius } from '../lib/matchmaking';
import { useNow } from '../lib/use-now';
import type { QueueModeStatus } from '../lib/ladder-types';

const elapsed = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

const BLURB: Record<Mode, string> = {
  '1v1': 'Head to head against the nearest-rated opponent in queue.',
  '2v2': 'Solo queue — four players, split into the most even teams by rating.',
  '3v3': 'Solo queue — six players, split into the most even teams by rating.',
};

export function QueueCard({
  mode,
  status,
  joinedAtMs,
  waiting,
  signedIn,
  blocked,
  busy,
  onJoin,
  onLeave,
}: {
  mode: Mode;
  status: QueueModeStatus | null; // null when signed out or not loaded yet
  joinedAtMs: number | null; // local anchor derived from the last poll; see PlayPage
  waiting: number | null; // null until the first count arrives
  signedIn: boolean;
  blocked: boolean; // an open match to deal with first
  busy: boolean;
  onJoin: () => void;
  onLeave: () => void;
}) {
  const needed = playersNeeded(mode);
  const inQueue = status?.inQueue ?? false;

  // The server says how long we've waited once per poll; the page anchors a
  // local start time on each answer and this ticks from it, so the timer
  // counts every second and re-syncs whenever the poll comes back.
  const now = useNow();
  const seconds = joinedAtMs === null ? 0 : Math.max(0, Math.floor((now - joinedAtMs) / 1000));

  return (
    <div className="queue-widget queue-card" data-active={inQueue || undefined}>
      <h2>Ranked {mode}</h2>
      <p className="queue-count">
        {waiting === null ? '—' : waiting} in queue <span className="dim">· need {needed}</span>
      </p>
      {inQueue && status ? (
        <>
          <p className="queue-pulse">
            Searching… <strong>{elapsed(seconds)}</strong>
          </p>
          <p className="dim">
            Matching within ±{searchRadius(seconds)} rating — the range widens the longer you wait. Keep this
            tab open.
          </p>
          <button type="button" className="btn" disabled={busy} onClick={onLeave}>
            Leave queue
          </button>
        </>
      ) : (
        <>
          <p className="dim">{BLURB[mode]}</p>
          {signedIn && (
            <button type="button" className="btn primary" disabled={busy || blocked} onClick={onJoin}>
              Find match
            </button>
          )}
        </>
      )}
    </div>
  );
}
