// Standing economy and in-place upgrades. Everything here is derived from the
// committed units.json — no new extract, no new fields.
//
// ## Three economy roles, not two
//
// The game builds one of three ResourceEntity categories per unit, and which
// one it picks is decided purely by whether both economy blocks are present
// (`host/units/unitsClasses/unitsBaseClass.lua:630`):
//
//   generation   production, no maintenanceConsumption   free income
//   production   both                                    a converter
//   consumption  maintenanceConsumption only             pure upkeep
//
// The middle case is the one worth separating. A converter's output scales with
// how well its input is met — ResourceEntity documents `productionMultiplier`
// as "Lowest satisfaction of all consumed resources" — so the Alloy Furnace's
// 10 alloy/s is what the 1,000 energy/s *buys*, not a bonus on top of it.
// Listing those as a "Produces" line and an "Upkeep" line reads as a generator
// that happens to cost something, which is the wrong way round.
//
// `narutalProducer` (sic) on a template would force the free-income case even
// with a consumption block. No template in the current data sets it, so the
// rule below is exactly the game's.
//
// ## Upgrades cost the target's full price
//
// An in-place upgrade is not a discounted transform. `UpgradeBehaviorThread`
// (`host/units/unitsClasses/unitsDefault.lua:188`) calls `CreateUnit` for the
// target at the structure's own position and then builds it like anything else,
// and the new unit's construction entity is charged its own template cost and
// build time (`unitsBaseClass.lua:155`). The old structure is deleted on
// completion with no rebate, so the upgrade price is simply the target's cost.
//
// What differs from an ordinary build is who pays the build power: the
// upgrading structure builds its own replacement, so the wall-clock time is
// `target.buildTime / source.buildPower`. That is the *only* reason a radar or
// an extractor carries build power at all — all 33 units with build power and
// nothing in `builds` have an `upgradesTo` — so the number belongs next to the
// upgrade rather than sitting in the economy list looking like a builder stat.

import type { ResourceRates, Unit } from './types';

export type EconomyRole = 'generator' | 'converter' | 'consumer';

export interface Rate {
  alloys: number;
  energy: number;
}

const rate = (r: ResourceRates | null | undefined): Rate => ({
  alloys: r?.alloys ?? 0,
  energy: r?.energy ?? 0,
});

const any = (r: Rate): boolean => r.alloys !== 0 || r.energy !== 0;

export const produces = (u: Unit): Rate => rate(u.production);
export const consumes = (u: Unit): Rate => rate(u.upkeep);

/** Production minus upkeep, per second — what the unit is worth to a base. */
export const netRate = (u: Unit): Rate => {
  const p = produces(u);
  const c = consumes(u);
  return { alloys: p.alloys - c.alloys, energy: p.energy - c.energy };
};

export function economyRole(u: Unit): EconomyRole | null {
  const makes = any(produces(u));
  const spends = any(consumes(u));
  if (makes && spends) return 'converter';
  if (makes) return 'generator';
  if (spends) return 'consumer';
  return null;
}

/** True when the unit's build power exists only to build its own upgrade. */
export const selfUpgraderOnly = (u: Unit): boolean =>
  (u.buildPower ?? 0) > 0 && u.builds.length === 0 && Boolean(u.upgradesTo);

/* ---------------- upgrades ---------------- */

export interface UpgradeDelta {
  label: string;
  from: number;
  to: number;
  /** Rates read as "+3/s"; absolute stats read as plain numbers. */
  perSecond: boolean;
}

export interface UpgradeStep {
  from: Unit;
  to: Unit;
  /** The target's own cost — an upgrade is charged the full build price. */
  alloys: number;
  energy: number;
  buildTime: number;
  /** The structure's own build power, which is what pays for the upgrade. */
  power: number;
  seconds: number;
  alloysPerSec: number;
  energyPerSec: number;
  deltas: UpgradeDelta[];
  /**
   * Seconds of extra alloy output needed to repay the alloy half of the price.
   * Null when the upgrade adds no alloy income. Deliberately about alloy only
   * — the energy price is real and is not folded into this number.
   */
  alloyPayback: number | null;
}

export function upgradeStep(u: Unit, byId: Map<string, Unit>): UpgradeStep | null {
  if (!u.upgradesTo) return null;
  const to = byId.get(u.upgradesTo);
  if (!to) return null;

  const power = u.buildPower ?? 0;
  const seconds = power > 0 ? to.buildTime / power : Infinity;
  const gainedAlloys = netRate(to).alloys - netRate(u).alloys;

  return {
    from: u,
    to,
    alloys: to.cost.alloys,
    energy: to.cost.energy,
    buildTime: to.buildTime,
    power,
    seconds,
    alloysPerSec: Number.isFinite(seconds) ? to.cost.alloys / seconds : 0,
    energyPerSec: Number.isFinite(seconds) ? to.cost.energy / seconds : 0,
    deltas: upgradeDeltas(u, to),
    alloyPayback: gainedAlloys > 0 ? to.cost.alloys / gainedAlloys : null,
  };
}

// Only the stats these structures actually differ on, and only where they do
// differ — an upgrade block listing eight unchanged rows says nothing.
function upgradeDeltas(from: Unit, to: Unit): UpgradeDelta[] {
  const shield = (u: Unit) => u.shields.reduce((n, s) => n + s.max, 0);
  const candidates: Array<[string, number, number, boolean]> = [
    ['Alloy', netRate(from).alloys, netRate(to).alloys, true],
    ['Energy', netRate(from).energy, netRate(to).energy, true],
    ['Health', from.health, to.health, false],
    ['Shield', shield(from), shield(to), false],
    ['Storage alloy', from.storage?.alloys ?? 0, to.storage?.alloys ?? 0, false],
    ['Storage energy', from.storage?.energy ?? 0, to.storage?.energy ?? 0, false],
    ['Radar', from.radar ?? 0, to.radar ?? 0, false],
    ['Sonar', from.sonar ?? 0, to.sonar ?? 0, false],
    ['Vision', from.vision ?? 0, to.vision ?? 0, false],
  ];

  // Build power only means something on the target if it still has a use for
  // it. At the top of a chain it drops to nothing, and "10 -> 0" reads as a
  // loss when all it means is that there is nothing left to upgrade into.
  if (to.builds.length > 0 || to.upgradesTo) {
    candidates.push(['Build power', from.buildPower ?? 0, to.buildPower ?? 0, false]);
  }

  return candidates
    .filter(([, a, b]) => a !== b)
    .map(([label, a, b, perSecond]) => ({ label, from: a, to: b, perSecond }));
}

/** The whole chain from this unit up, e.g. T1 -> T2 -> T3 extractor. */
export function upgradeChain(u: Unit, byId: Map<string, Unit>): UpgradeStep[] {
  const steps: UpgradeStep[] = [];
  const seen = new Set([u.id]);
  let current: Unit | undefined = u;

  while (current) {
    const step = upgradeStep(current, byId);
    // A template that pointed back into the chain would loop forever; none do,
    // but the guard is cheaper than trusting that after every game patch.
    if (!step || seen.has(step.to.id)) break;
    steps.push(step);
    seen.add(step.to.id);
    current = step.to;
  }
  return steps;
}
