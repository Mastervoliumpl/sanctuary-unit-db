// Pins the queue rules that supabase/migrations/0002_ladder.sql transcribes
// (queue_radius / pair_queue) — if these change, the SQL must change too.

import { describe, expect, it } from 'vitest';
import { RADIUS_BASE, RADIUS_PER_MINUTE, canPair, pairQueue, searchRadius } from './matchmaking';

const MIN = 60_000;
const entry = (playerId: string, rating: number, joinedAtMs: number) => ({
  playerId,
  rating,
  joinedAtMs,
});

describe('searchRadius', () => {
  it('starts at the base and widens stepwise each full minute', () => {
    expect(searchRadius(0)).toBe(RADIUS_BASE);
    expect(searchRadius(59)).toBe(RADIUS_BASE);
    expect(searchRadius(60)).toBe(RADIUS_BASE + RADIUS_PER_MINUTE);
    expect(searchRadius(8 * 60)).toBe(RADIUS_BASE + 8 * RADIUS_PER_MINUTE);
  });
});

describe('canPair', () => {
  it('requires both players to be inside each other’s radius', () => {
    const now = 10 * MIN;
    const patient = entry('a', 1000, 0); // waited 10 min → radius 1100
    const fresh = entry('b', 1500, now - 1000); // just joined → radius 100
    // The patient player would accept, but the fresh one wouldn't — no pair.
    expect(canPair(patient, fresh, now)).toBe(false);
    expect(canPair(entry('c', 1440, now - 1000), entry('d', 1500, now - 1000), now)).toBe(true);
  });

  it('is symmetric', () => {
    const now = 5 * MIN;
    const a = entry('a', 1000, 0);
    const b = entry('b', 1350, 2 * MIN);
    expect(canPair(a, b, now)).toBe(canPair(b, a, now));
  });
});

describe('pairQueue', () => {
  it('pairs the oldest entry with its oldest mutual candidate', () => {
    const now = 2 * MIN;
    const pairs = pairQueue(
      [entry('newest', 1000, 90_000), entry('oldest', 1000, 0), entry('middle', 1000, 30_000)],
      now,
    );
    expect(pairs).toEqual([['oldest', 'middle']]);
  });

  it('never pairs anyone twice and leaves out-of-range players waiting', () => {
    const now = MIN;
    const pairs = pairQueue([entry('a', 1000, 0), entry('b', 1050, 0), entry('far', 2000, 0)], now);
    expect(pairs).toEqual([['a', 'b']]);
  });

  it('pairs a wide spread once everyone has waited long enough', () => {
    const pairs = pairQueue([entry('a', 800, 0), entry('b', 1900, 0)], 11 * MIN);
    expect(pairs).toEqual([['a', 'b']]);
  });

  it('handles the empty and single-player queue', () => {
    expect(pairQueue([], 0)).toEqual([]);
    expect(pairQueue([entry('alone', 1000, 0)], 60 * MIN)).toEqual([]);
  });
});
