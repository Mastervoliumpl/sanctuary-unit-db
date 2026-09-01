// Pins the rating maths that supabase/migrations/0003_results.sql transcribes
// — if these change, the SQL must change with them.

import { describe, expect, it } from 'vitest';
import {
  K_PROVISIONAL,
  K_STANDARD,
  PROVISIONAL_GAMES,
  RATING_FLOOR,
  START_RATING,
  applyResult,
  expectedScore,
  kFactor,
} from './elo';

describe('expectedScore', () => {
  it('is a coin flip between equals and sums to 1', () => {
    expect(expectedScore(1000, 1000)).toBe(0.5);
    expect(expectedScore(1200, 1000) + expectedScore(1000, 1200)).toBeCloseTo(1, 12);
  });

  it('gives the textbook 400-point favourite ~0.909', () => {
    expect(expectedScore(1400, 1000)).toBeCloseTo(10 / 11, 12);
  });
});

describe('kFactor', () => {
  it('is provisional for the first ten games, then standard', () => {
    expect(kFactor(0)).toBe(K_PROVISIONAL);
    expect(kFactor(PROVISIONAL_GAMES - 1)).toBe(K_PROVISIONAL);
    expect(kFactor(PROVISIONAL_GAMES)).toBe(K_STANDARD);
    expect(kFactor(500)).toBe(K_STANDARD);
  });
});

describe('applyResult', () => {
  const veteran = (rating: number) => ({ rating, gamesPlayed: 100 });

  it('moves two equal veterans by exactly K/2 each way', () => {
    const r = applyResult(veteran(START_RATING), veteran(START_RATING));
    expect(r.winnerDelta).toBe(K_STANDARD / 2);
    expect(r.loserDelta).toBe(-K_STANDARD / 2);
  });

  it('is zero-sum when both players share a K', () => {
    const r = applyResult(veteran(1180), veteran(1020));
    expect(r.winnerDelta + r.loserDelta).toBe(0);
  });

  it('moves provisional players faster than veterans in the same game', () => {
    const r = applyResult({ rating: 1000, gamesPlayed: 2 }, veteran(1000));
    expect(r.winnerDelta).toBe(K_PROVISIONAL / 2);
    expect(r.loserDelta).toBe(-K_STANDARD / 2);
  });

  it('gives an upset winner more than a favourite winner', () => {
    const upset = applyResult(veteran(1000), veteran(1300));
    const expected = applyResult(veteran(1300), veteran(1000));
    expect(upset.winnerDelta).toBeGreaterThan(expected.winnerDelta);
  });

  it('never drops anyone below the floor', () => {
    // Near-equals near the floor: the loser would drop ~20 but is clamped.
    const r = applyResult(
      { rating: RATING_FLOOR, gamesPlayed: 0 },
      { rating: RATING_FLOOR + 5, gamesPlayed: 0 },
    );
    expect(r.loserAfter).toBe(RATING_FLOOR);
    expect(r.loserDelta).toBe(-5);
  });

  it('pins the worked example the SQL must reproduce: 1100 beats 1000', () => {
    // E = 1/(1+10^(-100/400)) ≈ 0.640; both veterans: winner +7, loser -7.
    const r = applyResult(veteran(1100), veteran(1000));
    expect(r.winnerAfter).toBe(1107);
    expect(r.loserAfter).toBe(993);
  });
});
