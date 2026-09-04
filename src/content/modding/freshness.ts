export function snapshotFreshness(documentedBuild: number, knownBuild: number, liveBuild?: number | null) {
  const newestKnown = Math.max(knownBuild, liveBuild ?? 0);
  return {
    newestKnown,
    state: documentedBuild < newestKnown ? 'older' : liveBuild === documentedBuild ? 'current' : 'unknown',
  } as const;
}
