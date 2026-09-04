// The "you're queued" strip under the header, on every page but the match
// room. It's what lets a player browse while waiting: the poll behind it is
// the queue heartbeat (see src/lib/queue-watch.ts). When a match forms it
// sends the player to the room from wherever they are.

import { useEffect, useState } from 'react';
import { Link, useNavigate, useRouterState } from '@tanstack/react-router';
import { MODES, type Mode } from '../lib/ladder-modes';
import { applyStatus, consumeNewMatch, isQueued, resumeQueueWatch, useQueueState } from '../lib/queue-watch';
import { useNow } from '../lib/use-now';
import { queueLeave } from '../server/queue-fns';

const elapsed = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export function QueueBanner() {
  const { status, joinedAt, newMatchId } = useQueueState();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  const now = useNow();
  const [busy, setBusy] = useState<Mode | null>(null);

  useEffect(() => {
    resumeQueueWatch();
  }, []);

  // A match that just formed: go there once, from any page.
  useEffect(() => {
    if (!newMatchId) return;
    consumeNewMatch();
    void navigate({ to: '/ladder/match/$matchId', params: { matchId: newMatchId }, replace: true });
  }, [newMatchId, navigate]);

  // The Play page's own cards already say all this; the match room is the
  // destination.
  if (!status || !isQueued(status) || pathname === '/play' || pathname.startsWith('/ladder/match/')) {
    return null;
  }

  const modes = MODES.filter((m) => status.queues[m].inQueue);
  const started = Math.min(...modes.map((m) => joinedAt[m] ?? now));
  const mod = status.mod;

  const leave = async (mode: Mode) => {
    setBusy(mode);
    try {
      applyStatus(await queueLeave({ data: { mode } }));
    } catch {
      // The next poll shows the truth either way.
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="queue-banner" role="status">
      <span className="queue-banner-pulse" aria-hidden="true" />
      <span>
        Queued for ranked <strong>{modes.join(' · ')}</strong> · <strong>{elapsed(now - started)}</strong>
      </span>
      {modes.includes('1v1') && (
        <span className="dim">
          {mod?.launchable ? 'auto-launch ready' : mod ? 'mod seen, not in the menu' : 'manual hosting'}
        </span>
      )}
      <span className="queue-banner-actions">
        <Link to="/play" className="linkish">
          Play page
        </Link>
        {modes.map((m) => (
          <button key={m} type="button" className="linkish" disabled={busy === m} onClick={() => leave(m)}>
            Leave {modes.length > 1 ? m : 'queue'}
          </button>
        ))}
      </span>
    </div>
  );
}
