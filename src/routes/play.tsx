// The queue hub: every mode's queue with live counts, your open match if you
// have one, and the reporter mod. One 5-second poll feeds all of it — for a
// signed-in player it's also the heartbeat that keeps their queue entries
// alive and the trigger for pairing passes. Degrades to counts-only when
// signed out, and to "unreachable" when there's no backend (the static e2e
// build).

import { useEffect, useRef, useState } from 'react';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { AlertSettings } from '../components/AlertSettings';
import { QueueCard } from '../components/QueueCard';
import { ReporterCard } from '../components/ReporterCard';
import { loadMe } from '../lib/auth';
import { MODES, type Mode } from '../lib/ladder-modes';
import { primeAudio, startMatchAlert } from '../lib/match-alert';
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
  // When each poll answered, per mode, as "you joined at" — the cards tick
  // from this locally between polls.
  const [joinedAt, setJoinedAt] = useState<Record<Mode, number | null>>({
    '1v1': null,
    '2v2': null,
    '3v3': null,
  });
  const [counts, setCounts] = useState<QueueCounts | null>(null);
  const [busy, setBusy] = useState<Mode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const alive = useRef(true);
  const wasQueued = useRef(false); // so a match that forms from OUR queue rings the alert

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
    const at = Date.now();
    setJoinedAt({
      '1v1': s.queues['1v1'].queuedSeconds == null ? null : at - s.queues['1v1'].queuedSeconds * 1000,
      '2v2': s.queues['2v2'].queuedSeconds == null ? null : at - s.queues['2v2'].queuedSeconds * 1000,
      '3v3': s.queues['3v3'].queuedSeconds == null ? null : at - s.queues['3v3'].queuedSeconds * 1000,
    });
    // An open match is the only thing that matters: go straight to it,
    // whether it just formed (even on the join click itself, when someone
    // was already waiting) or it's one from earlier. You can't queue with
    // one open anyway, and the match room links back here once it's done.
    // The alert only rings when a queue we were in produced it — an old
    // match you're returning to isn't news.
    if (s.matchId) {
      if (wasQueued.current) startMatchAlert(s.matchId);
      navigate({ to: '/ladder/match/$matchId', params: { matchId: s.matchId }, replace: true });
    }
    wasQueued.current = MODES.some((m) => s.queues[m].inQueue);
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
  const liveGames = status?.liveGames ?? counts?.liveGames ?? null;

  return (
    <>
      <div className="toolbar">
        <span className="toolbar-summary">
          Play ranked
          {liveGames !== null &&
            ` · ${liveGames === 0 ? 'no games live right now' : `${liveGames} game${liveGames === 1 ? '' : 's'} live now`}`}
        </span>
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

        <div className="queue-grid">
          {MODES.map((mode) => (
            <QueueCard
              key={mode}
              mode={mode}
              status={status?.queues[mode] ?? null}
              joinedAtMs={joinedAt[mode]}
              waiting={status ? status.queues[mode].waiting : (counts?.waiting[mode] ?? null)}
              signedIn={signedIn}
              blocked={blocked}
              busy={busy === mode}
              onJoin={() => {
                // Inside the click, so the browser lets the ding play later.
                primeAudio();
                // The join itself may complete the match (someone waiting).
                wasQueued.current = true;
                void act(mode, () => queueJoin({ data: { mode } }));
              }}
              onLeave={() => act(mode, () => queueLeave({ data: { mode } }))}
            />
          ))}
        </div>
        {error && <p className="queue-error">{error}</p>}

        <section className="play-extras">
          {signedIn && <AlertSettings />}
          <ReporterCard />
        </section>
      </main>
    </>
  );
}
