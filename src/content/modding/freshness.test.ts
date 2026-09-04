import { describe, expect, it } from 'vitest';
import { snapshotFreshness } from './freshness';

describe('documentation freshness', () => {
  it('marks the only documented snapshot older when a newer release is known', () => {
    expect(snapshotFreshness(10, 11, null)).toEqual({ state: 'older', newestKnown: 11 });
  });
  it('uses live release evidence without discarding a newer known release', () => {
    expect(snapshotFreshness(10, 11, 12)).toEqual({ state: 'older', newestKnown: 12 });
    expect(snapshotFreshness(10, 11, 10).state).toBe('older');
  });
  it('only labels the documented build current after a matching live check', () => {
    expect(snapshotFreshness(11, 11, 11).state).toBe('current');
    expect(snapshotFreshness(11, 11, null).state).toBe('unknown');
    expect(snapshotFreshness(12, 11, 11).state).toBe('unknown');
  });
});
