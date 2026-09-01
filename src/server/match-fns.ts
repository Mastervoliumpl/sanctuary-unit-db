// Match lifecycle: view, cancel, report, confirm, dispute, profiles.
//
// Trust model (v1, manual reporting): either player reports the result, the
// opponent confirms or disputes, and an unanswered report auto-confirms after
// 15 minutes (swept lazily by finalize_due_matches — no cron). Disputed
// matches freeze until an admin rules on them.

import { createServerFn } from '@tanstack/react-start';
import { sql } from './db';
import { requirePlayer } from './player';
import type { MatchStatus, MatchView, Profile, ProfileMatch } from '../lib/ladder-types';

const AUTO_CONFIRM_MINUTES = 15;
const OPEN_STATES: MatchStatus[] = ['in_progress', 'reported', 'disputed'];

interface MatchRow {
  id: string;
  status: MatchStatus;
  map_name: string;
  host_player_id: string;
  reported_by: string | null;
  reported_winner_team: number | null;
  auto_confirm_at: Date | null;
  created_at: Date;
  completed_at: Date | null;
}

interface ParticipantRow {
  player_id: string;
  team: number;
  rating_before: number;
  rating_after: number | null;
  rating_delta: number | null;
  outcome: 'win' | 'loss' | null;
  steam_id: string;
  persona_name: string;
  avatar_url: string | null;
}

const toView = (m: MatchRow, participants: ParticipantRow[]): MatchView => ({
  id: m.id,
  status: m.status,
  mapName: m.map_name,
  hostPlayerId: m.host_player_id,
  reportedBy: m.reported_by,
  reportedWinnerTeam: m.reported_winner_team,
  autoConfirmAt: m.auto_confirm_at?.toISOString() ?? null,
  createdAt: m.created_at.toISOString(),
  completedAt: m.completed_at?.toISOString() ?? null,
  participants: participants.map((p) => ({
    playerId: p.player_id,
    steamId: p.steam_id,
    personaName: p.persona_name,
    avatarUrl: p.avatar_url,
    team: p.team,
    ratingBefore: p.rating_before,
    ratingAfter: p.rating_after,
    ratingDelta: p.rating_delta,
    outcome: p.outcome,
  })),
});

// Loads a match the caller is allowed to see, as the caller. Open matches are
// participant-only; finished ones are public record (they're on profiles).
// Invalid uuids throw like missing matches — same "not found" to the client.
async function loadMatchAs(
  matchId: string,
  playerId: string | null,
): Promise<{ match: MatchRow; participants: ParticipantRow[] }> {
  const [match] = await sql()<MatchRow[]>`select * from matches where id = ${matchId}`;
  if (!match) throw new Error('Match not found');
  const participants = await sql()<ParticipantRow[]>`
    select mp.player_id, mp.team, mp.rating_before, mp.rating_after, mp.rating_delta, mp.outcome,
           p.steam_id, coalesce(p.display_name, p.persona_name) as persona_name, p.avatar_url
    from match_participants mp join players p on p.id = mp.player_id
    where mp.match_id = ${matchId}
    order by mp.team`;
  const mine = playerId !== null && participants.some((p) => p.player_id === playerId);
  if (OPEN_STATES.includes(match.status) && !mine) throw new Error('Match not found');
  return { match, participants };
}

const view = async (matchId: string, playerId: string | null): Promise<MatchView> => {
  const { match, participants } = await loadMatchAs(matchId, playerId);
  return toView(match, participants);
};

const matchIdInput = (data: unknown): { matchId: string } => {
  const d = data as { matchId?: unknown } | null;
  if (typeof d?.matchId !== 'string' || !/^[0-9a-f-]{36}$/.test(d.matchId)) {
    throw new Error('matchId required');
  }
  return { matchId: d.matchId };
};

export const matchGet = createServerFn({ method: 'POST' })
  .validator(matchIdInput)
  .handler(async ({ data }): Promise<MatchView> => {
    await sql()`select finalize_due_matches()`;
    const me = await requirePlayer().catch(() => null);
    return view(data.matchId, me?.playerId ?? null);
  });

export const matchCancel = createServerFn({ method: 'POST' })
  .validator(matchIdInput)
  .handler(async ({ data }): Promise<MatchView> => {
    const me = await requirePlayer();
    await loadMatchAs(data.matchId, me.playerId);
    // The status guard makes concurrent cancel/report races resolve to
    // whichever write lands first; a stale loser just reloads the new state.
    await sql()`
      update matches set status = 'cancelled', cancelled_by = ${me.playerId}
      where id = ${data.matchId} and status = 'in_progress'`;
    return view(data.matchId, me.playerId);
  });

