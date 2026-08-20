import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildResult, economyResult, packRows, unpackRows } from './calc';
import { duration } from './format';
import type { UnitsData } from './types';

const data: UnitsData = JSON.parse(
  readFileSync(new URL('../../public/data/units.json', import.meta.url), 'utf8'),
);
const byId = new Map(data.units.map((u) => [u.id, u]));

describe('build maths', () => {
  // The README's worked example: a T3 Land Factory (4,200 build time, 2,000
  // alloys, 20,000 energy) with three T2 engineers (10 build power each)
  // takes 140s and draws 14.29 alloys/s and 142.86 energy/s.
  it('matches the documented three-engineer example', () => {
    const target = byId.get('ues3511')!; // EDA T3 Land Factory
    const eng = byId.get('uel2501')!; // EDA T2 Engineer, 10 build power
    expect(target.buildTime).toBe(4200);
    expect(eng.buildPower).toBe(10);

    const r = buildResult(target, eng, [{ id: eng.id, count: 2 }], byId)!;
    expect(r.power).toBe(30);
    expect(r.seconds).toBeCloseTo(140, 5);
    expect(r.alloysPerSec).toBeCloseTo(14.29, 2);
    expect(r.energyPerSec).toBeCloseTo(142.86, 2);
  });

  it('returns null without a builder or with zero build power', () => {
    const target = byId.get('ues3511')!;
    expect(buildResult(target, undefined, [], byId)).toBeNull();
  });
});

describe('economy maths', () => {
  it('sums production, upkeep and storage by count', () => {
    const extractor = data.units.find((u) => u.production?.alloys && u.status === 'in-game')!;
    const r = economyResult([{ id: extractor.id, count: 4 }], byId);
    expect(r.alloysIn).toBeCloseTo((extractor.production!.alloys ?? 0) * 4, 5);
    expect(r.alloysNet).toBeCloseTo(r.alloysIn - r.alloysOut, 5);
  });
});

describe('URL row packing', () => {
  it('round-trips and drops unknown ids', () => {
    const rows = [
      { id: 'uel2501', count: 3 },
      { id: 'ues3511', count: 1 },
    ];
    expect(unpackRows(packRows(rows), byId)).toEqual(rows);
    expect(unpackRows('nope:2,uel2501:1', byId)).toEqual([{ id: 'uel2501', count: 1 }]);
    expect(packRows([])).toBeUndefined();
  });

  it('clamps malformed counts to at least 1', () => {
    expect(unpackRows('uel2501:0', byId)).toEqual([{ id: 'uel2501', count: 1 }]);
    expect(unpackRows('uel2501:banana', byId)).toEqual([{ id: 'uel2501', count: 1 }]);
  });
});

describe('duration formatting', () => {
  it('covers the ranges build times actually span', () => {
    expect(duration(8.4)).toBe('8.4 s');
    expect(duration(140)).toBe('2 m 20 s');
    expect(duration(1000)).toBe('16 m 40 s'); // the README's stalled-factory example
    expect(duration(7325)).toBe('2 h 2 m');
    expect(duration(Infinity)).toBe('—');
  });
});
