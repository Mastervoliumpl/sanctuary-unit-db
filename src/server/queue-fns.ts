// The matchmaking queues — one per mode, and a player may wait in several at
// once. The 5-second queueStatus poll is the engine of the whole system: it
// is the heartbeat that keeps entries alive, it sweeps overdue auto-confirms,
// and it runs a pairing pass for every mode the caller is queued in — so
// matches form and finalise with no cron and no long-running process.

import { createServerFn } from '@tanstack/react-start';
import { sql } from './db';
import { requirePlayer } from './player';
import { LADDER_MAPS, type LadderMap } from '../lib/ladder-maps';
import {
  MODES,
  isLeaderboardMode,
  isMode,
  playersNeeded,
  type LeaderboardMode,
  type Mode,
} from '../lib/ladder-modes';
import { searchRadius } from '../lib/matchmaking';
import type { LeaderboardRow, PlayStatus, QueueCounts, QueueModeStatus } from '../lib/ladder-types';

// A player's open match, if any — the one they should be looking at instead
// of queueing.
async function openMatchIdFor(playerId: string): Promise<string | null> {
  const rows = await sql()<{ match_id: string }[]>`
    select mp.match_id
    from match_participants mp
    join matches m on m.id = mp.match_id
    where mp.player_id = ${playerId}
      and m.status in ('in_progress', 'reported', 'disputed')
    limit 1`;
  return rows[0]?.match_id ?? null;
}

// The live pool for a mode, curated on the admin page. An emptied pool
// falls back to the seed list rather than leaving a mode unplayable.
async function poolFor(mode: Mode): Promise<LadderMap[]> {
  const rows = await sql()<{ name: string; size: number }[]>`
    select name, size from ladder_maps where mode = ${mode} and enabled order by name`;
  return rows.length > 0 ? rows : LADDER_MAPS[mode];
}

const runPairingPass = async (mode: Mode) => {
  const names = (await poolFor(mode)).map((m) => m.name);
  await sql()`select pair_queue(${mode}, ${sql().array(names)}::text[])`;
};

// The enabled pools, for the standings sidebar.
export const mapPools = createServerFn().handler(async (): Promise<Record<Mode, LadderMap[]>> => {
  const pools = {} as Record<Mode, LadderMap[]>;
  for (const mode of MODES) pools[mode] = await poolFor(mode);
  return pools;
});

const sweepDueMatches = () => sql()`select finalize_due_matches()`;

// Live entries only: stale ones are swept by pairing passes, but the count is
// read by visitors who never trigger one. Plus how many games are on right
// now — the other half of "is anything happening?".
async function countQueues(): Promise<QueueCounts> {
  const rows = await sql()<{ mode: Mode; n: number }[]>`
    select mode, count(*)::int as n from queue_entries
    where heartbeat_at > now() - interval '90 seconds'
    group by mode`;
  const waiting: Record<Mode, number> = { '1v1': 0, '2v2': 0, '3v3': 0 };
  for (const r of rows) waiting[r.mode] = r.n;
  const [live] = await sql()<{ n: number }[]>`
    select count(*)::int as n from matches where status in ('in_progress', 'reported', 'disputed')`;
  return { waiting, liveGames: live?.n ?? 0 };
}

async function playStatus(playerId: string): Promise<PlayStatus> {
  const matchId = await openMatchIdFor(playerId);
  const mine = await sql()<{ mode: Mode; joined_at: Date }[]>`
    select mode, joined_at from queue_entries where player_id = ${playerId}`;
  const counts = await countQueues();

  const queues = {} as Record<Mode, QueueModeStatus>;
  for (const mode of MODES) {
    const entry = mine.find((m) => m.mode === mode);
    const queuedSeconds = entry
      ? Math.max(0, Math.floor((Date.now() - entry.joined_at.getTime()) / 1000))
      : null;
    queues[mode] = {
      inQueue: entry !== undefined,
      queuedSeconds,
      searchRadius: queuedSeconds === null ? null : searchRadius(queuedSeconds),
      waiting: counts.waiting[mode],
      needed: playersNeeded(mode),
    };
  }
  return { matchId, queues, liveGames: counts.liveGames };
}

