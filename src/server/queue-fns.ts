// The matchmaking queue. The 5-second queueStatus poll is the engine of the
// whole system: it is the heartbeat that keeps an entry alive, it sweeps
// overdue auto-confirms, and it runs a pairing pass — so matches form and
// finalise with no cron and no long-running process anywhere.

import { createServerFn } from '@tanstack/react-start';
import { sql } from './db';
import { requirePlayer } from './player';
import { ladderMapNames } from '../lib/ladder-maps';
import { searchRadius } from '../lib/matchmaking';
import type { LeaderboardRow, QueueStatus } from '../lib/ladder-types';

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

const runPairingPass = () => sql()`select pair_queue(${sql().array(ladderMapNames())}::text[])`;

const sweepDueMatches = () => sql()`select finalize_due_matches()`;

export const queueJoin = createServerFn({ method: 'POST' }).handler(async (): Promise<QueueStatus> => {
  const me = await requirePlayer();

  const open = await openMatchIdFor(me.playerId);
  if (open) return { state: 'matched', matchId: open };

  // Rejoining is just a refresh — keeps the original joined_at if present.
  await sql()`
      insert into queue_entries (player_id, rating)
      values (${me.playerId}, ${me.rating})
      on conflict (player_id) do update set rating = excluded.rating, heartbeat_at = now()`;

  await runPairingPass();

  const matched = await openMatchIdFor(me.playerId);
  if (matched) return { state: 'matched', matchId: matched };
  return { state: 'queued', queuedSeconds: 0, searchRadius: searchRadius(0) };
});

export const queueLeave = createServerFn({ method: 'POST' }).handler(async (): Promise<void> => {
  const me = await requirePlayer();
  await sql()`delete from queue_entries where player_id = ${me.playerId}`;
});

export const queueStatus = createServerFn({ method: 'POST' }).handler(async (): Promise<QueueStatus> => {
  const me = await requirePlayer();

  await sweepDueMatches();

  const open = await openMatchIdFor(me.playerId);
  if (open) return { state: 'matched', matchId: open };

  // Bump the heartbeat before pairing so this entry can't be swept as stale
  // by the very pass it triggered.
  const rows = await sql()<{ joined_at: Date }[]>`
      update queue_entries set heartbeat_at = now()
      where player_id = ${me.playerId}
      returning joined_at`;
  const entry = rows[0];
  if (!entry) return { state: 'idle' };

  await runPairingPass();

  const matched = await openMatchIdFor(me.playerId);
  if (matched) return { state: 'matched', matchId: matched };

  const queuedSeconds = Math.max(0, Math.floor((Date.now() - entry.joined_at.getTime()) / 1000));
  return { state: 'queued', queuedSeconds, searchRadius: searchRadius(queuedSeconds) };
});

export const leaderboard = createServerFn().handler(async (): Promise<LeaderboardRow[]> => {
  await sweepDueMatches();
  const rows = await sql()<
    {
      steam_id: string;
      persona_name: string;
      avatar_url: string | null;
      rating: number;
      games_played: number;
      wins: number;
      losses: number;
    }[]
  >`
    select steam_id, coalesce(display_name, persona_name) as persona_name,
           avatar_url, rating, games_played, wins, losses
    from players
    where games_played >= 1 and banned_at is null
    order by rating desc, games_played desc
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
