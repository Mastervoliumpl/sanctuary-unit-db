import type { Unit } from './types';

export function fmt(n: number | null | undefined, digits = 2): string {
  return n == null || Number.isNaN(n) ? '—' : n.toLocaleString('en-GB', { maximumFractionDigits: digits });
}

// The templates spell the resource `alloys`, but it reads as a mass noun in
// play — "600 alloy", the way you'd say "600 mass" — so every label says
// "alloy". Several places print an economy table's own keys, which is why this
// is a lookup rather than a handful of literals: the field name stays exactly
// as units.json has it and only the label changes.
const RESOURCE_LABELS: Record<string, string> = { alloys: 'alloy' };
export const resourceName = (key: string): string => RESOURCE_LABELS[key] ?? key;

/** Seconds as a compact human duration — build times run from 1s to hours. */
export function duration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '—';
  if (seconds < 60) return `${fmt(seconds, 1)} s`;
  const total = Math.round(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  if (m < 60) return `${m} m ${s} s`;
  return `${Math.floor(m / 60)} h ${m % 60} m`;
}

// Many structures have no proper name, only a "Tier 2: Land Factory" label.
export function shortName(u: Unit): string {
  return u.displayName.replace(/^Tier \d+:\s*/, '') || u.id;
}

// In the build tree the same structure appears once per tier, so "Land Factory"
// three times over is useless — keep the tier on anything without a real name.
export function builderName(u: Unit): string {
  if (u.name) return u.name;
  return u.tier ? `T${u.tier} ${shortName(u)}` : shortName(u);
}

// "AOEDelayedCluster" -> "AOE Delayed Cluster"; the first pass breaks an
// acronym off the word that follows it, the second splits ordinary humps.
export const splitCamel = (s: string): string =>
  s.replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2').replace(/([a-z\d])([A-Z])/g, '$1 $2');
