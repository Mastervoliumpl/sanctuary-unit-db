// The queue hub: every mode's queue with live counts, your open match if you
// have one, and the reporter mod. One 5-second poll feeds all of it — for a
// signed-in player it's also the heartbeat that keeps their queue entries
// alive and the trigger for pairing passes. Degrades to counts-only when
// signed out, and to "unreachable" when there's no backend (the static e2e
// build).

import { useEffect, useRef, useState } from 'react';
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router';
import { QueueCard } from '../components/QueueCard';
import { ReporterCard } from '../components/ReporterCard';
import { loadMe } from '../lib/auth';
import { MODES, type Mode } from '../lib/ladder-modes';
import { queueCounts, queueJoin, queueLeave, queueStatus } from '../server/queue-fns';
import type { Me, PlayStatus, QueueCounts } from '../lib/ladder-types';

const POLL_MS = 5000;

export const Route = createFileRoute('/play')({
  ssr: false,
  head: () => ({
    meta: [
      { title: 'Play — SanctuaryDB' },
      { name: 'description', content: 'Queue for ranked 1v1, 2v2 and 3v3 in Sanctuary: Shattered Sun.' },
    ],
  }),
  component: PlayPage,
});

function PlayPage() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [status, setStatus] = useState<PlayStatus | null>(null);
  const [counts, setCounts] = useState<QueueCounts | null>(null);
  const [busy, setBusy] = useState<Mode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const alive = useRef(true);
  const wasQueued = useRef(false);

  useEffect(() => {
    alive.current = true;
    loadMe().then((m) => alive.current && setMe(m));
    return () => {
      alive.current = false;
    };
  }, []);

  const apply = (s: PlayStatus) => {
    if (!alive.current) return;
    setStatus(s);
    const queued = MODES.some((m) => s.queues[m].inQueue);
    // Only whisk people away when a queue they were in just produced a
    // match; an old open match is shown as a banner instead.
    if (s.matchId && wasQueued.current) {
      navigate({ to: '/ladder/match/$matchId', params: { matchId: s.matchId } });
    }
    wasQueued.current = queued;
  };

  useEffect(() => {
    if (me === undefined) return;
    const tick = () => {
      if (me) {
        queueStatus()
          .then(apply)
          .catch(() => {});
      } else {
        queueCounts()
          .then((c) => alive.current && setCounts(c))
          .catch(() => {});
      }
    };
    tick();
    const id = setInterval(tick, POLL_MS);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me]);

  const act = async (mode: Mode, fn: () => Promise<PlayStatus>) => {
    setBusy(mode);
    setError(null);
    try {
      apply(await fn());
    } catch {
      if (alive.current) setError('Something went wrong — try again.');
    } finally {
      if (alive.current) setBusy(null);
    }
  };

  const signedIn = !!me;
  const blocked = !!status?.matchId;

  return (
    <>
      <div className="toolbar">
        <span className="toolbar-summary">Play ranked</span>
      </div>
      <main className="play">
        {me === null && (
          <div className="queue-widget play-signin">
            <p className="dim">
              Sign in with your Steam account to queue. Every mode has its own rating, starting at 1000 and
              settling in over your first ten games — and you can wait in several queues at once.
            </p>
            <a className="steam-signin big" href="/api/auth/steam">
              Sign in through Steam
            </a>
          </div>
        )}

        {status?.matchId && (
          <div className="match-ready">
            <strong>You have a match waiting.</strong>{' '}
            <Link to="/ladder/match/$matchId" params={{ matchId: status.matchId }}>
              Open the match room
            </Link>
          </div>
        )}

        <div className="queue-grid">
          {MODES.map((mode) => (
            <QueueCard
              key={mode}
              mode={mode}
              status={status?.queues[mode] ?? null}
              waiting={status ? status.queues[mode].waiting : (counts?.[mode] ?? null)}
              signedIn={signedIn}
              blocked={blocked}
              busy={busy === mode}
              onJoin={() => act(mode, () => queueJoin({ data: { mode } }))}
              onLeave={() => act(mode, () => queueLeave({ data: { mode } }))}
            />
          ))}
        </div>
        {error && <p className="queue-error">{error}</p>}

        <section className="play-reporter">
          <ReporterCard />
        </section>
      </main>
    </>
  );
}
