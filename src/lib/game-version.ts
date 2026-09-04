export interface LiveBuildCheck {
  live: { buildId: number; updatedAt: string | null } | null;
  upToDate: boolean | null;
  checkedAt?: string;
}

// Share one release lookup between the data toolbar and documentation.
let pending: Promise<LiveBuildCheck | null> | null = null;

export function checkLiveBuild(): Promise<LiveBuildCheck | null> {
  pending ??= fetch('/api/game-version')
    .then((response) => (response.ok ? (response.json() as Promise<LiveBuildCheck>) : null))
    .then((check) => (check ? { ...check, checkedAt: new Date().toISOString() } : null))
    .catch(() => null);
  return pending;
}
