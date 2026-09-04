// One queue on the Play page. The count line ("3 in queue · need 4") is the
// honest signal of whether a game is likely soon, so it's always shown —
// signed in or not. The 1v1 card also carries the auto-launch bits: which
// factions you'll accept, and whether your game is ready to be launched.

import type { Mode } from '../lib/ladder-modes';
import { searchRadius } from '../lib/matchmaking';
import { FACTIONS, type Faction } from '../lib/mm';
import { useNow } from '../lib/use-now';
import type { ModPresence, QueueModeStatus } from '../lib/ladder-types';

const elapsed = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

const BLURB: Record<Mode, string> = {
  '1v1': 'Head to head against the nearest-rated opponent in queue.',
  '2v2': 'Solo queue — four players, split into the most even teams by rating.',
  '3v3': 'Solo queue — six players, split into the most even teams by rating.',
};

const STATE_LABEL: Record<ModPresence['state'], string> = {
  menu: 'in the menu',
  lobby: 'in a lobby',
  loading: 'loading a game',
  ingame: 'in a game',
};

export function QueueCard({
  mode,
  status,
  joinedAtMs,
  waiting,
  signedIn,
  blocked,
  busy,
  factions,
  mod,
  onFactions,
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
  factions: Faction[]; // 1v1 only: what an auto match may launch you as
  mod: ModPresence | null; // 1v1 only: the in-game mod's last word
  onFactions: (f: Faction[]) => void;
  onJoin: () => void;
  onLeave: () => void;
}) {
  const inQueue = status?.inQueue ?? false;

  // The server says how long we've waited once per poll; the page anchors a
  // local start time on each answer and this ticks from it, so the timer
  // counts every second and re-syncs whenever the poll comes back.
  const now = useNow();
  const seconds = joinedAtMs === null ? 0 : Math.max(0, Math.floor((now - joinedAtMs) / 1000));

  const auto = mode === '1v1' && signedIn;

  return (
    <div className="queue-widget queue-card" data-active={inQueue || undefined}>
      <h2>Ranked {mode}</h2>
      <p className="queue-count">{waiting === null ? '—' : waiting} in queue</p>
      {inQueue && status ? (
        <>
          <p className="queue-pulse">
            Searching… <strong>{elapsed(seconds)}</strong>
          </p>
          <p className="dim">
            Matching within ±{searchRadius(seconds)} rating — the range widens the longer you wait. Browse the
            rest of the site meanwhile; just keep SanctuaryDB open in a tab.
          </p>
          {auto && (
            <p className="dim">
              Playing as {factions.length === FACTIONS.length ? 'any faction' : factions.join(' or ')}.
            </p>
          )}
          <button type="button" className="btn" disabled={busy} onClick={onLeave}>
            Leave queue
          </button>
        </>
      ) : (
        <>
          <p className="dim">{BLURB[mode]}</p>
          {auto && (
            <div className="faction-pick" aria-label="Factions you'll play as">
              {FACTIONS.map((f) => {
                const on = factions.includes(f);
                return (
                  <label key={f} className="faction-opt" data-on={on || undefined}>
                    <input
                      type="checkbox"
                      checked={on}
                      disabled={busy}
                      onChange={() => {
                        const next = on ? factions.filter((x) => x !== f) : [...factions, f];
                        // Nothing ticked means anything goes — never a reason not to queue.
                        onFactions(next.length > 0 ? next : [...FACTIONS]);
                      }}
                    />
                    {f}
                  </label>
                );
              })}
            </div>
          )}
          {signedIn && (
            <button type="button" className="btn primary" disabled={busy || blocked} onClick={onJoin}>
              Find match
            </button>
          )}
        </>
      )}
      {auto && (
        <p className="launch-state" data-ready={mod?.launchable || undefined}>
          {mod?.launchable ? (
            <>
              <strong>Auto-launch ready</strong> — if your opponent's is too, the game starts itself.
            </>
          ) : mod ? (
            <>Game seen {STATE_LABEL[mod.state]} — back to the main menu to auto-launch.</>
          ) : (
            <>Manual hosting — run the game with the mod for auto-launch.</>
          )}
        </p>
      )}
    </div>
  );
}