export const matchReport = createServerFn({ method: 'POST' })
  .validator((data: unknown): { matchId: string; winnerTeam: number } => {
    const { matchId } = matchIdInput(data);
    const d = data as { winnerTeam?: unknown };
    if (d.winnerTeam !== 1 && d.winnerTeam !== 2) throw new Error('winnerTeam must be 1 or 2');
    return { matchId, winnerTeam: d.winnerTeam };
  })
  .handler(async ({ data }): Promise<MatchView> => {
    const me = await requirePlayer();
    await loadMatchAs(data.matchId, me.playerId);
    await sql()`
      update matches set
        status = 'reported',
        reported_by = ${me.playerId},
        reported_winner_team = ${data.winnerTeam},
        auto_confirm_at = now() + interval '1 minute' * ${AUTO_CONFIRM_MINUTES}
      where id = ${data.matchId} and status = 'in_progress'`;
    return view(data.matchId, me.playerId);
  });

export const matchConfirm = createServerFn({ method: 'POST' })
  .validator(matchIdInput)
  .handler(async ({ data }): Promise<MatchView> => {
    const me = await requirePlayer();
    const { match } = await loadMatchAs(data.matchId, me.playerId);
    if (match.status === 'reported' && match.reported_by !== me.playerId) {
      await sql()`select apply_match_result(${data.matchId}, ${match.reported_winner_team})`;
    }
    return view(data.matchId, me.playerId);
  });

export const matchDispute = createServerFn({ method: 'POST' })
  .validator((data: unknown): { matchId: string; reason: string } => {
    const { matchId } = matchIdInput(data);
    const d = data as { reason?: unknown };
    return { matchId, reason: typeof d.reason === 'string' ? d.reason.slice(0, 500) : '' };
  })
  .handler(async ({ data }): Promise<MatchView> => {
    const me = await requirePlayer();
    const { match } = await loadMatchAs(data.matchId, me.playerId);
    if (match.status === 'reported' && match.reported_by !== me.playerId) {
      await sql()`
        update matches set status = 'disputed'
        where id = ${data.matchId} and status = 'reported'`;
      await sql()`
        insert into disputes (match_id, raised_by, reason)
        values (${data.matchId}, ${me.playerId}, ${data.reason})`;
    }
    return view(data.matchId, me.playerId);
  });

export const profileGet = createServerFn({ method: 'POST' })
  .validator((data: unknown): { steamId: string } => {
    const d = data as { steamId?: unknown } | null;
    if (typeof d?.steamId !== 'string' || !/^\d{17}$/.test(d.steamId)) {
      throw new Error('steamId required');
    }
    return { steamId: d.steamId };
  })
  .handler(async ({ data }): Promise<Profile | null> => {
    const [player] = await sql()<
      {
        id: string;
        steam_id: string;
        persona_name: string;
        avatar_url: string | null;
        rating: number;
        games_played: number;
        wins: number;
        losses: number;
      }[]
    >`
      select id, steam_id, coalesce(display_name, persona_name) as persona_name,
             avatar_url, rating, games_played, wins, losses
      from players where steam_id = ${data.steamId} and banned_at is null`;
    if (!player) return null;

    const rows = await sql()<
      {
        match_id: string;
        outcome: 'win' | 'loss';
        rating_after: number;
        rating_delta: number;
        map_name: string;
        completed_at: Date;
        opponent_steam_id: string;
        opponent_name: string;
      }[]
    >`
      select mp.match_id, mp.outcome, mp.rating_after, mp.rating_delta,
             m.map_name, m.completed_at,
             op_p.steam_id as opponent_steam_id,
             coalesce(op_p.display_name, op_p.persona_name) as opponent_name
      from match_participants mp
      join matches m on m.id = mp.match_id and m.status = 'completed'
      join match_participants op on op.match_id = mp.match_id and op.player_id <> mp.player_id
      join players op_p on op_p.id = op.player_id
      where mp.player_id = ${player.id}
      order by m.completed_at asc`;

    const history: ProfileMatch[] = rows.map((r) => ({
      matchId: r.match_id,
      mapName: r.map_name,
      opponentName: r.opponent_name,
      opponentSteamId: r.opponent_steam_id,
      outcome: r.outcome,
      ratingAfter: r.rating_after,
      ratingDelta: r.rating_delta,
      completedAt: r.completed_at.toISOString(),
    }));

    return {
      steamId: player.steam_id,
      personaName: player.persona_name,
      avatarUrl: player.avatar_url,
      rating: player.rating,
      gamesPlayed: player.games_played,
      wins: player.wins,
      losses: player.losses,
      history,
    };
  });
