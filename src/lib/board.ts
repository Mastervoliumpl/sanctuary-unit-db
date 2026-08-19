// The aligned faction board: grouping, filtering and sorting. Pure functions
// over the units array — everything stateful lives in the route's search params.

import type { Faction, Unit } from './types';
import { FACTION_ORDER } from '../components/UnitIcon';

// Availability comes from the engine tree's QA tracker crossed with whether the
// unit actually has art. "In progress" means the model exists but is gated —
// awaiting approval, bad rigging, or missing a damage state.
export const STATUS_LABELS: Record<string, string> = {
  'in-game': 'In game',
  'in-progress': 'In progress',
  'no-model': 'No model',
};
export const DEFAULT_STATUS = 'In game';

export const DOMAIN_ORDER: Record<string, number> = { l: 0, a: 1, n: 2, s: 3 };
export const DOMAIN_NAMES: Record<string, string> = { l: 'Land', a: 'Air', n: 'Naval', s: 'Structure' };

export const METRICS: Record<string, (u: Unit) => number | null> = {
  alloys: (u) => u.cost.alloys,
  energy: (u) => u.cost.energy,
  buildTime: (u) => u.buildTime,
  health: (u) => u.health,
  dps: (u) => u.dps,
  projectileSpeed: (u) => u.projectileSpeed ?? 0,
  turnRate: (u) => u.movement?.rotationSpeed ?? 0,
  traverseSpeed: (u) => Math.max(0, ...u.weapons.map((w) => w.traverseSpeed ?? 0)),
};

export type SortKey = keyof typeof METRICS | 'default';

export interface BoardFilters {
  faction: Set<string>;
  domain: Set<string>;
  tier: Set<string>;
  role: Set<string>;
  status: Set<string>;
  search: string;
}

export interface Group {
  key: string;
  domain: string; // single-letter code from the id
  tier: number;
  label: string;
  role: string | null;
  code: string;
  units: Unit[];
  byFaction: Partial<Record<string, Unit[]>>;
}

export function matches(unit: Unit, f: BoardFilters): boolean {
  if (f.faction.size && !f.faction.has(unit.faction)) return false;
  if (f.domain.size && !f.domain.has(unit.domain)) return false;
  if (f.tier.size && !f.tier.has(String(unit.tier))) return false;
  if (f.role.size && !f.role.has(unit.role ?? '')) return false;
  if (f.status.size && !f.status.has(STATUS_LABELS[unit.status])) return false;

  if (f.search) {
    const q = f.search.toLowerCase();
    const haystack = [
      unit.id,
      unit.name,
      unit.displayName,
      unit.role,
      unit.faction,
      unit.domain,
      ...unit.tags,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    if (!haystack.includes(q)) return false;
  }
  return true;
}

/* ---------------- cross-faction grouping ---------------- */

// Template ids are u<faction><domain><code>, so uel1001 / ucl1001 / ugl1001 are
// the same slot in each faction's roster. Dropping the faction letter gives a
// key that lines equivalent units up across columns — Puma / Gladius / Gimlet.
//
// The id numbering is *nearly* tier-aligned, but not reliably: uel3002 "Hyena"
// is TECH2 (internally EDAT2FastUnit2 — EDA's second T2 raider) despite the 3,
// and uga3011 "TALEN" is TECH1. Grouping on the id alone therefore stranded
// Hyena in the T3 row, away from the other T2 raiders.
//
// So: bucket by id slot, split any slot spanning several tiers, then merge
// buckets that agree on domain, tier and label. Grouping purely by label
// instead would fix the raiders but shatter the slots where factions diverge in
// purpose — the 2806 row (repair station / shield booster / transmitter) would
// become nine single-faction rows instead of three aligned ones.
export function buildGroups(units: Unit[]): Group[] {
  const slots = new Map<string, Unit[]>();
  for (const unit of units) {
    const key = unit.id[2] + unit.id.slice(3);
    (slots.get(key) ?? slots.set(key, []).get(key)!).push(unit);
  }

  // Split slots whose members disagree on tier — they aren't equivalents.
  const parts: Unit[][] = [];
  for (const members of slots.values()) {
    const tiers = [...new Set(members.map((u) => u.tier))];
    if (tiers.length <= 1) parts.push(members);
    else for (const tier of tiers) parts.push(members.filter((u) => u.tier === tier));
  }

  const groups = new Map<string, Group>();
  for (const members of parts) {
    const first = members[0];
    const label = commonLabel(members);
    const key = `${first.id[2]}|${first.tier}|${label.toLowerCase()}`;

    if (!groups.has(key)) {
      groups.set(key, {
        key,
        domain: first.id[2],
        tier: first.tier ?? 0,
        label,
        role: members.find((u) => u.role)?.role ?? null,
        code: '',
        units: [],
        byFaction: {},
      });
    }
    const group = groups.get(key)!;
    for (const unit of members) {
      group.units.push(unit);
      (group.byFaction[unit.faction] ??= []).push(unit);
    }
  }

  // Order rows by the lowest id code they contain, so merged rows land where
  // the earlier of their slots used to sit.
  for (const group of groups.values()) {
    group.code = group.units.map((u) => u.id.slice(3)).sort()[0];
    group.role ??= group.units.find((u) => u.role)?.role ?? null;
  }

  return [...groups.values()].sort(byTechTree);
}

// Factions occasionally diverge within a slot (one gets a repair station where
// another gets a shield booster). Use the most common label and let the cards
// show the differences rather than hiding them.
function commonLabel(units: Unit[]): string {
  const counts = new Map<string, number>();
  for (const u of units) {
    const label = u.displayName.replace(/^Tier \d+:\s*/, '').trim();
    if (label) counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  if (!counts.size) return units[0]?.id ?? '';
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
}

export const byTechTree = (a: Group, b: Group): number =>
  DOMAIN_ORDER[a.domain] - DOMAIN_ORDER[b.domain] || a.tier - b.tier || a.code.localeCompare(b.code);

export function visibleGroups(groups: Group[], filters: BoardFilters, sort: SortKey): Group[] {
  const kept = groups
    .map((group) => {
      const units = group.units.filter((u) => matches(u, filters));
      return units.length ? { ...group, units, byFaction: groupByFaction(units) } : null;
    })
    .filter((g): g is Group => g !== null);

  if (sort === 'default') return kept;

  // Sorting keeps rows intact so the alignment survives — a row is ranked by its
  // strongest member, which is what you want when hunting for the costliest slot.
  const metric = METRICS[sort];
  const scoreOf = (g: Group) => Math.max(...g.units.map((u) => metric(u) ?? 0));
  return kept.sort((a, b) => scoreOf(b) - scoreOf(a) || byTechTree(a, b));
}

function groupByFaction(units: Unit[]): Partial<Record<string, Unit[]>> {
  const out: Partial<Record<string, Unit[]>> = {};
  for (const u of units) (out[u.faction] ??= []).push(u);
  return out;
}

// Columns follow the faction filter when one is active, so filtering to EDA
// collapses the layout to a single column instead of leaving two empty ones.
export function activeFactions(chosen: Set<string>): Faction[] {
  return FACTION_ORDER.filter((f) => !chosen.size || chosen.has(f));
}
