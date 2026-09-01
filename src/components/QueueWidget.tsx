// The "Find match" panel on the ladder page. While queued it polls
// queueStatus every 5 seconds — that poll is also the heartbeat that keeps
// the queue entry alive and the trigger for pairing passes, so the tab has to
// stay open to stay in queue (and says so).

import { useEffect, useRef, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { loadMe } from '../lib/auth';
import { queueJoin, queueLeave, queueStatus } from '../server/queue-fns';
import type { Me, QueueStatus } from '../lib/ladder-types';

const POLL_MS = 5000;

const elapsed = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

export function QueueWidget() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [status, setStatus] = useState<QueueStatus>({ state: 'idle' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    loadMe().then((m) => alive.current && setMe(m));
    return () => {
      alive.current = false;
    };
  }, []);

  const apply = (s: QueueStatus) => {
    if (!alive.current) return;
    setStatus(s);
    if (s.state === 'matched') {
      navigate({ to: '/ladder/match/$matchId', params: { matchId: s.matchId } });
    }
  };

  // One status check on sign-in resolution (restores a queue/match after a
  // reload), then a 5 s poll for as long as we're queued.
  useEffect(() => {
    if (!me) return;
    queueStatus()
      .then(apply)
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me]);

  useEffect(() => {
    if (!me || status.state !== 'queued') return;
    const id = setInterval(() => {
      queueStatus()
        .then(apply)
        .catch(() => {});
    }, POLL_MS);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me, status.state]);

  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch {
      if (alive.current) setError('Something went wrong — try again.');
    } finally {
      if (alive.current) setBusy(false);
    }
  };

  if (me === undefined) return null;

  if (!me) {
    return (
      <div className="queue-widget">
        <h2>Ranked 1v1</h2>
        <p className="dim">
          Sign in with your Steam account to join the queue. Your rating starts at 1000 and settles in over
          your first ten games.
        </p>
        <a className="steam-signin big" href="/api/auth/steam">
          Sign in through Steam
        </a>
      </div>
    );
  }

  return (
    <div className="queue-widget">
      <h2>Ranked 1v1</h2>
      {status.state === 'queued' ? (
        <>
          <p className="queue-pulse">
            Searching… <strong>{elapsed(status.queuedSeconds)}</strong>
          </p>
          <p className="dim">
            Matching within ±{status.searchRadius} rating — the range widens the longer you wait. Keep this
            tab open.
          </p>
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={() =>
              act(async () => apply(await queueLeave().then(() => ({ state: 'idle' as const }))))
            }
          >
            Leave queue
          </button>
        </>
      ) : (
        <>
          <p className="dim">
            You'll be matched against the nearest-rated opponent in queue, on a random official 1v1 map.
          </p>
          <button
            type="button"
            className="btn primary"
            disabled={busy}
            onClick={() => act(async () => apply(await queueJoin()))}
          >
            Find match
          </button>
        </>
      )}
      {error && <p className="queue-error">{error}</p>}
    </div>
  );
}