const modeInput = (data: unknown): { mode: Mode } => {
  const d = data as { mode?: unknown } | null;
  if (!isMode(d?.mode)) throw new Error('mode required');
  return { mode: d.mode };
};

export const queueJoin = createServerFn({ method: 'POST' })
  .validator(modeInput)
  .handler(async ({ data }): Promise<PlayStatus> => {
    const me = await requirePlayer();
    if (await openMatchIdFor(me.playerId)) return playStatus(me.playerId);

    // The rating snapshot the matchmaker balances on is this mode's.
    await sql()`select ensure_rating(${me.playerId}, ${data.mode})`;
    await sql()`
      insert into queue_entries (player_id, mode, rating)
      select ${me.playerId}, ${data.mode}, rating
      from player_ratings where player_id = ${me.playerId} and mode = ${data.mode}
      on conflict (player_id, mode) do update set rating = excluded.rating, heartbeat_at = now()`;

    await runPairingPass(data.mode);
    return playStatus(me.playerId);
  });

export const queueLeave = createServerFn({ method: 'POST' })
  .validator(modeInput)
  .handler(async ({ data }): Promise<PlayStatus> => {
    const me = await requirePlayer();
    await sql()`delete from queue_entries where player_id = ${me.playerId} and mode = ${data.mode}`;
    return playStatus(me.playerId);
  });

export const queueStatus = createServerFn({ method: 'POST' }).handler(async (): Promise<PlayStatus> => {
  const me = await requirePlayer();

  await sweepDueMatches();

  // Bump the heartbeat before pairing so these entries can't be swept as
  // stale by the very passes they trigger.
  const mine = await sql()<{ mode: Mode }[]>`
    update queue_entries set heartbeat_at = now()
    where player_id = ${me.playerId}
    returning mode`;
  for (const { mode } of mine) await runPairingPass(mode);

  return playStatus(me.playerId);
});

// For visitors who aren't signed in: how alive each queue is.
export const queueCounts = createServerFn().handler(async (): Promise<QueueCounts> => countQueues());

export const leaderboard = createServerFn()
  .validator((data: unknown): { mode: LeaderboardMode } => {
    const d = data as { mode?: unknown } | null;
    return { mode: isLeaderboardMode(d?.mode) ? d.mode : '1v1' };
  })
  .handler(async ({ data }): Promise<LeaderboardRow[]> => {
    await sweepDueMatches();
    interface Row {
      steam_id: string;
      persona_name: string;
      avatar_url: string | null;
      rating: number;
      games_played: number;
      wins: number;
      losses: number;
    }
    const rows =
      data.mode === 'overall'
        ? // Games-weighted across the modes each player has actually played.
          await sql()<Row[]>`
            select p.steam_id, coalesce(p.display_name, p.persona_name) as persona_name, p.avatar_url,
                   round(sum(pr.rating * pr.games_played)::numeric / sum(pr.games_played))::int as rating,
                   sum(pr.games_played)::int as games_played, sum(pr.wins)::int as wins, sum(pr.losses)::int as losses
            from player_ratings pr join players p on p.id = pr.player_id
            where pr.games_played > 0 and p.banned_at is null
            group by p.id
            order by rating desc, games_played desc
            limit 100`
        : await sql()<Row[]>`
            select p.steam_id, coalesce(p.display_name, p.persona_name) as persona_name, p.avatar_url,
                   pr.rating, pr.games_played, pr.wins, pr.losses
            from player_ratings pr join players p on p.id = pr.player_id
            where pr.mode = ${data.mode} and pr.games_played >= 1 and p.banned_at is null
            order by pr.rating desc, pr.games_played desc
            limit 100`;
    return rows.map((p, i) => ({
      rank: i + 1,
      steamId: p.steam_id,
      personaName: p.persona_name,
      avatarUrl: p.avatar_url,
      rating: p.rating,
      gamesPlayed: p.games_played,
      wins: p.wins,
      losses: p.losses,
    }));
  });
