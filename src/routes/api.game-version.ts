// Is the database current? Answers with the Steam build the data was
// extracted from and the build the Playtest branch is serving right now.
//
//   GET /api/game-version
//   → {
//       appId, branch,
//       data: { buildId, updatedAt, generatedAt, unitCount },
//       live: { buildId, updatedAt } | null,   // null when the lookup failed
//       upToDate: boolean | null              // null when live is null
//     }
//
// Public and CORS-open on purpose: the in-game mod, a Discord bot or anyone
// else can poll it. The game has no version string of its own (Unity's
// bundleVersion is a permanent 1.0), so the Steam build id is the version.
//
// Valve publishes no key-free endpoint for a branch's build id, so the live
// half comes from api.steamcmd.net — a public mirror of `app_info_print` that
// refreshes when Steam's change number moves. It is cached here for five
// minutes and the CDN is told the same, so a burst of viewers costs one
// upstream call. If it is down the response still carries the data half.

import { createFileRoute } from '@tanstack/react-router';
import version from '../../public/data/version.json';

const APP_ID = version.game?.appId ?? 4511930;
const BRANCH = 'public';
const TTL_MS = 5 * 60 * 1000;
const UPSTREAM_TIMEOUT_MS = 6000;

interface LiveBuild {
  buildId: number;
  updatedAt: string | null;
}

let cached: { at: number; live: LiveBuild | null } | null = null;

async function fetchLive(): Promise<LiveBuild | null> {
  const res = await fetch(`https://api.steamcmd.net/v1/info/${APP_ID}`, {
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    headers: { 'User-Agent': 'SanctuaryDB (+https://sanctuarydb.vercel.app)' },
  });
  if (!res.ok) return null;
  const body = (await res.json()) as {
    data?: Record<
      string,
      { depots?: { branches?: Record<string, { buildid?: string; timeupdated?: string }> } }
    >;
  };
  const branch = body.data?.[APP_ID]?.depots?.branches?.[BRANCH];
  const buildId = Number(branch?.buildid);
  if (!buildId) return null;
  const updated = Number(branch?.timeupdated);
  return { buildId, updatedAt: updated ? new Date(updated * 1000).toISOString() : null };
}

async function liveBuild(): Promise<LiveBuild | null> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.live;
  const live = await fetchLive().catch(() => null);
  // A failed lookup is cached for a shorter while, so an outage doesn't
  // hammer the mirror but recovers quickly.
  cached = { at: live ? Date.now() : Date.now() - TTL_MS + 30_000, live };
  return live;
}

export const Route = createFileRoute('/api/game-version')({
  server: {
    handlers: {
      GET: async () => {
        const live = await liveBuild();
        const data = {
          buildId: version.game?.buildId ?? null,
          updatedAt: version.game?.updatedAt ?? null,
          generatedAt: version.generatedAt,
          unitCount: version.unitCount,
        };
        const body = {
          appId: APP_ID,
          branch: BRANCH,
          data,
          live,
          upToDate: live && data.buildId ? live.buildId === data.buildId : null,
        };
        return new Response(JSON.stringify(body), {
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'public, max-age=60, s-maxage=300, stale-while-revalidate=3600',
          },
        });
      },
    },
  },
});
