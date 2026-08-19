import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildGroups, matches, visibleGroups, DEFAULT_STATUS, type BoardFilters } from './board';
import type { UnitsData } from './types';

// Tests run against the committed units.json — the same file the site serves —
// so they double as regression tests for the extractor's output. The pinned
// numbers come from the README's worked examples; if a re-extract changes
// them, that's a real balance change (fine, update the pin) or an extractor
// regression (the thing these exist to catch).
const data: UnitsData = JSON.parse(
  readFileSync(new URL('../../public/data/units.json', import.meta.url), 'utf8'),
);
const byId = new Map(data.units.map((u) => [u.id, u]));

const noFilters: BoardFilters = {
  faction: new Set(),
  domain: new Set(),
  tier: new Set(),
  role: new Set(),
  status: new Set(),
  search: '',
};

describe('grouping', () => {
  const groups = buildGroups(data.units);

  it('aligns the same roster slot across factions', () => {
    const t1Tanks = groups.find((g) => g.units.some((u) => u.id === 'uel1001'));
    expect(t1Tanks).toBeDefined();
    const names = t1Tanks!.units.map((u) => u.name).sort();
    expect(names).toEqual(['Gimlet', 'Gladius', 'Puma']);
  });

  it('splits slots whose members disagree on tier (Hyena is T2 despite its 3xxx id)', () => {
    const hyena = data.units.find((u) => u.name === 'Hyena')!;
    expect(hyena.tier).toBe(2);
    const group = groups.find((g) => g.units.includes(hyena))!;
    expect(group.tier).toBe(2);
    // Hyena must not share a row with genuine T3 units from the same id slot.
    expect(group.units.every((u) => u.tier === 2)).toBe(true);
  });

  it('every unit lands in exactly one group', () => {
    const seen = new Map<string, number>();
    for (const g of groups) for (const u of g.units) seen.set(u.id, (seen.get(u.id) ?? 0) + 1);
    expect(seen.size).toBe(data.units.length);
    expect([...seen.values()].every((n) => n === 1)).toBe(true);
  });
});

describe('filtering', () => {
  it('status filter matches the labelled availability', () => {
    const f = { ...noFilters, status: new Set([DEFAULT_STATUS]) };
    const kept = data.units.filter((u) => matches(u, f));
    expect(kept.length).toBe(data.units.filter((u) => u.status === 'in-game').length);
  });

  it('search hits ids, names and tags', () => {
    const kodiak = data.units.find((u) => u.name === 'Kodiak')!;
    expect(matches(kodiak, { ...noFilters, search: 'kodiak' })).toBe(true);
    expect(matches(kodiak, { ...noFilters, search: kodiak.id })).toBe(true);
    expect(matches(kodiak, { ...noFilters, search: 'zzz-no-such-unit' })).toBe(false);
  });

  it('metric sort ranks rows by their strongest member and keeps rows whole', () => {
    const groups = visibleGroups(buildGroups(data.units), noFilters, 'dps');
    const score = (g: (typeof groups)[number]) => Math.max(...g.units.map((u) => u.dps ?? 0));
    for (let i = 1; i < groups.length; i++) {
      expect(score(groups[i - 1])).toBeGreaterThanOrEqual(score(groups[i]));
    }
  });
});

describe('extracted data invariants (pinned from the game formulas)', () => {
  const dps = (name: string) => data.units.find((u) => u.name === name)?.dps;

  it('continuous beams use per-tick damage × tick rate — Auger is 256.4, not 8.5', () => {
    expect(dps('Auger')).toBeCloseTo(256.4, 1);
  });

  it('salvo indices wrap muzzle groups — Kodiak includes muzzleSalvoDelay stretch', () => {
    expect(dps('Kodiak')).toBeCloseTo(316.93, 1);
  });

  it('bomber weapons with no muzzles report null DPS, not a confident zero', () => {
    const talen = data.units.find((u) => u.name === 'TALEN')!;
    expect(talen.weapons.some((w) => w.dps === null)).toBe(true);
  });

  it('exactly the commanders, engineers and stations can assist a construction', () => {
    const withRange = data.units.filter((u) => u.buildRange != null && u.buildRange > 0);
    expect(withRange.length).toBe(22);
  });

  it('the OR grammar in canBuild resolves builders — the T3 Land Factory has them', () => {
    const lf3 = byId.get('ues3511')!;
    expect(lf3.builtBy.length).toBeGreaterThan(0);
  });
});
