// The /maps page's data: a small committed manifest written by
// scripts/add-map.js. The zips themselves live as GitHub release assets, so
// the repo carries only metadata and previews; live download counts come from
// the GitHub API when it feels like answering.

export interface MapEntry {
  slug: string;
  name: string;
  author: string;
  description: string;
  players: number;
  width: number;
  length: number;
  hasWater: boolean;
  version: number;
  sizeBytes: number;
  addedAt: string;
  updatedAt: string;
  screenshots: string[];
  tag: string;
  download: string;
}

export interface MapsData {
  repo: string;
  updatedAt: string;
  maps: MapEntry[];
}

let cache: Promise<MapsData> | null = null;

export function loadMaps(): Promise<MapsData> {
  cache ??= fetch('/data/maps.json').then((res) => {
    if (!res.ok) throw new Error(`/data/maps.json returned ${res.status}`);
    return res.json();
  });
  return cache;
}

// Unauthenticated GitHub API: 60 requests/hour per visitor IP, which is plenty
// for one listing call. Counts are decoration — any failure just hides them.
export async function fetchDownloadCounts(repo: string): Promise<Map<string, number>> {
  try {
    const res = await fetch(`https://api.github.com/repos/${repo}/releases?per_page=100`);
    if (!res.ok) return new Map();
    const releases: { tag_name: string; assets: { download_count: number }[] }[] = await res.json();
    return new Map(releases.map((r) => [r.tag_name, r.assets.reduce((n, a) => n + a.download_count, 0)]));
  } catch {
    return new Map();
  }
}

export const sizeLabel = (m: MapEntry): string => `${m.width} × ${m.length}`;

export const fileSizeLabel = (bytes: number): string =>
  bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
