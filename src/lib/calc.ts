// The calculator's maths and option pools. Follows the formulas the game
// documents in templateExplainations.lua:
//
//   buildTime / buildPower                       = seconds to build
//   resDrain(per tick) = cost / (buildTime / buildPower)
//
// Who can build what is not a free choice: a target's `builtBy` list comes from
// resolving every builder's canBuild tag expression, so a T1 air factory simply
// cannot start a T4 bot. Assisting is separate — any unit with the Assist order
// and build power can pour into someone else's build, including one it could
// never have started itself, so those two roles are picked from different pools.

import type { Unit } from './types';

export interface CountedRow {
  id: string;
  count: number;
}

export const shown = (u: Unit) => u.status !== 'no-model';
export const buildable = (u: Unit) => u.builtBy.length > 0 && u.buildTime > 0;
export const canAssist = (u: Unit) => u.canAssist && (u.buildPower ?? 0) > 0;

// The economy picker's split: generators/extractors are what almost every
// setup needs, while upkeep-only structures (shields, radar, factories idling)
// are the secondary "energy users" pool.
export const isProducer = (u: Unit) => (u.production?.alloys ?? 0) > 0 || (u.production?.energy ?? 0) > 0;
export const isConsumer = (u: Unit) =>
  !isProducer(u) && ((u.upkeep?.alloys ?? 0) > 0 || (u.upkeep?.energy ?? 0) > 0);

/* ---------------- maths ---------------- */

export interface BuildResult {
  target: Unit;
  primary: Unit;
  power: number;
  assistPower: number;
  seconds: number;
  alloysPerSec: number;
  energyPerSec: number;
}

export function buildResult(
  target: Unit | undefined,
  primary: Unit | undefined,
  assists: CountedRow[],
  byId: Map<string, Unit>,
): BuildResult | null {
  if (!target || !primary) return null;

  const assistPower = assists.reduce((sum, row) => sum + (byId.get(row.id)?.buildPower ?? 0) * row.count, 0);
  const total = (primary.buildPower ?? 0) + assistPower;
  if (total <= 0) return null;

  const seconds = target.buildTime / total;
  return {
    target,
    primary,
    power: total,
    assistPower,
    seconds,
    alloysPerSec: target.cost.alloys / seconds,
    energyPerSec: target.cost.energy / seconds,
  };
}

export interface EconomyResult {
  alloysIn: number;
  energyIn: number;
  alloysOut: number;
  energyOut: number;
  alloysStore: number;
  energyStore: number;
  alloysNet: number;
  energyNet: number;
}

export function economyResult(economy: CountedRow[], byId: Map<string, Unit>): EconomyResult {
  const t = { alloysIn: 0, energyIn: 0, alloysOut: 0, energyOut: 0, alloysStore: 0, energyStore: 0 };
  for (const row of economy) {
    const u = byId.get(row.id);
    if (!u) continue;
    t.alloysIn += (u.production?.alloys ?? 0) * row.count;
    t.energyIn += (u.production?.energy ?? 0) * row.count;
    t.alloysOut += (u.upkeep?.alloys ?? 0) * row.count;
    t.energyOut += (u.upkeep?.energy ?? 0) * row.count;
    t.alloysStore += (u.storage?.alloys ?? 0) * row.count;
    t.energyStore += (u.storage?.energy ?? 0) * row.count;
  }
  return { ...t, alloysNet: t.alloysIn - t.alloysOut, energyNet: t.energyIn - t.energyOut };
}

/* ---------------- URL packing ---------------- */
// Rows are kept in the URL as "id:count,id:count" so a build can be shared or
// bookmarked — same encoding the pre-framework site used.

export const packRows = (rows: CountedRow[]): string | undefined =>
  rows.length ? rows.map((r) => `${r.id}:${r.count}`).join(',') : undefined;

export const unpackRows = (raw: string | undefined, byId: Map<string, Unit>): CountedRow[] =>
  (raw ?? '')
    .split(',')
    .filter(Boolean)
    .map((chunk) => {
      const [id, count] = chunk.split(':');
      return { id, count: Math.max(1, Number(count) || 1) };
    })
    .filter((r) => byId.has(r.id));
