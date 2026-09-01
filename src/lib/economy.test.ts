import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { economyRole, netRate, selfUpgraderOnly, upgradeChain, upgradeStep } from './economy';
import type { UnitsData } from './types';

const data: UnitsData = JSON.parse(
  readFileSync(new URL('../../public/data/units.json', import.meta.url), 'utf8'),
);
const byId = new Map(data.units.map((u) => [u.id, u]));

describe('economy roles', () => {
  // The game picks its ResourceEntity category on whether both economy blocks
  // are present, so these three are the whole space.
  it('splits producers, converters and consumers the way the templates do', () => {
    const by = (role: string) => data.units.filter((u) => economyRole(u) === role);
    expect(
      by('converter')
        .map((u) => u.id)
        .sort(),
    ).toEqual(['ucs3603', 'ues3603', 'ugs3603']);
    expect(by('generator')).toHaveLength(22);
    expect(by('consumer')).toHaveLength(26);
    // Everything else has no standing economy at all.
    expect(by('generator').length + by('converter').length + by('consumer').length).toBe(51);
  });

  it('reads the Alloy Furnace as a trade, not a producer with upkeep', () => {
    const furnace = byId.get('ues3603')!;
    expect(economyRole(furnace)).toBe('converter');
    expect(netRate(furnace)).toEqual({ alloys: 10, energy: -1000 });
  });

  it('reads a shield as pure upkeep and an extractor as free income', () => {
    expect(economyRole(byId.get('ues2401')!)).toBe('consumer');
    expect(netRate(byId.get('ues2401')!)).toEqual({ alloys: 0, energy: -100 });
    expect(economyRole(byId.get('ues1601')!)).toBe('generator');
    expect(netRate(byId.get('ues1601')!)).toEqual({ alloys: 1, energy: 0 });
  });

  it('gives units with no economy block no role', () => {
    expect(economyRole(byId.get('uel1001')!)).toBeNull(); // Puma, a plain tank
  });
});

describe('build power on structures that build nothing', () => {
  // The claim the UI leans on: every structure carrying build power with an
  // empty `builds` list has an upgrade target, so the number is an upgrade rate
  // rather than a builder stat and belongs in the upgrade block.
  it("only ever exists to raise the unit's own upgrade", () => {
    const idle = data.units.filter((u) => (u.buildPower ?? 0) > 0 && u.builds.length === 0);
    expect(idle).toHaveLength(33);
    expect(idle.every((u) => u.upgradesTo)).toBe(true);
    expect(idle.every(selfUpgraderOnly)).toBe(true);
  });

  it('leaves real builders alone', () => {
    const factory = byId.get('ues1511')!; // T1 Land Factory: builds and upgrades
    expect(factory.buildPower).toBe(10);
    expect(selfUpgraderOnly(factory)).toBe(false);
  });
});

describe('upgrade maths', () => {
  // An upgrade is charged the target's full cost and is raised by the structure
  // itself, so a T1 Alloy Extractor (5 build power) reaching a T2 (600 build
  // time, 600 alloy, 6,000 energy) takes 120s at 5 alloy/s and 50 energy/s.
  it("charges the target's full price at the structure's own build power", () => {
    const step = upgradeStep(byId.get('ues1601')!, byId)!;
    expect(step.to.id).toBe('ues2601');
    expect([step.alloys, step.energy]).toEqual([600, 6000]);
    expect(step.power).toBe(5);
    expect(step.seconds).toBeCloseTo(120, 5);
    expect(step.alloysPerSec).toBeCloseTo(5, 5);
    expect(step.energyPerSec).toBeCloseTo(50, 5);
  });

  it('prices the alloy payback off the extra income only', () => {
    // T1 -> T2 extractor buys +3 alloys/s for 600 alloys: 200 seconds.
    const step = upgradeStep(byId.get('ues1601')!, byId)!;
    expect(step.alloyPayback).toBeCloseTo(200, 5);
    // A shield gains no income, so there is nothing to pay it back.
    expect(upgradeStep(byId.get('ues2401')!, byId)!.alloyPayback).toBeNull();
  });

  it('lists only the stats that actually move', () => {
    const step = upgradeStep(byId.get('ues1601')!, byId)!;
    const byLabel = new Map(step.deltas.map((d) => [d.label, d]));
    expect(byLabel.get('Alloy')).toMatchObject({ from: 1, to: 4, perSecond: true });
    expect(byLabel.get('Health')).toMatchObject({ from: 600, to: 2400 });
    expect(step.deltas.every((d) => d.from !== d.to)).toBe(true);
    expect(byLabel.has('Sonar')).toBe(false);
  });

  it('drops build power at the top of a chain rather than reporting a loss', () => {
    // T2 -> T3 Shield: the T3 has nothing left to upgrade into, so its build
    // power is 0 and the delta would read as a downgrade.
    const step = upgradeStep(byId.get('ues2401')!, byId)!;
    expect(step.from.buildPower).toBe(10);
    expect(step.to.buildPower).toBeNull();
    expect(step.deltas.some((d) => d.label === 'Build power')).toBe(false);
    // T1 -> T2 extractor keeps it, because the T2 still upgrades.
    const extractor = upgradeStep(byId.get('ues1601')!, byId)!;
    expect(extractor.deltas.some((d) => d.label === 'Build power')).toBe(true);
  });

  it('resolves every upgrade in the data', () => {
    const upgraders = data.units.filter((u) => u.upgradesTo);
    expect(upgraders).toHaveLength(57);
    expect(upgraders.every((u) => upgradeStep(u, byId) !== null)).toBe(true);
    // Every one is buildable by itself, so no upgrade reports an infinite time.
    expect(upgraders.every((u) => Number.isFinite(upgradeStep(u, byId)!.seconds))).toBe(true);
  });

  it('returns null for units that do not upgrade', () => {
    expect(upgradeStep(byId.get('uel1001')!, byId)).toBeNull(); // Puma
    expect(upgradeStep(byId.get('ues3601')!, byId)).toBeNull(); // top of the chain
  });

  it('walks the whole chain and terminates', () => {
    const chain = upgradeChain(byId.get('ues1601')!, byId);
    expect(chain.map((s) => s.to.id)).toEqual(['ues2601', 'ues3601']);
    // 600 + 2,000 alloy to take a T1 extractor all the way to T3.
    expect(chain.reduce((n, s) => n + s.alloys, 0)).toBe(2600);
    expect(upgradeChain(byId.get('uel1001')!, byId)).toEqual([]);
  });
});
