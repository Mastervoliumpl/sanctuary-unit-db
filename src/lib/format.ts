import type { Unit } from './types';

export function fmt(n: number | null | undefined, digits = 2): string {
  return n == null || Number.isNaN(n) ? '—' : n.toLocaleString('en-GB', { maximumFractionDigits: digits });
}

/** Seconds as a compact human duration — build times run from 1s to hours. */
export function duration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '—';
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  if (m < 60) return `${m}m ${String(s).padStart(2, '0')}s`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
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
