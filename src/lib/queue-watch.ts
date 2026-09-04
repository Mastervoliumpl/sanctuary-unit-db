// App-wide queue state. The 5-second status poll is the queue heartbeat
// (entries older than 90 s are swept), so it can't belong to the Play page
// alone: a player browsing units while waiting would silently drop out. It
// lives here instead, module-level like the match alert, and runs while
// either the Play page is open or the last answer said we're queued. A
// localStorage hint carries "queued" across a refresh or a new tab so the
// poll resumes before the first answer.
//
// Not signed in, no session hint → nothing runs, which keeps the static
// build and anonymous visits free of requests.

import { useSyncExternalStore } from 'react';
import { hasSessionHint } from './auth';
import { MODES, type Mode } from './ladder-modes';
import { startMatchAlert } from './match-alert';
import { queueStatus } from '../server/queue-fns';
import type { PlayStatus } from './ladder-types';

const POLL_MS = 5000;
const QUEUED_HINT = 'sdb.queued';

export interface QueueState {
  status: PlayStatus | null;
  // Local "joined at" anchors derived from each answer, so timers tick
  // every second and re-sync on every poll.
  joinedAt: Record<Mode, number | null>;
  // A match that just formed from a queue we were in: the banner sends the
  // player there once, from wherever they are. Cleared by consumeNewMatch.
  newMatchId: string | null;
}

let state: QueueState = {
  status: null,
  joinedAt: { '1v1': null, '2v2': null, '3v3': null },
  newMatchId: null,
};
let watchers = 0; // pages that want polling whether or not we're queued
let timer: ReturnType<typeof setInterval> | null = null;
let inFlight = false;
// "We were in a queue" as of the last answer — or the join click itself,
// since the join may complete the match on the spot.
let wasQueued = false;

const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

const readHint = (): boolean => {
  try {
    return localStorage.getItem(QUEUED_HINT) === '1';
  } catch {
    return false;
  }
};

const writeHint = (queued: boolean): void => {
  try {
    if (queued) localStorage.setItem(QUEUED_HINT, '1');
    else localStorage.removeItem(QUEUED_HINT);
  } catch {
    // Blocked storage: polling still works for this page's lifetime.
  }
};

export const isQueued = (s: PlayStatus | null): boolean => !!s && MODES.some((m) => s.queues[m].inQueue);

// Every status answer — from the poll, a join or a leave — comes through
// here so the whole app sees the same truth.
export function applyStatus(s: PlayStatus): void {
  const at = Date.now();
  const joinedAt = {} as Record<Mode, number | null>;
  for (const m of MODES) {
    const secs = s.queues[m].queuedSeconds;
    joinedAt[m] = secs == null ? null : at - secs * 1000;
  }
  const queued = isQueued(s);
  // Only a match produced by a queue we were in is news; an old open match
  // you're returning to isn't.
  const newMatchId = s.matchId && wasQueued ? s.matchId : null;
  if (newMatchId) startMatchAlert(newMatchId);
  wasQueued = queued;
  writeHint(queued);
  state = { status: s, joinedAt, newMatchId: newMatchId ?? state.newMatchId };
  emit();
  schedule();
}

// The join click: the answer may already be the match.
export function markJoining(): void {
  wasQueued = true;
}

export function consumeNewMatch(): void {
  if (state.newMatchId === null) return;
  state = { ...state, newMatchId: null };
  emit();
}

function poll(): void {
  if (inFlight || !hasSessionHint()) return;
  inFlight = true;
  queueStatus()
    .then(applyStatus)
    .catch(() => {})
    .finally(() => {
      inFlight = false;
    });
}

// Runs while someone is watching or we believe we're queued.
function schedule(): void {
  const wanted =
    hasSessionHint() && (watchers > 0 || isQueued(state.status) || (state.status === null && readHint()));
  if (wanted && timer === null) {
    timer = setInterval(poll, POLL_MS);
  } else if (!wanted && timer !== null) {
    clearInterval(timer);
    timer = null;
  }
}

// A page that wants live status regardless (the Play page). Returns the
// release function.
export function watchQueue(): () => void {
  watchers++;
  poll();
  schedule();
  return () => {
    watchers--;
    schedule();
  };
}

// Called once when the app mounts: if the last visit left us queued, pick
// the heartbeat straight back up.
export function resumeQueueWatch(): void {
  if (state.status === null && readHint()) {
    wasQueued = true;
    poll();
    schedule();
  }
}

export function useQueueState(): QueueState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
    () => state,
  );
}
