// Pins the queue rules that supabase/migrations/0002_ladder.sql transcribes
// (queue_radius / pair_queue) — if these change, the SQL must change too.

import { describe, expect, it } from 'vitest';
import {
  RADIUS_BASE,
  RADIUS_PER_MINUTE,
  bestSplit,
  canPair,
  formGroups,
  pairQueue,
  searchRadius,
} from './matchmaking';

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

describe('formGroups', () => {
  it('needs the full count before a team game forms', () => {
    const three = [entry('a', 1000, 0), entry('b', 1000, 0), entry('c', 1000, 0)];
    expect(formGroups(three, 4, MIN)).toEqual([]);
    const four = [...three, entry('d', 1000, 0)];
    expect(formGroups(four, 4, MIN).map((g) => g.map((e) => e.playerId))).toEqual([['a', 'b', 'c', 'd']]);
  });

  it('skips an anchor nobody is in range of and lets the rest play', () => {
    const q = [entry('lonely', 2000, 0), entry('a', 1000, 1000), entry('b', 1000, 2000)];
    expect(formGroups(q, 2, MIN).map((g) => g.map((e) => e.playerId))).toEqual([['a', 'b']]);
  });

  it('takes the longest-waiting candidates when more than enough are in range', () => {
    const q = [
      entry('anchor', 1000, 0),
      entry('old', 1000, 1000),
      entry('older', 1000, 500),
      entry('new', 1000, 9000),
    ];
    expect(formGroups(q, 3, MIN)[0].map((e) => e.playerId)).toEqual(['anchor', 'older', 'old']);
  });
});

describe('bestSplit', () => {
  const p = (playerId: string, rating: number) => ({ playerId, rating });

  it('picks the split with the smallest average gap', () => {
    // 1200+900 = 2100 vs 1100+1000 = 2100 — a perfect split exists.
    const s = bestSplit([p('a', 1200), p('b', 1100), p('c', 1000), p('d', 900)], 2);
    expect(s.gap).toBe(0);
    expect(s.team1).toEqual(['a', 'd']);
    expect(s.team2).toEqual(['b', 'c']);
  });

  it('pins player 0 to team 1 and covers 3v3', () => {
    const s = bestSplit(
      [p('a', 1200), p('b', 1100), p('c', 1000), p('d', 1000), p('e', 900), p('f', 800)],
      3,
    );
    expect(s.team1).toContain('a');
    expect(s.team1).toHaveLength(3);
    expect(s.team2).toHaveLength(3);
    expect(s.gap).toBe(0); // 1200+1000+800 vs 1100+1000+900
  });

  it('is the trivial split for 1v1', () => {
    expect(bestSplit([p('a', 1000), p('b', 1500)], 1)).toEqual({ team1: ['a'], team2: ['b'], gap: 500 });
  });
});
