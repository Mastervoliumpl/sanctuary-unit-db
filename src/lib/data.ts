import type { Unit, UnitsData } from './types';

// One fetch per session, shared by every route loader. Routes run with
// ssr: false, so this only ever executes in the browser.

export interface LoadedData {
  data: UnitsData;
  byId: Map<string, Unit>;
  /** Icon combos with real extracted artwork in /icons/<faction>/. */
  iconManifest: Set<string>;
  /** Unit ids with an extracted 64px render in /previews/. */
  previews: Set<string>;
}

let cache: Promise<LoadedData> | null = null;

export function loadData(): Promise<LoadedData> {
  cache ??= load();
  return cache;
}

async function load(): Promise<LoadedData> {
  const [data, iconManifest, previews] = await Promise.all([
    fetchJson<UnitsData>('/data/units.json'),
    // Both manifests are optional: without them icons fall back to generated
    // SVG and the preview panel is simply omitted.
    fetchJson<string[]>('/icons/manifest.json').catch(() => []),
    fetchJson<string[]>('/previews/manifest.json').catch(() => []),
  ]);

  return {
    data,
    byId: new Map(data.units.map((u) => [u.id, u])),
    iconManifest: new Set(iconManifest),
    previews: new Set(previews),
  };
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} returned ${res.status}`);
  return res.json();
}
