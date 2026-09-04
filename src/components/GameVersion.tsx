// Which game build the numbers on the page came from, and whether that is
// still what Steam is serving. Sits in the toolbar of every data page so a
// reader can tell at a glance if a patch has landed that the site hasn't
// caught up with yet.

import { useEffect, useState } from 'react';
import type { GameBuild } from '../lib/types';

interface LiveCheck {
  live: { buildId: number; updatedAt: string | null } | null;
  upToDate: boolean | null;
}

// One lookup per page load, shared by every toolbar that mounts.
let pending: Promise<LiveCheck | null> | null = null;

function checkLive(): Promise<LiveCheck | null> {
  pending ??= fetch('/api/game-version')
    .then((r) => (r.ok ? (r.json() as Promise<LiveCheck>) : null))
    .catch(() => null);
  return pending;
}

const day = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : null;

export function GameVersion({ game, generatedAt }: { game: GameBuild | null; generatedAt: string }) {
  const [check, setCheck] = useState<LiveCheck | null>(null);

  useEffect(() => {
    let alive = true;
    checkLive().then((c) => alive && setCheck(c));
    return () => {
      alive = false;
    };
  }, []);

  if (!game) {
    return (
      <span className="gamever" title={`Extracted ${day(generatedAt)}`}>
        Data {day(generatedAt)}
      </span>
    );
  }

  const state = check?.upToDate === true ? 'current' : check?.upToDate === false ? 'stale' : 'unknown';
  // The visible date is when the data was taken, which is what "is this
  // current?" turns on; the install date only tells you when Steam patched
  // the extracting machine.
  const title =
    state === 'current'
      ? `Steam build ${game.buildId}, still the live Playtest build. Data extracted ${day(generatedAt)}.`
      : state === 'stale'
        ? `Steam is now serving build ${check?.live?.buildId} (${day(check?.live?.updatedAt)}); this data is from build ${game.buildId}. A refresh is due.`
        : `Steam build ${game.buildId}, installed ${day(game.updatedAt)}, data extracted ${day(generatedAt)}.`;

  return (
    <span className={`gamever ${state}`} title={title}>
      <span className="dot" aria-hidden="true" />
      Build {game.buildId} · {day(generatedAt)}
      {state === 'stale' && <em>patch pending</em>}
    </span>
  );
}
