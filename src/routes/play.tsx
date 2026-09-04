// The queue hub: every mode's queue with live counts, your open match if you
// have one, and the reporter mod. The live status comes from the app-wide
// queue watch (src/lib/queue-watch.ts) — this page just asks it to keep
// polling while open, so counts stay fresh even before you queue. Degrades
// to counts-only when signed out, and to "unreachable" when there's no
// backend (the static e2e build).

import { useEffect, useRef, useState } from 'react';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { AlertSettings } from '../components/AlertSettings';
import { QueueCard } from '../components/QueueCard';
import { ReporterCard } from '../components/ReporterCard';
import { loadMe } from '../lib/auth';
import { MODES, type Mode } from '../lib/ladder-modes';
import { primeAudio } from '../lib/match-alert';
import { FACTIONS, isFaction, type Faction } from '../lib/mm';
import { applyStatus, markJoining, useQueueState, watchQueue } from '../lib/queue-watch';
import { queueCounts, queueJoin, queueLeave } from '../server/queue-fns';
import type { Me, PlayStatus, QueueCounts } from '../lib/ladder-types';

const POLL_MS = 5000;

// Factions you'll accept in an auto-launched 1v1, remembered per browser.
const FACTIONS_KEY = 'sdb.factions';

function loadFactions(): Faction[] {
  try {
    const raw = localStorage.getItem(FACTIONS_KEY);
    const picked = raw ? (JSON.parse(raw) as unknown[]).filter(isFaction) : [];
    return picked.length > 0 ? [...new Set(picked)] : [...FACTIONS];
  } catch {
    return [...FACTIONS];
  }
}

function saveFactions(f: Faction[]): void {
  try {
    localStorage.setItem(FACTIONS_KEY, JSON.stringify(f));
  } catch {
    // Blocked storage: the choice still applies to this visit.
  }
}

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
  const { status, joinedAt } = useQueueState();
  const [counts, setCounts] = useState<QueueCounts | null>(null);
  const [busy, setBusy] = useState<Mode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [factions, setFactions] = useState<Faction[]>(loadFactions);
  const navigate = useNavigate();
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    loadMe().then((m) => alive.current && setMe(m));
    return () => {
      alive.current = false;
    };
  }, []);

  // Signed in: the shared watch polls while this page is open. Signed out:
  // just the public counts.
  useEffect(() => {
    if (me === undefined) return;
    if (me) return watchQueue();
    const tick = () =>
      queueCounts()
        .then((c) => alive.current && setCounts(c))
        .catch(() => {});
    tick();
    const id = setInterval(tick, POLL_MS);
    return () => clearInterval(id);
  }, [me]);

  // An open match is the only thing that matters here: go straight to it,
  // whether it just formed or it's one from earlier. You can't queue with
  // one open anyway, and the match room links back here once it's done.
  // (The banner handles the alert for a match that formed from a queue.)
  useEffect(() => {
    if (status?.matchId) {
      void navigate({ to: '/ladder/match/$matchId', params: { matchId: status.matchId }, replace: true });
    }
  }, [status?.matchId, navigate]);

  const act = async (mode: Mode, fn: () => Promise<PlayStatus>) => {
    setBusy(mode);
    setError(null);
    try {
      applyStatus(await fn());
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
              factions={factions}
              mod={status?.mod ?? null}
              onFactions={(f) => {
                setFactions(f);
                saveFactions(f);
              }}
              onJoin={() => {
                // Inside the click, so the browser lets the ding play later.
                primeAudio();
                // The join itself may complete the match (someone waiting).
                markJoining();
                void act(mode, () => queueJoin({ data: { mode, factions } }));
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
