import { useEffect, useState } from 'react';
import { Link } from '@tanstack/react-router';
import version from '../../../public/data/version.json';
import { checkLiveBuild, type LiveBuildCheck } from '../../lib/game-version';
import { MODDING_SNAPSHOTS, resolveVersionSwitch, type ModdingSnapshot } from './registry';
import { snapshotFreshness } from './freshness';

export function SnapshotNotice({
  snapshot,
  documentPath,
  paths,
}: {
  snapshot: ModdingSnapshot;
  documentPath: string;
  paths: Record<string, string[]>;
}) {
  const [check, setCheck] = useState<LiveBuildCheck | null>(null);
  useEffect(() => {
    let active = true;
    void checkLiveBuild().then((result) => {
      if (active) setCheck(result);
    });
    return () => {
      active = false;
    };
  }, []);

  const latestDocumented = MODDING_SNAPSHOTS[0];
  const knownBuild = Math.max(version.game?.buildId ?? 0, latestDocumented.steamBuild);
  const knownOn =
    latestDocumented.steamBuild > (version.game?.buildId ?? 0)
      ? latestDocumented.inspectedOn
      : version.generatedAt.slice(0, 10);
  const freshness = snapshotFreshness(snapshot.steamBuild, knownBuild, check?.live?.buildId);
  const newerSnapshot = latestDocumented.steamBuild > snapshot.steamBuild ? latestDocumented : undefined;
  const target = newerSnapshot
    ? resolveVersionSwitch(newerSnapshot, documentPath, paths[newerSnapshot.id] ?? [])
    : undefined;

  return (
    <div className="docs-version-notice" data-freshness={freshness.state} aria-live="polite">
      {freshness.state === 'older' ? (
        <>
          <p>
            This snapshot describes an older build: Steam {snapshot.steamBuild}. Build {freshness.newestKnown}{' '}
            is known to be available. Paths, counts, and behavior may differ.
          </p>
          {newerSnapshot && target ? (
            <Link
              to="/modding/$version/$"
              params={{ version: newerSnapshot.id, _splat: target.documentPath }}
              search={{ versionFallback: target.fallbackFrom }}
            >
              Read the newer documented snapshot (Steam {newerSnapshot.steamBuild})
            </Link>
          ) : (
            <p>Documentation for the newer build is not yet available.</p>
          )}
        </>
      ) : freshness.state === 'current' ? (
        <p>This snapshot matches the Steam build returned by the latest release check.</p>
      ) : (
        <p>
          The live Steam build could not be confirmed. These pages describe build {snapshot.steamBuild};
          compare it with your installed build.
        </p>
      )}
      <small>
        {check?.live
          ? `Steam build check: ${check.checkedAt?.slice(0, 10)}.`
          : `Known build verified ${knownOn} from inspected game data. Live release status is unavailable.`}
      </small>
    </div>
  );
}
